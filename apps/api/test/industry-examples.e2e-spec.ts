import { INDUSTRY_TEMPLATES, getIndustryExamples, productTemplateCsv, parseProductSheet, validateProductRow } from '@friendly-crm/shared';

/** Words that belong to one trade and would look out of place in another's form. */
const TRADE_WORDS: Record<string, RegExp> = {
  printing: /calendar|lamination|flex|card|brochure/i,
  furniture: /\bcots?\b|teak|wardrobe|sofa|\btables?\b/i,
  textiles: /shirt|cotton|saree|fabric|combed/i,
  trading: /flat bar|\bMS\b|steel|\btons?\b|cement/i,
};

describe('industry form examples', () => {
  const keys = Object.keys(INDUSTRY_TEMPLATES);

  it('covers every industry with enquiry, customer, company and product examples in both languages', () => {
    expect(keys.sort()).toEqual(['furniture', 'printing', 'textiles', 'trading']);
    for (const k of keys) {
      const e = INDUSTRY_TEMPLATES[k].examples!;
      expect(e).toBeTruthy();
      for (const f of ['enquiry', 'customer', 'company'] as const) {
        expect(e[f].en.length).toBeGreaterThan(5);
        expect(e[f].ta.length).toBeGreaterThan(5);
      }
      expect(e.product.name).toBeTruthy();
    }
  });

  it("each trade's enquiry example mentions its own goods and none of another trade's", () => {
    for (const k of keys) {
      const own = getIndustryExamples(k).enquiry.en;
      expect(own).toMatch(TRADE_WORDS[k]);
      for (const other of keys.filter((x) => x !== k)) {
        expect(own).not.toMatch(TRADE_WORDS[other]);
      }
    }
  });

  it('falls back to neutral wording for an unknown trade', () => {
    const e = getIndustryExamples('spaceships');
    for (const re of Object.values(TRADE_WORDS)) expect(e.enquiry.en).not.toMatch(re);
  });

  it('the product template for each trade is a valid, importable row in that trade', () => {
    for (const k of keys) {
      const sheet = parseProductSheet(productTemplateCsv(k));
      const check = validateProductRow(sheet.rows[0]);
      expect(check.ok).toBe(true);
      expect(check.value!.name).toBe(INDUSTRY_TEMPLATES[k].examples!.product.name);
    }
  });
});
