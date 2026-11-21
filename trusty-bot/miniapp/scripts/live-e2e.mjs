import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [, , outDir = 'live-shots', apiOrigin = 'http://127.0.0.1:8811', token = '123456:TEST', MOCK = 'http://127.0.0.1:18766'] = process.argv;
const api = new URL(apiOrigin);
const dist = path.resolve('dist');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) {
    const p = http.request({ host: api.hostname, port: api.port, path: req.url, method: req.method, headers: req.headers }, (r) => {
      res.writeHead(r.statusCode, r.headers); r.pipe(res);
    });
    req.pipe(p);
    return;
  }
  const f = path.join(dist, req.url.split('?')[0] === '/' ? 'index.html' : req.url.split('?')[0]);
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }); res.end(d); });
}).listen(0);
const origin = `http://localhost:${server.address().port}/`;

function initData(user) {
  const fields = { auth_date: String(Math.floor(Date.now() / 1000)), query_id: 'AAE' + user.id, user: JSON.stringify(user) };
  const check = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = crypto.createHmac('sha256', secret).update(check).digest('hex');
  return new URLSearchParams({ ...fields, hash }).toString();
}

const stub = (init, user) => `
(() => {
  const handlers = { main: [], back: [], sec: [] };
  let mainParams = {};
  const draw = () => {
    let el = document.getElementById('__mb');
    if (!el) { el = document.createElement('div'); el.id = '__mb'; document.addEventListener('DOMContentLoaded', () => document.body.appendChild(el)); if (document.body) document.body.appendChild(el); }
    el.style.cssText = 'position:fixed;left:12px;right:12px;bottom:10px;height:50px;border-radius:12px;display:flex;align-items:center;justify-content:center;font:600 15px Onest,sans-serif;color:#fff;z-index:9999;pointer-events:none';
    el.style.background = mainParams.color || '#178A66';
    el.style.opacity = mainParams.is_active === false ? .5 : 1;
    el.style.display = mainParams.is_visible ? 'flex' : 'none';
    el.textContent = mainParams.text || '';
  };
  const btn = (k) => ({ setParams(p) { if (k === 'main') { mainParams = { ...mainParams, ...p }; draw(); } }, onClick(f) { handlers[k].push(f); },
    offClick(f) { handlers[k] = handlers[k].filter((x) => x !== f); }, show() { if (k === 'main') { mainParams.is_visible = true; draw(); } },
    hide() { if (k === 'main') { mainParams.is_visible = false; draw(); } } });
  window.Telegram = { WebApp: {
    initData: ${JSON.stringify(init)}, initDataUnsafe: { user: ${JSON.stringify(user)} }, colorScheme: 'light', version: '7.0',
    ready() {}, expand() {}, isVersionAtLeast() { return false; }, setHeaderColor() {}, setBackgroundColor() {},
    onEvent(e, f) { (handlers[e] = handlers[e] || []).push(f); }, offEvent() {},
    openTelegramLink(u) { window.__opened = u; }, openLink(u) { window.__opened = u; },
    BackButton: { show() {}, hide() {}, onClick(f) { handlers.back.push(f); }, offClick(f) { handlers.back = handlers.back.filter((x) => x !== f); } },
    MainButton: btn('main'), HapticFeedback: { impactOccurred() {}, notificationOccurred() {}, selectionChanged() {} },
  } };
  window.__tgMain = () => handlers.main.forEach((f) => f());
  window.__tgBack = () => handlers.back.forEach((f) => f());
})();`;

const USERS = {
  anna: { id: 2001, first_name: 'Анна', last_name: 'Соколова', username: 'anna_test' },
  boris: { id: 2002, first_name: 'Борис', last_name: 'Ким', username: 'boris_dev' },
  admin: { id: 2003, first_name: 'Админ', username: 'trusty_admin' },
};

