import { expect, test, type Page, type Route } from "@playwright/test";
import * as ax from "./admin-fixtures";
import * as fx from "./fixtures";

type Scheme = "light" | "dark";

interface Captured {
  invoice?: string;
  download?: { url: string; file_name: string };
  patch?: unknown;
  usersQuery?: string;
}

async function setup(page: Page, scheme: Scheme, captured: Captured = {}): Promise<void> {
  await page.addInitScript((colorScheme) => {
    const noop = () => undefined;
    const store = window as unknown as { __captured: Record<string, unknown> };
    store.__captured = {};
    (window as unknown as { Telegram: unknown }).Telegram = {
      WebApp: {
        initData: "query_id=test&user=%7B%22id%22%3A512345678%7D&auth_date=1700000000&hash=test",
        initDataUnsafe: { user: { id: 512345678 } },
        version: "8.0",
        platform: "tdesktop",
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
        openInvoice: (url: string, cb: (status: string) => void) => {
          store.__captured.invoice = url;
          cb("paid");
        },
        downloadFile: (params: unknown) => {
          store.__captured.download = params;
        },
        showConfirm: (_message: string, cb: (ok: boolean) => void) => cb(true),
        showAlert: (_message: string, cb?: () => void) => cb?.(),
        onEvent: noop,
        offEvent: noop,
      },
    };
  }, scheme);
  await page.route("https://telegram.org/**", (route) => route.fulfill({ status: 200, contentType: "text/javascript", body: "" }));
  await page.route("**/api/**", async (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api/, "");
    const method = route.request().method();
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (path === "/session" || path === "/me") return json({ ...fx.me, is_admin: true, onboarded: true });
    if (path === "/config") return json(fx.config);
    if (path === "/admin/overview") return json(ax.overview);
    if (path === "/admin/analytics") return json(ax.analytics(Number(url.searchParams.get("days") ?? 30)));
    if (path === "/admin/users") {
      captured.usersQuery = url.search;
      return json(ax.users);
    }
    if (/^\/admin\/users\/\d+$/.test(path)) return json(ax.userCard);
    if (path === "/admin/withdrawals") return json(ax.withdrawalQueue);
    if (path === "/admin/stars") return json(ax.stars);
    if (path === "/admin/stars/topup") return json({ id: "t3", url: "https://t.me/$invoice-test", amount: 500 });
    if (path === "/admin/export/users/link") return json({ url: "https://zuba.example.com/api/admin/export/users.csv?token=x", file_name: "zuba-users.csv", expires_in: 300 });
    if (path === "/admin/tasks") return json(ax.tasks);
    if (path === "/admin/finance") return json(ax.finance);
    if (path === "/admin/settings" && method === "PATCH") {
      captured.patch = route.request().postDataJSON();
      return json(ax.settings);
    }
    if (path === "/admin/settings") return json(ax.settings);
    if (path === "/admin/audience") return json(ax.audience);
    if (path === "/admin/broadcasts") return json(ax.broadcasts);
    if (path === "/admin/audit") return json(ax.audit);
    return json({ error: { code: "not_found", message: "Не найдено." } }, 404);
  });
}

async function assertNoOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

const SECTIONS = [
  { name: "overview", hash: "#/admin", ready: "text=Воронка новых пользователей" },
  { name: "users", hash: "#/admin/users", ready: "text=Найдено: 1 284" },
  { name: "user", hash: "#/admin/users/802", ready: "text=Корректировка баланса" },
  { name: "withdrawals", hash: "#/admin/withdrawals", ready: "text=Пополнить баланс" },
  { name: "tasks", hash: "#/admin/tasks", ready: "text=По типам заданий" },
  { name: "finance", hash: "#/admin/finance", ready: "text=Расходы и резервы" },
  { name: "settings", hash: "#/admin/settings", ready: "text=Средний приз кейса" },
  { name: "broadcast", hash: "#/admin/broadcast", ready: "text=Как увидит пользователь" },
  { name: "audit", hash: "#/admin/audit", ready: "text=Действия администраторов" },
];

for (const scheme of ["light", "dark"] as Scheme[]) {
  for (const width of [360, 430, 1024, 1440]) {
    test(`admin ${width}px ${scheme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: width >= 1024 ? 900 : 800 });
      await setup(page, scheme);
      for (const section of SECTIONS) {
        await page.goto(`/${section.hash}`);
        await page.locator(section.ready).first().waitFor();
        await assertNoOverflow(page);
        await page.screenshot({ path: `e2e/screenshots/admin-${scheme}-${width}-${section.name}.png`, fullPage: true });
      }
    });
  }
}

test("admin works at 320px without page overflow", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await setup(page, "light");
  for (const section of SECTIONS) {
    await page.goto(`/${section.hash}`);
    await page.locator(section.ready).first().waitFor();
    await assertNoOverflow(page);
  }
});

test("sidebar on desktop, tabs on phone", async ({ page }) => {
  await setup(page, "light");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/#/admin");
  await expect(page.locator(".adm-side")).toBeVisible();
  await expect(page.locator(".adm-tabs")).toBeHidden();
  await page.locator(".adm-side-link", { hasText: "Выводы" }).click();
  await expect(page.locator(".adm-title")).toHaveText("Выводы");
  await expect(page.locator(".adm-side-link", { hasText: "Выводы" }).locator(".adm-count")).toHaveText("4");
  await page.setViewportSize({ width: 390, height: 800 });
  await expect(page.locator(".adm-side")).toBeHidden();
  await expect(page.locator(".adm-tabs")).toBeVisible();
});

test("users table sorts on the server and exports csv", async ({ page }) => {
  const captured: Captured = {};
  await setup(page, "light", captured);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/#/admin/users");
  await page.locator("text=Найдено: 1 284").waitFor();
  await page.getByRole("button", { name: /Доступно/ }).click();
  await expect.poll(() => captured.usersQuery ?? "").toContain("sort=available");
  await page.getByRole("button", { name: "Выгрузить CSV" }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __captured: { download?: { file_name: string } } }).__captured.download?.file_name)).toBe("zuba-users.csv");
});

test("star top-up opens a Telegram invoice", async ({ page }) => {
  await setup(page, "dark");
  await page.setViewportSize({ width: 430, height: 900 });
  await page.goto("/#/admin/withdrawals");
  await expect(page.locator("text=не хватает 60 ⭐")).toBeVisible();
  await page.getByRole("button", { name: "1 000", exact: true }).click();
  await page.getByRole("button", { name: /Пополнить на/ }).click();
  await expect(page.locator("text=Оплачено 1 000 ⭐")).toBeVisible();
  const invoice = await page.evaluate(() => (window as unknown as { __captured: { invoice?: string } }).__captured.invoice);
  expect(invoice).toBe("https://t.me/$invoice-test");
});

test("settings save only changed values", async ({ page }) => {
  const captured: Captured = {};
  await setup(page, "light", captured);
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto("/#/admin/settings");
  await page.locator("text=Средний приз кейса").waitFor();
  await page.getByRole("button", { name: "Вернуть стандартное: 0.2" }).click();
  await page.getByRole("switch", { name: "Режим технического обслуживания" }).click();
  await expect(page.locator(".adm-savebar")).toContainText("Изменено настроек: 2");
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect.poll(() => captured.patch).toEqual({ values: { reward_boost: "0.2", maintenance: "true" } });
});
