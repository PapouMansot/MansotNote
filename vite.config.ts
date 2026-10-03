import { fileURLToPath, URL } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { pdfAssets } from './scripts/vite-pdf-assets';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), pdfAssets(fileURLToPath(new URL('./node_modules/pdfjs-dist', import.meta.url)))],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: false,
    proxy: process.env.MANSOTNOTE_DEV_API_URL ? {
      '/storage/v1/object/public/mansotnote-media/': { target: process.env.MANSOTNOTE_DEV_API_URL, rewrite: (path) => path.replace(/^\/storage\/v1\/object\/public\/mansotnote-media\//, '/media/') },
      '/api': { target: process.env.MANSOTNOTE_DEV_API_URL, rewrite: (path) => path.replace(/^\/api/, '') },
    } : undefined,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    // Shiki embarque ses grammaires : on évite les faux positifs.
    chunkSizeWarningLimit: 1024,
  },
});
