// Telegram-бот: приветствие и кнопка мини-аппа, оплата звёздами, ручные выводы и админ-панель.
// Работает через long polling, поэтому не требует отдельного адреса для вебхука.
// Документация: https://core.telegram.org/bots/api

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const fmt = (n) => new Intl.NumberFormat('ru-RU').format(n);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dateFmt = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
const fullName = (u) => [u.first_name, u.last_name].filter(Boolean).join(' ') || 'Игрок';
const btn = (text, data) => ({ text, callback_data: data });

export class Bot {
  constructor({ token, webAppUrl, adminId, supportUsername, limits, store }) {
    this.token = token;
    this.webAppUrl = webAppUrl;
    this.adminId = adminId;
    this.supportUsername = supportUsername;
    this.limits = limits;
    this.store = store;
    this.onBalance = () => {}; // баланс изменился — мини-апп игрока обновится сам
    this.offset = 0;
    this.running = false;
    this.pending = new Map(); // chatId админа → чего бот ждёт от него следующим сообщением
    this.broadcasting = false;
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
    const commands = [
      { command: 'start', description: 'Открыть Roulette Arena' },
      { command: 'paysupport', description: 'Помощь с оплатой' },
    ];
    await this.api('setMyCommands', { commands });
    if (this.adminId) {
      // Команда /admin видна в меню только администратору
      await this.api('setMyCommands', {
        commands: [{ command: 'admin', description: 'Админ-панель' }, ...commands],
        scope: { type: 'chat', chat_id: Number(this.adminId) },
      }).catch((e) => console.warn('Меню админа:', e.message));
    }
    await this.api('setChatMenuButton', {
      menu_button: { type: 'web_app', text: 'Играть', web_app: { url: this.webAppUrl } },
    });
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
    return { inline_keyboard: [[{ text, web_app: { url: this.webAppUrl } }]] };
  }

