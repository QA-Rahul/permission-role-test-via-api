import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.PORT ?? 3000);

export default defineConfig({
  testDir: './tests',
  // Tests share one stateful API and reset it before each test, so run serially.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0, // permission tests must be deterministic — no retrying flaky passes
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never' }], ['junit', { outputFile: 'test-results/junit.xml' }]]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    extraHTTPHeaders: { Accept: 'application/json' },
  },
  webServer: {
    command: 'node app/server.mjs',
    url: `http://localhost:${PORT}/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 15_000,
  },
});
