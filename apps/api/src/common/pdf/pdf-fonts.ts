import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';

/**
 * Fonts for the PDFs (quotes, invoices, credit notes).
 *
 * The built-in PDF fonts have no rupee sign and no Tamil. These bundled Noto fonts (SIL Open Font License, see
 * assets/fonts/OFL.txt) do: Noto Sans for English, digits and the rupee sign, Noto Sans Tamil for Tamil. The Tamil font has
 * no English letters, so text that mixes the two is drawn in runs, each in the font that has its letters.
 */
export const RUPEE = '₹';

const TAMIL = /[஀-௿]/;
const TAMIL_CHAR = /[஀-௿‌‍]/;
const FONT_FILES = {
  Body: 'NotoSans-Regular.ttf',
  BodyBold: 'NotoSans-Bold.ttf',
  Tamil: 'NotoSansTamil-Regular.ttf',
  TamilBold: 'NotoSansTamil-Bold.ttf',
} as const;

/** assets/fonts sits beside src and dist, so it is found from either (tests run from src, the server from dist). */
function fontDir(): string {
  let dir = __dirname;
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, 'assets', 'fonts');
    if (existsSync(join(candidate, FONT_FILES.Body))) return candidate;
    dir = dirname(dir);
  }
  throw new Error('PDF fonts not found: apps/api/assets/fonts/NotoSans-Regular.ttf is missing from this installation.');
}

let cached: Record<string, Buffer> | null = null;
/** The font files, read from disk once for the life of the server. */
function fontBytes(): Record<string, Buffer> {
  if (!cached) {
    const dir = fontDir();
    cached = Object.fromEntries(Object.entries(FONT_FILES).map(([name, file]) => [name, readFileSync(join(dir, file))]));
  }
  return cached;
}

/** Splits text into runs that each belong to one font. Spaces, digits and punctuation stay with the run they follow. */
export function splitRuns(text: string): Array<{ text: string; tamil: boolean }> {
  const runs: Array<{ text: string; tamil: boolean }> = [];
  let tamil = TAMIL_CHAR.test(text[0] ?? '');
  let current = '';
  for (const ch of text) {
    const strong = TAMIL_CHAR.test(ch) ? true : /\p{L}/u.test(ch) ? false : null; // null: neutral
    if (strong !== null && strong !== tamil) {
      if (current) runs.push({ text: current, tamil });
      current = '';
      tamil = strong;
    }
    current += ch;
  }
  if (current) runs.push({ text: current, tamil });
  return runs;
}

/**
 * Sets a new PDFKit document up with the fonts above (family "Body" and "BodyBold"; use doc.font('Body') etc.) and makes
 * text(), widthOfString() and heightOfString() handle Tamil, including Tamil mixed with English.
 */
export function preparePdfFonts(doc: any): void {
  for (const [name, bytes] of Object.entries(fontBytes())) doc.registerFont(name, bytes);

  // Which of our fonts is selected right now. Every switch below goes through select(), so a measuring call made while a
  // run is being drawn puts back exactly the font it found.
  let current: keyof typeof FONT_FILES = 'Body';
  const origFont = doc.font.bind(doc);
  const select = (name: keyof typeof FONT_FILES) => {
    current = name;
    return origFont(name);
  };
  doc.font = (name: string, ...rest: unknown[]) => {
    if (name in FONT_FILES) current = name as keyof typeof FONT_FILES;
    return origFont(name, ...rest);
  };
  const bold = () => current === 'BodyBold' || current === 'TamilBold';
  const english = () => (bold() ? 'BodyBold' : 'Body');
  const tamil = () => (bold() ? 'TamilBold' : 'Tamil');
  select('Body');

  const origText = doc.text.bind(doc);
  doc.text = (text: unknown, ...args: any[]) => {
    if (typeof text !== 'string' || !TAMIL.test(text)) return origText(text, ...args);
    const positioned = typeof args[0] === 'number';
    const opts = (positioned ? args[2] : args[0]) ?? {};
    const keep = current;
    const base = { english: english(), tamil: tamil() } as const;
    const runs = splitRuns(text);

    // Right- or centre-aligned text drawn in several runs does not line up by itself: when it fits on one line, work out
    // where it starts and draw it left-aligned from there.
    let start: { x: number; y: number } | null = positioned ? { x: args[0], y: args[1] } : null;
    let o0 = opts;
    if ((opts.align === 'right' || opts.align === 'center') && typeof opts.width === 'number') {
      const total = doc.widthOfString(text);
      if (total <= opts.width) {
        const x = (positioned ? args[0] : doc.x) + (opts.align === 'right' ? opts.width - total : (opts.width - total) / 2);
        start = { x, y: positioned ? args[1] : doc.y };
        const { align: _align, width: _width, ...rest } = opts;
        o0 = { ...rest, lineBreak: false }; // it fits on one line, so it must not wrap at the page edge
      }
    }

    runs.forEach((run, i) => {
      select(run.tamil ? base.tamil : base.english);
      const last = i === runs.length - 1;
      const o = { ...o0, continued: last ? opts.continued : true };
      if (i === 0 && start) origText(run.text, start.x, start.y, o);
      else origText(run.text, o);
    });
    select(keep);
    return doc;
  };

  const origWidth = doc.widthOfString.bind(doc);
  doc.widthOfString = (text: string, ...rest: unknown[]) => {
    if (typeof text !== 'string' || !TAMIL.test(text)) return origWidth(text, ...rest);
    const keep = current;
    const base = { english: english(), tamil: tamil() } as const;
    let total = 0;
    for (const run of splitRuns(text)) {
      select(run.tamil ? base.tamil : base.english);
      total += origWidth(run.text, ...rest);
    }
    select(keep);
    return total;
  };

  // Wrapped height: measured in whichever font most of the text is in, plus a margin (Tamil lines are taller), so nothing overlaps
  const origHeight = doc.heightOfString.bind(doc);
  doc.heightOfString = (text: string, ...rest: unknown[]) => {
    if (typeof text !== 'string' || !TAMIL.test(text)) return origHeight(text, ...rest);
    const keep = current;
    const tamilChars = [...text].filter((c) => TAMIL_CHAR.test(c)).length;
    select(tamilChars * 2 >= text.length ? tamil() : english());
    const h = origHeight(text, ...rest) * 1.2;
    select(keep);
    return h;
  };
}
