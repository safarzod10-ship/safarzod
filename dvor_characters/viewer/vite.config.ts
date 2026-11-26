import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { splashPlugin } from './splash/build.mjs';

export default defineConfig({
  base: './',
  plugins: [splashPlugin()],
  build: {
    target: 'es2020',
    outDir: 'dist-pages',
    emptyOutDir: true,
    rollupOptions: { input: { app: resolve(__dirname, 'app.html') } },
  },
});
