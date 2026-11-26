// Assemble the Mini App shell for a claude.ai artifact (page fragment, no <html>/<head>/<body>):
// CSS inlined, assets = base64 models (no .glb hosting / WebAssembly there), mockup images copied.
//   npx vite build --config vite.app-artifact.config.ts && node scripts/artifact-assets.mjs && node scripts/app-artifact.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { splashHtml } from '../splash/build.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const V = path.join(here, '..');
const OUT = path.join(V, 'app-artifact');
const css = fs.readFileSync(path.join(OUT, 'app.css'), 'utf8');
fs.mkdirSync(path.join(OUT, 'ui'), { recursive: true });
for (const f of fs.readdirSync(path.join(V, 'public', 'ui'))) fs.copyFileSync(path.join(V, 'public', 'ui', f), path.join(OUT, 'ui', f));
fs.mkdirSync(path.join(OUT, 'models'), { recursive: true });
for (const f of fs.readdirSync(path.join(V, 'artifact', 'models'))) {
  if (f.endsWith('.txt') || f.endsWith('.json')) fs.copyFileSync(path.join(V, 'artifact', 'models', f), path.join(OUT, 'models', f));
}
const html = `<title>ДВОР Mini App</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Exo+2:ital,wght@1,800&family=Rubik:wght@400;500;600;700&display=swap">
<style>
${css}
html, body { height: 100%; }
body { padding-left: max(0px, env(safe-area-inset-left, 0px)); padding-right: max(0px, env(safe-area-inset-right, 0px)); }
</style>
${splashHtml()}
<div id="app"></div>
<script>document.documentElement.dataset.assets = 'b64';</script>
<script type="module" src="app.js"></script>
`;
fs.writeFileSync(path.join(OUT, 'index.html'), html);
console.log('app-artifact/index.html', html.length, 'bytes; files:', fs.readdirSync(OUT).join(', '));
