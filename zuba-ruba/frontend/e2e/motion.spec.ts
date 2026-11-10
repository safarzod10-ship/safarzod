import { expect, test, type Page } from "@playwright/test";
import * as fx from "./fixtures";

test.use({ reducedMotion: "no-preference" });
test.setTimeout(90_000);

async function setup(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    const noop = () => undefined;
    (window as unknown as { Telegram: unknown }).Telegram = {
      WebApp: {
        initData: "query_id=AAH&user=%7B%22id%22%3A1%7D&auth_date=1&hash=x",
        initDataUnsafe: {},
        version: "8.0",
        platform: "ios",
        colorScheme: "light",
        BackButton: { show: noop, hide: noop, onClick: noop, offClick: noop },
        HapticFeedback: { impactOccurred: noop, notificationOccurred: noop, selectionChanged: noop },
        ready: noop,
        expand: noop,
        close: noop,
        isVersionAtLeast: () => true,
        setHeaderColor: noop,
        setBackgroundColor: noop,
        setBottomBarColor: noop,
        disableVerticalSwipes: noop,
        openLink: noop,
        openTelegramLink: noop,
        showConfirm: (_m: string, cb: (ok: boolean) => void) => cb(true),
        onEvent: noop,
        offEvent: noop,
      },
    };
  });
  const adminSpin = { ...fx.spinDone, test_available: true };
  const amounts = ["0.6", "1", "0.5"];
  await page.route("https://telegram.org/**", (route) => route.fulfill({ status: 200, contentType: "text/javascript", body: "" }));
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api/, "");
    const json = (body: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    if (path === "/session" || path === "/me") return json({ ...fx.me, is_admin: true });
    if (path === "/config") return json(fx.config);
    if (path === "/home") return json({ ...fx.home, spin: adminSpin });
    if (path === "/spin") return json({ amount: amounts.shift() ?? "0.7", test: true, balance: fx.home.balance, spin: adminSpin });
    if (path === "/cases/test") return json({ amount: "0.5", test: true });
    if (path === "/cases") return json(fx.cases);
    return json({});
  });
}

const wheelAngle = (page: Page) =>
  page.locator(".wheel-svg > g").evaluate((node) => Number(/rotate\((-?[\d.]+)\)/.exec(node.getAttribute("transform") ?? "")?.[1] ?? "0"));

test("home wheel spins counter-clockwise and lands under the pointer", async ({ page }) => {
  await setup(page);
  await page.goto("/#/");
  await page.locator("#splash").waitFor({ state: "detached", timeout: 8000 });
  const before = await wheelAngle(page);
  await page.getByRole("button", { name: "Тестовая прокрутка" }).click();
  await page.waitForTimeout(400);
  const during = await wheelAngle(page);
  expect(during).toBeLessThan(before - 30);
  await expect(page.locator(".daily-test-result")).toContainText("+0,6", { timeout: 9000 });
  const wheel = await page.locator(".wheel-svg").boundingBox();
  const label = await page.locator(".wheel-seg-won .wheel-label").boundingBox();
  expect(wheel && label && Math.abs(label.x + label.width / 2 - (wheel.x + wheel.width / 2)) < 30 && label.y < wheel.y + wheel.height / 2 - 40).toBeTruthy();
});

test("home test spins work repeatedly with real animation", async ({ page }) => {
  await setup(page);
  await page.goto("/#/");
  for (const expected of ["+0,6", "+1", "+0,5"]) {
    await page.waitForTimeout(400);
    await page.getByRole("button", { name: "Тестовая прокрутка" }).click();
    await expect(page.locator(".daily-test-result")).toContainText(expected, { timeout: 9000 });
    await expect(page.getByRole("button", { name: "Тестовая прокрутка" })).toBeEnabled();
  }
});

test("test cases open repeatedly with real animation", async ({ page }) => {
  await setup(page);
  await page.goto("/#/cases");
  for (let i = 0; i < 3; i += 1) {
    await page.waitForTimeout(400);
    await page.getByRole("button", { name: "Тестовый кейс" }).click();
    await expect(page.locator(".roulette-result-amount")).toContainText("+0,5", { timeout: 9000 });
    await page.getByRole("button", { name: "Готово" }).click();
  }
});

test("splash shows the animated logo, then disappears and gifts preload in the background", async ({ page }) => {
  await setup(page);
  const gifts: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/gifts/")) gifts.push(request.url());
  });
  await page.goto("/#/");
  await expect(page.locator("#splash .splash-logo")).toBeVisible();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: "e2e/screenshots/splash-light-390.png" });
  await expect(page.locator("#splash")).toBeAttached();
  await page.locator("#splash").waitFor({ state: "detached", timeout: 8000 });
  expect(await page.evaluate(() => performance.now())).toBeGreaterThan(2800);
  await expect(page.locator("text=Ежедневная рулетка")).toBeVisible();
  await expect.poll(() => gifts.length, { timeout: 15000 }).toBe(11);
});
