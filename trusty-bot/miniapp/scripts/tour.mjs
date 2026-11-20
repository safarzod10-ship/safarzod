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
const tab = async (label) => { await page.locator('.tabbar .tab', { hasText: label }).click(); };
const back = async () => { await page.getByLabel('Назад').first().click(); };

await page.goto(url);
await page.waitForTimeout(400);
await shot('splash', false);
await page.waitForTimeout(1200);
await shot('home');
await tab('Разработчики'); await shot('developers');
await tap('Тимур Исмаилов'); await shot('developer-profile');
await page.getByLabel('Ещё').click(); await shot('developer-menu', false);
await page.locator('.backdrop').click(); await back();
await tab('Проекты'); await shot('projects');
await tap('Telegram-бот для записи в барбершоп'); await shot('project-view'); await back();
await tap('Мои проекты'); await tap('Mini App для заказов в кофейне'); await shot('my-project-bids');
await tap('Выбрать'); await shot('choose-developer'); await back(); await back();
await page.getByLabel('Создать проект').click(); await shot('project-new');
await tap('Опубликовать проект'); await shot('project-new-errors'); await back();
await tab('Чаты'); await shot('chats');
await tap('Тимур Исмаилов'); await shot('chat-deal', false);
await page.getByLabel('Сообщение').fill('Давай лучше напрямую, напиши мне в лс'); await shot('chat-offsite-warning', false);
await back();
await tab('Профиль'); await shot('profile');
await tap('Админ-панель'); await shot('admin');
await tap('#52'); await shot('admin-complaint');
await tap('Бан на 30 дней'); await shot('admin-banned');
await back(); await tap('Баны'); await shot('admin-bans'); await back();
await tap('Я разработчик'); await shot('profile-dev');
await tap('Анкета разработчика'); await tap('Боты'); await shot('dev-form-1'); await back();
await tab('Разработчики'); await tap('Илья Гордеев'); await page.getByLabel('Ещё').click(); await tap('Пожаловаться'); await shot('complaint');

console.log(JSON.stringify({ shots: n, errors }));
await b.close();
server.close();
