import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// The ASP.NET server hosts /api in development (see README); the production build is served by it from wwwroot.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:5180' },
  },
  build: {
    outDir: '../server/BubblesMd.Server/wwwroot',
    emptyOutDir: true,
    // Tiptap + CodeMirror + marked in one bundle (~1.2 MB, ~400 kB gzip); acceptable for this single-page editor.
    chunkSizeWarningLimit: 1500,
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
});
