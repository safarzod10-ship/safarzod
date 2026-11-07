import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../server/db.js';
import { validateInitData, signInitData } from '../server/auth.js';
import { Game } from '../server/game.js';
import { Bot } from '../server/bot.js';

const TOKEN = '123456:TEST-token';
const settings = { countdownMs: 30, spinMs: 30, resultMs: 30, houseCut: 0.1, houseFreeUpTo: 9, minBet: 1 };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 2000) {
  const t0 = Date.now();
  while (!fn()) {
    if (Date.now() - t0 > ms) throw new Error('timeout');
    await wait(5);
  }
}
const user = (id, name = `U${id}`) => ({ id, first_name: name, username: `u${id}` });

function storeWith(...balances) {
  const store = openDb(':memory:');
  balances.forEach((b, i) => {
    store.upsertUser(user(i + 1));
    if (b) store.creditPayment({ chargeId: `seed-${i}`, userId: i + 1, amount: b, payload: 'seed' });
  });
  return store;
}

test('initData: верная подпись принимается, подделка и устаревшие данные — нет', () => {
  const now = Date.now();
  const fields = { auth_date: String(Math.floor(now / 1000)), query_id: 'AAE', signature: 'sig', user: JSON.stringify(user(42)) };
  const data = signInitData(fields, TOKEN);
  assert.equal(validateInitData(data, TOKEN).id, 42);
  assert.equal(validateInitData(data, 'other:token'), null);
  assert.equal(validateInitData(data.replace('%2242%22', '%2243%22').replace('42', '43'), TOKEN), null);
  const old = signInitData({ ...fields, auth_date: String(Math.floor(now / 1000) - 2 * 86400) }, TOKEN);
  assert.equal(validateInitData(old, TOKEN), null);
  assert.equal(validateInitData('', TOKEN), null);
});

test('раунд: ожидание → отсчёт → вращение → банк 90% победителю, статистика', async () => {
  const store = storeWith(1000, 1000);
  const game = new Game(store, settings, { random: (n) => (n === 10_000 ? 5000 : 0) }); // билет 0 → первый игрок
  game.start();
  game.placeBet(store.getUser(1), 300);
  assert.equal(game.publicState().status, 'waiting');
  game.placeBet(store.getUser(2), 700);
  const s = game.publicState();
  assert.equal(s.status, 'countdown');
  assert.equal(s.bank, 900);
  await until(() => game.publicState().status === 'spinning');
  assert.throws(() => game.placeBet(store.getUser(2), 1), /розыгрыш/);
  const landing = game.publicState().landing;
  assert.ok(landing > 0 && landing < 0.3, 'стрелка внутри сектора победителя (0..0.3)');
  await until(() => game.publicState().status === 'finished');
  const u1 = store.getUser(1);
  const u2 = store.getUser(2);
  assert.equal(u1.balance, 1000 - 300 + 900);
  assert.equal(u2.balance, 300);
  assert.deepEqual([u1.games, u1.wins, u1.losses, u2.games, u2.wins, u2.losses], [1, 1, 0, 1, 0, 1]);
  await until(() => game.publicState().status === 'waiting');
  assert.equal(game.publicState().players.length, 0);
  game.stop();
});

test('ставка больше баланса отклоняется и не попадает в раунд', () => {
  const store = storeWith(50);
  const game = new Game(store, settings);
  game.start();
  assert.throws(() => game.placeBet(store.getUser(1), 51), /Недостаточно/);
  assert.equal(game.publicState().players.length, 0);
  assert.equal(store.getUser(1).balance, 50);
  game.stop();
});

test('после перезапуска ставки незавершённого раунда возвращаются', () => {
  const store = storeWith(100);
  const game = new Game(store, settings);
  game.start();
  game.placeBet(store.getUser(1), 40);
  game.stop();
  assert.equal(store.getUser(1).balance, 60);
  assert.equal(store.refundOpenRounds(), 1);
  assert.equal(store.getUser(1).balance, 100);
});

