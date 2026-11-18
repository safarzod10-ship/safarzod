import { expect, test } from '@playwright/test';

const ADMIN = 'e2e-admin-token-0123456789abcdef';

test('host panel: login, status, test button, confirmations', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/panel/');
  await expect(page.locator('#login')).toBeVisible();
  await page.fill('#token', 'definitely-wrong-token-123456');
  await page.click('#login-btn');
  await expect(page.locator('#login-err')).toContainText('Wrong');
  await page.fill('#token', ADMIN);
  await page.click('#login-btn');
  await expect(page.locator('#app')).toBeVisible();
  await expect(page.locator('#game-kv')).toContainText('Level');
  await expect(page.locator('#stream-kv')).toContainText('tools not installed');
  await page.click('button[data-iv="SCAN"]');
  await expect(page.locator('#toast')).toContainText('SCAN');
  // reset requires typing RESET
  page.once('dialog', (d) => d.accept('nope'));
  await page.click('button[data-act="reset"]');
  await expect(page.locator('#game-kv')).toBeVisible();
  // no horizontal scroll on a phone
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  // big touch targets
  const h = await page.locator('button[data-act="stream-start"]').evaluate((b) => b.getBoundingClientRect().height);
  expect(h).toBeGreaterThanOrEqual(48);
  expect(errors).toEqual([]);
});

test('panel token from link hash is stored and removed from the URL', async ({ page }) => {
  await page.goto(`/panel/#t=${ADMIN}`);
  await expect(page.locator('#app')).toBeVisible();
  expect(page.url()).not.toContain(ADMIN);
});
