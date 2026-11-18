import { expect, test } from '@playwright/test';

const ADMIN = 'e2e-admin-token-0123456789abcdef';

test('game screen renders the museum and the vote panel without errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/?broadcast=1');
  await expect(page.locator('#lvl-num')).toContainText('LEVEL');
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.locator('#vote')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#opts .opt')).toHaveCount(3);
  await expect(page.locator('#auto')).toContainText('AUTO MODE');
  // full loop: vote closes (fast timings), robot acts, result banner appears
  await expect(page.locator('#result')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('#result .who')).toContainText(/AUTO MODE PICKED|CHAT CHOSE|TIE/);
  expect(errors).toEqual([]);
});

test('reload does not restart the game', async ({ page, request }) => {
  await page.goto('/');
  const a = await (await request.get('/api/state')).json();
  await page.reload();
  await expect(page.locator('#lvl-num')).toContainText('LEVEL');
  const b = await (await request.get('/api/state')).json();
  expect(b.rev).toBeGreaterThanOrEqual(a.rev);
  expect(b.level * 100 + b.beatIndex).toBeGreaterThanOrEqual(a.level * 100 + a.beatIndex);
});

test('websocket reconnect receives full state', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#lvl-num')).toContainText('LEVEL');
  await page.context().setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await page.context().setOffline(false);
  await expect(page.locator('#conn')).toBeHidden({ timeout: 15_000 });
});

test.describe('API protection', () => {
  test('admin API requires the token', async ({ request }) => {
    expect((await request.get('/api/admin/status')).status()).toBe(401);
    expect((await request.get('/api/admin/status', { headers: { authorization: 'Bearer wrong-token-wrong-token-xx' } })).status()).toBe(401);
    expect((await request.post('/api/admin/game/reset', { data: { confirm: 'RESET' } })).status()).toBe(401);
    const ok = await request.get('/api/admin/status', { headers: { authorization: `Bearer ${ADMIN}` } });
    expect(ok.status()).toBe(200);
    const body = await ok.text();
    expect(body).not.toContain(ADMIN);
  });

  test('bad input is rejected', async ({ request }) => {
    const h = { authorization: `Bearer ${ADMIN}`, 'content-type': 'application/json' };
    expect((await request.post('/api/admin/intervention', { headers: h, data: '{bad json' })).status()).toBe(400);
    expect((await request.post('/api/admin/intervention', { headers: h, data: { type: 'NUKE' } })).status()).toBe(400);
    expect((await request.post('/api/admin/game/reset', { headers: h, data: { confirm: 'yes' } })).status()).toBe(400);
    expect((await request.post('/api/admin/broadcast/config', { headers: h, data: { rtmpUrl: 'javascript:alert(1)' } })).status()).toBe(400);
    const big = 'x'.repeat(200 * 1024);
    expect((await request.post('/api/admin/audio', { headers: h, data: JSON.stringify({ master: 0.5, pad: big }) })).status()).toBe(413);
    expect((await request.get('/api/%E0%A4%A')).status()).toBeGreaterThanOrEqual(400);
    expect((await request.get('/../../etc/passwd')).status()).toBe(404);
  });

  test('webhook rejects unsigned and oversized payloads', async ({ request }) => {
    const r = await request.post('/webhooks/kick', { data: { content: '1' } });
    expect(r.status()).toBe(400);
    const r2 = await request.post('/webhooks/kick', {
      headers: { 'kick-event-message-id': 'x', 'kick-event-message-timestamp': new Date().toISOString(), 'kick-event-signature': 'AAAA', 'kick-event-type': 'chat.message.sent', 'content-type': 'application/json' },
      data: 'y'.repeat(300 * 1024),
    });
    expect(r2.status()).toBe(413);
  });

  test('security headers are set', async ({ request }) => {
    const r = await request.get('/');
    expect(r.headers()['content-security-policy']).toContain("default-src 'self'");
    expect(r.headers()['x-frame-options']).toBe('DENY');
  });
});

test('intervention test shows on stream as TEST', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.locator('#lvl-num')).toContainText('LEVEL');
  const r = await request.post('/api/admin/intervention', { headers: { authorization: `Bearer ${ADMIN}` }, data: { type: 'SHIELD' } });
  expect(r.status()).toBe(200);
  await expect(page.locator('.notice.test').first()).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.shield')).toBeVisible();
});
