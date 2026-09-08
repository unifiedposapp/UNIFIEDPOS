import { defineConfig } from 'vitest/config';

// Root Vitest config. Tests live in each package's `test/` folder (outside
// `src/`) so they are excluded from the production `tsc` build.
export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    environment: 'node',
    globals: false,
    // The pure-function suites need no database; keep them fast and isolated.
    testTimeout: 10000,
    // Coverage is OPT-IN (`npm run test:coverage` → `vitest run --coverage`), so
    // a plain `npm test` never requires @vitest/coverage-v8 to be installed.
    // The gate is scoped to the money-critical pure modules that are unit-tested
    // today; widen `include` and ratchet the thresholds up as coverage grows.
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      reportsDirectory: './coverage',
      include: [
        'packages/web/src/services/escpos.ts',
        'packages/server/src/services/paymentProvider.ts',
        'packages/server/src/data/currencies.ts',
        'packages/server/src/services/crypto.ts',
        'packages/server/src/data/paymentMethods.ts',
        'packages/server/src/services/moneyMath.ts',
        'packages/server/src/services/email.ts',
      ],
      thresholds: {
        statements: 70,
        branches: 60,
        functions: 70,
        lines: 70,
      },
    },
  },
});
