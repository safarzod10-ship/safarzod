/**
 * Telegram: Bot API calls, bot setup, webhook (/start, /city, /help,
 * Stars payments), invoices and inactivity reminders.
 */
import { CRYSTAL_PACKS } from '../src/game/config.ts';
import { cityLevelLabel } from '../src/game/rules.ts';
import type { TgUser } from './auth.ts';
import { ensureUser, getUser } from './db.ts';
import type { Env } from './env.ts';
import { ApiFail, isUniqueFail, json, readJson } from './http.ts';

// ---------------------------------------------------------------- texts

export const TEXTS = {
  description:
    'TERRIA — общий континент на 1000 мест. Получи бесплатно свой участок, построй город и преврати маленькое поселение в мегаполис.\n\n' +
    '🏗 Строй дома, фермы, лесопилки, шахты и заводы\n' +
    '🗺 Расширяй землю и развивай экономику\n' +
    '💱 Торгуй на рынке и на бирже с живыми игроками\n' +
    '🏆 Соревнуйся с соседями по континенту\n\n' +
    'Играть можно полностью бесплатно. Кристаллы за Telegram Stars — по желанию: для земли, лишнего строителя и украшений.',
  short: 'Свой город на общем континенте из 1000 участков. Строй, расширяйся, торгуй с игроками. Бесплатно.',
  start:
    '🌍 <b>Добро пожаловать в TERRIA!</b>\n\n' +
    'На континенте всего 1000 участков — один из них может стать твоим. Получи землю бесплатно, поставь ратушу, ' +
    'построй дома, фермы и мастерские, расширяй границы и торгуй с соседями на бирже.\n\n' +
    'Город работает, даже когда тебя нет: ресурсы копятся до 12 часов, ничего не разрушается.\n\n' +
    'Жми «Играть» 👇',
  help:
    '<b>Как играть в TERRIA</b>\n\n' +
    '🏠 Жилые кварталы дают жителей — они работают и платят налоги\n' +
    '🌾 Ферма кормит город, 🪵 лесопилка и 🪨 карьер дают материалы\n' +
    '🗺 Покупай соседние клетки, чтобы расширить город\n' +
    '🏛 Улучшай ратушу — она открывает новые здания и уровни\n' +
    '💱 Рынок: покупай и продавай по рыночной цене или выставляй свои заявки на бирже (заявка живёт 3 дня)\n' +
    '💎 Кристаллы за Telegram Stars не обязательны\n\n' +
    '/city — сводка по твоему городу',
  noCity: 'У тебя ещё нет города. Открой игру — участок выдаётся бесплатно 👇',
  other: 'Вся игра — в приложении 👇',
  paid: (n: number) => `💎 Начислено ${n} кристаллов. Спасибо за поддержку TERRIA!`,
  refunded: (n: number) => `Возврат оформлен, ${n} 💎 списано.`,
  reminder: (name: string, days: number) =>
    `🏚 Город «${escapeHtml(name)}» скучает без мэра.\n\nЕщё ${days} дн. без визита — и он станет заброшенным, ` +
    'а участок может достаться новому игроку. Загляни хотя бы на минуту — ресурсы уже накопились.',
  play: 'Играть',
};

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---------------------------------------------------------------- API

export async function tg<T = unknown>(env: Env, method: string, payload: Record<string, unknown>): Promise<T> {
  if (!env.BOT_TOKEN) throw new ApiFail(503, 'bot_not_configured');
  const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = (await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }))) as {
    ok: boolean;
    result?: T;
    description?: string;
  };
  if (!data.ok) throw new Error(`telegram ${method}: ${data.description ?? res.status}`);
  return data.result as T;
}

export async function webhookSecret(env: Env): Promise<string> {
  if (env.WEBHOOK_SECRET) return env.WEBHOOK_SECRET;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`terria-webhook:${env.BOT_TOKEN ?? ''}`));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 48);
}

const playButton = (env: Env) => ({ inline_keyboard: [[{ text: `🎮 ${TEXTS.play}`, web_app: { url: env.PUBLIC_URL } }]] });

