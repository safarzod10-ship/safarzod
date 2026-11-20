// Mock data for the prototype. Every person, project and amount here is an example.

export type DevStatus = 'free' | 'busy' | 'away';
export type DealResult = 'ontime' | 'late' | 'dispute_won' | 'dispute_lost';

export interface PastDeal {
  id: number;
  title: string;
  category: string;
  amount: string; // shown as a range to protect the client
  date: string;
  result: DealResult;
  rating?: number;
  review?: string;
  author?: string;
}

export interface Dev {
  id: string;
  name: string;
  handle: string;
  hue: number;
  title: string;
  categories: string[];
  stack: string[];
  rating: number;
  deals: number;
  volume: number; // USDT
  onTime: number; // %
  disputes: number;
  disputesLost: number;
  lastSeenMin: number;
  responseMin: number;
  status: DevStatus;
  busyUntil?: string;
  rate: number; // USDT / hour
  verified: boolean;
  github?: string;
  deposit?: number;
  isNew?: boolean;
  joined: string;
  about: string;
  portfolio: { title: string; text: string }[];
  history: PastDeal[];
  links?: string[];
  years?: number;
  moderation?: 'review' | 'published' | 'rejected';
  banned?: { until: string | null } | null;
}

export interface Client {
  id: string;
  name: string;
  handle: string;
  hue: number;
  rating: number;
  deals: number;
  lastSeenMin: number;
}

export interface Bid {
  devId: string;
  price: number;
  days: number;
  text: string;
  ago: string;
}

export interface Project {
  id: number;
  title: string;
  category: string;
  budgetMin: number;
  budgetMax: number;
  days: number;
  stack: string[];
  text: string;
  clientId: string;
  ago: string;
  files: { name: string; size: string }[];
  bids: Bid[];
  status: 'open' | 'in_work' | 'closed';
  client?: Client | null; // live API embeds the client
  bidsCount?: number; // live API: total bids (the list itself is only sent to the owner)
  myBid?: { projectId: number; price: number; days: number; text: string } | null;
}

export type DealStatus = 'awaiting_payment' | 'in_work' | 'review' | 'done' | 'dispute' | 'cancelled' | 'refunded';

export interface DealParty { id: string; name: string; handle: string; hue: number; lastSeenMin: number }
export interface DealPayment { id: number; kind: 'invoice' | 'payout' | 'refund'; amount: string; status: string; userId: string; url?: string | null; error?: string | null; at: string }
export interface Deal {
  id: number; title: string; category: string; amount: number; fee: string | null; total: string; status: DealStatus;
  role: 'client' | 'dev' | 'admin'; client: DealParty; dev: DealParty; days: number; due: string; dueAt: string; createdAt: string;
  paidAt?: string | null; submittedAt?: string | null; reviewUntil?: string | null; finishedAt?: string | null;
  workNote?: string | null; disputeReason?: string | null; disputeBy?: 'client' | 'dev' | null; resolution?: string | null;
  devShare?: number | null; result?: string | null; projectId?: number | null; chatId?: string | null;
  review?: { rating: number; text: string } | null; payments: DealPayment[];
  actions: { pay: boolean; submit: boolean; accept: boolean; dispute: boolean; cancel: boolean; review: boolean; resolve: boolean };
}
export interface PayConfig { enabled: boolean; asset: string; feePercent: number; reviewDays: number }

/** 90 -> "90", "94.50" -> "94,50" */
export function amt(x: number | string): string {
  const n = Number(x);
  return Number.isInteger(n) ? n.toLocaleString('ru-RU') : n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function dateTime(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).replace('.', '');
}

export interface Msg {
  id: number;
  from: 'me' | 'peer' | 'system';
  text: string;
  time?: string;
  at?: string; // ISO time from the API
  file?: string;
}

export interface Chat {
  id: string;
  peer: { name: string; hue: number; lastSeenMin: number; role: 'dev' | 'client'; refId: string };
  deal?: { id: number; title: string; amount: number; status: DealStatus; due: string; clientId?: string; devId?: string } | null;
  unread: number;
  messages: Msg[];
}

export type ComplaintReason = 'no_work' | 'vanished' | 'offsite_payment' | 'fraud' | 'other';