test('оплата звёздами зачисляется ровно один раз', () => {
  const store = storeWith(0);
  assert.equal(store.creditPayment({ chargeId: 'ch1', userId: 1, amount: 250, payload: 'dep:1:250:1' }).balance, 250);
  assert.equal(store.creditPayment({ chargeId: 'ch1', userId: 1, amount: 250, payload: 'dep:1:250:1' }), null);
  assert.equal(store.getUser(1).balance, 250);
});

function fakeBot(store) {
  const bot = new Bot({ token: TOKEN, webAppUrl: 'https://x.test/', adminId: '999', limits: { minDeposit: 1, maxAmount: 1e6 }, store });
  bot.calls = [];
  bot.api = async (method, payload) => {
    bot.calls.push({ method, payload });
    return method === 'sendMessage' ? { message_id: bot.calls.length, chat: { id: payload.chat_id } } : true;
  };
  return bot;
}

test('вывод: админ нажимает «Отправлено» → статус успешный, игрок получает сообщение', async () => {
  const store = storeWith(100);
  const bot = fakeBot(store);
  const { withdrawal } = store.withdraw(1, 50, 5);
  assert.equal(store.getUser(1).balance, 45);
  await bot.notifyWithdrawal(withdrawal, store.getUser(1));
  const card = bot.calls.find((c) => c.method === 'sendMessage');
  assert.equal(card.payload.chat_id, '999');
  assert.match(card.payload.text, /@u1/);
  assert.match(card.payload.text, /50/);

  await bot.handleUpdate({ callback_query: { id: 'q', from: { id: 999 }, data: `wd:sent:${withdrawal.id}`, message: { chat: { id: 999 }, message_id: 1 } } });
  assert.equal(store.getWithdrawal(withdrawal.id).status, 'sent');
  assert.ok(bot.calls.some((c) => c.method === 'sendMessage' && c.payload.chat_id === 1 && /выполнен/.test(c.payload.text)));
  // повторное нажатие ничего не меняет
  await bot.handleUpdate({ callback_query: { id: 'q2', from: { id: 999 }, data: `wd:sent:${withdrawal.id}`, message: { chat: { id: 999 }, message_id: 1 } } });
  assert.equal(store.getUser(1).balance, 45);
});

test('вывод: «Отмена» → админ пишет причину → звёзды возвращаются, игрок видит причину', async () => {
  const store = storeWith(100);
  const bot = fakeBot(store);
  const { withdrawal } = store.withdraw(1, 50, 5);
  await bot.notifyWithdrawal(withdrawal, store.getUser(1));
  await bot.handleUpdate({ callback_query: { id: 'q', from: { id: 999 }, data: `wd:cancel:${withdrawal.id}`, message: { chat: { id: 999 }, message_id: 1 } } });
  assert.equal(store.getWithdrawal(withdrawal.id).status, 'pending', 'до причины заявка не закрыта');
  await bot.handleUpdate({ message: { message_id: 5, chat: { id: 999, type: 'private' }, from: { id: 999 }, text: 'Неверный ник' } });
  const w = store.getWithdrawal(withdrawal.id);
  assert.equal(w.status, 'cancelled');
  assert.equal(w.reason, 'Неверный ник');
  assert.equal(store.getUser(1).balance, 100);
  assert.equal(store.userWithdrawals(1)[0].reason, 'Неверный ник');
  assert.ok(bot.calls.some((c) => c.payload.chat_id === 1 && /Неверный ник/.test(c.payload.text)));
});

test('чужой пользователь не может обработать заявку', async () => {
  const store = storeWith(100);
  const bot = fakeBot(store);
  const { withdrawal } = store.withdraw(1, 50, 5);
  await bot.handleUpdate({ callback_query: { id: 'q', from: { id: 1 }, data: `wd:sent:${withdrawal.id}`, message: { chat: { id: 1 }, message_id: 1 } } });
  assert.equal(store.getWithdrawal(withdrawal.id).status, 'pending');
});

