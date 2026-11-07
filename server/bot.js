import { readFile } from 'node:fs/promises';
import { AppError } from './db.js';
import { basename } from 'node:path';

const WELCOME =
  '🎲 <b>ROULETTE ARENA</b> — рулетка в Telegram!\n\n' +
  '⭐ Участвуй в раундах, соревнуйся с другими игроками и побеждай!\n\n' +
  '🎯 Чем больше твоя доля, тем выше шанс на победу.\n' +
  '🏆 Испытай удачу и стань победителем!\n\n' +
  '👇 Жми «Играть», чтобы начать!';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const fmt = (n) => new Intl.NumberFormat('ru-RU').format(n);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fullName = (u) => [u.first_name, u.last_name].filter(Boolean).join(' ') || 'Игрок';
const btn = (text, data) => ({ text, callback_data: data });
const link = (text, url) => ({ text, url });

export class Bot {
  constructor({
    token,
    webAppUrl,
    adminId,
    supportUsername,
    channelUrl,
    chatUrl,
    bannerPath,
    refPercent = 15,
    limits,
    store,
  }) {
    this.token = token;
    this.webAppUrl = webAppUrl;
    this.adminId = adminId;
    this.supportUsername = supportUsername;
    this.channelUrl = channelUrl;
    this.chatUrl = chatUrl;
    this.bannerPath = bannerPath;
    this.refPercent = refPercent;
    this.bannerFileId = null;
    this.limits = limits;
    this.store = store;
    this.onBalance = () => {};
    this.offset = 0;
    this.running = false;
    this.pending = new Map();
    this.broadcastState = { running: false, total: 0, sent: 0, failed: 0 };
  }

