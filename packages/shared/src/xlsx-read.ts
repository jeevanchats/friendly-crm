import { unzipSync } from 'fflate';

/**
 * Reading an Excel (.xlsx) workbook into rows of text. An .xlsx is a zip of XML files, so nothing outside the browser or
 * server is needed. It runs in both: the import pages read the file on the person's own device, and the enquiry reader
 * reads attachments on the server. The old binary .xls is not a zip and is not read.
 */

/** A file that unzips to more than this is refused: a small zip can hide a huge one. */
const MAX_UNZIPPED_BYTES = 30 * 1024 * 1024;
const MAX_SHEETS = 10;
export const DEFAULT_MAX_ROWS = 50_000;

export interface XlsxSheet {
  name: string;
  /** Row by row, every cell as text, columns kept in place (a gap is ''). */
  rows: string[][];
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decodeEntities = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });

/** The text of every <tag ...>text</tag> in the XML, joined. */
function textOf(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g');
  let out = '';
  for (let m = re.exec(xml); m; m = re.exec(xml)) out += decodeEntities(m[1]);
  return out;
}

/** "C5" -> column index 2 ("C"). */
const columnIndex = (ref: string) => {
  let n = 0;
  for (const ch of ref.replace(/[^A-Za-z]/g, '').toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return Math.max(0, n - 1);
};

/** Excel keeps a number as binary floating point: 0.1 + 0.2 is stored as 0.30000000000000004. Show what the cell shows. */
function numberText(raw: string): string {
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  return String(parseFloat(n.toPrecision(15)));
}

/** Unzip only the named entries; refuse a zip that would expand past the limit. */
function unzipText(data: Uint8Array, want: (name: string) => boolean): Record<string, string> {
  let total = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(data, {
      filter: (f) => {
        if (!want(f.name)) return false;
        total += f.originalSize;
        if (total > MAX_UNZIPPED_BYTES) throw new Error('TOO_LARGE');
        return true;
      },
    });
  } catch (err: any) {
    throw new Error(err?.message === 'TOO_LARGE' ? 'The file is too large once opened.' : 'This is not a valid .xlsx file.');
  }
  const decoder = new TextDecoder('utf-8');
  const out: Record<string, string> = {};
  for (const [name, bytes] of Object.entries(files)) out[name] = decoder.decode(bytes);
  return out;
}

/**
 * Every sheet of the workbook that has something in it, in workbook order, as rows of text.
 * Formulas give the value Excel last calculated. Dates come as the serial number Excel stores them as.
 * Throws an Error with a message fit to show when the file is not an .xlsx or is too large once opened.
 */
export function readXlsx(data: Uint8Array, opts: { maxRows?: number } = {}): XlsxSheet[] {
  const maxRows = opts.maxRows ?? DEFAULT_MAX_ROWS;
  const files = unzipText(data, (n) => n === 'xl/sharedStrings.xml' || n === 'xl/workbook.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  if (!Object.keys(files).some((n) => n.startsWith('xl/worksheets/'))) throw new Error('This is not a valid .xlsx file.');

  const shared = files['xl/sharedStrings.xml']
    ? [...files['xl/sharedStrings.xml'].matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map((si) => textOf(si[1].replace(/<rPh(?:\s[^>]*)?>[\s\S]*?<\/rPh>/g, ''), 't')) // phonetic guides are not part of the text
    : [];
  const names = files['xl/workbook.xml'] ? [...files['xl/workbook.xml'].matchAll(/<sheet\s[^>]*?name="([^"]*)"/g)].map((m) => decodeEntities(m[1])) : [];
  const sheetFiles = Object.keys(files)
    .filter((n) => n.startsWith('xl/worksheets/'))
    .sort((a, b) => parseInt(a.replace(/\D/g, ''), 10) - parseInt(b.replace(/\D/g, ''), 10))
    .slice(0, MAX_SHEETS);

  const sheets: XlsxSheet[] = [];
  sheetFiles.forEach((file, i) => {
    const rows: string[][] = [];
    for (const row of files[file].matchAll(/<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/g)) {
      const cells: string[] = [];
      for (const c of row[1].matchAll(/<c((?:\s[^>]*)?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1] ?? '';
        const inner = c[2] ?? '';
        const ref = /\sr="([^"]*)"/.exec(attrs)?.[1] ?? '';
        const type = /\st="([^"]*)"/.exec(attrs)?.[1] ?? '';
        let value: string;
        if (type === 'inlineStr') value = textOf(inner, 't');
        else {
          const v = textOf(inner, 'v');
          if (type === 's') value = shared[parseInt(v, 10)] ?? '';
          else if (type === 'b') value = v === '1' ? 'TRUE' : 'FALSE';
          else if (type === 'e') value = '';
          else if (type === 'str' || type === 'd') value = v;
          else value = v === '' ? '' : numberText(v);
        }
        value = value.replace(/\s+/g, ' ').trim();
        if (ref) cells[columnIndex(ref)] = value;
        else cells.push(value);
      }
      const filled = Array.from(cells, (v) => v ?? '');
      if (filled.some((v) => v)) rows.push(filled);
      if (rows.length >= maxRows) break;
    }
    if (rows.length) sheets.push({ name: names[i] ?? `Sheet${i + 1}`, rows });
  });
  return sheets;
}

/** Rows as CSV text (quotes where needed), the form the import pages already read. */
export function rowsToCsv(rows: string[][]): string {
  const q = (s: string) => (/[",\r\n;\t]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return rows.map((r) => r.map(q).join(',')).join('\r\n');
}
