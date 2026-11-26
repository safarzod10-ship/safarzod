// Builds the splash fragment (splash.html with the logo pieces inlined as data URIs) and a Vite plugin
// that puts it where app.html says <!--splash-->. Used by the Pages/dev builds and scripts/app-artifact.mjs.
// The logo pieces (crown, the four letters, the underline, the whole wordmark for the shine mask) were
// keyed out of the customer's first menu art; logo_word.webp is 460 x 233 px, the crown sits above it.
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
