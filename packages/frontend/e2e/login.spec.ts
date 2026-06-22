import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = path.resolve(__dirname, '../../../.agent-swarm/2026-06-22_deploy-e2e/screenshots');

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

test('admin login succeeds and navigates to rooms', async ({ page }) => {
  test.skip(!ADMIN_PASSWORD, 'ADMIN_PASSWORD environment variable is not set');

  await page.goto('/login');

  // Ensure we are on the admin tab
  await page.getByRole('tab', { name: /管理员|Admin/i }).click();

  await page.getByRole('textbox', { name: /用户名|Username/i }).fill(ADMIN_USERNAME);
  await page.getByRole('textbox', { name: /密码|Password/i }).fill(ADMIN_PASSWORD);

  await page.getByRole('button', { name: /登录|Login/i }).click();

  // Wait for navigation to room list
  await page.waitForURL('/rooms', { timeout: 10000 });
  await expect(page).toHaveURL('/rooms');

  // Verify admin-specific elements are present
  await expect(page.getByRole('button', { name: /管理员面板|Admin Panel/i })).toBeVisible();

  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'login-rooms.png'), fullPage: true });
});
