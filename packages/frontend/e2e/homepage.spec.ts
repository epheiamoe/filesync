import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = path.resolve(__dirname, '../../../.agent-swarm/2026-06-22_deploy-e2e/screenshots');

test('homepage loads and shows login form', async ({ page, baseURL }) => {
  await page.goto(baseURL || '/');

  // Wait for the app shell to render
  await expect(page.locator('h1', { hasText: /filesync/i })).toBeVisible();

  // Verify admin login tab and form elements exist
  await expect(page.getByRole('tab', { name: /管理员|Admin/i })).toBeVisible();
  await expect(page.getByRole('textbox', { name: /用户名|Username/i })).toBeVisible();
  await expect(page.getByRole('textbox', { name: /密码|Password/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /登录|Login/i })).toBeVisible();

  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'homepage.png'), fullPage: true });
});
