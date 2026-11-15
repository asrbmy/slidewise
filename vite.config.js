import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { swPlugin } from './scripts/sw-plugin.js';

// BASE_PATH is configurable: "/my-repo/" for GitHub Pages project sites, "./" (default) works from any subpath.
const base = process.env.BASE_PATH || './';

export default defineConfig({
  base,
  plugins: [react(), swPlugin()],
  build: { target: 'es2020', sourcemap: false, chunkSizeWarningLimit: 900 },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{js,jsx}'],
    setupFiles: ['src/test/setup.js'],
    globals: true,
  },
});
