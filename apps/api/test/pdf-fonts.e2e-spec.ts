import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { InvoicePdfService } from '../src/modules/invoices/invoice-pdf.service';
import { splitRuns } from '../src/common/pdf/pdf-fonts';

/**
 * The PDFs use bundled Noto fonts so they can show the rupee sign and Tamil (the built-in PDF fonts can do neither).
 * Set PDF_DEBUG_DIR to also write the PDFs out, to look at them.
 */
const inv: any = {
  id: 'i1',
  invoiceNumber: 'INV/25-26/0007',
  financialYear: '2025-26',
  issuedAt: '2026-10-30T10:00:00.000Z',
  orderId: 'o1',
  orderNumber: 'ORD-2026-0007',
  supplyType: 'INTRA',
  placeOfSupply: { stateCode: '33', stateName: 'Tamil Nadu' },
  reverseCharge: false,
  supplier: { name: 'செந்தாமரை Art Crafts', gstin: '33AAAAA0000A1Z5', address: '12 பஜார் தெரு, கோயம்புத்தூர் 641001', stateCode: '33', phone: '+919840000001' },
  buyer: { name: 'முருகன் ஸ்டோர்ஸ் (Murugan Stores)', gstin: null, address: '5 காந்தி சாலை, Salem', stateCode: '33' },
  lines: [
    { lineNo: 1, itemName: 'MS Round Rod', description: '50 mm dia, 1 m length', hsnCode: '7214', quantity: '10', unit: 'Kg', unitPrice: '72.50', taxPercent: '18', taxableValue: '725.00', cgst: '65.25', sgst: '65.25', igst: '0.00', lineTotal: '855.50' },
    { lineNo: 2, itemName: 'திருமண அழைப்பிதழ்', description: 'தங்க நிற அச்சு, 300 GSM', hsnCode: '4911', quantity: '200', unit: 'Nos', unitPrice: '12.00', taxPercent: '12', taxableValue: '2400.00', cgst: '144.00', sgst: '144.00', igst: '0.00', lineTotal: '2688.00' },
  ],
  totals: { taxableValue: '3125.00', cgst: '209.25', sgst: '209.25', igst: '0.00', roundOff: '0.50', grandTotal: '3544.00' },
  credited: '0.00',
  netTotal: '3544.00',
  payment: { paid: '1000.00', balanceDue: '2544.00', customerCredit: '0.00', status: 'PARTIAL' },
};

describe('PDF fonts: rupee sign and Tamil', () => {
  it('splits mixed text into runs by font (the Tamil font has no English letters)', () => {
    expect(splitRuns('Murugan Stores')).toEqual([{ text: 'Murugan Stores', tamil: false }]);
    expect(splitRuns('முருகன்')).toEqual([{ text: 'முருகன்', tamil: true }]);
    expect(splitRuns('முருகன் ஸ்டோர்ஸ் (Murugan Stores) 5')).toEqual([
      { text: 'முருகன் ஸ்டோர்ஸ் (', tamil: true },
      { text: 'Murugan Stores) 5', tamil: false },
    ]);
    expect(splitRuns('')).toEqual([]);
  });

  it('an invoice prints the rupee sign and Tamil names, with the fonts embedded', async () => {
    const pdf = await new InvoicePdfService().generate(inv, null);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    if (process.env.PDF_DEBUG_DIR) {
      mkdirSync(process.env.PDF_DEBUG_DIR, { recursive: true });
      writeFileSync(join(process.env.PDF_DEBUG_DIR, 'invoice-tamil.pdf'), pdf);
    }
    const raw = pdf.toString('latin1');
    expect(raw).toMatch(/NotoSans/);
    expect(raw).toMatch(/NotoSansTamil/);
    expect(raw).not.toMatch(/Helvetica/); // no built-in font left: it has no rupee sign and no Tamil
  });
});
