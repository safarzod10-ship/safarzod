import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const dataUri = (f) => `data:image/webp;base64,${fs.readFileSync(path.join(dir, f)).toString('base64')}`;
const PARTS = { L1: 'logo_l1', L2: 'logo_l2', L3: 'logo_l3', L4: 'logo_l4', LINE: 'logo_line', CROWN: 'logo_crown', WORD: 'logo_word' };

export function splashHtml() {
  let html = fs.readFileSync(path.join(dir, 'splash.html'), 'utf8');
  for (const [k, f] of Object.entries(PARTS)) html = html.replace(`__LOGO_${k}__`, dataUri(`${f}.webp`));
  return html;
}

export function splashPlugin() {
  return { name: 'dvor-splash', transformIndexHtml: (html) => html.replace('<!--splash-->', splashHtml()) };
}
