// Screenshot tour of the built Mini App: node scripts/tour.mjs <outDir> [light|dark] [scale]
// Serves dist/ itself, walks the main flows and saves one PNG per screen.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const [, , outDir = 'shots', scheme = 'light', scale = '1'] = process.argv;
const dist = path.resolve('dist');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const p = path.join(dist, decodeURIComponent(req.url.split('?')[0]) === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]));
  fs.readFile(p, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); res.end(d); });
}).listen(0);
const url = `http://localhost:${server.address().port}/`;
fs.mkdirSync(outDir, { recursive: true });

const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: +scale, colorScheme: scheme, hasTouch: true });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
let n = 0;
const shot = async (name, full = true) => {
  await page.waitForTimeout(450);
  await page.screenshot({ path: path.join(outDir, `${String(++n).padStart(2, '0')}-${name}.png`), fullPage: full });
};
const tap = async (text, opts = {}) => { await page.getByText(text, { exact: false, ...opts }).first().click(); };
const tab = async (label) => { await page.waitForSelector('#tl-splash', { state: 'detached' }); await page.locator(`.island .tab[aria-label="${label}"]`).click({ force: true }); };
const back = async () => { await page.getByLabel('Назад').first().click(); };
const closeSheet = async () => { await page.locator('.backdrop').click({ position: { x: 10, y: 10 } }); await page.waitForTimeout(250); };

await page.goto(url);
await page.waitForTimeout(600);
await shot('splash', false);
await page.waitForSelector('.ob');
await shot('onboarding-1', false);
await page.getByRole('button', { name: 'Дальше' }).click();
await shot('onboarding-role', false);
await page.getByRole('radio', { name: /Заказчик/ }).click();
await page.getByRole('button', { name: /Начать как/ }).click();
await page.waitForSelector('.island');
await shot('home', false);
await page.getByLabel('Что значит «у гаранта»').click(); await shot('home-info', false); await page.mouse.click(5, 300);
await page.getByLabel('Сменить роль').click(); await shot('role-switch', false); await closeSheet();
await page.getByLabel('Создать').click(); await shot('fab-menu', false); await closeSheet();
await tap('Mini App для заказов в кофейне'); await shot('deal'); await back();
await tab('Исполнители'); await shot('developers', false);
await tap('Тимур Исмаилов'); await shot('developer-profile');
await back();
await tab('Профиль'); await tap('Мои проекты'); await shot('my-projects', false);
await tap('Mini App для заказов в кофейне'); await shot('my-project-bids');
await back(); await back();
await tab('Чаты'); await shot('chats', false);
{ const r = await page.locator('.swipe-body').first().boundingBox(); await page.mouse.move(r.x + r.width - 40, r.y + r.height / 2); await page.mouse.down();
  for (let dx = 0; dx <= 130; dx += 13) await page.mouse.move(r.x + r.width - 40 - dx, r.y + r.height / 2); await page.mouse.up(); await shot('chat-swipe', false);
  await page.locator('.swipe-body').first().click(); await page.waitForTimeout(300); }
await tap('Алина Ковалёва'); await page.waitForTimeout(300); await shot('chat-offer', false);
await page.getByLabel('Предложить цену').click(); await page.waitForTimeout(400); await shot('offer-pick-project', false); await closeSheet();
await tap('Предложить свою цену'); await page.waitForTimeout(400); await shot('counter-sheet', false);
await page.getByRole('button', { name: '+10' }).click(); await page.getByRole('button', { name: '+10' }).click(); await page.waitForTimeout(500); await shot('counter-odometer', false);
await tap('Отправить свою цену'); await page.waitForTimeout(900); await shot('chat-typing', false);
await page.waitForTimeout(2600); await shot('chat-answer', false);
await back();
await tap('Тимур Исмаилов'); await shot('chat-deal', false);
await page.getByLabel('Сообщение').fill('Давай лучше напрямую, напиши мне в лс'); await shot('chat-offsite-warning', false);
await back();
await tab('Профиль'); await shot('profile');
await tap('Админ-панель'); await shot('admin');
await tap('#52'); await shot('admin-complaint');
await back(); await back();
await tab('Исполнители'); await tap('Илья Гордеев'); await page.getByLabel('Ещё').click(); await tap('Пожаловаться'); await shot('complaint');
await back(); await back();
await tab('Главная'); await page.getByLabel('Создать').click(); await tap('Опубликовать проект'); await shot('project-new');
await back(); await page.getByLabel('Создать').click(); await tap('Как работает гарант'); await shot('guide');
await back(); await tab('Профиль'); await tap('Я исполнитель'); await page.waitForTimeout(300); await shot('profile-dev');
await tab('Проекты'); await shot('projects-dev', false);
await tap('Telegram-бот для записи в барбершоп'); await shot('project-view', false); await back();
await tab('Профиль');
await page.getByText('Анкета исполнителя', { exact: true }).first().click(); await page.waitForTimeout(300); await shot('dev-form-1');

console.log(JSON.stringify({ shots: n, errors }));
await b.close();
server.close();
