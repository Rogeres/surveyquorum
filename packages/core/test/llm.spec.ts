import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { LlmClient, LlmRequest } from '../src/detectors/types.js';
import {
  AgentFileClient,
  agentInstructions,
  ingestAgentResponses,
  REQUESTS_FILE,
  RESPONSES_FILE,
} from '../src/llm/agent-file.js';
import { AnthropicClient } from '../src/llm/anthropic.js';
import { cachePath, createFileCache, withCache } from '../src/llm/cache.js';
import { createLlmClient, createRawLlmClient } from '../src/llm/client.js';
import { isYandexCloud, loadLlmConfigFromEnv, resolveAuthScheme } from '../src/llm/config.js';
import { estimateCost, formatCost, priceClassFor } from '../src/llm/cost.js';
import { requestCacheKey, sha256 } from '../src/llm/hash.js';
import { parseJsonReply, validateJson } from '../src/llm/json-schema.js';
import { OpenAiCompatibleClient } from '../src/llm/openai-compatible.js';
import { mapPool } from '../src/llm/pool.js';
import { fillPrompt } from '../src/llm/prompt.js';

const SCHEMA = {
  type: 'object',
  required: ['label', 'confidence'],
  properties: {
    label: { type: 'string', enum: ['ok', 'bad'] },
    confidence: { type: 'integer', minimum: 1, maximum: 5 },
    tags: { type: 'array', items: { type: 'string' } },
  },
};

function request(prompt = 'classify this', role: LlmRequest['role'] = 'classifier'): LlmRequest {
  return { role, prompt, schema: SCHEMA, cacheKey: requestCacheKey(role, prompt, SCHEMA) };
}

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'sq-llm-'));
}

/** fetch stub that serves canned bodies in order and records every call. */
function fakeFetch(replies: { status: number; body: unknown }[]) {
  const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] =
    [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    const reply = replies.shift();
    if (!reply) throw new Error('no more canned replies');
    calls.push({
      url: String(url),
      headers: Object.fromEntries(
        Object.entries((init?.headers as Record<string, string>) ?? {}).map(([k, v]) => [
          k.toLowerCase(),
          v,
        ]),
      ),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    return new Response(typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body), {
      status: reply.status,
    });
  }) as typeof fetch;
  return { impl, calls };
}

function chat(content: string, status = 200) {
  return {
    status,
    body: {
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    },
  };
}

