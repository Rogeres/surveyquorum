import {
  type FetchLike,
  importPathway,
  PathwayApiError,
  type PathwayApiOptions,
} from 'surveyquorum';
import { formatReport } from './convert.js';
import { arg, consoleIo, type Io, writeOut } from './shared.js';

export const IMPORT_USAGE =
  'surveyquorum import pathway --test <id> [--token <t>] [--base-url <u>] ' +
  '[--survey-id <id>] [--out <dataset.json>] [--max-pages <n>]';

export const IMPORT_HELP = `${IMPORT_USAGE}

  --token     Pathway public-API token; default: env PATHWAY_API_TOKEN
  --base-url  API origin; default: env PATHWAY_API_URL, else https://api.pthwy.ru
  --test      test id (the id in the test's URL)
  --out       where to write the dataset; default .surveyquorum/dataset.json
  --max-pages stop after N pages of 100 responses (debugging aid)

See adapters/presets/pathway.md for what the API carries that the CSV export does not.`;

/** Injectable seams for tests: the network and the environment. */
export interface ImportDeps {
  fetch?: FetchLike;
  env?: Record<string, string | undefined>;
  sleep?: PathwayApiOptions['sleep'];
}

export async function importCommand(
  rest: string[],
  io: Io = consoleIo,
  deps: ImportDeps = {},
): Promise<number> {
  const [source, ...flags] = rest;
  const usage = () => {
    io.err(IMPORT_HELP);
    return 2;
  };
  if (source !== 'pathway') {
    if (source) io.err(`import: unknown source "${source}" (only "pathway" is supported)`);
    return usage();
  }
  const env = deps.env ?? process.env;
  const testId = arg(flags, '--test')?.trim();
  const token = arg(flags, '--token') ?? env.PATHWAY_API_TOKEN;
  const baseUrl = arg(flags, '--base-url') ?? env.PATHWAY_API_URL ?? 'https://api.pthwy.ru';
  if (!testId) return usage();
  if (!token?.trim()) {
    io.err('import: no API token — pass --token or set PATHWAY_API_TOKEN');
    return 2;
  }
  if (!baseUrl?.trim()) {
    io.err('import: no API base URL — pass --base-url or set PATHWAY_API_URL');
    return 2;
  }
  const maxPagesRaw = arg(flags, '--max-pages');
  const maxPages = maxPagesRaw === undefined ? undefined : Number(maxPagesRaw);
  if (maxPages !== undefined && (!Number.isInteger(maxPages) || maxPages < 1)) {
    io.err(`import: --max-pages must be a positive integer, got "${maxPagesRaw}"`);
    return 2;
  }

  let fetched = 0;
  try {
    const result = await importPathway(testId, {
      baseUrl,
      token,
      fetch: deps.fetch,
      sleep: deps.sleep,
      maxPages,
      surveyId: arg(flags, '--survey-id'),
      onPage: (p) => {
        fetched += p.received;
        const total = p.totalCount === null ? '' : ` of ${p.totalCount}`;
        io.err(
          `page ${p.page}: ${p.received} response(s), ${fetched}${total} so far` +
            (p.hasNextPage ? '' : ' — last page'),
        );
      },
    });
    const { dataset, report } = result;
    io.err(
      `fetched ${result.pagesFetched} page(s), ${result.answersFetched} response(s) for test "${testId}"` +
        (result.test.name ? ` (${result.test.name})` : '') +
        `: ${report.rowsConverted} kept, ${report.rowsSkipped} skipped`,
    );
    const out = arg(flags, '--out') ?? '.surveyquorum/dataset.json';
    writeOut(out, dataset);
    io.err(formatReport(report, 'pathway api'));
    io.out(`dataset written to ${out}`);
    return report.responses > 0 ? 0 : 1;
  } catch (err) {
    if (err instanceof PathwayApiError) {
      io.err(`import: ${err.message}`);
      return 1;
    }
    throw err;
  }
}
