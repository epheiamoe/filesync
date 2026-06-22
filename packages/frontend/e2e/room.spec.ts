import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = path.resolve(__dirname, '../../../.agent-swarm/2026-06-22_deploy-e2e/screenshots');

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

test('admin can create a room', async ({ page }) => {
  test.skip(!ADMIN_PASSWORD, 'ADMIN_PASSWORD environment variable is not set');

  // Login
  await page.goto('/login');
  await page.getByRole('tab', { name: /管理员|Admin/i }).click();
  await page.getByRole('textbox', { name: /用户名|Username/i }).fill(ADMIN_USERNAME);
  await page.getByRole('textbox', { name: /密码|Password/i }).fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: /登录|Login/i }).click();
  await page.waitForURL('/rooms', { timeout: 10000 });

  // Capture room codes before creation
  const roomCodesBefore = await page.locator('main code').allTextContents();

  // Open create room panel
  const createButton = page.getByRole('button', { name: /创建房间|\+ 创建|Create Room/i }).first();
  await createButton.click();

  // Click the inner create button inside the panel
  const confirmCreate = page.locator('button', { hasText: /创建|Create/i }).filter({ hasNotText: /创建房间|\+ 创建/ }).first();
  await confirmCreate.click();

  // Wait for the room list to update: a new 4-digit room code appears
  await expect.poll(async () => {
    const codes = await page.locator('main code').allTextContents();
    return codes.filter((c) => /^\d{4}$/.test(c.trim())).length;
  }).toBeGreaterThan(roomCodesBefore.filter((c) => /^\d{4}$/.test(c.trim())).length);

  // Capture the newly created room code
  const roomCodesAfter = await page.locator('main code').allTextContents();
  const newRoomCode = roomCodesAfter.find((code) => !roomCodesBefore.includes(code));
  expect(newRoomCode).toMatch(/^\d{4}$/);

  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'room-created.png'), fullPage: true });
});