export interface Complaint {
  id: number;
  fromId?: string;
  fromName: string;
  againstId: string;
  againstName: string;
  dealId?: number | null;
  reason: ComplaintReason;
  text: string;
  evidence: string[]; // image urls
  status: 'new' | 'review' | 'resolved' | 'rejected';
  ago: string;
  decision?: string | null;
}

export interface Member {
  id: string;
  name: string;
  handle: string;
  hue: number;
  role: 'dev' | 'client';
  strikes: number;
  ban?: { until: string | null } | null; // until null = permanent
  isAdmin?: boolean;
}

export const CATEGORIES = [
  { key: 'bots', label: 'Боты', count: 124 },
  { key: 'web', label: 'Веб', count: 98 },
  { key: 'parsers', label: 'Парсеры', count: 41 },
  { key: 'mobile', label: 'Mobile', count: 37 },
  { key: 'web3', label: 'Web3', count: 22 },
  { key: 'design', label: 'Дизайн', count: 30 },
  { key: 'devops', label: 'DevOps', count: 14 },
];

export const categoryLabel = (k: string) => CATEGORIES.find((c) => c.key === k)?.label ?? k;

export const DEVS: Dev[] = [
  {
    id: 'timur', name: 'Тимур Исмаилов', handle: 'timur_dev', hue: 0, title: 'Telegram-боты и Mini Apps',
    categories: ['bots', 'web'], stack: ['Python', 'aiogram 3', 'PostgreSQL', 'Redis', 'Mini Apps'],
    rating: 4.9, deals: 48, volume: 18400, onTime: 96, disputes: 1, disputesLost: 0, lastSeenMin: 2, responseMin: 15,
    status: 'free', rate: 25, verified: true, github: 'timur-dev', deposit: 200, joined: 'марта 2025',
    about: 'Пишу ботов и Mini Apps под ключ: от ТЗ до деплоя на сервер заказчика. Оплаты, админки, рассылки, интеграции с CRM. Сдаю с инструкцией и месяцем бесплатных правок.',
    portfolio: [
      { title: 'Бот записи для сети барбершопов', text: '3 филиала, онлайн-оплата, напоминания. 2 400 записей в месяц.' },
      { title: 'Mini App доставки для кафе', text: 'Корзина, промокоды, статус заказа в реальном времени.' },
    ],
    history: [
      { id: 1042, title: 'Бот для приёма заявок', category: 'Боты', amount: '200–300', date: '14 ноя', result: 'ontime', rating: 5, review: 'Сделал за 5 дней вместо 7, всё объяснил. Буду работать ещё.', author: 'Анна' },
      { id: 1017, title: 'Интеграция бота с amoCRM', category: 'Боты', amount: '100–200', date: '2 ноя', result: 'ontime', rating: 5, review: 'Чётко по ТЗ, на связи каждый день.', author: 'Олег' },
      { id: 988, title: 'Mini App каталога товаров', category: 'Веб', amount: '500–700', date: '21 окт', result: 'dispute_won', rating: 4, review: 'Был спор по объёму правок, арбитр разобрался. Результатом доволен.', author: 'Игорь' },
      { id: 951, title: 'Рассыльщик с сегментами', category: 'Боты', amount: '100–200', date: '9 окт', result: 'ontime', rating: 5, review: 'Быстро и аккуратно.', author: 'Мария' },
    ],
  },
  {
    id: 'alina', name: 'Алина Ковалёва', handle: 'alina_front', hue: 1, title: 'Фронтенд: React, Next.js',
    categories: ['web', 'design'], stack: ['React', 'Next.js', 'TypeScript', 'Tailwind', 'Figma'],
    rating: 4.8, deals: 31, volume: 12650, onTime: 94, disputes: 0, disputesLost: 0, lastSeenMin: 1, responseMin: 25,
    status: 'free', rate: 30, verified: true, github: 'alinakov', joined: 'мая 2025',
    about: 'Вёрстка и фронтенд сложных интерфейсов. Анимации, адаптив, доступность. Работаю по макету или делаю его сама.',
    portfolio: [{ title: 'Лендинг онлайн-школы', text: 'Next.js, конверсия в заявку выросла с 2,1 до 3,4 %.' }],
    history: [
      { id: 1031, title: 'Лендинг для студии йоги', category: 'Веб', amount: '200–300', date: '10 ноя', result: 'ontime', rating: 5, review: 'Красиво и быстро, учла все пожелания.', author: 'Света' },
      { id: 976, title: 'Личный кабинет SaaS', category: 'Веб', amount: '700–1000', date: '15 окт', result: 'late', rating: 4, review: 'Задержка на 2 дня, но предупредила заранее.', author: 'Денис' },
    ],
  },
  {
    id: 'sergey', name: 'Сергей Ли', handle: 'sergey_parse', hue: 2, title: 'Парсеры и автоматизация',
    categories: ['parsers', 'bots'], stack: ['Python', 'Scrapy', 'Playwright', 'Google Sheets API'],
    rating: 4.7, deals: 63, volume: 9800, onTime: 92, disputes: 2, disputesLost: 1, lastSeenMin: 38, responseMin: 40,
    status: 'busy', busyUntil: '28 ноя', rate: 20, verified: true, joined: 'января 2025',
    about: 'Парсинг маркетплейсов, обход защит, выгрузки в Sheets и БД по расписанию.',
    portfolio: [{ title: 'Мониторинг цен Wildberries', text: '12 000 товаров, обновление каждые 30 минут.' }],
    history: [
      { id: 1036, title: 'Парсер Ozon в Google Sheets', category: 'Парсеры', amount: '50–100', date: '12 ноя', result: 'ontime', rating: 5, review: 'Работает стабильно уже неделю.', author: 'Кирилл' },
      { id: 940, title: 'Сбор контактов с Авито', category: 'Парсеры', amount: '50–100', date: '3 окт', result: 'dispute_lost', rating: 3, review: 'Часть данных не собиралась, арбитр вернул 40 %.', author: 'Павел' },
    ],
  },
  {
    id: 'madina', name: 'Мадина Рахимова', handle: 'madina_flutter', hue: 3, title: 'Мобильные приложения',
    categories: ['mobile'], stack: ['Flutter', 'Dart', 'Firebase', 'Kotlin'],
    rating: 4.9, deals: 22, volume: 15300, onTime: 100, disputes: 0, disputesLost: 0, lastSeenMin: 180, responseMin: 60,
    status: 'free', rate: 35, verified: true, github: 'madina-r', deposit: 300, joined: 'февраля 2025',
    about: 'iOS и Android на Flutter. Публикация в сторах, push-уведомления, оплата внутри приложения.',
    portfolio: [{ title: 'Приложение фитнес-клуба', text: 'Запись, абонементы, 4,8 в App Store.' }],
    history: [{ id: 1002, title: 'Приложение доставки воды', category: 'Mobile', amount: '1000+', date: '28 окт', result: 'ontime', rating: 5, review: 'Лучший исполнитель, с кем работали.', author: 'Руслан' }],
  },
  {
    id: 'artem', name: 'Артём Белов', handle: 'artem_ton', hue: 4, title: 'Смарт-контракты TON и EVM',
    categories: ['web3'], stack: ['FunC', 'Tact', 'Solidity', 'TypeScript'],
    rating: 4.6, deals: 14, volume: 21000, onTime: 86, disputes: 1, disputesLost: 0, lastSeenMin: 4, responseMin: 30,
    status: 'free', rate: 45, verified: true, joined: 'апреля 2025',
    about: 'Контракты стейкинга, NFT, джеттоны. Покрытие тестами, аудит перед деплоем.',
    portfolio: [{ title: 'Стейкинг-пул на TON', text: 'TVL 180 000 TON, без инцидентов.' }],
    history: [{ id: 1011, title: 'Jetton с вестингом', category: 'Web3', amount: '1000+', date: '30 окт', result: 'ontime', rating: 5, review: 'Профессионал.', author: 'Ян' }],
  },
  {
    id: 'ksenia', name: 'Ксения Мороз', handle: 'ksu_ui', hue: 5, title: 'UI/UX дизайн',
    categories: ['design'], stack: ['Figma', 'Прототипы', 'Дизайн-системы'],
    rating: 5.0, deals: 19, volume: 5600, onTime: 100, disputes: 0, disputesLost: 0, lastSeenMin: 9, responseMin: 20,
    status: 'busy', busyUntil: '2 дек', rate: 22, verified: true, joined: 'июня 2025',
    about: 'Интерфейсы для Mini Apps и SaaS. Передаю макеты с гайдом для разработчика.',
    portfolio: [{ title: 'Дизайн-система финтех-приложения', text: '140 компонентов, тёмная тема.' }],
    history: [{ id: 1025, title: 'Макеты Mini App магазина', category: 'Дизайн', amount: '100–200', date: '8 ноя', result: 'ontime', rating: 5, review: 'Очень аккуратная работа.', author: 'Вика' }],
  },
  {
    id: 'rustam', name: 'Рустам Каримов', handle: 'rustam_ops', hue: 6, title: 'DevOps и серверы',
    categories: ['devops'], stack: ['Docker', 'Linux', 'Nginx', 'CI/CD', 'Grafana'],
    rating: 4.8, deals: 27, volume: 6100, onTime: 97, disputes: 0, disputesLost: 0, lastSeenMin: 0, responseMin: 10,
    status: 'free', rate: 28, verified: true, joined: 'марта 2025',
    about: 'Разверну проект на вашем сервере, настрою бэкапы, мониторинг и автодеплой.',
    portfolio: [{ title: 'Инфраструктура для 40 ботов', text: 'Docker Swarm, алерты в Telegram.' }],
    history: [{ id: 1039, title: 'Деплой бота и Mini App', category: 'DevOps', amount: '50–100', date: '13 ноя', result: 'ontime', rating: 5, review: 'За час всё поднял.', author: 'Тимур' }],
  },
  {
    id: 'ilya', name: 'Илья Гордеев', handle: 'ilya_g', hue: 7, title: 'Боты на Node.js',
    categories: ['bots'], stack: ['Node.js', 'grammY', 'MongoDB'],
    rating: 0, deals: 0, volume: 0, onTime: 0, disputes: 0, disputesLost: 0, lastSeenMin: 12, responseMin: 0,
    status: 'free', rate: 12, verified: false, isNew: true, joined: 'ноября 2026',
    about: 'Начинающий разработчик, 1 год коммерческого опыта в студии. Беру небольшие задачи.',
    portfolio: [{ title: 'Бот-викторина', text: 'Учебный проект, 300 пользователей.' }],
    history: [],
  },
];

