import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';

// Load test credentials from .env.test (gitignored; never commit secrets).
dotenv.config({ path: '.env.test' });

/**
 * Playwright E2E configuration for filesync frontend.
 *
 * Credentials are loaded from environment variables (never hardcoded).
 * Copy .env.test.template to .env.test and fill in real values for local runs.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [['list'], ['html', { outputFolder: '../.agent-swarm/2026-06-22_deploy-e2e/playwright-report' }]],
  use: {
    // Default to the local Vite dev server. Set BASE_URL to a production
    // Pages URL (e.g. https://filesync.example.com) for production E2E runs.
    baseURL: process.env.BASE_URL || 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    headless: true,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
