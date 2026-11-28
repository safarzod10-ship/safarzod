/**
 * Contact sheet of cut sprites on a light background with the measured lot
 * diamond drawn on top (to check edges and anchors):
 *   node tools/art/preview.mjs <cutDir> <out.png> [scale=2] [filter-regex]
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const [, , dir, out, scaleArg, filter] = process.argv;
const S = Number(scaleArg ?? 2);
const re = filter ? new RegExp(filter) : null;
const cut = JSON.parse(readFileSync(join(dir, 'cut.json'), 'utf8'));
const items = cut.sprites.filter((s) => !re || re.test(s.name));
const WIDTH = 1900;
const comp = [];
let x = 10;
let y = 10;
let rowH = 0;
for (const s of items) {
  const w = Math.round(s.w * S);
  const h = Math.round(s.h * S);
  if (x + w > WIDTH) (x = 10), (y += rowH + 26), (rowH = 0);
  comp.push({ input: await sharp(join(dir, s.file)).resize(w, h, { kernel: 'nearest' }).toBuffer(), left: x, top: y });
  if (!s.name.startsWith('tree')) {
    const hw = (s.dw / 2) * S;
    const hh = hw / 2;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(hw * 2 + 4)}" height="${Math.ceil(hh * 2 + 4)}"><polygon points="${hw + 2},2 ${2 * hw + 2},${hh + 2} ${hw + 2},${2 * hh + 2} 2,${hh + 2}" fill="none" stroke="#e0007a" stroke-width="1.5" stroke-dasharray="4 3"/></svg>`;
    comp.push({ input: Buffer.from(svg), left: Math.max(0, Math.round(x + s.ax * S - hw - 2)), top: Math.max(0, Math.round(y + s.ay * S - hh - 2)) });
  }
  const label = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20"><text x="0" y="15" font-family="sans-serif" font-size="13" fill="#123">${s.name}</text></svg>`;
  comp.push({ input: Buffer.from(label), left: x, top: y + h + 2 });
  x += w + 14;
  rowH = Math.max(rowH, h);
}
await sharp({ create: { width: WIDTH, height: y + rowH + 34, channels: 4, background: '#cfe0c4' } }).composite(comp).png().toFile(out);
