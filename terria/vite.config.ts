import { defineConfig } from 'vitest/config';

// Relative base so the build can be hosted from any path
// (Telegram Mini App hosting, GitHub Pages sub-folder, static preview).
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
  worker: { format: 'es' },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