describe('json-schema', () => {
  it('accepts a conforming value and reports violations by path', () => {
    expect(validateJson({ label: 'ok', confidence: 3 }, SCHEMA)).toEqual([]);
    expect(validateJson({ label: 'meh', confidence: 3 }, SCHEMA)[0]).toContain('$.label');
    expect(validateJson({ label: 'ok' }, SCHEMA)[0]).toContain('confidence: required');
    expect(validateJson({ label: 'ok', confidence: 2.5 }, SCHEMA)[0]).toContain('integer');
    expect(validateJson({ label: 'ok', confidence: 9 }, SCHEMA)[0]).toContain('<= 5');
    expect(validateJson({ label: 'ok', confidence: 1, tags: ['a', 2] }, SCHEMA)[0]).toContain(
      '$.tags[1]',
    );
    expect(validateJson('nope', SCHEMA)[0]).toContain('expected object');
  });

  it('parses JSON out of fences and prose', () => {
    expect(parseJsonReply('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonReply('Sure! Here it is: {"a":[1,2]} hope it helps')).toEqual({ a: [1, 2] });
    expect(() => parseJsonReply('no json here')).toThrow();
  });

  it('hashes deterministically and distinguishes part boundaries', () => {
    expect(sha256('a', 'b')).toBe(sha256('a', 'b'));
    expect(sha256('ab', 'c')).not.toBe(sha256('a', 'bc'));
    expect(requestCacheKey('classifier', 'p', SCHEMA)).toHaveLength(64);
  });

  it('fills prompt placeholders and refuses missing ones', () => {
    expect(fillPrompt('Q: {question} A: {answer}', { question: 'x', answer: 'y' })).toBe(
      'Q: x A: y',
    );
    expect(() => fillPrompt('{missing}', {})).toThrow(/missing/);
  });

  it('mapPool preserves order under concurrency', async () => {
    const out = await mapPool([3, 1, 2], 2, async (x) => {
      await new Promise((r) => setTimeout(r, x));
      return x * 10;
    });
    expect(out).toEqual([30, 10, 20]);
  });
});

describe('file cache', () => {
  it('misses, stores, then hits; pending answers are never stored', async () => {
    const dir = tmp();
    let calls = 0;
    let pendingMode = false;
    const inner: LlmClient = {
      async complete() {
        calls++;
        return pendingMode
          ? { json: null, pending: true }
          : { json: { label: 'ok', confidence: 4 } };
      },
    };
    const client = withCache(inner, dir);
    const first = await client.complete(request());
    expect(first.fromCache).toBeUndefined();
    const second = await client.complete(request());
    expect(second.fromCache).toBe(true);
    expect(second.json).toEqual({ label: 'ok', confidence: 4 });
    expect(calls).toBe(1);
    expect(client.stats).toEqual({ hits: 1, misses: 1, pending: 0 });
    expect(readFileSync(cachePath(dir, request().cacheKey), 'utf8')).toContain('"label": "ok"');

    pendingMode = true;
    const other = request('something else');
    expect((await client.complete(other)).pending).toBe(true);
    expect(createFileCache(dir).has(other.cacheKey)).toBe(false);
    expect(client.stats.pending).toBe(1);
  });

  it('uses a two-level hash directory', () => {
    expect(cachePath('/c', 'abcdef')).toBe(join('/c', 'ab', 'cd', 'abcdef.json'));
  });
});

describe('agent-file mode', () => {
  it('writes each request once, answers pending, and resume ingests responses into the cache', async () => {
    const dir = tmp();
    const agent = new AgentFileClient(dir);
    const cache = createFileCache(join(dir, 'llm-cache'));
    const client = withCache(agent, cache);
    const r1 = request('first');
    const r2 = request('second', 'arbiter');
    expect((await client.complete(r1)).pending).toBe(true);
    expect((await client.complete(r1)).pending).toBe(true);
    expect((await client.complete(r2)).pending).toBe(true);
    expect(agent.pendingCount).toBe(2);
    const lines = readFileSync(join(dir, REQUESTS_FILE), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    const parsed = JSON.parse(lines[1]);
    expect(parsed).toMatchObject({ id: r2.cacheKey, role: 'arbiter', prompt: 'second' });
    expect(parsed.schema).toEqual(SCHEMA);
    expect(agentInstructions(dir, 2)).toContain('judge-responses.jsonl');

    writeFileSync(
      join(dir, RESPONSES_FILE),
      [
        JSON.stringify({ id: r1.cacheKey, json: { label: 'bad', confidence: 5 } }),
        JSON.stringify({ id: r2.cacheKey, json: { label: 'nonsense', confidence: 5 } }),
        'not json at all',
        JSON.stringify({ nope: true }),
      ].join('\n'),
    );
    const ingest = ingestAgentResponses(cache, dir);
    expect(ingest.accepted).toBe(1);
    expect(ingest.rejected.map((r) => r.line)).toEqual([2, 3, 4]);
    expect(ingest.rejected[0].reason).toContain('$.label');

    // A second run (fresh client = truncated requests file) now hits the cache for r1 only.
    const agent2 = new AgentFileClient(dir);
    const client2 = withCache(agent2, cache);
    const got = await client2.complete(r1);
    expect(got.fromCache).toBe(true);
    expect(got.json).toEqual({ label: 'bad', confidence: 5 });
    expect((await client2.complete(r2)).pending).toBe(true);
    expect(agent2.pendingCount).toBe(1);
    expect(readFileSync(join(dir, REQUESTS_FILE), 'utf8').trim().split('\n')).toHaveLength(1);
  });

  it('rejects answers to ids that were never requested and leaves only rejected lines in the file', async () => {
    const dir = tmp();
    const agent = new AgentFileClient(dir);
    const cache = createFileCache(join(dir, 'llm-cache'));
    const client = withCache(agent, cache);
    const r1 = request('asked');
    expect((await client.complete(r1)).pending).toBe(true);
    const good = JSON.stringify({ id: r1.cacheKey, json: { label: 'bad', confidence: 5 } });
    const stray = JSON.stringify({ id: 'deadbeef', json: { label: 'bad', confidence: 5 } });
    writeFileSync(join(dir, RESPONSES_FILE), `${good}\n${stray}\n`);
    const ingest = ingestAgentResponses(cache, dir);
    expect(ingest.accepted).toBe(1);
    expect(ingest.rejected).toEqual([
      {
        line: 2,
        reason: expect.stringMatching(
          /id "deadbeef" is not among the pending requests.*not cached/,
        ),
      },
    ]);
    expect(cache.has('deadbeef')).toBe(false);
    expect(cache.has(r1.cacheKey)).toBe(true);
    expect(readFileSync(join(dir, RESPONSES_FILE), 'utf8')).toBe(`${stray}\n`);
    // Nothing accepted: the file is left alone, so a second resume reports the same lines.
    expect(ingestAgentResponses(cache, dir).rejected).toHaveLength(1);
    expect(readFileSync(join(dir, RESPONSES_FILE), 'utf8')).toBe(`${stray}\n`);
  });

  it('factory builds an agent-file client for the provider', async () => {
    const dir = tmp();
    const client = createLlmClient({
      provider: 'agent-file',
      models: { classifier: 'agent', arbiter: 'agent' },
      agentDir: dir,
      cacheDir: join(dir, 'cache'),
    });
    expect((await client.complete(request())).pending).toBe(true);
    expect(readFileSync(join(dir, REQUESTS_FILE), 'utf8')).toContain('"classify this"');
  });
});

describe('openai-compatible client', () => {
  const config = {
    provider: 'openai-compatible' as const,
    baseUrl: 'https://example.invalid/v1',
    apiKey: 'test-key-not-real',
    models: { classifier: 'mini-model', arbiter: 'big-model' },
  };

  it('validates the reply and retries once with the error appended', async () => {
    const f = fakeFetch([
      chat('{"label":"meh","confidence":3}'),
      chat('{"label":"ok","confidence":3}'),
    ]);
    const client = new OpenAiCompatibleClient(config, { fetchImpl: f.impl, backoffMs: 0 });
    const res = await client.complete(request());
    expect(res.json).toEqual({ label: 'ok', confidence: 3 });
    expect(res.usage).toEqual({ inputTokens: 20, outputTokens: 10 });
    expect(f.calls).toHaveLength(2);
    expect(f.calls[0].url).toBe('https://example.invalid/v1/chat/completions');
    expect(f.calls[0].headers.authorization).toBe('Bearer test-key-not-real');
    expect(f.calls[0].body.model).toBe('mini-model');
    expect(f.calls[0].body.response_format).toEqual({ type: 'json_object' });
    const retryPrompt = (f.calls[1].body.messages as { content: string }[])[0].content;
    expect(retryPrompt).toContain('did not satisfy the schema');
    expect(retryPrompt).toContain('$.label');
  });

  it('gives up after two invalid replies', async () => {
    const f = fakeFetch([chat('garbage'), chat('still garbage')]);
    const client = new OpenAiCompatibleClient(config, { fetchImpl: f.impl, backoffMs: 0 });
    await expect(client.complete(request())).rejects.toThrow(/schema validation twice/);
  });

  it('retries on 429 and 5xx with backoff, routes the arbiter role to its model', async () => {
    const f = fakeFetch([
      { status: 429, body: { error: { message: 'slow down' } } },
      { status: 503, body: 'upstream down' },
      chat('```json\n{"label":"bad","confidence":5}\n```'),
    ]);
    const client = new OpenAiCompatibleClient(config, { fetchImpl: f.impl, backoffMs: 0 });
    const res = await client.complete(request('p', 'arbiter'));
    expect(res.json).toEqual({ label: 'bad', confidence: 5 });
    expect(f.calls).toHaveLength(3);
    expect(f.calls[2].body.model).toBe('big-model');
  });

  it('drops response_format when the server rejects it with 400, for the rest of the run', async () => {
    const f = fakeFetch([
      { status: 400, body: { error: { message: 'response_format unsupported' } } },
      chat('{"label":"ok","confidence":1}'),
      chat('{"label":"ok","confidence":2}'),
    ]);
    const client = new OpenAiCompatibleClient(config, { fetchImpl: f.impl, backoffMs: 0 });
    expect((await client.complete(request('a'))).json).toEqual({ label: 'ok', confidence: 1 });
    expect((await client.complete(request('b'))).json).toEqual({ label: 'ok', confidence: 2 });
    expect(f.calls[1].body.response_format).toBeUndefined();
    expect(f.calls[2].body.response_format).toBeUndefined();
  });

  it('sends strict json_schema when asked', async () => {
    const f = fakeFetch([chat('{"label":"ok","confidence":1}')]);
    const client = new OpenAiCompatibleClient(
      { ...config, strictJsonSchema: true },
      { fetchImpl: f.impl, backoffMs: 0 },
    );
    await client.complete(request());
    expect(f.calls[0].body.response_format).toMatchObject({
      type: 'json_schema',
      json_schema: { strict: true, schema: SCHEMA },
    });
  });

  it('speaks Yandex Cloud: Api-Key header, no strict json_schema', async () => {
    const f = fakeFetch([chat('{"label":"ok","confidence":1}')]);
    const yandex = {
      ...config,
      baseUrl: 'https://llm.api.cloud.yandex.net/v1',
      strictJsonSchema: true,
      models: { classifier: 'gpt://folder/yandexgpt/latest', arbiter: 'gpt://folder/qwen/latest' },
    };
    expect(isYandexCloud(yandex.baseUrl)).toBe(true);
    expect(resolveAuthScheme(yandex)).toBe('api-key');
    expect(resolveAuthScheme({ ...yandex, authScheme: 'bearer' })).toBe('bearer');
    expect(resolveAuthScheme(config)).toBe('bearer');
    const client = new OpenAiCompatibleClient(yandex, { fetchImpl: f.impl, backoffMs: 0 });
    await client.complete(request());
    expect(f.calls[0].url).toBe('https://llm.api.cloud.yandex.net/v1/chat/completions');
    expect(f.calls[0].headers.authorization).toBe('Api-Key test-key-not-real');
    expect(f.calls[0].body.model).toBe('gpt://folder/yandexgpt/latest');
    expect(f.calls[0].body.response_format).toEqual({ type: 'json_object' });
  });
});

describe('anthropic client', () => {
  it('posts to /v1/messages with the version header and reads the text block', async () => {
    const f = fakeFetch([
      {
        status: 200,
        body: {
          content: [{ type: 'text', text: '{"label":"ok","confidence":2}' }],
          usage: { input_tokens: 7, output_tokens: 3 },
        },
      },
    ]);
    const client = new AnthropicClient(
      { provider: 'anthropic', apiKey: 'k', models: { classifier: 'small', arbiter: 'large' } },
      { fetchImpl: f.impl, backoffMs: 0 },
    );
    const res = await client.complete(request());
    expect(res.json).toEqual({ label: 'ok', confidence: 2 });
    expect(res.usage).toEqual({ inputTokens: 7, outputTokens: 3 });
    expect(f.calls[0].url).toBe('https://api.anthropic.com/v1/messages');
    expect(f.calls[0].headers['anthropic-version']).toBe('2023-06-01');
    expect(f.calls[0].headers['x-api-key']).toBe('k');
    expect(f.calls[0].body.model).toBe('small');
    expect(f.calls[0].body.max_tokens).toBeGreaterThan(0);
  });

  it('factory picks the transport by provider', () => {
    const models = { classifier: 'a', arbiter: 'b' };
    expect(createRawLlmClient({ provider: 'anthropic', models })).toBeInstanceOf(AnthropicClient);
    expect(createRawLlmClient({ provider: 'openai-compatible', models })).toBeInstanceOf(
      OpenAiCompatibleClient,
    );
  });
});

describe('config', () => {
  it('returns undefined without any configuration', () => {
    expect(loadLlmConfigFromEnv({}, tmp())).toBeUndefined();
  });

  it('reads env first, then the config file, defaulting the arbiter model to the classifier', () => {
    const dir = tmp();
    writeFileSync(
      join(dir, 'surveyquorum.config.json'),
      JSON.stringify({
        provider: 'openai-compatible',
        model: 'file-model',
        baseUrl: 'http://localhost:11434/v1',
      }),
    );
    const fromFile = loadLlmConfigFromEnv({}, dir);
    expect(fromFile).toMatchObject({
      provider: 'openai-compatible',
      baseUrl: 'http://localhost:11434/v1',
      models: { classifier: 'file-model', arbiter: 'file-model' },
    });
    const fromEnv = loadLlmConfigFromEnv(
      {
        SURVEYQUORUM_LLM_MODEL: 'env-model',
        SURVEYQUORUM_LLM_ARBITER_MODEL: 'env-arbiter',
        SURVEYQUORUM_LLM_AUTH_SCHEME: 'api-key',
      },
      dir,
    );
    expect(fromEnv?.models).toEqual({ classifier: 'env-model', arbiter: 'env-arbiter' });
    expect(fromEnv?.authScheme).toBe('api-key');
    expect(fromEnv?.baseUrl).toBe('http://localhost:11434/v1');
    expect(() =>
      loadLlmConfigFromEnv({ SURVEYQUORUM_LLM_PROVIDER: 'carrier-pigeon' }, tmp()),
    ).toThrow(/unknown LLM provider/);
    expect(
      loadLlmConfigFromEnv({ SURVEYQUORUM_LLM_PROVIDER: 'agent-file' }, tmp())?.models,
    ).toEqual({
      classifier: 'agent',
      arbiter: 'agent',
    });
  });
});

describe('cost estimate', () => {
  it('matches a price class by model id and falls back to generic', () => {
    expect(priceClassFor('gpt-4o-mini')).toBe('openai-mini');
    expect(priceClassFor('claude-haiku-x')).toBe('anthropic-haiku');
    expect(priceClassFor('gpt://folder/qwen3-235b/latest')).toBe('qwen');
    expect(priceClassFor('mystery-model')).toBe('generic');
    const e = estimateCost({
      requests: 1000,
      avgInputTokens: 1000,
      avgOutputTokens: 100,
      model: 'gpt-4o-mini',
    });
    expect(e.inputTokens).toBe(1_000_000);
    expect(e.usd).toBeCloseTo(0.4 + 0.16, 3);
    expect(formatCost(e, 'gpt-4o-mini')).toContain('1000 requests');
    expect(formatCost(e, 'gpt-4o-mini')).toContain('verify');
  });
});
