import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  timeout: 90_000,
  use: {
    baseURL: process.env.STUDYMIND_BASE_URL ?? 'https://studymind-forgeiv.vercel.app',
    headless: true,
    trace: 'retain-on-failure',
  },
});
