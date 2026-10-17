import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 15_000,
  use: { baseURL: 'http://127.0.0.1:5173', ...devices['Desktop Chrome'], screenshot: 'only-on-failure' },
  webServer: { command: 'pnpm dev -- --host 127.0.0.1', url: 'http://127.0.0.1:5173', reuseExistingServer: true, timeout: 30_000 },
});
