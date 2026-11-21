import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base: './' 让 dist/ 可以放在任意子路径下（GitHub Pages、Cloudflare Pages 等）
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { chunkSizeWarningLimit: 1500 }, // three.js 本身就有约 1 MB
});
