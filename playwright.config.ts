import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  timeout: 100_000,
  expect: { timeout: 20_000 },
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:5173', channel: process.env.BUIDL_BROWSER || 'chromium' },
  webServer: { command: 'npm run dev -- --port 5173 --strictPort', url: 'http://127.0.0.1:5173', reuseExistingServer: true },
});
