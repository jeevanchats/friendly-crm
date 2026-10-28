import {
  GST_STATES,
  computeGstInvoice,
  financialYear,
  formatInvoiceNumber,
  gstinCheckChar,
  isValidGstin,
  isValidHsn,
  stateCodeFromGstin,
} from '@friendly-crm/shared';

describe('GST helpers', () => {
  describe('GSTIN', () => {
    it('accepts well-formed GSTINs with the right check character', () => {
      for (const g of ['27AAPFU0939F1ZV', '33AAAAA0000A1Z5', '29AABCT1332L1ZT']) {
        const withCheck = g.slice(0, 14) + gstinCheckChar(g.slice(0, 14));
        expect(isValidGstin(withCheck)).toBe(true);
      }
      expect(isValidGstin('27AAPFU0939F1ZV')).toBe(true);
    });

    it('rejects a wrong check character, bad shape, unknown state and non-strings', () => {
      expect(isValidGstin('27AAPFU0939F1ZX')).toBe(false); // wrong check char
      expect(isValidGstin('27AAPFU0939F1Z')).toBe(false); // too short
      expect(isValidGstin('99AAPFU0939F1Z' + gstinCheckChar('99AAPFU0939F1Z'))).toBe(false); // no state 99
      expect(isValidGstin('27aapfu0939f1zv')).toBe(true); // case-insensitive
      expect(isValidGstin(null)).toBe(false);
      expect(isValidGstin(27)).toBe(false);
    });

    it('reads the state from a valid GSTIN only', () => {
      expect(stateCodeFromGstin('27AAPFU0939F1ZV')).toBe('27');
      expect(stateCodeFromGstin('27AAPFU0939F1ZX')).toBeNull();
      expect(stateCodeFromGstin(null)).toBeNull();
      expect(GST_STATES['33']).toBe('Tamil Nadu');
    });
  });

  describe('HSN', () => {
    it('accepts 4, 6 and 8 digit codes only', () => {
      for (const ok of ['4901', '490199', '49011010']) expect(isValidHsn(ok)).toBe(true);
      for (const bad of ['', '49', '490', '49011', '4901101', '490110101', '49O1', ' 4901', undefined]) {
        expect(isValidHsn(bad as any)).toBe(false);
      }
    });
  });

  describe('financial year and invoice numbers', () => {
    it('rolls the year over in April', () => {
      expect(financialYear(new Date(2026, 2, 31))).toBe('2025-26'); // 31 Mar 2026
      expect(financialYear(new Date(2026, 3, 1))).toBe('2026-27'); // 1 Apr 2026
      expect(financialYear(new Date(2026, 9, 25))).toBe('2026-27');
      expect(financialYear(new Date(2027, 0, 5))).toBe('2026-27');
      expect(financialYear(new Date(2099, 5, 1))).toBe('2099-00');
    });

    it('formats within the 16 character GST limit and refuses overflow', () => {
      expect(formatInvoiceNumber('2026-27', 1)).toBe('INV/2026-27/0001');
      expect(formatInvoiceNumber('2026-27', 9999)).toBe('INV/2026-27/9999');
      expect(formatInvoiceNumber('2026-27', 1).length).toBe(16);
      expect(() => formatInvoiceNumber('2026-27', 10000)).toThrow(/16 character/);
      expect(() => formatInvoiceNumber('2026-27', 0)).toThrow();
    });
  });

  describe('computeGstInvoice', () => {
    const line = (over: Partial<Parameters<typeof computeGstInvoice>[0]['lines'][0]> = {}) => ({
      itemName: 'Wall calendar',
      hsnCode: '4910',
      quantity: 100,
      unit: 'Nos',
      unitPrice: 10,
      taxPercent: 18,
      ...over,
    });

    it('splits intra-state tax into equal CGST and SGST', () => {
      const r = computeGstInvoice({ lines: [line()], agreedTotalPaise: 118000, supplierStateCode: '33', placeOfSupplyStateCode: '33' });
      expect(r.supplyType).toBe('INTRA');
      expect(r).toMatchObject({ taxablePaise: 100000, cgstPaise: 9000, sgstPaise: 9000, igstPaise: 0, roundOffPaise: 0, grandTotalPaise: 118000 });
    });

    it('charges IGST on inter-state supply', () => {
      const r = computeGstInvoice({ lines: [line()], agreedTotalPaise: 118000, supplierStateCode: '33', placeOfSupplyStateCode: '27' });
      expect(r.supplyType).toBe('INTER');
      expect(r).toMatchObject({ taxablePaise: 100000, cgstPaise: 0, sgstPaise: 0, igstPaise: 18000, roundOffPaise: 0 });
    });

    it('handles mixed rates per line', () => {
      const r = computeGstInvoice({
        lines: [line({ taxPercent: 12, unitPrice: 5 }), line({ itemName: 'Service', hsnCode: '998361', taxPercent: 18, unitPrice: 20 })],
        agreedTotalPaise: 56000 + 236000,
        supplierStateCode: '33',
        placeOfSupplyStateCode: '33',
      });
      expect(r.lines.map((l) => l.taxablePaise)).toEqual([50000, 200000]);
      expect(r.cgstPaise + r.sgstPaise).toBe(6000 + 36000);
      expect(r.roundOffPaise).toBe(0);
    });

    it('applies a discount to the taxable value, so tax falls too, and still totals the agreed amount', () => {
      // ₹1,000 + 18% = ₹1,180, discounted to ₹1,062 (10% off the gross)
      const r = computeGstInvoice({ lines: [line()], agreedTotalPaise: 106200, supplierStateCode: '33', placeOfSupplyStateCode: '33' });
      expect(r.taxablePaise).toBe(90000);
      expect(r.cgstPaise).toBe(8100);
      expect(r.sgstPaise).toBe(8100);
      expect(r.roundOffPaise).toBe(0);
      expect(r.grandTotalPaise).toBe(106200);
    });

    it('always lands exactly on the agreed total, putting rounding in round-off', () => {
      const lines = [
        line({ quantity: 3, unitPrice: 33.33, taxPercent: 5 }),
        line({ quantity: 7, unitPrice: 12.49, taxPercent: 12 }),
        line({ quantity: 1, unitPrice: 0.99, taxPercent: 28 }),
      ];
      const gross = lines.reduce((s, l) => s + Math.round(l.quantity * l.unitPrice * 100 * (1 + l.taxPercent / 100)), 0);
      for (const place of ['33', '19']) {
        const r = computeGstInvoice({ lines, agreedTotalPaise: gross, supplierStateCode: '33', placeOfSupplyStateCode: place });
        const sum = r.lines.reduce((s, l) => s + l.totalPaise, 0);
        expect(sum + r.roundOffPaise).toBe(gross);
        expect(Math.abs(r.roundOffPaise)).toBeLessThanOrEqual(3);
        expect(r.taxablePaise + r.cgstPaise + r.sgstPaise + r.igstPaise + r.roundOffPaise).toBe(gross);
        expect(r.cgstPaise).toBe(r.sgstPaise);
      }
    });

    it('supports zero-rated lines', () => {
      const r = computeGstInvoice({ lines: [line({ taxPercent: 0 })], agreedTotalPaise: 100000, supplierStateCode: '33', placeOfSupplyStateCode: '27' });
      expect(r).toMatchObject({ taxablePaise: 100000, igstPaise: 0, roundOffPaise: 0 });
    });

    it('refuses lines that do not reconcile with the order total, empty invoices and bad state codes', () => {
      expect(() => computeGstInvoice({ lines: [line()], agreedTotalPaise: 118000 + 5000, supplierStateCode: '33', placeOfSupplyStateCode: '33' })).toThrow(/higher than its lines/);
      expect(() => computeGstInvoice({ lines: [], agreedTotalPaise: 100, supplierStateCode: '33', placeOfSupplyStateCode: '33' })).toThrow(/at least one/);
      expect(() => computeGstInvoice({ lines: [line()], agreedTotalPaise: 100, supplierStateCode: '99', placeOfSupplyStateCode: '33' })).toThrow(/state codes/);
      expect(() => computeGstInvoice({ lines: [line()], agreedTotalPaise: 1.5, supplierStateCode: '33', placeOfSupplyStateCode: '33' })).toThrow(/whole paise/);
    });
  });
});

import { amountInWords } from '@friendly-crm/shared';

describe('amountInWords', () => {
  it.each([
    [0, 'Rupees Zero Only'],
    [100, 'Rupees One Only'],
    [118000, 'Rupees One Thousand One Hundred Eighty Only'],
    [12345600, 'Rupees One Lakh Twenty Three Thousand Four Hundred Fifty Six Only'],
    [12345670, 'Rupees One Lakh Twenty Three Thousand Four Hundred Fifty Six and Seventy Paise Only'],
    [1000000000, 'Rupees One Crore Only'],
    [250000000000, 'Rupees Two Hundred Fifty Crore Only'],
    [5, 'Rupees Zero and Five Paise Only'],
    [2000000, 'Rupees Twenty Thousand Only'],
  ])('%i paise', (paise, words) => {
    expect(amountInWords(paise)).toBe(words);
  });

  it('handles round lakhs and thousands without stray words', () => {
    expect(amountInWords(10000100)).toBe('Rupees One Lakh One Only');
    expect(amountInWords(10100000)).toBe('Rupees One Lakh One Thousand Only');
  });

  it('rejects fractions and negatives', () => {
    expect(() => amountInWords(1.5)).toThrow();
    expect(() => amountInWords(-1)).toThrow();
  });
});
