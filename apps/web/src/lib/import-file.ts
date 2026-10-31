import { readXlsx, rowsToCsv } from '@friendly-crm/shared';

export interface ImportFile {
  /** The sheet as CSV text, the form the import pages read. */
  text: string;
  /** Set for an Excel workbook: which sheet was read and how many others with data were left alone. */
  sheet?: { name: string; others: number };
}

/** A reason the file cannot be imported, with the words to show (in both languages). */
export class ImportFileError extends Error {
  constructor(public readonly en: string, public readonly ta: string) {
    super(en);
  }
}

const isXlsx = (f: File) => /\.xlsx$/i.test(f.name) || f.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const isOldExcel = (f: File) => /\.xls$/i.test(f.name) || f.type === 'application/vnd.ms-excel';

/**
 * Reads a CSV/text file as is, and an Excel (.xlsx) workbook as its first sheet with data. The workbook is opened on this
 * device; it is not uploaded. Throws ImportFileError when the file cannot be used.
 */
export async function readImportFile(file: File): Promise<ImportFile> {
  if (isOldExcel(file) && !isXlsx(file)) {
    throw new ImportFileError(
      'This is an old Excel file (.xls). Open it in Excel and use Save As → Excel Workbook (.xlsx), or CSV UTF-8, then choose it again.',
      'இது பழைய Excel கோப்பு (.xls). Excel-இல் திறந்து Save As → Excel Workbook (.xlsx) அல்லது CSV UTF-8 ஆகச் சேமித்து மீண்டும் தேர்ந்தெடுக்கவும்.'
    );
  }
  if (!isXlsx(file)) return { text: await file.text() };

  let sheets: ReturnType<typeof readXlsx>;
  try {
    sheets = readXlsx(new Uint8Array(await file.arrayBuffer()));
  } catch (err: any) {
    const tooBig = /too large/i.test(err?.message ?? '');
    throw new ImportFileError(
      tooBig ? 'This workbook is too large to open here. Split it into smaller files.' : 'This file could not be opened as an Excel workbook (.xlsx). It may be damaged or password-protected.',
      tooBig ? 'இந்த Excel கோப்பு திறக்க மிகப் பெரியது. சிறிய கோப்புகளாகப் பிரிக்கவும்.' : 'இந்தக் கோப்பை Excel (.xlsx) ஆகத் திறக்க முடியவில்லை. அது சிதைந்திருக்கலாம் அல்லது கடவுச்சொல் உள்ளதாக இருக்கலாம்.'
    );
  }
  if (!sheets.length) throw new ImportFileError('This workbook has nothing in it.', 'இந்த Excel கோப்பில் எதுவும் இல்லை.');
  return { text: rowsToCsv(sheets[0].rows), sheet: { name: sheets[0].name, others: sheets.length - 1 } };
}
