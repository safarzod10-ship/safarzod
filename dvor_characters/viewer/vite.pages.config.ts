import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Mini App for static hosting (GitHub Pages, set as the bot's Mini App URL in BotFather).
//   npx vite build --config vite.pages.config.ts && node scripts/pages.mjs
// Real .glb files with the Meshopt decoder (unlike the claude.ai artifact build).
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    outDir: 'dist-pages',
    emptyOutDir: true,
    rollupOptions: { input: { app: resolve(__dirname, 'app.html') } },
  },
});
