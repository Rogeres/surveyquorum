/**
 * Minimal RFC 4180 CSV parser. No dependencies on purpose.
 *
 * Handles: quoted fields, doubled quotes inside quoted fields, CR/LF/CRLF line endings,
 * newlines inside quoted fields, a leading UTF-8 byte order mark, a configurable delimiter and
 * a trailing newline. Returns rows of raw strings; the caller decides about trimming.
 */

export interface CsvTable {
  header: string[];
  /** Data rows, without the header. Row `i` is line `i + 2` in a file without embedded newlines. */
  rows: string[][];
}

export function parseCsvRows(text: string, delimiter = ','): string[][] {
  if (delimiter.length !== 1)
    throw new Error(`CSV delimiter must be one character, got "${delimiter}"`);
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;
  const n = src.length;

  while (i < n) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          quoted = false;
          i += 1;
        }
      } else {
        field += ch;
        i += 1;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
      i += 1;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
      i += 1;
    } else if (ch === '\r' || ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      i += ch === '\r' && src[i + 1] === '\n' ? 2 : 1;
    } else {
      field += ch;
      i += 1;
    }
  }
  if (quoted) throw new Error('CSV ends inside a quoted field');
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // Drop fully empty lines (a trailing newline, blank separators).
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

export function parseCsv(text: string, delimiter = ','): CsvTable {
  const rows = parseCsvRows(text, delimiter);
  if (rows.length === 0) return { header: [], rows: [] };
  const [header, ...data] = rows;
  return { header: header.map((h) => h.trim()), rows: data };
}
