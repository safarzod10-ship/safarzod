import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, '..', '..', 'dist');
const out = path.join(here, '..', 'public', 'models');
const files = ['MAP_Dvor.glb', 'MAP_Dvor.colliders.json', 'PROPS.glb', ...['Technik', 'Tank', 'Sprinter', 'Sniper', 'Medic'].map((n) => `USER_HERO_${n}.glb`)];

fs.mkdirSync(out, { recursive: true });
for (const f of files) fs.copyFileSync(path.join(dist, f), path.join(out, f));
console.log(`public/models: ${files.length} files`);