test('pre_checkout: принимается только корректный счёт XTR своего пользователя', async () => {
  const bot = fakeBot(storeWith(0));
  const q = (over) => ({ pre_checkout_query: { id: 'p', from: { id: 1 }, currency: 'XTR', total_amount: 100, invoice_payload: 'dep:1:100:1', ...over } });
  await bot.handleUpdate(q({}));
  await bot.handleUpdate(q({ total_amount: 99 }));
  await bot.handleUpdate(q({ from: { id: 2 } }));
  const answers = bot.calls.filter((c) => c.method === 'answerPreCheckoutQuery').map((c) => c.payload.ok);
  assert.deepEqual(answers, [true, false, false]);
});

// ---------- Админ-панель ----------
const adminMsg = (text, id = 100) => ({ message: { message_id: id, chat: { id: 999, type: 'private' }, from: { id: 999, first_name: 'Admin' }, text } });
const adminTap = (data) => ({ callback_query: { id: 'cb', from: { id: 999 }, data, message: { chat: { id: 999 }, message_id: 77 } } });
const lastText = (bot) => [...bot.calls].reverse().find((c) => c.payload.text)?.payload.text ?? '';

test('/admin отвечает только администратору и показывает статистику', async () => {
  const store = storeWith(100);
  store.creditPayment({ chargeId: 'p1', userId: 1, amount: 40, payload: 'dep:1:40:1' });
  const bot = fakeBot(store);
  await bot.handleUpdate({ message: { message_id: 1, chat: { id: 1, type: 'private' }, from: { id: 1, first_name: 'U1' }, text: '/admin' } });
  assert.doesNotMatch(lastText(bot), /Админ-панель/);
  await bot.handleUpdate(adminMsg('/admin'));
  const text = lastText(bot);
  assert.match(text, /Админ-панель/);
  assert.match(text, /Пользователи: 2/); // игрок + сам админ
  assert.match(text, /24 часа: 2 · <b>140 ⭐/);
});

test('поиск по нику → карточка; баланс: +5 добавляет, −N не уходит ниже нуля', async () => {
  const store = storeWith(2);
  const bot = fakeBot(store);
  await bot.handleUpdate(adminTap('adm:find'));
  await bot.handleUpdate(adminMsg('@U1'));
  assert.match(lastText(bot), /ID: <code>1<\/code>/);

  await bot.handleUpdate(adminTap('adm:bal:1'));
  await bot.handleUpdate(adminMsg('5'));
  assert.equal(store.getUser(1).balance, 7);
  await bot.handleUpdate(adminTap('adm:bal:1'));
  await bot.handleUpdate(adminMsg('-10'));
  assert.equal(store.getUser(1).balance, 0);
  assert.ok(bot.calls.some((c) => /Списано <b>7/.test(c.payload.text ?? '')));
  await bot.handleUpdate(adminTap('adm:bal:1'));
  await bot.handleUpdate(adminMsg('-5'));
  assert.equal(store.getUser(1).balance, 0);
  assert.ok(bot.calls.some((c) => /Баланс нулевой/.test(c.payload.text ?? '')));
});

test('неизвестный ник — понятный ответ, поиск продолжается', async () => {
  const bot = fakeBot(storeWith(0));
  await bot.handleUpdate(adminTap('adm:find'));
  await bot.handleUpdate(adminMsg('@nobody'));
  assert.match(lastText(bot), /Не нашёл/);
  await bot.handleUpdate(adminMsg('1'));
  assert.match(lastText(bot), /ID: <code>1<\/code>/);
});

test('блокировка: кнопка меняется, бот и оплата закрыты для игрока, разблокировка возвращает доступ', async () => {
  const store = storeWith(10);
  const bot = fakeBot(store);
  await bot.handleUpdate(adminTap('adm:block:1'));
  assert.equal(store.getUser(1).blocked, 1);
  const edit = [...bot.calls].reverse().find((c) => c.method === 'editMessageText');
  assert.ok(JSON.stringify(edit.payload.reply_markup).includes('Разблокировать'));
  await bot.handleUpdate({ message: { message_id: 2, chat: { id: 1, type: 'private' }, from: { id: 1, first_name: 'U1' }, text: '/start' } });
  assert.match(lastText(bot), /заблокирован/);
  await bot.handleUpdate({ pre_checkout_query: { id: 'p', from: { id: 1 }, currency: 'XTR', total_amount: 5, invoice_payload: 'dep:1:5:1' } });
  assert.equal(bot.calls.at(-1).payload.ok, false);
  await bot.handleUpdate(adminTap('adm:unblock:1'));
  assert.equal(store.getUser(1).blocked, 0);
});

