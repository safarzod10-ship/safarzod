// Finish the GitHub Pages build (after `vite build --config vite.pages.config.ts`):
// app.html becomes index.html, files the Mini App never loads are dropped, Jekyll is switched off.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist-pages');
fs.renameSync(path.join(OUT, 'app.html'), path.join(OUT, 'index.html'));
const KEEP = new Set(['MAP_Dvor.glb', 'MAP_Dvor.colliders.json', 'USER_CH_Technik.glb', 'USER_CH_Tank.glb', 'USER_CH_Sprinter.glb']);
for (const f of fs.readdirSync(path.join(OUT, 'models'))) if (!KEEP.has(f)) fs.rmSync(path.join(OUT, 'models', f));
fs.rmSync(path.join(OUT, 'basis'), { recursive: true, force: true });
fs.writeFileSync(path.join(OUT, '.nojekyll'), '');
let total = 0;
const walk = (d) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); const s = fs.statSync(p); if (s.isDirectory()) walk(p); else total += s.size; } };
walk(OUT);
console.log('dist-pages ready,', (total / 1e6).toFixed(2), 'MB');
