import { expect, test, type Page, type Route } from "@playwright/test";
import * as fx from "./fixtures";

type Scheme = "light" | "dark";

interface MockOptions {
  onboarded?: boolean;
}

async function mockApi(page: Page, options: MockOptions = {}): Promise<void> {
  await page.route("https://telegram.org/**", (route) => route.fulfill({ status: 200, contentType: "text/javascript", body: "" }));
  await page.route("**/api/**", async (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api/, "");
    const method = route.request().method();
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (path === "/session" || path === "/me") return json({ ...fx.me, onboarded: options.onboarded ?? true });
    if (path === "/me/onboarding") return json({ ...fx.me, onboarded: true });
    if (path === "/config") return json(fx.config);
    if (path === "/home") return json(fx.home);
    if (path === "/operations") return json(fx.operationsPage);
    if (path === "/notifications") return json(fx.notifications);
    if (path === "/notifications/read") return json({ ok: true });
    if (path === "/tasks") return json(fx.tasks);
    if (path.endsWith("/check") && method === "POST") return json(fx.checkResult);
    if (path === "/cases") return json(fx.cases);
    if (path.startsWith("/cases/") && path.endsWith("/open")) return json(fx.openedCase);
    if (path === "/referrals") return json(fx.referrals);
    if (path === "/withdrawals") return json(fx.withdrawals);
    return json({ error: { code: "not_found", message: "Не найдено." } }, 404);
  });
}

async function fakeTelegram(page: Page, scheme: Scheme): Promise<void> {
  await page.addInitScript((colorScheme) => {
    const noop = () => undefined;
    (window as unknown as { Telegram: unknown }).Telegram = {
      WebApp: {
        initData: "query_id=test&user=%7B%22id%22%3A512345678%7D&auth_date=1700000000&hash=test",
        initDataUnsafe: { user: { id: 512345678 } },
        version: "8.0",
        platform: "ios",
        colorScheme,
        safeAreaInset: { top: 0, bottom: 0, left: 0, right: 0 },
        contentSafeAreaInset: { top: 0, bottom: 0, left: 0, right: 0 },
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
        showConfirm: (_message: string, cb: (ok: boolean) => void) => cb(true),
        showAlert: (_message: string, cb?: () => void) => cb?.(),
        onEvent: noop,
        offEvent: noop,
      },
    };
  }, scheme);
}

async function assertNoOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

const SCREENS = [
  { name: "home", hash: "#/", ready: "text=Задания сегодня: 3 из 5" },
  { name: "tasks", hash: "#/tasks", ready: "text=Новости технологий и науки каждый день" },
  { name: "cases", hash: "#/cases", ready: "text=Что может выпасть" },
  { name: "profile", hash: "#/profile", ready: "text=Приглашай друзей" },
  { name: "withdraw", hash: "#/withdraw", ready: "text=Доступно к выводу" },
  { name: "rules", hash: "#/rules", ready: "text=Шансы кейса" },
  { name: "history", hash: "#/history", ready: "text=Награда за кейс" },
];

const WIDTHS = [320, 360, 390, 430];
const SCHEMES: Scheme[] = ["light", "dark"];

for (const scheme of SCHEMES) {
  for (const width of WIDTHS) {
    test(`screens ${width}px ${scheme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 780 });
      await fakeTelegram(page, scheme);
      await mockApi(page);
      for (const screen of SCREENS) {
        await page.goto(`/${screen.hash}`);
        await page.locator(screen.ready).first().waitFor();
        await expect(page.locator("html")).toHaveAttribute("data-theme", scheme);
        await assertNoOverflow(page);
        await page.screenshot({ path: `e2e/screenshots/${scheme}-${width}-${screen.name}.png`, fullPage: true });
      }
    });

    test(`onboarding ${width}px ${scheme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 700 });
      await fakeTelegram(page, scheme);
      await mockApi(page, { onboarded: false });
      await page.goto("/");
      await expect(page.locator(".onb-title")).toContainText("Задания.");
      await assertNoOverflow(page);
      await page.screenshot({ path: `e2e/screenshots/${scheme}-${width}-onboarding-1.png` });
      await page.getByRole("button", { name: "Далее" }).click();
      await expect(page.locator(".onb-title")).toHaveText("Выполняй задания");
      await page.screenshot({ path: `e2e/screenshots/${scheme}-${width}-onboarding-2.png` });
      await page.getByRole("button", { name: "Далее" }).click();
      await expect(page.locator(".onb-title")).toHaveText("Забирай подарки");
      await page.screenshot({ path: `e2e/screenshots/${scheme}-${width}-onboarding-3.png` });
      await page.getByRole("button", { name: "Начать" }).click();
      await expect(page.locator("text=Ежедневная рулетка")).toBeVisible();
    });
  }
}

test("task check shows result and case link", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await fakeTelegram(page, "light");
  await mockApi(page);
  await page.goto("/#/tasks");
  const row = page.locator(".task-card").first();
  await row.getByRole("button", { name: "Проверить" }).click();
  await expect(row.locator(".task-note")).toContainText("Задание выполнено");
  await expect(row.getByRole("button", { name: "Открыть кейс" })).toBeVisible();
  await expect(row.getByRole("button", { name: "Проверить" })).toHaveCount(0);
  await page.getByRole("tab", { name: "Боты" }).click();
  await expect(page.getByRole("tab", { name: "Боты" })).toHaveAttribute("aria-selected", "true");
});

