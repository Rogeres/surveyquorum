/**
 * Every preset in `adapters/presets/` ships with an invented sample export and the converter
 * output it must produce. This test keeps presets honest when the converter changes.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { convertCsv } from '../src/adapters/csv.js';
import { parseMapping } from '../src/adapters/mapping.js';
import { convertPathwayReport } from '../src/adapters/pathway-report.js';

const presetsDir = fileURLToPath(new URL('../../../adapters/presets/', import.meta.url));
const presets = readdirSync(presetsDir).filter(
  (f) => f.endsWith('.json') && !f.endsWith('.expected.json'),
);

describe('adapter presets', () => {
  it('has at least one preset', () => {
    expect(presets.length).toBeGreaterThan(0);
  });

  for (const file of presets) {
    const name = file.replace(/\.json$/, '');
    it(`${name}: sample converts to the expected dataset and report`, () => {
      const mapping = parseMapping(JSON.parse(readFileSync(join(presetsDir, file), 'utf8')));
      expect(mapping.name).toBe(name);
      const sample = readFileSync(join(presetsDir, `${name}.sample.csv`), 'utf8');
      expect(sample.trim().split('\n').length).toBeLessThanOrEqual(21); // header + 20 rows
      const expected = JSON.parse(readFileSync(join(presetsDir, `${name}.expected.json`), 'utf8'));
      expect(convertCsv(sample, mapping)).toEqual(expected);
    });
  }

  // `pathway` is a built-in preset without a mapping file, so the loop above does not see it.
  it('pathway: sample converts to the expected dataset and report', () => {
    const sample = readFileSync(join(presetsDir, 'pathway.sample.csv'), 'utf8');
    expect(sample.trim().split('\n').length).toBeLessThanOrEqual(21);
    const expected = JSON.parse(readFileSync(join(presetsDir, 'pathway.expected.json'), 'utf8'));
    expect(convertPathwayReport(sample, { surveyId: 'pathway.sample' })).toEqual(expected);
  });
});
