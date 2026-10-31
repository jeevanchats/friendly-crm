import { unzipSync } from 'fflate';

/**
 * Plain text out of Word (.docx) and Excel (.xlsx) files. Both are zip files of XML, so this needs no outside service.
 * The old binary formats (.doc, .xls) are not zip files and are not read.
 */

/** A file that unzips to more than this is refused: a small zip can hide a huge one. */
const MAX_UNZIPPED_BYTES = 30 * 1024 * 1024;
const MAX_SHEETS = 10;
const MAX_ROWS_PER_SHEET = 500;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });

/** Unzip only the named entries; refuse a zip that would expand past the limit. */
function unzip(data: Buffer, want: (name: string) => boolean): Record<string, string> {
  let total = 0;
  const files = unzipSync(new Uint8Array(data), {
    filter: (f) => {
      if (!want(f.name)) return false;
      total += f.originalSize;
      if (total > MAX_UNZIPPED_BYTES) throw new Error('The file is too large once opened.');
      return true;
    },
  });
  const out: Record<string, string> = {};
  for (const [name, bytes] of Object.entries(files)) out[name] = Buffer.from(bytes).toString('utf8');
  return out;
}

/** The text of every <tag ...>text</tag> in the XML, joined. Handles the xml:space and attributes on the tag. */
function textOf(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g');
  let out = '';
  for (let m = re.exec(xml); m; m = re.exec(xml)) out += decode(m[1]);
  return out;
}

/** Word: one line per paragraph; the cells of a table row are joined with " | ". */
export function docxText(data: Buffer): string {
  const files = unzip(data, (n) => n === 'word/document.xml');
  const xml = files['word/document.xml'];
  if (!xml) return '';
  const paragraph = (p: string) => {
    // runs of text, with tabs and line breaks kept as spaces
    const flat = p.replace(/<w:tab\s*\/>/g, '<w:t> </w:t>').replace(/<w:br\s*\/>/g, '<w:t> </w:t>');
    return textOf(flat, 'w:t').replace(/\s+/g, ' ').trim();
  };
  const lines: string[] = [];
  // Rows of a table first, so their cells are not also listed as loose paragraphs
  const body = xml.replace(/<w:tr(?:\s[^>]*)?>([\s\S]*?)<\/w:tr>/g, (_m, row: string) => {
    const cells = [...row.matchAll(/<w:tc(?:\s[^>]*)?>([\s\S]*?)<\/w:tc>/g)].map((c) =>
      [...c[1].matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g)].map((p) => paragraph(p[1])).filter(Boolean).join(' ')
    );
    return `<w:p><w:r><w:t>${cells.join(' | ').replace(/&/g, '&amp;').replace(/</g, '&lt;')}</w:t></w:r></w:p>`;
  });
  for (const p of body.matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g)) {
    const line = paragraph(p[1]);
    if (line.replace(/[|\s]/g, '')) lines.push(line);
  }
  return lines.join('\n');
}

/** "C5" -> column index 2 ("C"). */
const columnIndex = (ref: string) => {
  let n = 0;
  for (const ch of ref.replace(/[^A-Za-z]/g, '').toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return Math.max(0, n - 1);
};

/** Excel: each sheet by name, then one line per row with the cells joined by " | ". Dates stay as the number Excel keeps. */
export function xlsxText(data: Buffer): string {
  const files = unzip(data, (n) => n === 'xl/sharedStrings.xml' || n === 'xl/workbook.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  const shared = files['xl/sharedStrings.xml']
    ? [...files['xl/sharedStrings.xml'].matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map((si) => textOf(si[1], 't'))
    : [];
  const names = files['xl/workbook.xml']
    ? [...files['xl/workbook.xml'].matchAll(/<sheet\s[^>]*?name="([^"]*)"/g)].map((m) => decode(m[1]))
    : [];
  const sheetFiles = Object.keys(files)
    .filter((n) => n.startsWith('xl/worksheets/'))
    .sort((a, b) => parseInt(a.replace(/\D/g, ''), 10) - parseInt(b.replace(/\D/g, ''), 10))
    .slice(0, MAX_SHEETS);

  const out: string[] = [];
  sheetFiles.forEach((file, i) => {
    const rows: string[] = [];
    for (const row of files[file].matchAll(/<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/g)) {
      const cells: string[] = [];
      for (const c of row[1].matchAll(/<c((?:\s[^>]*)?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1] ?? '';
        const inner = c[2] ?? '';
        const ref = /\sr="([^"]*)"/.exec(attrs)?.[1] ?? '';
        const type = /\st="([^"]*)"/.exec(attrs)?.[1] ?? '';
        let value = '';
        if (type === 'inlineStr') value = textOf(inner, 't');
        else {
          const v = textOf(inner, 'v');
          value = type === 's' ? shared[parseInt(v, 10)] ?? '' : v;
        }
        value = value.replace(/\s+/g, ' ').trim();
        if (ref) cells[columnIndex(ref)] = value;
        else cells.push(value);
      }
      const filled = Array.from(cells, (v) => v ?? '');
      if (filled.some((v) => v)) rows.push(filled.join(' | ').replace(/(?:\s\|\s)+$/, ''));
      if (rows.length >= MAX_ROWS_PER_SHEET) break;
    }
    if (rows.length) out.push(`Sheet ${names[i] ?? i + 1}:\n${rows.join('\n')}`);
  });
  return out.join('\n\n');
}