export async function sendText(env: Env, chatId: number, text: string, withButton = true): Promise<void> {
  await tg(env, 'sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    ...(withButton ? { reply_markup: playButton(env) } : {}),
  });
}

// ---------------------------------------------------------------- setup

let setupDone = '';

/** Configure webhook, commands, descriptions and the menu button once per version. */
export async function ensureBotSetup(env: Env, force = false): Promise<boolean> {
  if (!env.BOT_TOKEN) return false;
  const want = `${env.BOT_SETUP_VERSION}|${env.PUBLIC_URL}`;
  if (!force && setupDone === want) return true;
  if (!force) {
    const row = await env.DB.prepare("SELECT value FROM meta WHERE key = 'bot_setup'").first<{ value: string }>();
    if (row?.value === want) {
      setupDone = want;
      return true;
    }
  }
  await tg(env, 'setWebhook', {
    url: `${env.PUBLIC_URL}/tg/webhook`,
    secret_token: await webhookSecret(env),
    allowed_updates: ['message', 'pre_checkout_query'],
  });
  await tg(env, 'setMyCommands', {
    commands: [
      { command: 'start', description: 'Играть' },
      { command: 'city', description: 'Мой город' },
      { command: 'help', description: 'Помощь' },
    ],
  });
  await tg(env, 'setMyDescription', { description: TEXTS.description });
  await tg(env, 'setMyShortDescription', { short_description: TEXTS.short });
  await tg(env, 'setChatMenuButton', { menu_button: { type: 'web_app', text: TEXTS.play, web_app: { url: env.PUBLIC_URL } } });
  await env.DB.prepare("INSERT INTO meta (key, value) VALUES ('bot_setup', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(want)
    .run();
  setupDone = want;
  return true;
}

// ---------------------------------------------------------------- shop

export function packList() {
  return CRYSTAL_PACKS;
}

export async function createInvoice(env: Env, req: Request, user: TgUser): Promise<{ link: string }> {
  const body = await readJson<{ pack?: unknown }>(req);
  const pack = CRYSTAL_PACKS.find((p) => p.id === body.pack);
  if (!pack) throw new ApiFail(400, 'bad_request');
  if (!env.BOT_TOKEN) throw new ApiFail(503, 'bot_not_configured');
  const nonce = crypto.randomUUID().slice(0, 8);
  const link = await tg<string>(env, 'createInvoiceLink', {
    title: `${pack.crystals} кристаллов`,
    description: `Пакет «${pack.label}»: ${pack.crystals} 💎 для земли, дополнительного строителя и украшений в TERRIA.`,
    payload: `${user.id}:${pack.id}:${nonce}`,
    provider_token: '',
    currency: 'XTR',
    prices: [{ label: `${pack.crystals} 💎`, amount: pack.stars }],
  });
  return { link };
}

// ---------------------------------------------------------------- webhook

interface TgMessage {
  message_id: number;
  from?: TgUser;
  chat: { id: number; type: string };
  text?: string;
  successful_payment?: { currency: string; total_amount: number; invoice_payload: string; telegram_payment_charge_id: string };
  refunded_payment?: { currency: string; total_amount: number; invoice_payload: string; telegram_payment_charge_id: string };
}
interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  pre_checkout_query?: { id: string; from: TgUser; currency: string; total_amount: number; invoice_payload: string };
}

function parsePayload(p: string): { userId: number; packId: string } | null {
  const [u, pack] = p.split(':');
  const userId = Number(u);
  if (!Number.isSafeInteger(userId) || !pack) return null;
  return { userId, packId: pack };
}