test('рассылка: предпросмотр → подтверждение → копия всем незаблокированным', async () => {
  const store = storeWith(0, 0, 0);
  store.setBlocked(3, true);
  const bot = fakeBot(store);
  await bot.handleUpdate(adminTap('adm:bcast'));
  await bot.handleUpdate(adminMsg('Новый турнир сегодня!', 555));
  assert.match(lastText(bot), /Отправить/);
  await bot.handleUpdate(adminTap('adm:bsend'));
  await until(() => !bot.broadcasting && bot.calls.some((c) => /Рассылка завершена/.test(c.payload.text ?? '')));
  const copies = bot.calls.filter((c) => c.method === 'copyMessage');
  assert.deepEqual(copies.map((c) => c.payload.chat_id).sort(), [1, 2, 999]);
  assert.ok(copies.every((c) => c.payload.message_id === 555));
});

test('/start: баннер с подписью, синяя «Играть», канал, чат, поддержка; баннер загружается один раз', async () => {
  const store = storeWith(0);
  const bot = new Bot({
    token: TOKEN, webAppUrl: 'https://x.test/', adminId: '999', supportUsername: 'bob_proger',
    channelUrl: 'https://t.me/safroulette', chatUrl: 'https://t.me/safroulette_chat',
    bannerPath: new URL('../public/banner.jpg', import.meta.url).pathname, limits: { minDeposit: 1, maxAmount: 1e6 }, store,
  });
  // перехватываем сеть: проверяем настоящий multipart-запрос, который ушёл бы в Telegram
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const method = url.split('/').pop();
    const body = init.body instanceof FormData ? Object.fromEntries(init.body) : JSON.parse(init.body);
    sent.push({ method, body });
    const result = method === 'sendPhoto' ? { message_id: 1, chat: { id: 1 }, photo: [{ file_id: 'small' }, { file_id: 'BIG' }] } : true;
    return { json: async () => ({ ok: true, result }) };
  };
  try {
    const start = { message: { message_id: 1, chat: { id: 1, type: 'private' }, from: { id: 1, first_name: 'U1' }, text: '/start' } };
    await bot.handleUpdate(start);
    await bot.handleUpdate(start);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(sent.length, 2);
  const [first, second] = sent;
  assert.equal(first.method, 'sendPhoto');
  assert.ok(first.body.photo instanceof Blob && first.body.photo.size > 50_000, 'картинка загружена файлом');
  assert.match(first.body.caption, /ROULETTE ARENA<\/b> — рулетка в Telegram!/);
  const kb = JSON.parse(first.body.reply_markup).inline_keyboard;
  assert.deepEqual(kb[0][0], { text: '🎮 Играть', web_app: { url: 'https://x.test/' }, style: 'primary' });
  assert.deepEqual(kb[1].map((b) => b.url), ['https://t.me/safroulette', 'https://t.me/safroulette_chat']);
  assert.equal(kb[2][0].url, 'https://t.me/bob_proger');
  assert.equal(second.body.photo, 'BIG', 'повторно — по file_id, без загрузки');
});

test('банк: до 9 включительно без комиссии, от 10 — минус 10%', async () => {
  const { bankOf } = await import('../server/game.js');
  assert.equal(bankOf(2, 0.1), 2); // 1 + 1 — победитель забирает всё
  assert.equal(bankOf(8, 0.1), 8);
  assert.equal(bankOf(9, 0.1), 9);
  assert.equal(bankOf(10, 0.1), 9); // пример: ставки 10 → банк 9
  assert.equal(bankOf(15, 0.1), 14);
  assert.equal(bankOf(20, 0.1), 18);
  assert.equal(bankOf(500, 0.1), 450);
  assert.equal(bankOf(1800, 0.1), 1620);
  for (let t = 10; t < 5000; t++) assert.equal(bankOf(t, 0.1), t - Math.floor(t / 10));
});

