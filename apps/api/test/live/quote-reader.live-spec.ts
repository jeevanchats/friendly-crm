import * as fs from 'fs';
import * as path from 'path';
import { QuoteReaderService } from '../../src/modules/sales/quote-reader.service';
import { DocumentTextService } from '../../src/modules/sales/document-text.service';

/**
 * A LIVE check of enquiry reading (handwriting photo + spoken words) against the real Anthropic API. Not part of the
 * normal test lanes: run it with `npm run check:ai` from apps/api. It sends only a made-up enquiry.
 * The key is read from the repository's .env (Jest keeps its own copy of process.env, so load-env does not reach it).
 */
function keyFromDotEnv(): string | undefined {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  for (const dir of [process.cwd(), path.resolve(process.cwd(), '../..')]) {
    const file = path.join(dir, '.env');
    if (!fs.existsSync(file)) continue;
    const m = fs.readFileSync(file, 'utf8').match(/^ANTHROPIC_API_KEY=(.+)$/m);
    if (m) return m[1].trim();
  }
  return undefined;
}

const photo = fs.readFileSync(path.join(__dirname, 'fixtures', 'handwritten-enquiry.png'));

function readerWith(attachments: any[], leads: any[]) {
  const attachmentsSvc: any = { readable: async () => ({ leads, attachments }) };
  const productsSvc: any = { list: async () => ({ data: [{ id: 'p-card', name: 'Visiting Card', unit: 'Box', isActive: true }] }) };
  return new QuoteReaderService(attachmentsSvc, productsSvc, new DocumentTextService(), { forCustomer: async () => [] } as any);
}

describe('LIVE: enquiry reading (handwriting and voice note text)', () => {
  beforeAll(() => {
    process.env.ANTHROPIC_API_KEY = keyFromDotEnv();
    delete process.env.OLLAMA_URL;
  });

  it('reads a handwritten photo into quote lines', async () => {
    const reader = readerWith(
      [{ kind: 'FILE', fileName: 'note.png', mimeType: 'image/png', sizeBytes: photo.length, data: photo, transcript: null }],
      [{ id: 'l1', title: 'Enquiry from Ravi', notes: null, customData: {} }]
    );
    expect(reader.mode()).toBe('ai');
    const out = await reader.read('live-tenant-1', { userId: 'u', role: 'OWNER' } as any, { leadId: 'l1' });
    process.stdout.write(`\nHANDWRITING\n${out.summary}\n${out.lines.map((l) => `  ${l.itemName} | qty ${l.quantity} | ${l.unit} | rate ${l.unitPrice} | missing: ${l.missing.join(',')}`).join('\n')}\nskipped: ${out.skipped.join(' / ')}\n`);
    const text = out.lines.map((l) => `${l.itemName} ${l.description ?? ''}`.toLowerCase()).join('\n');
    expect(out.lines.length).toBeGreaterThanOrEqual(3);
    expect(text).toMatch(/visiting|card/);
    expect(text).toMatch(/letterhead/);
    expect(text).toMatch(/flex|banner/);
    expect(out.lines.find((l) => /visiting|card/i.test(l.itemName))?.quantity).toBe(500);
  }, 120_000);

  it('reads the words of a voice note (typed down) into quote lines', async () => {
    const reader = readerWith(
      [{ kind: 'VOICE', fileName: 'voice.webm', mimeType: 'audio/webm', sizeBytes: 10, data: Buffer.from('x'), transcript: 'need two hundred wedding invitation cards and ten thousand rupee flex board one piece' }],
      [{ id: 'l2', title: 'Phone enquiry', notes: null, customData: {} }]
    );
    const out = await reader.read('live-tenant-2', { userId: 'u', role: 'OWNER' } as any, { leadId: 'l2' });
    process.stdout.write(`\nVOICE\n${out.summary}\n${out.lines.map((l) => `  ${l.itemName} | qty ${l.quantity} | rate ${l.unitPrice}`).join('\n')}\n`);
    const text = out.lines.map((l) => l.itemName.toLowerCase()).join('\n');
    expect(text).toMatch(/invitation|card/);
    expect(out.lines.find((l) => /invitation|card/i.test(l.itemName))?.quantity).toBe(200);
  }, 120_000);

  it('keeps sizes in the description and does not turn a size into a quantity (steel enquiry)', async () => {
    const reader = readerWith(
      [],
      [{ id: 'l3', title: 'Follow up with Jeevan (ms rod 50diameter 1 meter length, ms falt 20 x 30 6 meter)', notes: null, customData: {} }]
    );
    const out = await reader.read('live-tenant-3', { userId: 'u', role: 'OWNER' } as any, { leadId: 'l3' });
    const rows = out.lines.map((l) => `  [${l.itemName}] desc="${l.description}" qty ${l.quantity} unit="${l.unit}" missing: ${l.missing.join(',')}`);
    process.stdout.write(['', 'STEEL', out.summary, ...rows, ''].join('\n'));
    expect(out.lines).toHaveLength(2);
    const rod = out.lines.find((l) => /rod/i.test(l.itemName))!;
    const flat = out.lines.find((l) => /fl[a-z]*t/i.test(l.itemName))!;
    expect(rod.itemName).not.toMatch(/\d/); // no size in the name
    expect(flat.itemName).not.toMatch(/\d/);
    expect(rod.description).toMatch(/50/);
    expect(flat.description).toMatch(/20/);
    expect(rod.quantity).toBe(0); // "1 meter length" is a size, not how many
    expect(flat.quantity).toBe(0);
    expect(rod.missing).toEqual(expect.arrayContaining(['quantity', 'unit', 'rate']));
  }, 120_000);
});
