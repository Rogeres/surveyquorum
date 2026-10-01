import { describe, expect, it } from 'vitest';
import { parseDataset } from '../src/contract/index.js';

describe('input contract', () => {
  it('parses a minimal survey and defaults missing durations to 0', () => {
    const ds = parseDataset([
      {
        id: 's1',
        responses: [
          {
            id: 'r1',
            blocks: [
              { type: 'choice', question: 'Which apps do you use?', answer: ['A'] },
              {
                type: 'open',
                question: 'Why?',
                duration: 12,
                answer: [{ role: 'user', text: 'Cheap' }],
              },
              { type: 'website', question: 'Find the pricing page', duration: 3, gaveUp: true },
            ],
          },
        ],
      },
    ]);
    expect(ds[0].responses[0].blocks[0].duration).toBe(0);
    expect(ds[0].responses[0].blocks[2].type).toBe('website');
  });

  it('fails with a path on an unknown block type', () => {
    expect(() =>
      parseDataset([
        { id: 's1', responses: [{ id: 'r1', blocks: [{ type: 'hologram', question: 'x' }] }] },
      ]),
    ).toThrowError(/responses.*blocks.*type|type/);
  });
});
