import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Tests run against the core source, not against a stale `dist`.
    alias: { surveyquorum: fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)) },
  },
  test: {
    include: ['packages/*/test/**/*.spec.ts'],
    reporters: ['default'],
  },
});
