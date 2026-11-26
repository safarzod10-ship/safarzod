import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist-pages');
fs.renameSync(path.join(out, 'app.html'), path.join(out, 'index.html'));
fs.writeFileSync(path.join(out, '.nojekyll'), '');

let total = 0;
const walk = (d) => {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p); else total += st.size;
  }
};
walk(out);
console.log(`dist-pages: ${(total / 1e6).toFixed(2)} MB`);
