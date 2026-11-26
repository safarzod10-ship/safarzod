// Builds the splash fragment (splash.html with the logos inlined as data URIs) and a Vite plugin that
// puts it where app.html says <!--splash-->. Used by the Pages/dev builds and scripts/app-artifact.mjs.
// The logos are the crown and the wordmark keyed out of the first menu art (782x1580 px, removed); the
// percentages in splash.html are their boxes in that picture, so they land exactly on the menu art.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const dataUri = (f) => `data:image/webp;base64,${fs.readFileSync(path.join(dir, f)).toString('base64')}`;

export function splashHtml() {
  return fs.readFileSync(path.join(dir, 'splash.html'), 'utf8')
    .replace('__LOGO_WORD__', dataUri('logo_word.webp'))
    .replace('__LOGO_CROWN__', dataUri('logo_crown.webp'));
}

export function splashPlugin() {
  return { name: 'dvor-splash', transformIndexHtml: (html) => html.replace('<!--splash-->', splashHtml()) };
}
