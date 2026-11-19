import { defineConfig } from 'vitest/config';

/** Runs only the sound-bank builder: `npm run sounds`. */
export default defineConfig({
  test: {
    include: ['scripts/sounds/build.test.ts'],
    testTimeout: 120000,
  },
});
