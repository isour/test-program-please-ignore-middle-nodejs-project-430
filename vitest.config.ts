import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Явный include: тесты лежат в tests/ и находятся надёжно, не полагаясь на дефолты Vitest
    include: ['tests/**/*.test.ts'],
  },
});