  async handleUpdate(update) {
    if (update.callback_query) return this.#onCallback(update.callback_query);
    if (update.pre_checkout_query) return this.#onPreCheckout(update.pre_checkout_query);
    const msg = update.message;
    if (!msg || msg.chat.type !== 'private') return;
    if (msg.successful_payment) return this.#onPaid(msg);

    const user = this.store.upsertUser(msg.from); // все, кто писал боту, попадают в рассылку
    const text = msg.text ?? '';
    const admin = this.#isAdmin(msg.from.id);

    if (admin && this.pending.has(msg.chat.id) && !text.startsWith('/')) return this.#onAdminInput(msg);
    if (text.startsWith('/')) this.pending.delete(msg.chat.id);
    if (!text) return;

    if (user.blocked && !admin) {
      const contact = this.supportUsername ? ` Если это ошибка — напишите @${esc(this.supportUsername)}.` : '';
      return this.#send(msg.chat.id, `🚫 Ваш аккаунт заблокирован.${contact}`);
    }
    if (admin && /^\/admin\b/.test(text)) return this.#sendPanel(msg.chat.id);
    if (/^\/paysupport\b/.test(text)) {
      const contact = this.supportUsername ? `@${esc(this.supportUsername)}` : 'администратору бота';
      return this.#send(
        msg.chat.id,
        `Вопросы по оплате и выводу — напишите ${contact}.\nВаш ID: <code>${msg.from.id}</code>`,
      );
    }
    return this.#send(msg.chat.id, this.#welcomeText(msg.from), this.playButton());
  }

  #welcomeText(from) {
    return (
      `🎰 <b>Roulette Arena</b>\n\n` +
      `Привет, ${esc(from.first_name || 'игрок')}! Здесь крутится колесо, а банк забирает один.\n\n` +
      `• Делайте ставку звёздами — чем она больше, тем шире ваш сектор\n` +
      `• Раунд стартует, как только в игре двое, — 15 секунд на ставки\n` +
      `• Победитель забирает весь банк раунда\n` +
      `• Пополнение — звёздами Telegram, вывод — от ${fmt(this.limits.minWithdraw ?? 50)} ⭐\n\n` +
      `Жмите «Играть» 👇`
    );
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
    if (scope !== 'wd' && scope !== 'adm') return answer();
    if (!this.#isAdmin(cq.from.id)) return answer('Недоступно', true);
    return scope === 'wd' ? this.#onWithdrawalButton(cq, answer) : this.#onAdminButton(cq, answer);
  }

  // ====================== Админ-панель ======================

  #panelKeyboard() {
    return {
      inline_keyboard: [
        [btn('🔎 Найти игрока', 'adm:find'), btn('📣 Рассылка', 'adm:bcast')],
        [btn('🔄 Обновить', 'adm:stats')],
      ],
    };
  }

  #panelText() {
    const s = this.store.stats();
    const dep = (p) => `${fmt(s.deposits[p].n)} · <b>${fmt(s.deposits[p].sum)} ⭐</b>`;
    const games = (p) => `${fmt(s.games[p].n)} · оборот ${fmt(s.games[p].turnover)} ⭐ · доход ${fmt(s.games[p].income)} ⭐`;
    return (
      `🛠 <b>Админ-панель</b>\n\n` +
      `👥 <b>Пользователи: ${fmt(s.users)}</b>\n` +
      `Новые: ${fmt(s.newUsers.day)} за 24 ч · ${fmt(s.newUsers.week)} за 7 дн · ${fmt(s.newUsers.month)} за 30 дн\n\n` +
      `💳 <b>Пополнения</b>\n` +
      `24 часа: ${dep('day')}\n` +
      `7 дней: ${dep('week')}\n` +
      `30 дней: ${dep('month')}\n\n` +
      `🎰 <b>Игры</b>\n` +
      `24 часа: ${games('day')}\n` +
      `7 дней: ${games('week')}\n` +
      `30 дней: ${games('month')}\n\n` +
      `⏳ Заявки на вывод: <b>${fmt(s.pending.n)}</b>` +
      (s.pending.n ? ` на ${fmt(s.pending.sum)} ⭐` : '')
    );
  }

  #sendPanel(chatId) {
    return this.#send(chatId, this.#panelText(), this.#panelKeyboard());
  }

  #userCard(u) {
    const sum = this.store.userSummary(u.id);
    const nick = u.username ? `@${esc(u.username)}` : '<i>без ника</i>';
    return (
      `👤 <b><a href="tg://user?id=${u.id}">${esc(fullName(u))}</a></b> · ${nick}\n` +
      `ID: <code>${u.id}</code>\n` +
      `Статус: ${u.blocked ? '🚫 <b>заблокирован</b>' : '✅ активен'}\n\n` +
      `Баланс: <b>${fmt(u.balance)} ⭐</b>\n` +
      `Игры: ${fmt(u.games)} · победы: ${fmt(u.wins)} · поражения: ${fmt(u.losses)}\n` +
      `Пополнено: ${fmt(sum.deposits.sum)} ⭐ (${fmt(sum.deposits.n)} раз)\n` +
      `Выведено: ${fmt(sum.withdrawn)} ⭐\n` +
      `С нами с ${dateFmt.format(u.created_at)}`
    );
  }

  #userKeyboard(u) {
    return {
      inline_keyboard: [
        [
          btn('💰 Изменить баланс', `adm:bal:${u.id}`),
          u.blocked ? btn('✅ Разблокировать', `adm:unblock:${u.id}`) : btn('🚫 Заблокировать', `adm:block:${u.id}`),
        ],
        [btn('🔄 Обновить', `adm:user:${u.id}`), btn('🔎 Другой игрок', 'adm:find')],
      ],
    };
  }

  async #onAdminButton(cq, answer) {
    const [, action, rawId] = cq.data.split(':');
    const chatId = cq.message.chat.id;
    const id = Number(rawId);

    switch (action) {
      case 'stats':
        await this.#edit(cq.message, this.#panelText(), this.#panelKeyboard());
        return answer('Обновлено');

      case 'find':
        await answer();
        return this.#ask(chatId, { kind: 'find' }, '🔎 Напишите ник игрока (например @nickname) или его Telegram ID.', '@ник или ID');

      case 'user': {
        const u = this.store.getUser(id);
        if (!u) return answer('Пользователь не найден', true);
        await this.#edit(cq.message, this.#userCard(u), this.#userKeyboard(u));
        return answer('Обновлено');
      }

      case 'block':
      case 'unblock': {
        const u = this.store.setBlocked(id, action === 'block');
        if (!u) return answer('Пользователь не найден', true);
        await this.#edit(cq.message, this.#userCard(u), this.#userKeyboard(u));
        return answer(action === 'block' ? 'Заблокирован' : 'Разблокирован');
      }

      case 'bal': {
        const u = this.store.getUser(id);
        if (!u) return answer('Пользователь не найден', true);
        await answer();
        return this.#ask(
          chatId,
          { kind: 'balance', userId: id, card: cq.message },
          `💰 Баланс ${esc(fullName(u))}: <b>${fmt(u.balance)} ⭐</b>\n\n` +
            `Напишите число:\n<code>5</code> — добавить 5 ⭐\n<code>-5</code> — отнять 5 ⭐`,
          'Например 100 или -50',
        );
      }

      case 'bcast': {
        if (this.broadcasting) return answer('Рассылка уже идёт', true);
        await answer();
        const n = this.store.broadcastIds().length;
        return this.#ask(
          chatId,
          { kind: 'broadcast' },
          `📣 Отправьте сообщение для рассылки — текст, фото, видео или GIF с подписью.\n` +
            `Его получат <b>${fmt(n)}</b> пользователей. Перед отправкой я покажу, как оно выглядит.`,
          'Сообщение для рассылки',
        );
      }

      case 'bsend': {
        const state = this.pending.get(chatId);
        if (state?.kind !== 'broadcastConfirm') return answer('Рассылка устарела', true);
        if (this.broadcasting) return answer('Рассылка уже идёт', true);
        this.pending.delete(chatId);
        await answer('Рассылка запущена');
        this.#runBroadcast(cq.message, state.sourceMessageId).catch((e) => console.error('Рассылка:', e.message));
        return;
      }

      case 'bcancel':
        this.pending.delete(chatId);
        await this.#edit(cq.message, '✖️ Рассылка отменена.');
        return answer();
    }
    return answer();
  }

  /** Ответы админа на вопросы бота: ник для поиска, сумма, причина отмены, сообщение для рассылки. */
  async #onAdminInput(msg) {
    const chatId = msg.chat.id;
    const state = this.pending.get(chatId);
    const text = (msg.text ?? '').trim();

    if (state.kind === 'cancelReason') {
      this.pending.delete(chatId);
      return this.#finishCancel(msg, state);
    }

    if (state.kind === 'find') {
      const u = this.store.findUser(text);
      if (!u) {
        return this.#send(chatId, `Не нашёл «${esc(text)}». Проверьте ник или ID и напишите ещё раз.`, {
          force_reply: true,
          input_field_placeholder: '@ник или ID',
        });
      }
      this.pending.delete(chatId);
      return this.#send(chatId, this.#userCard(u), this.#userKeyboard(u));
    }

    if (state.kind === 'balance') {
      if (!/^[+-]?\d{1,7}$/.test(text.replace(/\s/g, '')) || Number(text.replace(/\s/g, '')) === 0) {
        return this.#send(chatId, 'Нужно число, например <code>100</code> или <code>-50</code>.', {
          force_reply: true,
          input_field_placeholder: 'Например 100 или -50',
        });
      }
      this.pending.delete(chatId);
      const delta = Number(text.replace(/\s/g, ''));
      const { user, applied } = this.store.adjustBalance(state.userId, delta);
      this.onBalance(user);
      let result;
      if (applied > 0) result = `✅ Добавлено <b>${fmt(applied)} ⭐</b>`;
      else if (applied < 0 && -applied === -delta) result = `✅ Списано <b>${fmt(-applied)} ⭐</b>`;
      else if (applied < 0) result = `✅ Списано <b>${fmt(-applied)} ⭐</b> — больше на балансе не было`;
      else result = 'Баланс нулевой — списывать нечего';
      await this.#send(chatId, `${result}\nБаланс ${esc(fullName(user))}: <b>${fmt(user.balance)} ⭐</b>`, undefined, {
        reply_parameters: { message_id: msg.message_id },
      });
      if (state.card) await this.#edit(state.card, this.#userCard(user), this.#userKeyboard(user)).catch(() => {});
      return;
    }

    if (state.kind === 'broadcast' || state.kind === 'broadcastConfirm') {
      const n = this.store.broadcastIds().length;
      this.pending.set(chatId, { kind: 'broadcastConfirm', sourceMessageId: msg.message_id });
      return this.#send(
        chatId,
        `👆 Так увидят сообщение пользователи (с кнопкой «Играть»).\nОтправить <b>${fmt(n)}</b> пользователям?`,
        { inline_keyboard: [[btn('✅ Отправить', 'adm:bsend'), btn('✖️ Отмена', 'adm:bcancel')]] },
        { reply_parameters: { message_id: msg.message_id } },
      );
    }
  }

  /** Рассылка копией сообщения админа: ~20 сообщений в секунду, в фоне, с отчётом. */
  async #runBroadcast(statusMessage, sourceMessageId) {
    this.broadcasting = true;
    const ids = this.store.broadcastIds();
    let sent = 0;
    let failed = 0;
    await this.#edit(statusMessage, `📣 Рассылка идёт… 0 из ${fmt(ids.length)}`);
    try {
      for (const [i, id] of ids.entries()) {
        try {
          await this.api('copyMessage', {
            chat_id: id,
            from_chat_id: statusMessage.chat.id,
            message_id: sourceMessageId,
            reply_markup: this.playButton(),
          });
          sent++;
        } catch {
          failed++; // пользователь заблокировал бота или удалил аккаунт
        }
        if ((i + 1) % 100 === 0) await this.#edit(statusMessage, `📣 Рассылка идёт… ${fmt(i + 1)} из ${fmt(ids.length)}`).catch(() => {});
        await sleep(50);
      }
    } finally {
      this.broadcasting = false;
    }
    await this.#edit(
      statusMessage,
      `✅ <b>Рассылка завершена</b>\nДоставлено: ${fmt(sent)}\nНе доставлено: ${fmt(failed)} (заблокировали бота)`,
    );
  }

  // ====================== Пополнение звёздами (XTR) ======================
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
      n <= this.limits.maxAmount &&
      !this.store.getUser(q.from.id)?.blocked;
    await this.api('answerPreCheckoutQuery', {
      pre_checkout_query_id: q.id,
      ok,
      ...(ok ? {} : { error_message: 'Оплата недоступна. Откройте пополнение в приложении ещё раз.' }),
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
    await this.#send(msg.chat.id, `Баланс пополнен на <b>${fmt(p.total_amount)} ⭐</b>`, this.playButton('Открыть игру'));
  }

  // ====================== Заявки на вывод ======================

  /** Новая заявка → сообщение администратору с кнопками. */
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
      const done = this.store.markWithdrawalSent(id);
      if (!done) return answer('Заявка уже обработана');
      await this.#closeAdminMessage(done, '✅ <b>Отправлено</b>');
      await answer('Отмечено как отправлено');
      await this.#notifyUser(done.user_id, `✅ Вывод <b>${fmt(done.amount)} ⭐</b> выполнен. Заявка #${done.id}.`);
      return;
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

  async #finishCancel(msg, { withdrawalId, promptId }) {
    const reason = (msg.text ?? '').trim().slice(0, 300);
    if (!reason) {
      return this.#ask(msg.chat.id, { kind: 'cancelReason', withdrawalId }, 'Причина нужна текстом. Напишите её ещё раз.', 'Причина отмены');
    }
    const w = this.store.cancelWithdrawal(withdrawalId, reason);
    if (!w) return this.#send(msg.chat.id, `Заявка #${withdrawalId} уже обработана.`);
    this.onBalance(this.store.getUser(w.user_id));
    await this.#closeAdminMessage(w, `✖️ <b>Отменено</b>\nПричина: ${esc(reason)}`);
    await this.api('deleteMessage', { chat_id: msg.chat.id, message_id: promptId }).catch(() => {});
    await this.#send(msg.chat.id, `Заявка #${w.id} отменена, ${fmt(w.total)} ⭐ возвращено игроку.`, undefined, {
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
    await this.#edit(
      { chat: { id: w.admin_chat_id }, message_id: w.admin_message_id },
      this.#withdrawalText(w, user, footer),
    ).catch((e) => console.error('editMessageText:', e.message));
  }

  async #notifyUser(userId, html) {
    // Игрок мог не запускать бота или заблокировать его — статус всё равно виден в приложении.
    await this.#send(userId, html, this.playButton('Открыть игру')).catch(() => {});
  }
}