  async api(method, payload = {}) {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(65_000),
      });
      const data = await res.json();
      if (data.ok) return data.result;
      const retry = data.parameters?.retry_after;
      if (retry && attempt < 3) {
        await sleep(retry * 1000);
        continue;
      }
      throw new Error(`${method}: ${data.error_code} ${data.description}`);
    }
  }

  async upload(method, payload, field, filePath) {
    return this.uploadBuffer(method, payload, field, await readFile(filePath), basename(filePath));
  }

  async uploadBuffer(method, payload, field, buffer, filename) {
    const form = new FormData();
    for (const [k, v] of Object.entries(payload)) form.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
    form.append(field, new Blob([buffer]), filename);
    const res = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(65_000),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(`${method}: ${data.error_code} ${data.description}`);
    return data.result;
  }

  async start() {
    const me = await this.api('getMe');
    this.username = me.username;
    this.botId = me.id;
    await this.api('deleteWebhook', { drop_pending_updates: false });
    const commands = [
      { command: 'start', description: 'Открыть Roulette Arena' },
      { command: 'paysupport', description: 'Помощь с оплатой' },
    ];
    await this.api('setMyCommands', { commands });
    if (this.adminId) {
      await this.api('setMyCommands', {
        commands: [{ command: 'admin', description: 'Админ-панель' }, ...commands],
        scope: { type: 'chat', chat_id: Number(this.adminId) },
      }).catch((e) => console.warn('Меню админа:', e.message));
    }
    await this.api('setChatMenuButton', { menu_button: { type: 'default' } });
    await this.api('setMyShortDescription', {
      short_description: 'Roulette Arena — рулетка на звёзды: победитель забирает весь банк.',
    }).catch(() => {});
    console.log(`Бот @${me.username} запущен. Мини-апп: ${this.webAppUrl}`);
    if (!this.adminId) console.warn('ADMIN_ID не задан — админ-панель и заявки на вывод недоступны.');
    this.running = true;
    this.#poll();
  }

  stop() {
    this.running = false;
  }

  async #poll() {
    let backoff = 1000;
    while (this.running) {
      try {
        const updates = await this.api('getUpdates', {
          offset: this.offset,
          timeout: 50,
          allowed_updates: ['message', 'callback_query', 'pre_checkout_query'],
        });
        backoff = 1000;
        for (const u of updates) {
          this.offset = u.update_id + 1;
          await this.handleUpdate(u).catch((e) => console.error('Ошибка обработки апдейта:', e.message));
        }
      } catch (e) {
        console.error('getUpdates:', e.message);
        await sleep(backoff);
        backoff = Math.min(backoff * 2, 30_000);
      }
    }
  }

  #isAdmin(id) {
    return !!this.adminId && String(id) === String(this.adminId);
  }

  playButton(text = '🎮 Играть') {
    return { inline_keyboard: [[{ text, web_app: { url: this.webAppUrl }, style: 'primary' }]] };
  }

  #welcomeKeyboard() {
    const rows = [[{ text: '🎮 Играть', web_app: { url: this.webAppUrl }, style: 'primary' }]];
    const community = [];
    if (this.channelUrl) community.push(link('📢 Канал', this.channelUrl));
    if (this.chatUrl) community.push(link('💬 Чат', this.chatUrl));
    if (community.length) rows.push(community);
    if (this.supportUsername) rows.push([link('🛟 Поддержка', `https://t.me/${this.supportUsername}`)]);
    return { inline_keyboard: rows };
  }

  async #sendWelcome(chatId) {
    const payload = { chat_id: chatId, caption: WELCOME, parse_mode: 'HTML', reply_markup: this.#welcomeKeyboard() };
    try {
      if (this.bannerFileId) return await this.api('sendPhoto', { ...payload, photo: this.bannerFileId });
      if (this.bannerPath) {
        const msg = await this.upload('sendPhoto', payload, 'photo', this.bannerPath);
        this.bannerFileId = msg.photo?.at(-1)?.file_id ?? null;
        return msg;
      }
    } catch (e) {
      console.error('Баннер не отправился, отправляю текстом:', e.message);
    }
    return this.#send(chatId, WELCOME, this.#welcomeKeyboard());
  }

  async handleUpdate(update) {
    if (update.callback_query) return this.#onCallback(update.callback_query);
    if (update.pre_checkout_query) return this.#onPreCheckout(update.pre_checkout_query);
    const msg = update.message;
    if (!msg || msg.chat.type !== 'private') return;
    if (msg.successful_payment) return this.#onPaid(msg);

    const isNew = !this.store.getUser(msg.from.id);
    const user = this.store.upsertUser(msg.from);
    const text = msg.text ?? '';
    const ref = text.match(/^\/start\s+ref_(\d{1,15})$/);
    if (ref && isNew && this.store.setReferrer(user.id, Number(ref[1]))) {
      this.onInvited(this.store.getUser(user.id)).catch(() => {});
    }
    const admin = this.#isAdmin(msg.from.id);

    if (admin && this.pending.has(msg.chat.id) && !text.startsWith('/')) return this.#onAdminInput(msg);
    if (text.startsWith('/')) this.pending.delete(msg.chat.id);
    if (!text) return;

    if (user.blocked && !admin) {
      const contact = this.supportUsername ? ` Если это ошибка — напишите @${esc(this.supportUsername)}.` : '';
      return this.#send(msg.chat.id, `🚫 Ваш аккаунт заблокирован.${contact}`);
    }
    if (admin && /^\/admin\b/.test(text)) {
      return this.#send(msg.chat.id, 'Админ-панель открывается в приложении.', {
        inline_keyboard: [
          [
            {
              text: 'Открыть админ-панель',
              web_app: { url: `${this.webAppUrl.replace(/\/$/, '')}/#admin` },
              style: 'primary',
            },
          ],
        ],
      });
    }
    if (/^\/paysupport\b/.test(text)) {
      const contact = this.supportUsername ? `@${esc(this.supportUsername)}` : 'администратору бота';
      return this.#send(
        msg.chat.id,
        `Вопросы по оплате и выводу — напишите ${contact}.\nВаш ID: <code>${msg.from.id}</code>`,
      );
    }
    return this.#sendWelcome(msg.chat.id);
  }

  #send(chatId, html, replyMarkup, extra = {}) {
    return this.api('sendMessage', {
      chat_id: chatId,
      text: html,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      ...extra,
    });
  }

  #edit(message, html, replyMarkup) {
    return this.api('editMessageText', {
      chat_id: message.chat.id,
      message_id: message.message_id,
      text: html,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      reply_markup: replyMarkup ?? { inline_keyboard: [] },
    }).catch((e) => {
      if (!/not modified/.test(e.message)) throw e;
    });
  }

  async #ask(chatId, state, html, placeholder) {
    const prompt = await this.#send(chatId, html, { force_reply: true, input_field_placeholder: placeholder });
    this.pending.set(chatId, { ...state, promptId: prompt.message_id });
  }

  async #onCallback(cq) {
    const [scope] = (cq.data ?? '').split(':');
    const answer = (text, alert = false) =>
      this.api('answerCallbackQuery', { callback_query_id: cq.id, ...(text ? { text, show_alert: alert } : {}) });
    if (scope !== 'wd') return answer();
    if (!this.#isAdmin(cq.from.id)) return answer('Недоступно', true);
    return this.#onWithdrawalButton(cq, answer);
  }

  referralLink(userId) {
    return `https://t.me/${this.username}?startapp=ref_${userId}`;
  }

  async onInvited(friend) {
    const inviter = this.store.getUser(friend.referrer_id);
    if (!inviter) return;
    await this.#send(
      inviter.id,
      `👋 Новый друг по вашей ссылке: <b>${esc(fullName(friend))}</b>.\n` +
        `Вы будете получать <b>${fmt(this.refPercent)}%</b> с каждого пополнения друга.`,
    ).catch(() => {});
  }

  async #notifyReferralIncome(friend, referral) {
    const inviter = this.store.getUser(referral.inviterId);
    if (!inviter) return;
    this.onBalance(inviter);
    await this.#send(
      inviter.id,
      `💸 Друг <b>${esc(fullName(friend))}</b> пополнил баланс — вам <b>+${fmt(referral.amount)} ⭐</b> (${fmt(this.refPercent)}%)`,
      this.playButton('Открыть игру'),
    ).catch(() => {});
  }

  async describeTaskLink(raw) {
    let url = raw.trim();
    if (/^@[A-Za-z0-9_]{4,}$/.test(url)) url = `https://t.me/${url.slice(1)}`;
    if (/^t\.me\//i.test(url)) url = `https://${url}`;
    let parsed;
    try {
      parsed = new URL(url);
      if (!/^https?:$/.test(parsed.protocol)) throw new Error();
    } catch {
      return null;
    }
    const tg = /^(t\.me|telegram\.me)$/i.test(parsed.hostname)
      ? parsed.pathname.match(/^\/([A-Za-z0-9_]{4,})\/?$/)
      : null;
    if (!tg) return { kind: 'link', url, title: `Перейти на ${parsed.hostname.replace(/^www\./, '')}`, note: '' };

    const ref = `@${tg[1]}`;
    let chat;
    try {
      chat = await this.api('getChat', { chat_id: ref });
    } catch {
      return {
        kind: 'link',
        url,
        title: `Перейти в ${ref}`,
        note: `⚠️ Не нашёл ${esc(ref)} — задание будет засчитываться за переход по ссылке.`,
      };
    }
    const isChannel = chat.type === 'channel';
    const title = isChannel ? `Подписаться на «${chat.title}»` : `Вступить в чат «${chat.title}»`;
    let canCheck = false;
    try {
      const m = await this.api('getChatMember', { chat_id: ref, user_id: this.botId });
      canCheck = m.status === 'administrator' || (!isChannel && m.status === 'member');
    } catch {}
    if (canCheck)
      return { kind: 'subscribe', url, chatRef: ref, title, note: '✅ Подписка будет проверяться автоматически.' };
    return {
      kind: 'link',
      url,
      title,
      note:
        `⚠️ Бот не ${isChannel ? 'администратор канала' : 'участник чата'} ${esc(ref)}, поэтому подписку проверить нельзя — ` +
        'задание засчитывается за переход. Чтобы включить проверку, добавьте бота и создайте задание заново.',
    };
  }

  async assertSubscribed(channel, userId) {
    if (!channel) return;
    let member;
    try {
      member = await this.isMember(channel, userId);
    } catch (e) {
      console.error(`Проверка подписки на ${channel} не удалась (бот — админ канала?):`, e.message);
      throw new AppError('CHECK_FAILED', 'Не удалось проверить подписку. Попробуйте через минуту', 503);
    }
    if (!member) throw new AppError('NOT_SUBSCRIBED', `Для вывода подпишитесь на канал ${channel}`, 403);
  }

  async isMember(chatRef, userId) {
    const m = await this.api('getChatMember', { chat_id: chatRef, user_id: userId });
    return ['creator', 'administrator', 'member'].includes(m.status) || (m.status === 'restricted' && m.is_member);
  }

  async #onAdminInput(msg) {
    const state = this.pending.get(msg.chat.id);
    this.pending.delete(msg.chat.id);
    if (state?.kind === 'cancelReason') return this.#finishCancel(msg, state);
  }

  broadcastStatus() {
    return { ...this.broadcastState };
  }

  async broadcast({ text, photo }) {
    if (this.broadcastState.running) throw new AppError('BUSY', 'Рассылка уже идёт', 409);
    const ids = this.store.broadcastIds();
    const html = esc(text);
    let photoId = null;
    if (photo) {
      const probe = await this.uploadBuffer(
        'sendPhoto',
        { chat_id: this.adminId, caption: html, parse_mode: 'HTML', reply_markup: this.playButton() },
        'photo',
        photo,
        'image.jpg',
      );
      photoId = probe.photo?.at(-1)?.file_id;
    }
    this.broadcastState = { running: true, total: ids.length, sent: 0, failed: 0, startedAt: Date.now() };
    const state = this.broadcastState;
    (async () => {
      for (const id of ids) {
        try {
          if (photoId)
            await this.api('sendPhoto', {
              chat_id: id,
              photo: photoId,
              caption: html,
              parse_mode: 'HTML',
              reply_markup: this.playButton(),
            });
          else await this.#send(id, html, this.playButton());
          state.sent++;
        } catch {
          state.failed++;
        }
        await sleep(50);
      }
    })()
      .catch((e) => console.error('broadcast:', e.message))
      .finally(() => {
        state.running = false;
        state.finishedAt = Date.now();
      });
    return this.broadcastStatus();
  }

  async message(userId, text) {
    try {
      await this.#send(userId, esc(text), this.playButton('Открыть игру'));
      return true;
    } catch {
      return false;
    }
  }

  createDepositLink(userId, amount) {
    return this.api('createInvoiceLink', {
      title: 'Пополнение баланса',
      description: `${fmt(amount)} ⭐ на баланс Roulette Arena`,
      payload: `dep:${userId}:${amount}:${Date.now()}`,
      currency: 'XTR',
      prices: [{ label: 'Пополнение', amount }],
    });
  }

  async #onPreCheckout(q) {
    const [kind, userId, amount] = (q.invoice_payload ?? '').split(':');
    const n = Number(amount);
    const ok =
      kind === 'dep' &&
      q.currency === 'XTR' &&
      String(q.from.id) === userId &&
      n === q.total_amount &&
      Number.isSafeInteger(n) &&
      n >= this.limits.minDeposit &&
      n <= this.limits.maxAmount &&
      !this.store.getUser(q.from.id)?.blocked;
    await this.api('answerPreCheckoutQuery', {
      pre_checkout_query_id: q.id,
      ok,
      ...(ok ? {} : { error_message: 'Оплата недоступна. Откройте пополнение в приложении ещё раз.' }),
    });
  }

  async #onPaid(msg) {
    const p = msg.successful_payment;
    if (p.currency !== 'XTR') return;
    this.store.upsertUser(msg.from);
    const user = this.store.creditPayment({
      chargeId: p.telegram_payment_charge_id,
      userId: msg.from.id,
      amount: p.total_amount,
      payload: p.invoice_payload,
      refPercent: this.refPercent,
    });
    if (!user) return;
    this.onBalance(user);
    await this.#send(
      msg.chat.id,
      `Баланс пополнен на <b>${fmt(p.total_amount)} ⭐</b>`,
      this.playButton('Открыть игру'),
    );
    if (user.referral) await this.#notifyReferralIncome(user, user.referral);
  }

  async notifyWithdrawal(w, user) {
    if (!this.adminId) return;
    const msg = await this.#send(this.adminId, this.#withdrawalText(w, user), {
      inline_keyboard: [[btn('✅ Отправлено', `wd:sent:${w.id}`), btn('✖️ Отмена', `wd:cancel:${w.id}`)]],
    });
    this.store.setWithdrawalAdminMessage(w.id, msg.chat.id, msg.message_id);
  }

  #withdrawalText(w, user, footer = '') {
    const nick = user.username ? `@${esc(user.username)}` : '<i>без ника</i>';
    return (
      `💸 <b>Заявка на вывод #${w.id}</b>\n\n` +
      `Игрок: <a href="tg://user?id=${user.id}">${esc(fullName(user))}</a> · ${nick}\n` +
      `ID: <code>${user.id}</code>\n\n` +
      `К отправке: <b>${fmt(w.amount)} ⭐</b>\n` +
      `Комиссия: ${fmt(w.fee)} ⭐ · Списано с баланса: ${fmt(w.total)} ⭐` +
      (footer ? `\n\n${footer}` : '')
    );
  }

  async #onWithdrawalButton(cq, answer) {
    const [, action, rawId] = cq.data.split(':');
    const id = Number(rawId);
    const w = this.store.getWithdrawal(id);
    if (!w || w.status !== 'pending') {
      await answer('Заявка уже обработана');
      return this.api('editMessageReplyMarkup', {
        chat_id: cq.message.chat.id,
        message_id: cq.message.message_id,
        reply_markup: { inline_keyboard: [] },
      }).catch(() => {});
    }

    if (action === 'sent') {
      const done = await this.completeWithdrawal(id);
      return answer(done ? 'Отмечено как отправлено' : 'Заявка уже обработана');
    }
    if (action === 'cancel') {
      await answer();
      return this.#ask(
        cq.message.chat.id,
        { kind: 'cancelReason', withdrawalId: id },
        `Напишите причину отмены заявки #${id}. Её увидит игрок.`,
        'Причина отмены',
      );
    }
    return answer();
  }

  async completeWithdrawal(id) {
    const done = this.store.markWithdrawalSent(id);
    if (!done) return null;
    await this.#closeAdminMessage(done, '✅ <b>Отправлено</b>');
    await this.#notifyUser(done.user_id, `✅ Вывод <b>${fmt(done.amount)} ⭐</b> выполнен. Заявка #${done.id}.`);
    return done;
  }

  async cancelWithdrawal(id, reason) {
    const w = this.store.cancelWithdrawal(id, reason);
    if (!w) return null;
    this.onBalance(this.store.getUser(w.user_id));
    await this.#closeAdminMessage(w, `✖️ <b>Отменено</b>\nПричина: ${esc(reason)}`);
    await this.#notifyUser(
      w.user_id,
      `✖️ Заявка на вывод #${w.id} отменена.\nПричина: ${esc(reason)}\n\n${fmt(w.total)} ⭐ возвращено на баланс.`,
    );
    return w;
  }

  async #finishCancel(msg, { withdrawalId, promptId }) {
    const reason = (msg.text ?? '').trim().slice(0, 300);
    if (!reason) {
      return this.#ask(
        msg.chat.id,
        { kind: 'cancelReason', withdrawalId },
        'Причина нужна текстом. Напишите её ещё раз.',
        'Причина отмены',
      );
    }
    const w = await this.cancelWithdrawal(withdrawalId, reason);
    if (!w) return this.#send(msg.chat.id, `Заявка #${withdrawalId} уже обработана.`);
    await this.api('deleteMessage', { chat_id: msg.chat.id, message_id: promptId }).catch(() => {});
    await this.#send(msg.chat.id, `Заявка #${w.id} отменена, ${fmt(w.total)} ⭐ возвращено игроку.`, undefined, {
      reply_parameters: { message_id: msg.message_id },
    });
  }

  async #closeAdminMessage(w, footer) {
    if (!w.admin_message_id) return;
    const user = this.store.getUser(w.user_id) ?? { id: w.user_id };
    await this.#edit(
      { chat: { id: w.admin_chat_id }, message_id: w.admin_message_id },
      this.#withdrawalText(w, user, footer),
    ).catch((e) => console.error('editMessageText:', e.message));
  }

  notifyAdmin(html) {
    if (!this.adminId) return Promise.resolve();
    return this.#send(this.adminId, html).catch(() => {});
  }

  notifyUser(userId, html) {
    return this.#notifyUser(userId, html);
  }

  async #notifyUser(userId, html) {
    await this.#send(userId, html, this.playButton('Открыть игру')).catch(() => {});
  }
}
