import { defineConfig } from 'vitest/config';

// Relative base so the built site works from any sub-path (GitHub Pages
// serves project sites from /<repo>/).
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        main: 'index.html',
        debug: 'debug.html',
      },
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