export const CLIENTS: Client[] = [
  { id: 'anna', name: 'Анна Соколова', handle: 'anna_barber', hue: 2, rating: 5.0, deals: 4, lastSeenMin: 3 },
  { id: 'kirill', name: 'Кирилл Н.', handle: 'kirill_shop', hue: 5, rating: 4.8, deals: 9, lastSeenMin: 60 },
  { id: 'school', name: 'Онлайн-школа «Код»', handle: 'kod_school', hue: 1, rating: 4.9, deals: 12, lastSeenMin: 20 },
  { id: 'me', name: 'Вы', handle: 'you', hue: 0, rating: 5.0, deals: 4, lastSeenMin: 0 },
];

export const PROJECTS: Project[] = [
  {
    id: 311, title: 'Telegram-бот для записи в барбершоп', category: 'bots', budgetMin: 150, budgetMax: 250, days: 10,
    stack: ['Python', 'aiogram', 'PostgreSQL'], clientId: 'anna', ago: '2 ч назад', status: 'open',
    text: 'Нужен бот для записи клиентов к мастерам. Выбор услуги, мастера и времени, напоминание за 2 часа, отмена записи. Админка для управления расписанием. Есть 2 филиала.',
    files: [{ name: 'ТЗ_барбершоп.pdf', size: '240 КБ' }],
    bids: [
      { devId: 'timur', price: 220, days: 8, text: 'Делал похожий бот для сети из 3 барбершопов, покажу демо. Админка в виде Mini App.', ago: '1 ч назад' },
      { devId: 'ilya', price: 120, days: 12, text: 'Готов сделать на Node.js, первый вариант покажу через 4 дня.', ago: '40 мин назад' },
      { devId: 'sergey', price: 200, days: 10, text: 'Сделаю на aiogram 3, с экспортом записей в Google Sheets.', ago: '25 мин назад' },
    ],
  },
  {
    id: 309, title: 'Парсер Wildberries с выгрузкой в Google Sheets', category: 'parsers', budgetMin: 80, budgetMax: 120, days: 5,
    stack: ['Python', 'Google Sheets'], clientId: 'kirill', ago: '5 ч назад', status: 'open',
    text: 'Собирать цены и остатки по 500 артикулам конкурентов раз в час. Выгрузка в таблицу, подсветка изменений цены больше 5 %.',
    files: [], bids: [{ devId: 'sergey', price: 100, days: 4, text: 'Есть готовое решение под WB, адаптирую под ваш список.', ago: '3 ч назад' }],
  },
  {
    id: 305, title: 'Mini App для заказов в кофейне', category: 'web', budgetMin: 500, budgetMax: 700, days: 21,
    stack: ['React', 'Node.js', 'Mini Apps'], clientId: 'me', ago: 'вчера', status: 'open',
    text: 'Меню с фото, корзина, оплата при получении, статус заказа. Панель бариста для приёма заказов.',
    files: [{ name: 'Меню_и_референсы.zip', size: '8,4 МБ' }],
    bids: [
      { devId: 'timur', price: 650, days: 18, text: 'Сделаю Mini App и бота-уведомлялку для бариста. Бэкенд на Python.', ago: 'вчера' },
      { devId: 'alina', price: 600, days: 20, text: 'Фронт и дизайн на мне, бэкенд сделаю на Next.js API.', ago: '20 ч назад' },
    ],
  },
  {
    id: 301, title: 'Лендинг онлайн-школы на Next.js', category: 'web', budgetMin: 300, budgetMax: 300, days: 14,
    stack: ['Next.js', 'Figma'], clientId: 'school', ago: '2 дня назад', status: 'open',
    text: 'Макет готов в Figma, нужна адаптивная вёрстка с анимациями и формой заявки в amoCRM.',
    files: [{ name: 'figma-link.txt', size: '1 КБ' }], bids: [],
  },
  {
    id: 298, title: 'Смарт-контракт стейкинга на TON', category: 'web3', budgetMin: 1000, budgetMax: 1400, days: 30,
    stack: ['Tact', 'TypeScript'], clientId: 'kirill', ago: '3 дня назад', status: 'open',
    text: 'Стейкинг джеттона с наградами по эпохам, досрочный вывод с комиссией. Тесты и деплой в mainnet.',
    files: [], bids: [{ devId: 'artem', price: 1200, days: 25, text: 'Профильная задача, делал 2 похожих пула.', ago: '2 дня назад' }],
  },
];