export async function handleWebhook(env: Env, req: Request, now: number): Promise<Response> {
  if (!env.BOT_TOKEN) return json({ ok: false }, 503);
  const secret = req.headers.get('x-telegram-bot-api-secret-token');
  if (secret !== (await webhookSecret(env))) return json({ ok: false }, 401);
  const update = (await req.json().catch(() => null)) as TgUpdate | null;
  if (!update) return json({ ok: true });

  if (update.pre_checkout_query) {
    const q = update.pre_checkout_query;
    const p = parsePayload(q.invoice_payload);
    const pack = p && CRYSTAL_PACKS.find((x) => x.id === p.packId);
    const user = p ? await getUser(env, p.userId) : null;
    const ok = !!(p && pack && user && q.currency === 'XTR' && q.total_amount === pack.stars && q.from.id === p.userId);
    await tg(env, 'answerPreCheckoutQuery', ok ? { pre_checkout_query_id: q.id, ok: true } : { pre_checkout_query_id: q.id, ok: false, error_message: 'Платёж не прошёл проверку, попробуйте ещё раз из игры.' });
    return json({ ok: true });
  }

  const msg = update.message;
  if (!msg) return json({ ok: true });

  if (msg.successful_payment) {
    // errors here bubble up as 500 so Telegram retries the update
    const sp = msg.successful_payment;
    const p = parsePayload(sp.invoice_payload);
    const pack = p && CRYSTAL_PACKS.find((x) => x.id === p.packId);
    if (!p || !pack) {
      console.error('payment with unknown payload', sp.invoice_payload, sp.telegram_payment_charge_id);
      return json({ ok: true });
    }
    if (msg.from) await ensureUser(env, msg.from, now);
    try {
      await env.DB.batch([
        env.DB.prepare('INSERT INTO payments (charge_id, user_id, pack, stars, crystals, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)').bind(
          sp.telegram_payment_charge_id,
          p.userId,
          pack.id,
          sp.total_amount,
          pack.crystals,
          now,
        ),
        env.DB.prepare('UPDATE users SET crystals = crystals + ?1 WHERE id = ?2').bind(pack.crystals, p.userId),
      ]);
      await sendText(env, msg.chat.id, TEXTS.paid(pack.crystals), true).catch(() => undefined);
    } catch (e) {
      if (!isUniqueFail(e)) throw e; // already credited
    }
    return json({ ok: true });
  }

  if (msg.refunded_payment) {
    const rp = msg.refunded_payment;
    const pay = await env.DB.prepare('SELECT * FROM payments WHERE charge_id = ?1')
      .bind(rp.telegram_payment_charge_id)
      .first<{ user_id: number; crystals: number; refunded: number }>();
    if (pay && !pay.refunded) {
      await env.DB.batch([
        env.DB.prepare('UPDATE payments SET refunded = 1 WHERE charge_id = ?1 AND refunded = 0').bind(rp.telegram_payment_charge_id),
        env.DB.prepare('UPDATE users SET crystals = MAX(0, crystals - ?1) WHERE id = ?2').bind(pay.crystals, pay.user_id),
      ]);
      await sendText(env, msg.chat.id, TEXTS.refunded(pay.crystals), false).catch(() => undefined);
    }
    return json({ ok: true });
  }

  if (msg.chat.type !== 'private' || !msg.from) return json({ ok: true });
  const text = (msg.text ?? '').trim();
  const cmd = text.split(/[\s@]/)[0].toLowerCase();
  try {
    if (cmd === '/start') {
      await ensureUser(env, msg.from, now);
      await env.DB.prepare('UPDATE users SET bot_chat = 1 WHERE id = ?1 AND bot_chat = 0').bind(msg.from.id).run();
      await sendText(env, msg.chat.id, TEXTS.start);
    } else if (cmd === '/help') {
      await sendText(env, msg.chat.id, TEXTS.help);
    } else if (cmd === '/city') {
      const c = await env.DB.prepare(
        'SELECT name, th, pop, status, coins FROM cities WHERE user_id = ?1',
      )
        .bind(msg.from.id)
        .first<{ name: string; th: number; pop: number; status: string; coins: number }>();
      if (!c) await sendText(env, msg.chat.id, TEXTS.noCity);
      else
        await sendText(
          env,
          msg.chat.id,
          `🏙 <b>${escapeHtml(c.name)}</b>\n${cityLevelLabel(c.th)} · ратуша ${c.th}\n👥 ${c.pop} жителей · 🪙 ${Math.floor(c.coins)}` +
            (c.status === 'abandoned' ? '\n\n🏚 Город заброшен — зайди, чтобы вернуть его к жизни.' : ''),
        );
    } else {
      await sendText(env, msg.chat.id, TEXTS.other);
    }
  } catch (e) {
    console.error('webhook message failed', e);
  }
  return json({ ok: true });
}
