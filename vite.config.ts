import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Copies index.html to 404.html after build so hosting providers
// that don't support _redirects still serve the SPA on any path.
function spa404Fallback() {
  return {
    name: 'spa-404-fallback',
    closeBundle() {
      const distDir = fileURLToPath(new URL('./dist', import.meta.url));
      const indexHtml = join(distDir, 'index.html');
      const notFoundHtml = join(distDir, '404.html');
      if (existsSync(indexHtml)) {
        copyFileSync(indexHtml, notFoundHtml);
      }
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), spa404Fallback()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
});
