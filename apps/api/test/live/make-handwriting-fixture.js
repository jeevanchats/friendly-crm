// Draws test/live/fixtures/handwritten-enquiry.png (a handwriting-style enquiry) for the live reader check.
// Run: node test/live/make-handwriting-fixture.js   (Windows: uses the Ink Free font)
const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const fs = require('fs');
const path = require('path');

GlobalFonts.registerFromPath('C:\\Windows\\Fonts\\Inkfree.ttf', 'InkFree');
const c = createCanvas(900, 520);
const g = c.getContext('2d');
g.fillStyle = '#faf8ee';
g.fillRect(0, 0, 900, 520);
g.fillStyle = '#192878';
g.font = '46px InkFree';
const lines = [
  'Enquiry - Mr Ravi (Sri Murugan Stores)',
  '1) Visiting cards 500 nos - 300 gsm matt',
  '2) A4 letterhead  2 reams',
  '3) Flex banner 10 x 4 ft - 2 pcs',
  '    rate 12 per sq ft',
];
lines.forEach((t, i) => g.fillText(t, 40 + (i % 2) * 6, 80 + i * 85));
const out = path.join(__dirname, 'fixtures', 'handwritten-enquiry.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, c.toBuffer('image/png'));
console.log('wrote', out);
