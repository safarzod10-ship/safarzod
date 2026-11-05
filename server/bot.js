// Telegram-бот: открывает мини-апп и обслуживает ручные выводы для администратора.
// Работает через long polling, поэтому не требует отдельного адреса для вебхука.
// Документация: https://core.telegram.org/bots/api

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const fmt = (n) => new Intl.NumberFormat('ru-RU').format(n);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Bot {
  constructor({ token, webAppUrl, adminId, supportUsername, limits, store }) {
    this.token = token;
    this.webAppUrl = webAppUrl;
    this.adminId = adminId;
    this.supportUsername = supportUsername;
    this.limits = limits;
    this.store = store;
    this.onBalance = () => {}; // вызывается после зачисления оплаты (обновление клиента)
    this.offset = 0;
    this.running = false;
    this.awaitingReason = new Map(); // adminChatId → { withdrawalId, promptMessageId }
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

  async start() {
    const me = await this.api('getMe');
    this.username = me.username;
    await this.api('deleteWebhook', { drop_pending_updates: false });
    await this.api('setMyCommands', {
      commands: [
        { command: 'start', description: 'Открыть Roulette Arena' },
        { command: 'paysupport', description: 'Помощь с оплатой' },
      ],
    });
    await this.api('setChatMenuButton', {
      menu_button: { type: 'web_app', text: 'Играть', web_app: { url: this.webAppUrl } },
    });
    await this.api('setMyShortDescription', { short_description: 'Roulette Arena — рулетка, где банк забирает один.' }).catch(() => {});
    console.log(`Бот @${me.username} запущен. Мини-апп: ${this.webAppUrl}`);
    if (!this.adminId) console.warn('ADMIN_ID не задан — заявки на вывод некому отправлять.');
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
    return this.adminId && String(id) === String(this.adminId);
  }

  async handleUpdate(update) {
    if (update.callback_query) return this.#onCallback(update.callback_query);
    if (update.pre_checkout_query) return this.#onPreCheckout(update.pre_checkout_query);
    const msg = update.message;
    if (msg?.successful_payment) return this.#onPaid(msg);
    if (!msg?.text || msg.chat.type !== 'private') return;

    if (this.#isAdmin(msg.from.id) && this.awaitingReason.has(msg.chat.id) && !msg.text.startsWith('/')) {
      return this.#finishCancel(msg);
    }
    if (msg.text.startsWith('/')) this.awaitingReason.delete(msg.chat.id);

    if (msg.text.startsWith('/paysupport')) {
      const contact = this.supportUsername ? `@${esc(this.supportUsername)}` : 'администратору бота';
      return this.api('sendMessage', {
        chat_id: msg.chat.id,
        text: `Вопросы по оплате и выводу: напишите ${contact}. Укажите ваш ID: <code>${msg.from.id}</code>.`,
        parse_mode: 'HTML',
      });
    }

    await this.api('sendMessage', {
      chat_id: msg.chat.id,
      text:
        '<b>Roulette Arena</b>\n\n' +
        'Делайте ставку, ждите соперников и забирайте весь банк раунда. ' +
        'Чем больше ставка — тем больше ваш сектор на колесе.',
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: 'Открыть игру', web_app: { url: this.webAppUrl } }]] },
    });
  }

  // ---------- Пополнение звёздами (XTR) ----------
  // https://core.telegram.org/bots/payments-stars

  /** Ссылка на счёт; мини-апп открывает её через Telegram.WebApp.openInvoice. */
  createDepositLink(userId, amount) {
    return this.api('createInvoiceLink', {
      title: 'Пополнение баланса',
      description: `${fmt(amount)} ⭐ на баланс Roulette Arena`,
      payload: `dep:${userId}:${amount}:${Date.now()}`,
      currency: 'XTR',
      prices: [{ label: 'Пополнение', amount }],
    });
  }

  /** Telegram спрашивает, можно ли принять оплату (ответить нужно за 10 секунд). */
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
      n <= this.limits.maxAmount;
    await this.api('answerPreCheckoutQuery', {
      pre_checkout_query_id: q.id,
      ok,
      ...(ok ? {} : { error_message: 'Счёт устарел. Откройте пополнение в приложении ещё раз.' }),
    });
  }

  /** Оплата прошла — зачисляем звёзды на баланс (один раз на платёж). */
  async #onPaid(msg) {
    const p = msg.successful_payment;
    if (p.currency !== 'XTR') return;
    this.store.upsertUser(msg.from);
    const user = this.store.creditPayment({
      chargeId: p.telegram_payment_charge_id,
      userId: msg.from.id,
      amount: p.total_amount,
      payload: p.invoice_payload,
    });
    if (!user) return; // уже зачислено
    this.onBalance(user);
    await this.api('sendMessage', {
      chat_id: msg.chat.id,
      text: `Баланс пополнен на <b>${fmt(p.total_amount)} ⭐</b>`,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: 'Открыть игру', web_app: { url: this.webAppUrl } }]] },
    });
  }

  // ---------- Заявки на вывод ----------

  /** Новая заявка → сообщение администратору с кнопками. */
  async notifyWithdrawal(w, user) {
    if (!this.adminId) return;
    const msg = await this.api('sendMessage', {
      chat_id: this.adminId,
      text: this.#withdrawalText(w, user),
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Отправлено', callback_data: `wd:sent:${w.id}` },
            { text: '✖️ Отмена', callback_data: `wd:cancel:${w.id}` },
          ],
        ],
      },
    });
    this.store.setWithdrawalAdminMessage(w.id, msg.chat.id, msg.message_id);
  }

  #withdrawalText(w, user, footer = '') {
    const name = [user.first_name, user.last_name].filter(Boolean).join(' ') || 'Игрок';
    const nick = user.username ? `@${esc(user.username)}` : '<i>без ника</i>';
    return (
      `💸 <b>Заявка на вывод #${w.id}</b>\n\n` +
      `Игрок: <a href="tg://user?id=${user.id}">${esc(name)}</a> · ${nick}\n` +
      `ID: <code>${user.id}</code>\n\n` +
      `К отправке: <b>${fmt(w.amount)} ⭐</b>\n` +
      `Комиссия: ${fmt(w.fee)} ⭐ · Списано с баланса: ${fmt(w.total)} ⭐` +
      (footer ? `\n\n${footer}` : '')
    );
  }

  async #onCallback(cq) {
    const [scope, action, rawId] = (cq.data ?? '').split(':');
    if (scope !== 'wd') return this.api('answerCallbackQuery', { callback_query_id: cq.id });
    if (!this.#isAdmin(cq.from.id)) {
      return this.api('answerCallbackQuery', { callback_query_id: cq.id, text: 'Недоступно', show_alert: true });
    }
    const id = Number(rawId);
    const w = this.store.getWithdrawal(id);
    if (!w || w.status !== 'pending') {
      await this.api('answerCallbackQuery', { callback_query_id: cq.id, text: 'Заявка уже обработана' });
      return this.api('editMessageReplyMarkup', {
        chat_id: cq.message.chat.id,
        message_id: cq.message.message_id,
        reply_markup: { inline_keyboard: [] },
      }).catch(() => {});
    }

    if (action === 'sent') {
      const done = this.store.markWithdrawalSent(id);
      if (!done) return this.api('answerCallbackQuery', { callback_query_id: cq.id, text: 'Заявка уже обработана' });
      await this.#closeAdminMessage(done, '✅ <b>Отправлено</b>');
      await this.api('answerCallbackQuery', { callback_query_id: cq.id, text: 'Отмечено как отправлено' });
      await this.#notifyUser(done.user_id, `✅ Вывод <b>${fmt(done.amount)} ⭐</b> выполнен. Заявка #${done.id}.`);
      return;
    }

    if (action === 'cancel') {
      const prompt = await this.api('sendMessage', {
        chat_id: cq.message.chat.id,
        text: `Напишите причину отмены заявки #${id}. Её увидит игрок.`,
        reply_markup: { force_reply: true, input_field_placeholder: 'Причина отмены' },
      });
      this.awaitingReason.set(cq.message.chat.id, { withdrawalId: id, promptMessageId: prompt.message_id });
      return this.api('answerCallbackQuery', { callback_query_id: cq.id });
    }
    return this.api('answerCallbackQuery', { callback_query_id: cq.id });
  }

  async #finishCancel(msg) {
    const { withdrawalId, promptMessageId } = this.awaitingReason.get(msg.chat.id);
    this.awaitingReason.delete(msg.chat.id);
    const reason = msg.text.trim().slice(0, 300);
    const w = this.store.cancelWithdrawal(withdrawalId, reason);
    if (!w) {
      return this.api('sendMessage', { chat_id: msg.chat.id, text: `Заявка #${withdrawalId} уже обработана.` });
    }
    await this.#closeAdminMessage(w, `✖️ <b>Отменено</b>\nПричина: ${esc(reason)}`);
    await this.api('deleteMessage', { chat_id: msg.chat.id, message_id: promptMessageId }).catch(() => {});
    await this.api('sendMessage', {
      chat_id: msg.chat.id,
      text: `Заявка #${w.id} отменена, ${fmt(w.total)} ⭐ возвращено игроку.`,
      reply_parameters: { message_id: msg.message_id },
    });
    await this.#notifyUser(
      w.user_id,
      `✖️ Заявка на вывод #${w.id} отменена.\nПричина: ${esc(reason)}\n\n${fmt(w.total)} ⭐ возвращено на баланс.`,
    );
  }

  async #closeAdminMessage(w, footer) {
    if (!w.admin_message_id) return;
    const user = this.store.getUser(w.user_id) ?? { id: w.user_id };
    await this.api('editMessageText', {
      chat_id: w.admin_chat_id,
      message_id: w.admin_message_id,
      text: this.#withdrawalText(w, user, footer),
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [] },
    }).catch((e) => console.error('editMessageText:', e.message));
  }

  async #notifyUser(userId, html) {
    // Игрок мог не запускать бота или заблокировать его — статус всё равно виден в приложении.
    await this.api('sendMessage', {
      chat_id: userId,
      text: html,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: 'Открыть игру', web_app: { url: this.webAppUrl } }]] },
    }).catch(() => {});
  }
}