const b = await chromium.launch();
const errors = [];
const pages = {};
for (const [k, u] of Object.entries(USERS)) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  await ctx.route('https://telegram.org/**', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
  await ctx.addInitScript(stub(initData(u), u));
  if (k !== 'anna') await ctx.addInitScript(() => { try { localStorage.setItem('trusty.tips.client', '1'); localStorage.setItem('trusty.tips.dev', '1'); } catch {} });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(`${k}: ${e.message}`));
  p.on('console', (m) => m.type() === 'error' && !m.text().includes('Failed to load resource') && errors.push(`${k}: ${m.text()}`));
  pages[k] = p;
}
fs.mkdirSync(outDir, { recursive: true });
let n = 0;
const shot = async (p, name, full = false) => { await p.waitForTimeout(600); await p.screenshot({ path: path.join(outDir, `${String(++n).padStart(2, '0')}-${name}.png`), fullPage: full }); };
const tab = async (p, label) => { await p.waitForSelector('#tl-splash', { state: 'detached' }); await p.locator(`.island .tab[aria-label="${label}"]`).click({ force: true }); };
const projects = (p) => tab(p, 'Проекты');
const PNG = fs.readFileSync(new URL('./sample-shot.png', import.meta.url));
const pickInto = async (p, click, files) => { const fc = p.waitForEvent('filechooser'); await click(); await (await fc).setFiles(files); };
const imgLoaded = (loc) => loc.evaluate((img) => new Promise((ok) => { if (img.complete) ok(img.naturalWidth > 0); else { img.onload = () => ok(true); img.onerror = () => ok(false); } }));
const main = (p) => p.locator('.bar .bar-row .btn').last().click();
const step = (label) => console.log('•', label);