export const CHATS: Chat[] = [
  {
    id: 'c-timur', peer: { name: 'Тимур Исмаилов', hue: 0, lastSeenMin: 2, role: 'dev', refId: 'timur' },
    deal: { id: 1048, title: 'Mini App для заказов в кофейне', amount: 650, status: 'in_work', due: '9 дек' }, unread: 2,
    messages: [
      { id: 1, from: 'system', text: 'Сделка #1048 создана. Условия зафиксированы: 650 USDT, срок 18 дней.', time: 'вчера' },
      { id: 2, from: 'system', text: 'Заказчик внёс 650 USDT. Деньги у гаранта до приёмки работы.', time: 'вчера' },
      { id: 3, from: 'peer', text: 'Добрый день! Начал. Сегодня пришлю структуру экранов на согласование.', time: '10:12' },
      { id: 4, from: 'me', text: 'Отлично, жду. Цвета бренда приложила в ТЗ.', time: '10:20' },
      { id: 5, from: 'peer', text: 'Вот первая версия меню и корзины.', time: '16:41', file: 'menu-v1.png' },
      { id: 6, from: 'peer', text: 'Если ок, завтра подключаю панель бариста.', time: '16:42' },
    ],
  },
  {
    id: 'c-alina', peer: { name: 'Алина Ковалёва', hue: 1, lastSeenMin: 1, role: 'dev', refId: 'alina' }, unread: 0,
    messages: [
      { id: 1, from: 'peer', text: 'Здравствуйте! Видела ваш проект кофейни. Могу показать примеры похожих интерфейсов.', time: 'вчера' },
      { id: 2, from: 'me', text: 'Спасибо, уже выбрала исполнителя. Напишу по следующему проекту.', time: 'вчера' },
    ],
  },
  {
    id: 'c-ilya', peer: { name: 'Илья Гордеев', hue: 7, lastSeenMin: 12, role: 'dev', refId: 'ilya' }, unread: 1,
    messages: [
      { id: 1, from: 'peer', text: 'Можем обсудить детали напрямую? Напишите мне в лс @ilya_g, так будет быстрее и без комиссии.', time: '12:03' },
      { id: 2, from: 'system', text: 'Внимание: договорённости и оплата вне Trusty не защищены гарантом.', time: '12:03' },
    ],
  },
];

