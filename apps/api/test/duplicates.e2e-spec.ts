import { cleanDisplayName, findImportNameClashes, makeSimilarFinder, nameKey, nameSimilarity, rankSimilar } from '@friendly-crm/shared';

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

describe('duplicate control: the fast path agrees with the plain comparison, and is fast', () => {
  const words = ['Anand', 'Murugan', 'Lakshmi', 'Traders', 'Stores', 'Agencies', 'Textiles', 'Furniture', 'Printers', 'Steel', 'Balaji', 'Kumar', 'Ganesh', 'Velan', 'Selvam', 'Vinayaga'];
  const name = (i: number) => `${words[i % 16]} ${words[(i * 7 + 3) % 16]} ${words[(i * 3 + 1) % 16]}`;
  // Small slips of the kind people actually make
  const slip = (s: string, i: number) => [s + 's', s.replace(/a/, 'aa'), s.slice(1), s.replace(/ /, '  '), s.replace(/e/, 'i'), s.toUpperCase(), `M/s. ${s} Pvt Ltd`, s + ' x'][i % 8];

  it('finds exactly the pairs the plain similarity score would', () => {
    const pool = Array.from({ length: 200 }, (_, i) => ({ id: String(i), name: name(i * 5) }));
    const finder = makeSimilarFinder(pool);
    for (let i = 0; i < 120; i++) {
      const q = slip(name(i * 11 + 2), i);
      const expected = pool.filter((p) => nameSimilarity(q, p.name) >= 0.82).map((p) => p.id).sort();
      const got = finder.find({ name: q }, { limit: 1000 }).map((h) => h.item.id).sort();
      expect(got).toEqual(expected);
    }
  });

  it('an import check stays quick: a big file against a big master compares identical names only, a modest one compares by similarity', () => {
    const pool = Array.from({ length: 5000 }, (_, i) => ({ id: String(i), name: `${name(i)} ${i}` }));

    let started = Date.now();
    const rows = Array.from({ length: 1000 }, (_, i) => ({ name: i === 3 ? name(3).toUpperCase() + ' 3' : `${name(i * 5 + 1)} ${i * 5 + 1}x` }));
    const big = findImportNameClashes(rows, pool);
    expect(big.fuzzy).toBe(false);
    expect(big.hits[3]?.item.id).toBe('3'); // identical once tidied is still found
    expect(Date.now() - started).toBeLessThan(3000);

    started = Date.now();
    const small = findImportNameClashes(rows.slice(0, 40), pool.slice(0, 2000));
    expect(small.fuzzy).toBe(true);
    expect(Date.now() - started).toBeLessThan(15000);
  });
});

describe('duplicate control: a short name inside a longer one (customers)', () => {
  const pool = [
    { id: 's', name: 'Jeevan Prakash Nadar', companyName: 'CHRIS GRAPHIC DESIGN STUDIO', gstin: null, code: null },
    { id: 'k', name: 'Kumar Stores', companyName: null, gstin: null, code: null },
  ];

  it('is not matched by default (spelling similarity alone)', () => {
    expect(rankSimilar({ name: 'Jeevan', companyName: 'Chris graphic' }, pool)).toEqual([]);
  });

  it('with `contained`, "Chris graphic" finds "Chris Graphic Design Studio", either way round', () => {
    const hit = rankSimilar({ name: 'Jeevan', companyName: 'Chris graphic' }, pool, { contained: true });
    expect(hit.map((h) => [h.item.id, h.reason])).toEqual([['s', 'similar-name']]);
    const back = rankSimilar({ name: 'x', companyName: 'Chris Graphic Design Studio Chennai' }, pool, { contained: true });
    expect(back.map((h) => h.item.id)).toEqual(['s']);
  });

  it('needs two or more words, so "Kumar" does not match "Kumar Stores"', () => {
    expect(rankSimilar({ name: 'Kumar' }, pool, { contained: true })).toEqual([]);
  });

  it('is also used when checking an import file', () => {
    const { hits } = findImportNameClashes([{ name: 'Chris Graphic' }, { name: 'Brand New Company' }], pool, { contained: true });
    expect(hits[0]?.item.id).toBe('s');
    expect(hits[1]).toBeUndefined();
  });
});
