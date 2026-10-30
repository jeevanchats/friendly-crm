import {
  customerTemplateCsv,
  gstinCheckChar,
  normalizeContactPhone,
  parseCustomerSheet,
  parseDelimited,
  parseMoneyToPaise,
  parseStateCode,
  validateCustomerRow,
  RowCheck,
} from '@friendly-crm/shared';

const gstin = (first14: string) => first14 + gstinCheckChar(first14);
const errs = (r: RowCheck): string[] => r.errors;

describe('normalizeContactPhone', () => {
  it.each([
    ['9443022222', '+919443022222'],
    ['09443022222', '+919443022222'],
    ['+91 94430 22222', '+919443022222'],
    ['91-9443022222', '+919443022222'],
    ['919443022222', '+919443022222'],
    [9443022222, '+919443022222'],
    ['+14155552671', '+14155552671'],
  ])('%s -> %s', (raw, expected) => {
    expect(normalizeContactPhone(raw)).toBe(expected);
  });

  it.each(['', '12345', '5443022222', '94430222', '9443022222222', 'abc', null, undefined, '+123'])('rejects %p', (raw) => {
    expect(normalizeContactPhone(raw as any)).toBeNull();
  });
});

describe('parseStateCode', () => {
  it.each([
    ['Tamil Nadu', '33'],
    ['TAMILNADU', '33'],
    ['tn', '33'],
    ['33', '33'],
    ['33 - Tamil Nadu', '33'],
    ['7', '07'],
    ['Karnataka', '29'],
    ['Jammu and Kashmir', '01'],
    ['Pondicherry', '34'],
    ['Delhi', '07'],
  ])('%s -> %s', (raw, expected) => expect(parseStateCode(raw)).toBe(expected));

  it('returns null for unknown text', () => {
    expect(parseStateCode('Atlantis')).toBeNull();
    expect(parseStateCode('99')).toBeNull();
    expect(parseStateCode('')).toBeNull();
  });
});

describe('parseMoneyToPaise', () => {
  it.each([
    ['25000', 2500000],
    ['₹1,23,456.50', 12345650],
    ['Rs. 500', 50000],
    ['1200 Dr', 120000],
    ['1,200.00 Dr', 120000],
    ['', 0],
    ['0', 0],
    ['0.5', 50],
  ])('%s -> %i paise', (raw, paise) => expect(parseMoneyToPaise(raw)).toEqual({ paise }));

  it('reads credit, brackets and minus as negative', () => {
    expect(parseMoneyToPaise('1200 Cr')).toEqual({ paise: -120000 });
    expect(parseMoneyToPaise('(500)')).toEqual({ paise: -50000 });
    expect(parseMoneyToPaise('-500')).toEqual({ paise: -50000 });
  });

  it('rejects text and over-precise numbers', () => {
    expect('error' in (parseMoneyToPaise('abc') as any)).toBe(true);
    expect('error' in (parseMoneyToPaise('10.123') as any)).toBe(true);
    expect('error' in (parseMoneyToPaise('1e5') as any)).toBe(true);
  });
});

