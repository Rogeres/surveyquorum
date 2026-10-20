// promptfoo custom provider: runs the skill through the local `claude -p` CLI (subscription, no API key).
// Async spawn so that `-j N` really runs N cases at once.
// Config: { model: 'sonnet' | 'opus' | 'haiku' | <model id> }.
// The prompt arrives as a JSON array of chat messages (see prompts/review.mjs); system goes to --system-prompt.
import { spawn } from 'node:child_process';

export default class ClaudeCli {
  constructor(options = {}) {
    this.model = options.config?.model ?? 'sonnet';
    this.timeoutMs = options.config?.timeoutMs ?? 900_000;
  }
  id() { return `claude-cli:${this.model}`; }
  async callApi(prompt) {
    let messages;
    try { messages = JSON.parse(prompt); } catch { messages = [{ role: 'user', content: prompt }]; }
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const user = messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n\n');
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT'].includes(k)));
    const r = await new Promise((resolve) => {
      const child = spawn('claude', ['-p', '--model', this.model, '--system-prompt', system, '--output-format', 'json', '--max-turns', '1',
        '--disallowedTools', 'Bash,Read,Write,Edit,WebFetch,WebSearch,Agent,Grep,Glob'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '', stderr = '';
      const timer = setTimeout(() => { child.kill('SIGKILL'); stderr += `\ntimeout after ${this.timeoutMs} ms`; }, this.timeoutMs);
      child.stdout.on('data', (d) => { stdout += d; });
      child.stderr.on('data', (d) => { stderr += d; });
      child.on('error', (e) => { clearTimeout(timer); resolve({ status: -1, stdout, stderr: String(e) }); });
      child.on('close', (status) => { clearTimeout(timer); resolve({ status, stdout, stderr }); });
      child.stdin.end(user);
    });
    if (r.status !== 0) return { error: `claude exit ${r.status}: ${(r.stderr || '').slice(-800)}` };
    let j; try { j = JSON.parse(r.stdout); } catch { return { error: `unparseable CLI output: ${r.stdout.slice(0, 300)}` }; }
    if (j.is_error) return { error: String(j.result).slice(0, 800) };
    const u = j.usage ?? {};
    return { output: j.result ?? '', cost: j.total_cost_usd, tokenUsage: { prompt: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), completion: u.output_tokens ?? 0 } };
  }
}
