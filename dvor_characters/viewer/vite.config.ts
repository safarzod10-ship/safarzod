import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { splashPlugin } from './splash/build.mjs';

// Relative base so the build works from any sub-path (Telegram Mini App hosting, GitHub Pages...).
export default defineConfig({
  base: './',
  plugins: [splashPlugin()],
  build: {
    target: 'es2020',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        preview: resolve(__dirname, 'preview.html'),
        app: resolve(__dirname, 'app.html'),
      },
    },
  },
});