describe('parseDelimited', () => {
  it('handles quotes, embedded commas and newlines, doubled quotes and CRLF', () => {
    const rows = parseDelimited('a,b,c\r\n1,"x, y",3\r\n"multi\nline","say ""hi""",z\r\n');
    expect(rows).toEqual([
      ['a', 'b', 'c'],
      ['1', 'x, y', '3'],
      ['multi\nline', 'say "hi"', 'z'],
    ]);
  });

  it('detects tabs (pasted from Excel) and semicolons, and strips a BOM', () => {
    expect(parseDelimited('a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseDelimited('a;b\n1;2')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseDelimited('﻿a,b\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('drops blank lines and returns nothing for empty input', () => {
    expect(parseDelimited('a,b\n\n,\n1,2\n')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseDelimited('   \n')).toEqual([]);
  });
});

describe('parseCustomerSheet', () => {
  it('matches common header spellings and ignores unknown columns', () => {
    const sheet = parseCustomerSheet(
      'Party Name,Mobile No.,GST No,State,Outstanding,Sales Rep\nAnand Traders,98400 11111,,TN,"1,500.00",Ravi\n'
    );
    expect(sheet.mapping).toEqual({ name: 0, phone: 1, gstin: 2, state: 3, openingBalance: 4 });
    expect(sheet.ignoredHeaders).toEqual(['Sales Rep']);
    expect(sheet.rows).toEqual([{ name: 'Anand Traders', phone: '98400 11111', gstin: '', state: 'TN', openingBalance: '1,500.00' }]);
  });

  it('round-trips its own template', () => {
    const sheet = parseCustomerSheet(customerTemplateCsv());
    expect(Object.keys(sheet.mapping)).toHaveLength(10);
    expect(sheet.rows).toHaveLength(1);
    const check = validateCustomerRow(sheet.rows[0]);
    expect(check.ok).toBe(true);
  });
});

describe('validateCustomerRow', () => {
  it('cleans a good row', () => {
    const r = validateCustomerRow({
      name: '  Anand Traders ',
      phone: '98400 11111',
      gstin: gstin('33AABCS1234A1Z').toLowerCase(),
      openingBalance: '₹12,500',
      creditLimit: '50000',
      companyName: '',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toMatchObject({
        name: 'Anand Traders',
        phone: '+919840011111',
        whatsappNumber: '+919840011111',
        gstin: gstin('33AABCS1234A1Z'),
        stateCode: '33',
        companyName: null,
        openingBalancePaise: 1250000,
        creditLimitPaise: 5000000,
      });
    }
  });

  it('takes the state from a GSTIN and rejects a state that contradicts it', () => {
    const mh = '27AAPFU0939F1ZV';
    const ok = validateCustomerRow({ name: 'A', phone: '9840011111', gstin: mh, state: 'Maharashtra' });
    expect(ok.value?.stateCode).toBe('27');
    const bad = validateCustomerRow({ name: 'A', phone: '9840011111', gstin: mh, state: 'Tamil Nadu' });
    expect(bad.ok).toBe(false);
    expect(errs(bad).join(' ')).toMatch(/does not match the GSTIN/);
  });

  it('reports every problem in a row at once', () => {
    const r = validateCustomerRow({ name: '', phone: '123', gstin: 'XYZ', state: 'Atlantis', email: 'nope', openingBalance: 'lots' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(errs(r)).toHaveLength(6);
      expect(errs(r).join(' | ')).toMatch(/Name is missing/);
      expect(errs(r).join(' | ')).toMatch(/Phone "123"/);
      expect(errs(r).join(' | ')).toMatch(/GSTIN "XYZ"/);
      expect(errs(r).join(' | ')).toMatch(/State "Atlantis"/);
      expect(errs(r).join(' | ')).toMatch(/Email "nope"/);
      expect(errs(r).join(' | ')).toMatch(/Opening balance/);
    }
  });

  it('accepts a customer in credit (Tally "Cr", a minus sign or brackets) as a negative opening balance, with a note', () => {
    for (const cell of ['500 Cr', '-500', '(500)', '₹500.00 Cr']) {
      const r = validateCustomerRow({ name: 'A', phone: '9840011111', openingBalance: cell });
      expect(r.ok).toBe(true);
      expect(r.value?.openingBalancePaise).toBe(-50000);
      expect(r.warnings.join(' ')).toMatch(/In credit.*₹500\.00 in advance/);
    }
    // a customer who owes (Dr or plain) is unchanged and gets no such note
    const owes = validateCustomerRow({ name: 'A', phone: '9840011111', openingBalance: '500 Dr' });
    expect(owes.value?.openingBalancePaise).toBe(50000);
    expect(owes.warnings).toEqual([]);
  });

  it('still refuses a negative credit limit', () => {
    const r = validateCustomerRow({ name: 'A', phone: '9840011111', creditLimit: '-100' });
    expect(r.ok).toBe(false);
    expect(errs(r)[0]).toMatch(/Credit limit cannot be negative/);
  });

  it('warns, but accepts, an opening balance above the credit limit', () => {
    const r = validateCustomerRow({ name: 'A', phone: '9840011111', openingBalance: '900', creditLimit: '500' });
    expect(r.warnings).toEqual(['Opening balance is above the credit limit']);
  });

  it('uses a separate WhatsApp number when given', () => {
    const r = validateCustomerRow({ name: 'A', phone: '9840011111', whatsappNumber: '9840022222' });
    expect(r.value?.whatsappNumber).toBe('+919840022222');
  });
});