test('задания: награда один раз, удалённое задание недоступно', () => {
  const store = storeWith(0);
  const t = store.addTask({ kind: 'link', title: 'Перейти', url: 'https://example.com', reward: 10 });
  assert.equal(store.userTasks(1)[0].done, false);
  assert.equal(store.completeTask(t.id, 1).balance, 10);
  assert.equal(store.completeTask(t.id, 1), null);
  assert.equal(store.getUser(1).balance, 10);
  assert.equal(store.userTasks(1)[0].done, true);
  store.disableTask(t.id);
  assert.equal(store.userTasks(1).length, 0);
  assert.throws(() => store.completeTask(t.id, 1), /недоступно/);
});

test('админ добавляет задание: ссылка → награда; канал без прав бота → засчитывается за переход', async () => {
  const store = storeWith(0);
  const bot = fakeBot(store);
  bot.botId = 777;
  const base = bot.api;
  bot.api = async (method, payload) => {
    if (method === 'getChat') return { id: -100, type: 'channel', title: 'Мой канал' };
    if (method === 'getChatMember') return { status: payload.user_id === 777 ? 'administrator' : 'left' };
    return base(method, payload);
  };
  await bot.handleUpdate(adminTap('adm:taskadd'));
  await bot.handleUpdate(adminMsg('https://t.me/my_channel'));
  assert.match(lastText(bot), /Подписаться на «Мой канал»[\s\S]*проверяться автоматически/);
  await bot.handleUpdate(adminMsg('25'));
  const [task] = store.activeTasks();
  assert.deepEqual([task.kind, task.chat_ref, task.reward], ['subscribe', '@my_channel', 25]);
  assert.equal(await bot.isMember('@my_channel', 1), false);

  bot.api = async (method, payload) => {
    if (method === 'getChat') return { id: -100, type: 'channel', title: 'Чужой' };
    if (method === 'getChatMember') return { status: 'left' };
    return base(method, payload);
  };
  await bot.handleUpdate(adminTap('adm:taskadd'));
  await bot.handleUpdate(adminMsg('@other_chan'));
  assert.match(lastText(bot), /не администратор канала/);
  await bot.handleUpdate(adminMsg('5'));
  assert.equal(store.activeTasks()[0].kind, 'link');

  await bot.handleUpdate(adminTap(`adm:taskdel:${task.id}`));
  assert.equal(store.activeTasks().length, 1);
});

// ---------- Рефералы ----------
function refBot(store, members = new Set()) {
  const bot = fakeBot(store);
  bot.refPercent = 15;
  const base = bot.api;
  bot.api = async (method, payload) => {
    if (method === 'getChatMember') return { status: members.has(payload.user_id) ? 'member' : 'left' };
    return base(method, payload);
  };
  bot.upload = async () => ({ photo: [{ file_id: 'F' }] });
  return bot;
}
const startFrom = (id, text) => ({ message: { message_id: 1, chat: { id, type: 'private' }, from: { id, first_name: `F${id}` }, text } });

test('реферал: новый пользователь по ссылке привязывается; старый и сам себя — нет', async () => {
  const store = storeWith(0); // пригласивший — id 1
  const bot = refBot(store);
  await bot.handleUpdate(startFrom(50, '/start ref_1'));
  assert.equal(store.getUser(50).referrer_id, 1);
  await wait(20); // уведомление пригласившему уходит в фоне
  assert.ok(bot.calls.some((c) => c.payload.chat_id === 1 && /Новый друг/.test(c.payload.text ?? '')));
  await bot.handleUpdate(startFrom(50, '/start ref_2')); // повторно — не перепривязывается
  assert.equal(store.getUser(50).referrer_id, 1);
  store.upsertUser({ id: 60, first_name: 'Old' });
  await bot.handleUpdate(startFrom(60, '/start ref_1')); // уже был в базе
  assert.equal(store.getUser(60).referrer_id, null);
  await bot.handleUpdate(startFrom(1, '/start ref_1'));
  assert.equal(store.getUser(1).referrer_id, null);
  assert.equal(store.friends(1).n, 1);
});