const shot = (title: string, lines: string[], hue: number) => {
  const rows = lines
    .map((l, i) => `<rect x="${i % 2 ? 70 : 16}" y="${46 + i * 34}" width="${170}" height="24" rx="10" fill="${i % 2 ? '#178A66' : '#E3EBE7'}"/><text x="${i % 2 ? 80 : 26}" y="${62 + i * 34}" font-family="Arial" font-size="11" fill="${i % 2 ? '#fff' : '#0D2C27'}">${l}</text>`)
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="200"><rect width="256" height="200" fill="#fff"/><rect width="256" height="32" fill="hsl(${hue},30%,92%)"/><text x="14" y="21" font-family="Arial" font-size="12" font-weight="bold" fill="#0D2C27">${title}</text>${rows}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
};

export const COMPLAINTS: Complaint[] = [
  {
    id: 52, fromName: 'Павел К.', againstId: 'ilya', againstName: 'Илья Гордеев', reason: 'offsite_payment',
    text: 'Попросил перевести предоплату на карту, минуя Trusty. После отказа перестал отвечать.',
    evidence: [shot('Илья Гордеев', ['Давайте напрямую', 'Скинь 50% на карту', 'Так без комиссии'], 140)], status: 'new', ago: '35 мин назад',
  },
  {
    id: 51, fromName: 'Олег Т.', againstId: 'sergey', againstName: 'Сергей Ли', dealId: 1033, reason: 'no_work',
    text: 'Срок сдачи прошёл 3 дня назад, работа не сдана. На сообщения отвечает «завтра».',
    evidence: [shot('Сделка #1033', ['Когда будет готово?', 'Завтра скину', 'Прошло 3 дня'], 20), shot('Условия #1033', ['Срок: 15 ноября', 'Сумма: 80 USDT'], 60)], status: 'review', ago: '3 ч назад',
  },
  {
    id: 47, fromName: 'Ира М.', againstId: 'artem', againstName: 'Артём Белов', dealId: 1011, reason: 'other',
    text: 'Не согласна с качеством тестов.', evidence: [], status: 'rejected', ago: '6 дней назад', decision: 'Работа соответствует ТЗ, жалоба отклонена.',
  },
];

