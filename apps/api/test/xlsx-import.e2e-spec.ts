import { zipSync, strToU8 } from 'fflate';
import { readXlsx, rowsToCsv, parseProductSheet, parseCustomerSheet, validateProductRow, validateCustomerRow } from '@friendly-crm/shared';

const book = (sheetXml: string, strings: string[] = [], names: string[] = ['Sheet1']) =>
  new Uint8Array(
    zipSync({
      'xl/workbook.xml': strToU8(`<workbook><sheets>${names.map((n, i) => `<sheet name="${n}" sheetId="${i + 1}"/>`).join('')}</sheets></workbook>`),
      'xl/sharedStrings.xml': strToU8(`<sst>${strings.map((s) => `<si><t>${s}</t></si>`).join('')}</sst>`),
      'xl/worksheets/sheet1.xml': strToU8(`<worksheet><sheetData>${sheetXml}</sheetData></worksheet>`),
    })
  );

describe('Reading an Excel workbook for the import pages', () => {
  it('turns a product sheet into the rows the product import already understands', () => {
    // Name, HSN, Unit, Rate, GST % : the rate and GST are numbers in Excel, the HSN is text
    const wb = book(
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c><c r="E1" t="s"><v>4</v></c></row>' +
        '<row r="2"><c r="A2" t="s"><v>5</v></c><c r="B2" t="s"><v>6</v></c><c r="C2" t="s"><v>7</v></c><c r="D2"><v>72.5</v></c><c r="E2"><v>18</v></c></row>' +
        '<row r="3"><c r="A3" t="s"><v>8</v></c><c r="C3" t="s"><v>9</v></c><c r="D3"><v>0.30000000000000004</v></c><c r="E3"><f>6+6</f><v>12</v></c></row>',
      ['Name', 'HSN', 'Unit', 'Rate', 'GST %', 'MS Round Rod', '7214', 'Kg', 'Visiting, Card &amp; Box', 'Box']
    );
    const [sheet] = readXlsx(wb);
    expect(sheet.name).toBe('Sheet1');
    const parsed = parseProductSheet(rowsToCsv(sheet.rows));
    expect(parsed.mapping.name).toBe(0);
    expect(parsed.rows).toEqual([
      { name: 'MS Round Rod', hsnCode: '7214', unit: 'Kg', unitPrice: '72.5', taxPercent: '18' },
      { name: 'Visiting, Card & Box', hsnCode: '', unit: 'Box', unitPrice: '0.3', taxPercent: '12' }, // 0.30000000000000004 shows as 0.3; a formula gives its value
    ]);
    expect(validateProductRow(parsed.rows[0]).errors ?? []).toEqual([]);
  });

  it('keeps a customer phone number typed as a number, and Tamil names', () => {
    const wb = book(
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
        '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>9840012345</v></c></row>' +
        '<row r="3"><c r="A3" t="inlineStr"><is><t>முருகன் ஸ்டோர்ஸ்</t></is></c><c r="B3" t="s"><v>3</v></c></row>',
      ['Name', 'Phone', 'Sri Traders', '+91 98400 54321']
    );
    const parsed = parseCustomerSheet(rowsToCsv(readXlsx(wb)[0].rows));
    expect(parsed.rows.map((r) => [r.name, r.phone])).toEqual([['Sri Traders', '9840012345'], ['முருகன் ஸ்டோர்ஸ்', '+91 98400 54321']]);
    expect(validateCustomerRow(parsed.rows[0]).errors ?? []).toEqual([]);
  });

  it('skips empty sheets, leaves gaps as blank cells, and quotes what CSV needs quoted', () => {
    const [sheet] = readXlsx(book('<row r="1"><c r="A1" t="inlineStr"><is><t>a</t></is></c><c r="C1" t="inlineStr"><is><t>say "hi"</t></is></c></row><row r="2"/>'));
    expect(sheet.rows).toEqual([['a', '', 'say "hi"']]);
    expect(rowsToCsv(sheet.rows)).toBe('a,,"say ""hi"""');
    expect(readXlsx(book('<row r="1"><c r="A1"/></row>'))).toEqual([]);
  });

  it('refuses a file that is not an .xlsx, and a zip that opens into something enormous', () => {
    expect(() => readXlsx(new Uint8Array(Buffer.from('a,b,c\n1,2,3')))).toThrow('not a valid .xlsx');
    const noSheets = new Uint8Array(zipSync({ 'readme.txt': strToU8('hello') }));
    expect(() => readXlsx(noSheets)).toThrow('not a valid .xlsx');
    const bomb = new Uint8Array(zipSync({ 'xl/worksheets/sheet1.xml': strToU8('a'.repeat(31 * 1024 * 1024)) }));
    expect(bomb.length).toBeLessThan(200 * 1024);
    expect(() => readXlsx(bomb)).toThrow('too large');
  });

  it('stops at the row limit it is given', () => {
    const rows = Array.from({ length: 10 }, (_, i) => `<row r="${i + 1}"><c r="A${i + 1}"><v>${i}</v></c></row>`).join('');
    expect(readXlsx(book(rows), { maxRows: 3 })[0].rows).toHaveLength(3);
  });
});