test('реферал: 15% с каждого пополнения друга, дробные части копятся, повтор платежа не удваивает', async () => {
  const store = storeWith(0); // пригласивший — id 1
  const bot = refBot(store);
  await bot.handleUpdate(startFrom(50, '/start ref_1'));
  const pay = (id, amount) =>
    bot.handleUpdate({
      message: {
        message_id: 9, chat: { id: 50, type: 'private' }, from: { id: 50, first_name: 'F50' },
        successful_payment: { currency: 'XTR', total_amount: amount, telegram_payment_charge_id: id, invoice_payload: `dep:50:${amount}:1` },
      },
    });
  await pay('c1', 100);
  assert.equal(store.getUser(1).balance, 15);
  assert.ok(bot.calls.some((c) => c.payload.chat_id === 1 && /пополнил баланс — вам <b>\+15 ⭐/.test(c.payload.text ?? '')));
  await pay('c1', 100); // тот же платёж повторно
  assert.equal(store.getUser(1).balance, 15);
  await pay('c2', 3); // 103 × 15% = 15.45 → пока ничего
  assert.equal(store.getUser(1).balance, 15);
  await pay('c3', 4); // 107 × 15% = 16.05 → +1
  assert.equal(store.getUser(1).balance, 16);
  assert.equal(store.getUser(50).balance, 107, 'друг получает пополнение полностью');
  const f = store.friends(1);
  assert.deepEqual([f.n, f.earned, f.list[0].earned], [1, 16, 16]);
});

test('реферал: пополнение без пригласившего никому ничего не начисляет', () => {
  const store = storeWith(0, 0);
  const u = store.creditPayment({ chargeId: 'x', userId: 2, amount: 100, payload: 'dep', refPercent: 15 });
  assert.equal(u.referral, null);
  assert.equal(store.getUser(1).balance, 0);
});

test('вывод: без подписки на канал — понятная ошибка; с подпиской — можно; сбой проверки — не пускает', async () => {
  const store = storeWith(0);
  const members = new Set();
  const bot = refBot(store, members);
  await assert.rejects(bot.assertSubscribed('@safroulette', 1), (e) => e.code === 'NOT_SUBSCRIBED' && /@safroulette/.test(e.message));
  members.add(1);
  await bot.assertSubscribed('@safroulette', 1);
  bot.api = async () => {
    throw new Error('400 Bad Request: member list is inaccessible');
  };
  await assert.rejects(bot.assertSubscribed('@safroulette', 1), (e) => e.code === 'CHECK_FAILED');
});

test('startapp: параметр из подписанного initData доступен серверу, подделка ломает подпись', () => {
  const fields = { auth_date: String(Math.floor(Date.now() / 1000)), start_param: 'ref_1', user: JSON.stringify(user(77)) };
  const data = signInitData(fields, TOKEN);
  const u = validateInitData(data, TOKEN);
  assert.deepEqual([u.id, u.startParam], [77, 'ref_1']);
  assert.equal(validateInitData(data.replace('ref_1', 'ref_2'), TOKEN), null);
  assert.equal(validateInitData(signInitData({ ...fields, start_param: undefined }, TOKEN).replace('start_param=undefined&', ''), TOKEN), null);
});

test('оборот перед выводом: пополнение ×3, бонусы ×10, возвраты ставок не засчитываются', () => {
  const store = storeWith(1000);
  const opts = { deposit: 3, bonus: 10 };
  assert.deepEqual(store.wager(1, opts), { required: 3000, done: 0, left: 3000 });
  store.tx(() => {
    store.ledgerDebit(1, 500, 'crash_bet', 1);
    store.ledgerCredit(1, 100, 'crash_refund', 1);
    store.ledgerDebit(1, 5, 'basket_entry', 1);
    store.ledgerCredit(1, 20, 'task', 1);
  });
  assert.deepEqual(store.wager(1, opts), { required: 3200, done: 405, left: 2795 });
  store.tx(() => store.ledgerCredit(1, 5000, 'admin', 0)); // ручное начисление админа не добавляет оборот
  store.tx(() => store.ledgerDebit(1, 2795, 'crash_bet', 2));
  assert.deepEqual(store.wager(1, opts), { required: 3200, done: 3200, left: 0 });
});
