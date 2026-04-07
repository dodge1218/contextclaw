import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    pool: 'threads',
    include: ['src/__tests__/**/*.test.ts'],
    poolOptions: {
      threads: {
        singleThread: true,
      },
    },
  },
});
