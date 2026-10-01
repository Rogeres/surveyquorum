/**
 * Minimal JSON-schema check: type, required, properties, items, enum, minimum/maximum.
 * Enough to validate the small flat answer shapes our prompts ask for. Deliberately not a
 * full validator — no $ref, no oneOf, no formats — so the core stays dependency-free.
 */
export function validateJson(
  value: unknown,
  schema: Record<string, unknown>,
  path = '$',
): string[] {
  const errors: string[] = [];
  const type = schema.type as string | string[] | undefined;
  if (type !== undefined) {
    const types = Array.isArray(type) ? type : [type];
    if (!types.some((t) => matchesType(value, t))) {
      errors.push(`${path}: expected ${types.join('|')}, got ${describe(value)}`);
      return errors;
    }
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((e) => e === value)) {
    errors.push(`${path}: must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(', ')}`);
  }
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum)
      errors.push(`${path}: must be >= ${schema.minimum}`);
    if (typeof schema.maximum === 'number' && value > schema.maximum)
      errors.push(`${path}: must be <= ${schema.maximum}`);
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    for (const key of (schema.required as string[] | undefined) ?? []) {
      if (!(key in obj)) errors.push(`${path}.${key}: required`);
    }
    const props = (schema.properties as Record<string, Record<string, unknown>> | undefined) ?? {};
    for (const [key, sub] of Object.entries(props)) {
      if (key in obj) errors.push(...validateJson(obj[key], sub, `${path}.${key}`));
    }
  }
  if (Array.isArray(value) && schema.items && typeof schema.items === 'object') {
    value.forEach((item, i) => {
      errors.push(...validateJson(item, schema.items as Record<string, unknown>, `${path}[${i}]`));
    });
  }
  return errors;
}

function matchesType(value: unknown, t: string): boolean {
  switch (t) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
    case 'array':
      return Array.isArray(value);
    case 'object':
      return value !== null && typeof value === 'object' && !Array.isArray(value);
    default:
      return true;
  }
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/**
 * Pull a JSON document out of a model reply: strips Markdown code fences and any prose
 * around the first `{`/`[` … last `}`/`]`. Throws when nothing parses.
 */
export function parseJsonReply(text: string): unknown {
  let t = text.trim();
  const fence = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) t = fence[1].trim();
  try {
    return JSON.parse(t);
  } catch {
    const starts = ['{', '['].map((c) => t.indexOf(c)).filter((i) => i >= 0);
    const end = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
    if (starts.length === 0) throw new Error('reply contains no JSON');
    const start = Math.min(...starts);
    if (end <= start) throw new Error('reply contains no JSON');
    return JSON.parse(t.slice(start, end + 1));
  }
}
