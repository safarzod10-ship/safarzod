// Copy optimised GLBs from ../dist and the Basis transcoder from three into public/.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const pub = path.join(here, '..', 'public');
const dist = path.join(here, '..', '..', 'dist');
fs.mkdirSync(path.join(pub, 'models'), { recursive: true });
fs.mkdirSync(path.join(pub, 'basis'), { recursive: true });
for (const f of fs.readdirSync(dist).filter((f) => f.endsWith('.glb') || f === 'report.json')) {
  fs.copyFileSync(path.join(dist, f), path.join(pub, 'models', f));
}
const basis = path.join(here, '..', 'node_modules', 'three', 'examples', 'jsm', 'libs', 'basis');
for (const f of ['basis_transcoder.js', 'basis_transcoder.wasm']) fs.copyFileSync(path.join(basis, f), path.join(pub, 'basis', f));
console.log('synced', fs.readdirSync(path.join(pub, 'models')).join(', '));