test("case roulette spins to the server result", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await fakeTelegram(page, "light");
  await mockApi(page);
  await page.goto("/#/cases");
  await page.getByRole("button", { name: "Открыть кейс" }).click();
  await expect(page.locator(".roulette-result-amount")).toContainText("+0,3");
  await expect(page.locator(".prize-won .prize-amount")).toHaveText("0,3");
  const pointer = await page.locator(".roulette-line").boundingBox();
  const won = await page.locator(".prize-won").boundingBox();
  expect(pointer && won && pointer.x >= won.x && pointer.x <= won.x + won.width).toBeTruthy();
  await page.screenshot({ path: "e2e/screenshots/light-390-case-open.png" });
  await page.getByRole("button", { name: "Следующий кейс" }).click();
  await expect(page.locator(".roulette-result")).toHaveCount(0);
});

test("withdraw request flow", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await fakeTelegram(page, "dark");
  await mockApi(page);
  let idempotencyKey: string | null = null;
  let body: unknown = null;
  await page.route("**/api/withdrawals", async (route) => {
    if (route.request().method() === "POST") {
      idempotencyKey = route.request().headers()["idempotency-key"] ?? null;
      body = route.request().postDataJSON();
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fx.withdrawals.items[0]) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fx.withdrawals) });
  });
  await page.goto("/#/withdraw");
  await page.getByRole("button", { name: /Мишка/ }).click();
  await page.getByRole("button", { name: "Вывести «Мишка» · 15 ⭐" }).click();
  await expect(page.locator("text=Заявка №4 принята")).toBeVisible();
  expect(idempotencyKey).toBeTruthy();
  expect(body).toEqual({ gift_id: "5170233102089322756" });
  await page.screenshot({ path: "e2e/screenshots/dark-360-withdraw-done.png", fullPage: true });
});

test("outside telegram shows the bot link", async ({ page }) => {
  await page.route("https://telegram.org/**", (route) => route.fulfill({ status: 200, contentType: "text/javascript", body: "" }));
  await page.setViewportSize({ width: 360, height: 700 });
  await page.goto("/");
  await expect(page.locator("text=Откройте приложение через Telegram")).toBeVisible();
  await expect(page.getByRole("link", { name: "Перейти к @zuba_ruba_bot" })).toHaveAttribute("href", "https://t.me/zuba_ruba_bot");
});

test("maintenance error switches to the maintenance screen", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 700 });
  await fakeTelegram(page, "light");
  await page.route("https://telegram.org/**", (route) => route.fulfill({ status: 200, contentType: "text/javascript", body: "" }));
  await page.route("**/api/**", (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "maintenance", message: "Идут технические работы." } }) }),
  );
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Технические работы" })).toBeVisible();
  await expect(page.locator("text=Идут технические работы.")).toBeVisible();
});

test("tab bar is visible when Telegram opens the app with launch parameters in the hash", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await fakeTelegram(page, "light");
  await mockApi(page);
  await page.goto("/#tgWebAppData=query_id%3DAAH&tgWebAppVersion=8.0&tgWebAppPlatform=ios");
  await page.locator("text=Ежедневная рулетка").waitFor();
  await expect(page.locator(".tabbar")).toBeVisible();
  const box = await page.locator(".tabbar-inner").boundingBox();
  expect(box && box.y + box.height <= 780).toBeTruthy();
  expect(new URL(page.url()).hash).toBe("#/");
  await page.locator(".tabbar").getByRole("button", { name: "Задания" }).click();
  await expect(page.locator(".tab-active")).toContainText("Задания");
});

test("daily roulette spins once tasks are done and shows the countdown", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await fakeTelegram(page, "light");
  await mockApi(page);
  await page.route("**/api/home", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...fx.home, spin: fx.spinReady }) }));
  let spins = 0;
  await page.route("**/api/spin", (route) => {
    spins += 1;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fx.spinResult) });
  });
  await page.goto("/#/");
  await page.getByRole("button", { name: "Крутить" }).click();
  await expect(page.locator(".daily-won")).toContainText("+0,8");
  await expect(page.locator(".wheel")).toHaveAttribute("data-result", "0.8");
  await expect(page.locator(".wheel-seg-won .wheel-label")).toHaveText("0,8");
  const wheel = await page.locator(".wheel-svg").boundingBox();
  const label = await page.locator(".wheel-seg-won .wheel-label").boundingBox();
  const center = wheel ? { x: wheel.x + wheel.width / 2, y: wheel.y + wheel.height / 2 } : null;
  expect(center && label && Math.abs(label.x + label.width / 2 - center.x) < 30 && label.y + label.height / 2 < center.y - 40).toBeTruthy();
  await expect(page.locator(".balance-pill")).toContainText("19,1");
  await expect(page.locator("text=Следующая прокрутка через")).toBeVisible();
  expect(spins).toBe(1);
  await page.screenshot({ path: "e2e/screenshots/light-390-home-spin.png" });
});
