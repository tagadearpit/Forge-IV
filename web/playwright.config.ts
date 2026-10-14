import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  timeout: 90_000,
  use: {
    // Local by default; set STUDYMIND_BASE_URL explicitly for the deployed smoke suite.
    baseURL: process.env.STUDYMIND_BASE_URL ?? 'http://127.0.0.1:3000',
    headless: true,
    trace: 'retain-on-failure',
  },
});
