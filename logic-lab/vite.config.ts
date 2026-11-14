import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative base so the built dist/ works from any sub-path (GitHub Pages, a plain folder, ...).
  base: './',
  plugins: [react()]
});
