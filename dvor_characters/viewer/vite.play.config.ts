import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Bundle for the claude.ai artifact "Пробежка по двору": one ES module, no code splitting.
//   npx vite build --config vite.play.config.ts && node scripts/artifact-assets.mjs
export default defineConfig({
  build: {
    target: 'es2020',
    outDir: 'artifact',
    emptyOutDir: false,
    copyPublicDir: false,
    lib: { entry: resolve(__dirname, 'src/play.ts'), formats: ['es'], fileName: () => 'play.js' },
  },
});
