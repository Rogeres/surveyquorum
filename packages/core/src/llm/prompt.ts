import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Load a prompt template that sits next to the calling module in `prompts/`. Prompts are plain
 * text and are not copied into `dist/`, so a compiled module falls back to the `src/` tree
 * (shipped in the package). Placeholders look like `{name}`.
 */
export function loadPrompt(moduleUrl: string, file: string): string {
  const direct = fileURLToPath(new URL(`./prompts/${file}`, moduleUrl));
  if (existsSync(direct)) return readFileSync(direct, 'utf8');
  const fromSrc = direct.replace(/([\\/])dist([\\/])/, '$1src$2');
  if (existsSync(fromSrc)) return readFileSync(fromSrc, 'utf8');
  throw new Error(`prompt not found: ${direct}`);
}

/** Replace `{key}` placeholders; a missing key is a programming error and throws. */
export function fillPrompt(template: string, values: Record<string, string>): string {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (m, key: string) => {
    if (!(key in values)) throw new Error(`prompt placeholder without value: ${m}`);
    return values[key];
  });
}