const { anna, boris, admin } = pages;
try {
const onboard = async (p, role, name) => {
  await p.goto(origin);
  await p.waitForSelector('.ob', { timeout: 15000 });
  if (name) await shot(p, name);
  await p.getByRole('radio', { name: new RegExp(role) }).click();
  if (name) await shot(p, name + '-role');
  await main(p);
};
await onboard(anna, 'Заказчик', 'anna-onboarding');
await anna.waitForSelector('.island');
await anna.waitForSelector('.coach', { timeout: 5000 });
await shot(anna, 'anna-tips');
for (let i = 0; i < 4; i++) await anna.locator('.coach-card').getByRole('button', { name: 'Далее' }).click();
await anna.locator('.coach-card').getByRole('button', { name: 'Понятно' }).click();
await anna.waitForSelector('.coach', { state: 'detached' });
await shot(anna, 'anna-home-empty');
await onboard(admin, 'Заказчик');
await admin.waitForSelector('.island');
await onboard(boris, 'Исполнитель');
await boris.getByText('Шаг 1 из 4').waitFor();
step('users onboarded');
if (process.env.MAKE_ADMIN) execSync(process.env.MAKE_ADMIN, { stdio: 'inherit' });

await boris.getByRole('button', { name: 'Боты' }).click();
await main(boris);
await boris.getByText('Шаг 2 из 4').waitFor();
for (const t of ['Python', 'aiogram', 'PostgreSQL']) await boris.getByRole('button', { name: t, exact: true }).click();
await main(boris);
await boris.getByText('Шаг 3 из 4').waitFor();
await main(boris);
await boris.getByText('Шаг 4 из 4').waitFor();
await boris.locator('textarea').first().fill('Пишу Telegram-ботов на aiogram 3 с 2022 года: записи, оплаты, CRM-интеграции. Сдаю с инструкцией и деплоем.');
await boris.locator('input.input').first().fill('boris-kim');
await shot(boris, 'boris-form-step4', true);
await main(boris);
await boris.getByText('Анкета на проверке').waitFor();
await shot(boris, 'boris-form-sent');
step('questionnaire sent');

await admin.reload(); await admin.waitForSelector('.island');
await tab(admin, 'Профиль');
await admin.getByText('Админ-панель').click();
await admin.getByRole('tab', { name: /Анкеты/ }).click();
await shot(admin, 'admin-profiles');
await admin.getByText('Борис Ким').click();
await shot(admin, 'admin-profile-review', true);
await main(admin);
await admin.getByText('Новых анкет нет').waitFor();
step('profile published');

await boris.reload(); await boris.waitForSelector('.island');
await tab(boris, 'Профиль');
await boris.getByText('Портфолио', { exact: true }).click();
await boris.getByRole('button', { name: /Добавить работу/ }).click();
await pickInto(boris, () => boris.getByLabel('Выбрать картинку').click(), { name: 'shot.png', mimeType: 'image/png', buffer: PNG });
await boris.locator('.pic-drop img').waitFor();
await boris.getByPlaceholder('Бот записи для барбершопа').fill('Бот записи в салон');
await boris.locator('.sheet textarea').fill('Запись, оплата и напоминания. 900 записей в месяц.');
await boris.getByPlaceholder('https://t.me/your_bot').fill('https://t.me/salon_demo_bot');
await shot(boris, 'boris-portfolio-add');
await boris.locator('.sheet').getByRole('button', { name: 'Добавить' }).click();
await boris.getByText('Портфолио сохранено').waitFor();
await boris.reload(); await boris.waitForSelector('.island');
await tab(boris, 'Профиль');
await boris.getByText('Мой профиль в каталоге').click();
await boris.locator('.work', { hasText: 'Бот записи в салон' }).waitFor();
if (!await imgLoaded(boris.locator('.work img').first())) throw new Error('portfolio picture does not load');
await boris.locator('.work').scrollIntoViewIfNeeded();
await shot(boris, 'boris-profile-portfolio');
await boris.getByLabel('Ещё').click();
await boris.locator('.sheet').getByText('Поделиться профилем').click();
if (!await imgLoaded(boris.locator('.share-pic img'))) throw new Error('share card does not load');
await shot(boris, 'boris-share-card');
const shareText = await boris.locator('.sheet').innerText();
if (shareText.includes('localhost') || shareText.includes('/api/')) throw new Error('share sheet shows the server address: ' + shareText);
await boris.evaluate(() => { window.__opened = null; });
await boris.locator('.sheet').getByRole('button', { name: 'Переслать' }).click();
await boris.waitForFunction(() => !!window.__opened);
const shared = await boris.evaluate(() => window.__opened);
if (!/^https:\/\/t\.me\/share\/url\?url=https%3A%2F%2Ft\.me%2Fitrustybot%3Fstart(app)?%3Ddev_2002/.test(shared)) throw new Error('unexpected share link ' + shared);
step('portfolio with a picture, share card');

await anna.reload(); await anna.waitForSelector('.island');
if (await anna.locator('.ob').count()) throw new Error('intro shown again after reload');
await anna.waitForTimeout(900);
if (await anna.locator('.coach').count()) throw new Error('tips shown again after reload');
await anna.getByLabel('Создать').click();
await anna.getByText('Опубликовать проект').click();
await anna.getByPlaceholder('Например, бот для записи в салон').fill('Бот для записи в студию маникюра');
await anna.getByPlaceholder('Бот должен…').fill('Запись к мастеру, выбор услуги и времени, напоминание за 2 часа, отмена записи, админка расписания.');
await anna.getByPlaceholder('от', { exact: true }).fill('60');
await anna.getByPlaceholder('до', { exact: true }).fill('120');
await main(anna);
await anna.getByText('Проект опубликован').waitFor();
await shot(anna, 'anna-project-published');
step('project published');

await anna.reload(); await anna.waitForSelector('.island');
await tab(anna, 'Профиль');
await anna.getByText('Мои проекты').click();
await anna.getByText('Бот для записи в студию маникюра').click();
await anna.getByText('Подходящие исполнители').scrollIntoViewIfNeeded();
const match = anna.locator('.cell', { hasText: 'Борис Ким' }).last();
await match.waitFor();
await match.getByRole('button', { name: 'Пригласить' }).click();
await match.getByText('Приглашён').waitFor();
await shot(anna, 'anna-matches-invited', true);
await boris.reload(); await boris.waitForSelector('.island');
await projects(boris);
await boris.locator('.cell', { hasText: 'Бот для записи в студию маникюра' }).getByText('Вас пригласили').waitFor();
step('matches + invite');

await boris.reload(); await boris.waitForSelector('.island');
await projects(boris);
await boris.getByText('Бот для записи в студию маникюра').click();
await shot(boris, 'boris-project-view', true);
await main(boris);
await boris.locator('input.input').first().fill('90');
await boris.locator('textarea').fill('Сделаю на aiogram 3 за 5 дней, админка в виде Mini App. Покажу демо на второй день.');
await main(boris);
await boris.getByText('Отклик отправлен').first().waitFor();
await shot(boris, 'boris-bid-sent');
step('bid sent');

await anna.reload(); await anna.waitForSelector('.island');
await tab(anna, 'Профиль');
await anna.getByText('Мои проекты').click();
await anna.getByText('Бот для записи в студию маникюра').click();
await shot(anna, 'anna-bids', true);
await anna.getByRole('button', { name: 'Выбрать' }).click();
await shot(anna, 'anna-choose');
await main(anna);
await anna.getByText('Сделка #1').first().waitFor();
await shot(anna, 'anna-deal-awaiting', true);
step('deal created');

await main(anna);
await anna.waitForFunction(() => !!window.__opened);
const opened = await anna.evaluate(() => window.__opened);
if (!opened.startsWith('https://t.me/CryptoBot?start=IV')) throw new Error('unexpected invoice link ' + opened);
await fetch(MOCK + '/_mock/pay_last', { method: 'POST' });
await anna.getByText('В работе').first().waitFor({ timeout: 20000 });
await shot(anna, 'anna-deal-paid', true);
step('deal paid');

await boris.reload(); await boris.waitForSelector('.island');
await tab(boris, 'Чаты');
await boris.locator('.swipe-body', { hasText: 'Анна Соколова' }).click();
await boris.locator('.deal-card').click();
await shot(boris, 'boris-deal-in-work', true);
await main(boris);
await boris.locator('.sheet textarea').fill('Бот готов: репозиторий и инструкция в чате.');
await pickInto(boris, () => boris.locator('.sheet').getByRole('button', { name: /Приложить файлы/ }).click(),
  [{ name: 'admin.png', mimeType: 'image/png', buffer: PNG }, { name: 'README.txt', mimeType: 'text/plain', buffer: Buffer.from('Запуск: docker compose up -d\n') }]);
await shot(boris, 'boris-submit-files');
await boris.locator('.sheet .btn.primary').click();
await boris.getByText('На приёмке').first().waitFor();
await shot(boris, 'boris-deal-submitted');
step('work submitted with files');
await anna.reload(); await anna.waitForSelector('.island');
await tab(anna, 'Чаты');
await anna.locator('.swipe-body', { hasText: 'Борис Ким' }).click();
await anna.locator('.att-file', { hasText: 'README.txt' }).waitFor();
if (!await imgLoaded(anna.locator('.att-grid img').first())) throw new Error('chat picture does not load');
await shot(anna, 'anna-chat-files');
await anna.locator('.att-grid button').first().click();
await anna.locator('.lightbox').waitFor();
await anna.getByRole('button', { name: 'Закрыть' }).click();
step('files in chat');

await anna.reload(); await anna.waitForSelector('.island');
await tab(anna, 'Профиль');
await anna.getByText('Мои сделки').click();
await shot(anna, 'anna-deals-list');
await anna.locator('.cell', { hasText: 'Бот для записи в студию маникюра' }).click();
await main(anna);
await anna.locator('.sheet .btn.primary').click();
await anna.getByText('Завершена').first().waitFor();
const state = await (await fetch(MOCK + '/_mock/state')).json();
const payout = state.transfers['trusty-1-payout-2002'];
if (!payout || payout.amount !== '90.00') throw new Error('payout missing: ' + JSON.stringify(state.transfers));
await anna.locator('.sheet', { hasText: 'Оценить исполнителя' }).waitFor({ timeout: 8000 });
await anna.locator('.stars button').nth(4).click();
await anna.locator('.sheet textarea').fill('Всё сделано в срок');
await anna.locator('.sheet .btn.primary').click();
await anna.getByText('Заказчик об исполнителе').waitFor();
await shot(anna, 'anna-deal-done', true);
step('accepted, paid out, client rated the executor');
await boris.reload(); await boris.waitForSelector('.island');
await tab(boris, 'Чаты');
await boris.locator('.swipe-body', { hasText: 'Анна Соколова' }).click();
await boris.locator('.deal-card').click();
await main(boris);
await boris.locator('.sheet', { hasText: 'Оценить заказчика' }).waitFor();
await boris.locator('.stars button').nth(3).click();
await boris.locator('.sheet .btn.primary').click();
await boris.getByText('Исполнитель о заказчике').waitFor();
step('executor rated the client');

await boris.reload(); await boris.waitForSelector('.island');
await tab(boris, 'Профиль');
await boris.getByText('IT Trusty Pro').click();
await shot(boris, 'boris-pro', true);
await boris.getByRole('button', { name: /(Или|Оплатить) [\d,]+ USDT/ }).click();
await boris.waitForFunction(() => !!window.__opened);
const proLink = await boris.evaluate(() => window.__opened);
if (!proLink.startsWith('https://t.me/CryptoBot?start=IV')) throw new Error('unexpected Pro invoice ' + proLink);
await fetch(MOCK + '/_mock/pay_last', { method: 'POST' });
await boris.locator('.success').waitFor({ timeout: 20000 });
await shot(boris, 'boris-pro-paid');
await boris.getByText(/Активен до/).waitFor({ timeout: 8000 });
await shot(boris, 'boris-profile-pro');
step('Pro paid in USDT');

await tab(boris, 'Чаты');
await boris.locator('.swipe-body', { hasText: 'Анна Соколова' }).click();
await boris.locator('.chat-peer', { hasText: /заказчик · ★/ }).waitFor();
await boris.evaluate(() => window.__tgBack()); await boris.waitForTimeout(300);

await main(anna);
await anna.waitForSelector('.chat');
await anna.getByLabel('Сообщение').fill('Спасибо! Есть ещё задача, обсудим?');
await anna.getByLabel('Отправить').click();
await shot(anna, 'anna-deal-chat');

await anna.getByLabel('Предложить цену').click();
await anna.locator('.sheet', { hasText: 'Сначала проект' }).waitFor();
await shot(anna, 'anna-offer-needs-project');
await anna.locator('.sheet').getByRole('button', { name: 'Опубликовать проект' }).click();
await anna.getByPlaceholder('Например, бот для записи в салон').fill('Доработка админки для студии');
await anna.getByPlaceholder('Бот должен…').fill('Добавить в админку отчёты по мастерам, выгрузку в Excel и роли сотрудников.');
await anna.getByPlaceholder('от', { exact: true }).fill('40');
await anna.getByPlaceholder('до', { exact: true }).fill('60');
await main(anna);
await anna.getByText('Проект опубликован').waitFor();
await main(anna);
await anna.getByRole('radio', { name: /Доработка админки для студии/ }).waitFor();
if (await anna.getByRole('radio', { name: /Доработка админки для студии/ }).getAttribute('aria-checked') !== 'true') throw new Error('the new project is not preselected');
await anna.getByLabel('Изменить сумму').click();
await anna.getByLabel('Сумма', { exact: true }).fill('40');
await anna.waitForTimeout(4000);
if (await anna.getByLabel('Сумма', { exact: true }).inputValue() !== '40') throw new Error('offer amount was reset');
if (await anna.getByRole('radio', { name: /Доработка админки для студии/ }).getAttribute('aria-checked') !== 'true') throw new Error('offer project was reset');
await shot(anna, 'anna-offer-sheet');
await anna.getByRole('button', { name: 'Отправить оффер' }).click();
await anna.locator('.offer-card', { hasText: 'Вы предлагаете' }).waitFor();
await boris.reload(); await boris.waitForSelector('.island');
await tab(boris, 'Чаты');
await boris.locator('.swipe-body', { hasText: 'Анна Соколова' }).click();
await boris.locator('.offer-card', { hasText: 'предлагает' }).waitFor();
await shot(boris, 'boris-offer-received');
await boris.getByRole('button', { name: 'Предложить свою цену' }).click();
await boris.getByLabel('Сумма', { exact: true }).fill('50');
await boris.getByRole('button', { name: 'Отправить свою цену' }).click();
await boris.locator('.offer-card', { hasText: 'ВСТРЕЧНАЯ ЦЕНА' }).waitFor();
await anna.locator('.offer-card', { hasText: 'ВСТРЕЧНАЯ ЦЕНА' }).waitFor({ timeout: 15000 });
await shot(anna, 'anna-counter-received');
await anna.locator('.offer-acts .btn.primary').last().click();
await anna.getByText('Сделка #2').first().waitFor();
await shot(anna, 'anna-offer-deal', true);
const deal2 = await anna.evaluate(() => document.querySelector('.deal-head .sum b')?.textContent);
if (deal2 !== '50') throw new Error('deal from the offer has amount ' + deal2);
step('offer -> counter -> accepted -> deal #2');
await anna.evaluate(() => window.__tgBack()); await anna.waitForTimeout(400);

await boris.reload(); await boris.waitForSelector('.island');
await tab(boris, 'Чаты');
await shot(boris, 'boris-chats');
await boris.locator('.swipe-body', { hasText: 'Анна Соколова' }).click();
await boris.getByLabel('Сообщение').fill('Давайте без гаранта, напишите мне в лс');
await shot(boris, 'boris-offsite-warning');
await boris.getByLabel('Отправить').click();
await boris.waitForTimeout(500);
step('messages exchanged');

await anna.waitForTimeout(4500);
await shot(anna, 'anna-chat-updated');
await anna.locator('.chat').waitFor();
await anna.getByLabel('Ещё').click();
await anna.locator('.sheet').getByText('Пожаловаться').click();
await anna.getByText('Просит оплату вне гаранта').click();
await anna.locator('textarea').fill('Предлагает перейти в личку и работать без гаранта, это против правил.');
await anna.locator('input[type=file]').setInputFiles({ name: 'chat.png', mimeType: 'image/png', buffer: PNG });
await shot(anna, 'anna-complaint', true);
await main(anna);
await anna.getByText(/Жалоба #\d+ отправлена/).waitFor();
step('complaint sent');

await admin.evaluate(() => window.__tgBack()); await admin.waitForTimeout(300);
await admin.reload(); await admin.waitForSelector('.island');
await tab(admin, 'Профиль');
await admin.getByText('Админ-панель').click();
await admin.locator('.cell', { hasText: 'Борис Ким' }).first().click();
await shot(admin, 'admin-complaint', true);
await main(admin);
await admin.getByText(/Первое нарушение: блокировка до/).first().waitFor();
await shot(admin, 'admin-banned');
step('banned');

await boris.reload();
await boris.getByText('Аккаунт заблокирован').waitFor();
await shot(boris, 'boris-banned-screen');
step('ban enforced');

await tab(admin, 'Профиль').catch(() => {});
await admin.reload(); await admin.waitForSelector('.island');
await tab(admin, 'Профиль');
await admin.getByText('Финансы и споры').click();
await admin.getByText('Последние операции').waitFor();
await shot(admin, 'admin-finance', true);
step('finance');

await anna.reload(); await anna.waitForSelector('.island');
await tab(anna, 'Чаты');
await anna.locator('.swipe-body', { hasText: 'Борис Ким' }).click();
await anna.getByLabel('Ещё').click();
await anna.locator('.sheet').getByText('Удалить чат').click();
await anna.locator('.sheet .btn.danger').click();
await anna.getByText('Чат удалён').waitFor();
await anna.waitForSelector('.island');
if (await anna.locator('.swipe-body', { hasText: 'Борис Ким' }).count()) throw new Error('deleted chat is still listed');
await shot(anna, 'anna-chat-deleted');
step('chat deleted');

} catch (e) {
  for (const [k, p] of Object.entries(pages)) await p.screenshot({ path: path.join(outDir, `fail-${k}.png`), fullPage: true }).catch(() => {});
  console.log('FAILED:', e.message.split('\n')[0], JSON.stringify(errors));
  process.exitCode = 1;
}
console.log(JSON.stringify({ shots: n, errors }));
await b.close();
server.close();
