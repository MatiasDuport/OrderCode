import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  use: { baseURL: 'http://127.0.0.1:5174', ...devices['Desktop Chrome'], screenshot: 'only-on-failure' },
  webServer: { command: 'pnpm exec vite --host 127.0.0.1 --port 5174 --strictPort --mode e2e', url: 'http://127.0.0.1:5174/src/styles.css', reuseExistingServer: false, timeout: 90_000 },
});