export const MEMBERS: Member[] = [
  ...DEVS.map((d) => ({ id: d.id, name: d.name, handle: d.handle, hue: d.hue, role: 'dev' as const, strikes: d.id === 'sergey' ? 1 : 0 })),
  { id: 'max', name: 'Максим Ветров', handle: 'max_vetrov', hue: 3, role: 'client', strikes: 1, ban: { until: '14 дек' } },
  { id: 'dmitry', name: 'Дмитрий Шах', handle: 'dshah', hue: 6, role: 'dev', strikes: 2, ban: { until: null } },
];

export const ADMINS = [
  { name: 'Вы', handle: 'you' },
  { name: 'Второй администратор', handle: 'admin2' },
];

// ---------------------------------------------------------------- formatting helpers
export function msgTime(m: { time?: string; at?: string }): string {
  if (m.at) {
    const d = new Date(m.at);
    const today = new Date().toDateString() === d.toDateString();
    return today ? d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }).replace('.', '');
  }
  return m.time ?? '';
}

export function seen(min: number): string {
  if (min <= 5) return 'в сети';
  if (min < 60) return `был ${min} мин назад`;
  const h = Math.round(min / 60);
  if (h < 24) return `был ${h} ч назад`;
  return 'был давно';
}

export function responseTime(min: number): string {
  if (!min) return 'нет данных';
  if (min < 60) return `~${min} мин`;
  return `~${Math.round(min / 60)} ч`;
}

export const bidCount = (p: { bids: unknown[]; bidsCount?: number }) => p.bidsCount ?? p.bids.length;

