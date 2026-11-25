import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Mini App shell as a claude.ai artifact: one ES module + one CSS file, assembled into
// app-artifact/index.html by scripts/app-artifact.mjs.
//   npx vite build --config vite.app-artifact.config.ts && node scripts/app-artifact.mjs
export default defineConfig({
  build: {
    target: 'es2020',
    outDir: 'app-artifact',
    emptyOutDir: false,
    copyPublicDir: false,
    cssCodeSplit: false,
    lib: { entry: resolve(__dirname, 'src/app/main.ts'), formats: ['es'], fileName: () => 'app.js', cssFileName: 'app' },
  },
});
