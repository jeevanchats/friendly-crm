import { cleanDisplayName, nameKey, nameSimilarity, rankSimilar } from '@friendly-crm/shared';

describe('duplicate control: names', () => {
  it('tidies a name without changing its case or punctuation', () => {
    expect(cleanDisplayName('  Anand   Traders ')).toBe('Anand Traders');
    expect(cleanDisplayName('A4  Sheet')).toBe('A4 Sheet');
    expect(cleanDisplayName(null)).toBe('');
  });

  it('gives one key to the usual ways of writing the same business', () => {
    const k = nameKey('Anand Traders');
    for (const v of ['ANAND TRADERS', 'Anand Trader', 'M/s. Anand Traders Pvt. Ltd.', 'Tvl. Anand-Traders', 'anand  traders']) {
      expect(nameKey(v)).toBe(k);
    }
  });

  it('treats "and" and "&" alike', () => {
    expect(nameKey('Rao & Sons')).toBe(nameKey('Rao and Sons'));
  });

  it('keeps different businesses apart', () => {
    expect(nameSimilarity('Anand Traders', 'Anand Agencies')).toBeLessThan(0.82);
    expect(nameSimilarity('Sri Murugan Stores', 'Sri Murugan Textiles')).toBeLessThan(0.82);
  });

  it('catches a spelling slip and a transliteration variant', () => {
    expect(nameSimilarity('Vinayaga Furniture', 'Vinayaka Furnitures')).toBeGreaterThanOrEqual(0.82);
    expect(nameSimilarity('Anand Traders', 'Anan Traders')).toBeGreaterThanOrEqual(0.82);
  });

  it('works for Tamil names', () => {
    expect(nameKey('ஆனந்த் டிரேடர்ஸ்')).toBe(nameKey('ஆனந்த்  டிரேடர்ஸ்'));
    expect(nameSimilarity('ஆனந்த் டிரேடர்ஸ்', 'ஆனந்த் டிரேடர்')).toBeGreaterThanOrEqual(0.82);
  });

  it('is zero for empty or noise-only names', () => {
    expect(nameSimilarity('', 'Anand')).toBe(0);
    expect(nameSimilarity('Pvt Ltd', 'Anand')).toBe(0);
  });
});

describe('duplicate control: ranking', () => {
  const pool = [
    { id: '1', name: 'Anand Traders', companyName: null, gstin: '33AAAAA0000A1Z5', code: null },
    { id: '2', name: 'Murugan Stores', companyName: 'Sri Murugan Stores Pvt Ltd', gstin: null, code: null },
    { id: '3', name: 'Kumar', companyName: null, gstin: null, code: null },
  ];

  it('a shared GSTIN is a certain match even under a different name', () => {
    const [hit] = rankSimilar({ name: 'Totally Different', gstin: '33aaaaa0000a1z5' }, pool);
    expect(hit).toMatchObject({ reason: 'gstin', score: 1 });
    expect(hit.item.id).toBe('1');
  });

  it('matches on the company name as well as the contact name', () => {
    const [hit] = rankSimilar({ name: 'Murugan Stores' }, pool);
    expect(hit.item.id).toBe('2');
    expect(hit.reason).toBe('same-name');
  });

  it('flags a near spelling as similar, not same', () => {
    const [hit] = rankSimilar({ name: 'Anand Trader' }, pool);
    expect(hit.item.id).toBe('1');
  });

  it('finds nothing for a new name, and can skip the record being edited', () => {
    expect(rankSimilar({ name: 'Brand New Company' }, pool)).toEqual([]);
    expect(rankSimilar({ name: 'Anand Traders' }, pool, { excludeId: '1' })).toEqual([]);
  });

  it('matches products on code, ignoring case', () => {
    const products = [{ id: 'p1', name: 'A4 Sheet', code: 'PAP-A4' }];
    const [hit] = rankSimilar({ name: 'Something else', code: 'pap-a4' }, products);
    expect(hit).toMatchObject({ reason: 'code', score: 1 });
  });

  it('ranks certain matches above name matches and honours the limit', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ id: `x${i}`, name: 'Anand Traders' }));
    expect(rankSimilar({ name: 'Anand Traders' }, many, { limit: 3 })).toHaveLength(3);
  });
});
