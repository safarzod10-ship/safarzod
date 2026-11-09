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
    if (path === "/admin/overview") return json(fx.adminOverview);
    if (path === "/admin/finance") return json(fx.adminFinance);
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
  { name: "home", hash: "#/", ready: "text=Общий баланс" },
  { name: "tasks", hash: "#/tasks", ready: "text=Новости технологий и науки каждый день" },
  { name: "cases", hash: "#/cases", ready: "text=Готовы к открытию · 2" },
  { name: "profile", hash: "#/profile", ready: "text=Приглашай друзей" },
  { name: "withdraw", hash: "#/withdraw", ready: "text=Доступно к выводу" },
  { name: "admin", hash: "#/admin", ready: "text=Чистая прибыль" },
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
      await page.getByRole("button", { name: "Далее" }).click();
      await expect(page.locator(".onb-title")).toHaveText("Следи за наградами");
      await page.screenshot({ path: `e2e/screenshots/${scheme}-${width}-onboarding-3.png` });
      await page.getByRole("button", { name: "Начать" }).click();
      await expect(page.locator("text=Общий баланс")).toBeVisible();
    });
  }
}

test("task check shows result and case link", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await fakeTelegram(page, "light");
  await mockApi(page);
  await page.goto("/#/tasks");
  const row = page.locator(".task").first();
  await row.getByRole("button", { name: "Проверить" }).click();
  await expect(row.locator(".task-message")).toContainText("Задание выполнено");
  await expect(row.getByRole("button", { name: "Открыть кейс" })).toBeVisible();
  await expect(row.getByRole("button", { name: "Проверить" })).toHaveCount(0);
  await page.getByRole("tab", { name: "Боты" }).click();
  await expect(page.getByRole("tab", { name: "Боты" })).toHaveAttribute("aria-selected", "true");
});

test("case opening reveals amount", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await fakeTelegram(page, "light");
  await mockApi(page);
  await page.goto("/#/cases");
  await page.locator(".case-row").first().getByRole("button", { name: "Открыть" }).click();
  await expect(page.locator(".case-reveal-amount")).toHaveText("+0,3 ⭐");
  await page.screenshot({ path: "e2e/screenshots/light-390-case-open.png" });
  await page.getByRole("button", { name: "Готово" }).click();
  await expect(page.locator(".sheet")).toHaveCount(0);
});

test("withdraw request flow", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await fakeTelegram(page, "dark");
  await mockApi(page);
  let idempotencyKey: string | null = null;
  await page.route("**/api/withdrawals", async (route) => {
    if (route.request().method() === "POST") {
      idempotencyKey = route.request().headers()["idempotency-key"] ?? null;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fx.withdrawals.items[0]) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fx.withdrawals) });
  });
  await page.goto("/#/withdraw");
  await page.getByRole("radio", { name: "15 ⭐" }).click();
  await page.getByRole("button", { name: "Вывести 15 ⭐" }).click();
  await expect(page.locator("text=Заявка №4 создана")).toBeVisible();
  expect(idempotencyKey).toBeTruthy();
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