export const usdt = (n: number) => `${n.toLocaleString('ru-RU')} USDT`;
export const budget = (p: { budgetMin: number; budgetMax: number }) =>
  p.budgetMin === p.budgetMax ? usdt(p.budgetMin) : `${p.budgetMin.toLocaleString('ru-RU')}–${usdt(p.budgetMax)}`;

export function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

export const RESULT_LABEL: Record<DealResult, string> = {
  ontime: 'В срок',
  late: 'С опозданием',
  dispute_won: 'Спор решён в пользу разработчика',
  dispute_lost: 'Спор решён в пользу заказчика',
};

export const DEAL_STATUS: Record<DealStatus, string> = {
  awaiting_payment: 'Ожидает оплаты',
  in_work: 'В работе',
  review: 'На приёмке',
  done: 'Завершена',
  dispute: 'Спор',
  cancelled: 'Отменена',
  refunded: 'Возврат',
};

export const DEAL_TONE: Record<DealStatus, 'green' | 'amber' | 'blue' | 'red' | undefined> = {
  awaiting_payment: 'amber', in_work: 'blue', review: 'amber', done: 'green', dispute: 'red', cancelled: undefined, refunded: undefined,
};

const party = (id: string, name: string, hue: number, handle: string, lastSeenMin = 3): DealParty => ({ id, name, hue, handle, lastSeenMin });
const ME_CLIENT = party('me', 'Вы', 0, 'you', 0);
const noActs = { pay: false, submit: false, accept: false, dispute: false, cancel: false, review: false, resolve: false };

/** demo deals for the browser preview */
export const DEMO_DEALS: Deal[] = [
  {
    id: 1048, title: 'Mini App для заказов в кофейне', category: 'Веб', amount: 650, fee: '32.50', total: '682.50', status: 'in_work', role: 'client',
    client: ME_CLIENT, dev: party('timur', 'Тимур Исмаилов', 0, 'timur_dev', 2), days: 18, due: '9 дек', dueAt: '2026-12-09T12:00:00Z',
    createdAt: '2026-11-19T10:00:00Z', paidAt: '2026-11-19T10:20:00Z', chatId: 'c-timur', projectId: 305, payments: [],
    actions: { ...noActs, accept: true, dispute: true },
  },
  {
    id: 1053, title: 'Парсер Wildberries с выгрузкой в Google Sheets', category: 'Парсеры', amount: 100, fee: '5.00', total: '105.00',
    status: 'awaiting_payment', role: 'client', client: ME_CLIENT, dev: party('sergey', 'Сергей Ли', 2, 'sergey_parse', 38), days: 4, due: '24 ноя',
    dueAt: '2026-11-24T12:00:00Z', createdAt: '2026-11-20T09:00:00Z', chatId: null, projectId: 309, payments: [],
    actions: { ...noActs, pay: true, cancel: true },
  },
  {
    id: 1017, title: 'Интеграция бота с amoCRM', category: 'Боты', amount: 150, fee: '7.50', total: '157.50', status: 'done', role: 'client',
    client: ME_CLIENT, dev: party('timur', 'Тимур Исмаилов', 0, 'timur_dev', 2), days: 6, due: '2 ноя', dueAt: '2026-11-02T12:00:00Z',
    createdAt: '2026-10-27T10:00:00Z', paidAt: '2026-10-27T11:00:00Z', submittedAt: '2026-11-01T15:00:00Z', finishedAt: '2026-11-02T09:00:00Z',
    result: 'ontime', review: { rating: 5, text: 'Чётко по ТЗ, на связи каждый день.' }, chatId: 'c-timur', payments: [], actions: noActs,
  },
];

export const REASONS: { key: ComplaintReason; label: string }[] = [
  { key: 'no_work', label: 'Не выполнил работу или сорвал срок' },
  { key: 'vanished', label: 'Пропал и не выходит на связь' },
  { key: 'offsite_payment', label: 'Просит оплату вне гаранта' },
  { key: 'fraud', label: 'Мошенничество или обман' },
  { key: 'other', label: 'Другое' },
];

/** words that usually mean someone is trying to take the deal out of Trusty */
export const OFFSITE = /(@[a-z0-9_]{4,}|t\.me\/|в\s?лс|в\s?личк|напрямую|без\s+(гаранта|комисси)|на\s+карт|\+7\d|\b\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\b)/i;
