import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' so the build works from any sub-path (GitHub Pages, static hosting)
export default defineConfig({ plugins: [react()], base: './', server: { host: true } });
