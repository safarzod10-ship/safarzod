const $ = (id) => document.getElementById(id);
const fmt = (n) => new Intl.NumberFormat('ru-RU').format(Math.round(n ?? 0));
const gram = (nano) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 4 }).format((nano ?? 0) / 1e9);
const both = (xtr, g) => [`${fmt(xtr)} ⭐`, g ? `${gram(g)} Gram` : ''].filter(Boolean).join(' + ');
const sgnGram = (nano) => (nano > 0 ? `+${gram(nano)}` : nano < 0 ? `−${gram(-nano)}` : '0');
const signed = (n) => (n > 0 ? `+${fmt(n)}` : n < 0 ? `−${fmt(-n)}` : '0');
const dateTime = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});
const dateOnly = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
const when = (t) => (t ? dateTime.format(t) : '—');

const LEDGER = {
  deposit: 'Пополнение',
  bet: 'Рулетка · ставка',
  win: 'Рулетка · выигрыш',
  refund: 'Рулетка · возврат',
  crash_bet: 'Crash · ставка',
  crash_win: 'Crash · выигрыш',
  crash_refund: 'Crash · отмена ставки',
  basket_entry: 'Баскетбол · попытка',
  basket_prize: 'Баскетбол · приз дня',
  basket_refund: 'Баскетбол · возврат',
  withdraw: 'Заявка на вывод',
  withdraw_refund: 'Отмена вывода',
  referral: 'Реферальный бонус',
  ref_deposit: 'Доход с реферала',
  task: 'Задание',
  admin: 'Админ',
};
const GAMES = { roulette: 'Рулетка', crash: 'Racket Crash', basket: 'Basketball Rush' };
const STATUS = { pending: 'В обработке', sent: 'Отправлено', cancelled: 'Отменено' };

export function createAdmin({ api, haptic, toast, avatarHtml, esc, go, supports, tg }) {
  const s = {
    tab: 'users',
    query: '',
    users: [],
    total: 0,
    user: null,
    ledgerEnd: false,
    photo: null,
    poll: null,
    searchTimer: 0,
    onlineOnly: false,
  };

  const run = async (btn, fn) => {
    btn?.classList.add('loading');
    try {
      return await fn();
    } catch (e) {
      haptic.err();
      toast(e.message, 'err');
    } finally {
      btn?.classList.remove('loading');
    }
  };

  const confirmAsync = (text) =>
    new Promise((resolve) => (supports('6.2') ? tg.showConfirm(text, resolve) : resolve(window.confirm(text))));

  function setTab(tab) {
    s.tab = tab;
    document.querySelectorAll('#adm-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    document.querySelectorAll('.adm-pane').forEach((p) => (p.hidden = p.dataset.pane !== tab));
    clearInterval(s.poll);
    if (tab === 'users') loadUsers(true);
    if (tab === 'withdrawals') loadWithdrawals();
    if (tab === 'broadcast') loadBroadcast();
    if (tab === 'tasks') loadTasks();
    if (tab === 'stats') loadStats();
  }

  async function loadUsers(reset) {
    if (reset) {
      s.users = [];
      s.total = 0;
    }
    const data = await api('/api/admin/users', {
      query: s.query,
      offset: reset ? 0 : s.users.length,
      online: s.onlineOnly,
    }).catch((e) => toast(e.message, 'err'));
    if (!data) return;
    s.users = reset ? data.users : s.users.concat(data.users);
    s.total = data.total;
    $('adm-online-n').textContent = fmt(data.onlineCount ?? 0);
    renderUsers();
  }

  function renderUsers() {
    $('adm-count').textContent = `${fmt(s.total)} ${s.onlineOnly ? 'онлайн' : s.query ? 'найдено' : 'всего'}`;
    $('adm-users').innerHTML = s.users.length
      ? s.users
          .map(
            (u, i) => `<button class="adm-row" data-user="${u.id}">
              <span class="adm-rank num">${i + 1}</span><span class="adm-av${u.online ? ' online' : ''}">${avatarHtml(u, 'xs')}</span>
              <span class="adm-who"><b>${esc(u.name)}</b><small>${u.username ? '@' + esc(u.username) + ' · ' : ''}ID ${u.id}</small></span>
              ${u.blocked ? '<span class="adm-tag red">Блок</span>' : ''}
              <span class="adm-bal num">${fmt(u.balance)} ⭐${u.gram ? `<small>${gram(u.gram)} Gram</small>` : ''}</span></button>`,
          )
          .join('')
      : '<div class="adm-empty">Никого не найдено</div>';
    $('adm-more').hidden = s.users.length >= s.total;
  }

  async function openUser(id) {
    const data = await api('/api/admin/user', { id }).catch((e) => toast(e.message, 'err'));
    if (!data) return;
    s.user = data;
    s.ledgerEnd = data.ledger.length < 50;
    renderUser();
    go('admin-user');
  }

  const row = (label, value, cls = '') =>
    `<div class="adm-kv${cls ? ' ' + cls : ''}"><span>${label}</span><b class="num">${value}</b></div>`;

  function renderUser() {
    const d = s.user;
    const u = d.user;
    const m = d.money;
    $('au-head').innerHTML = `<span class="adm-av big${u.online ? ' online' : ''}">${avatarHtml(u, 'lg')}</span>
      <div class="au-name">${esc(u.name)}${u.blocked ? ' <span class="adm-tag red">Заблокирован</span>' : ''}</div>
      <div class="au-sub">${u.username ? `<a href="https://t.me/${esc(u.username)}" target="_blank" rel="noopener">@${esc(u.username)}</a> · ` : ''}ID ${u.id}</div>
      <div class="au-bal num">${fmt(u.balance)} ⭐${u.gram ? `<span class="au-gram">${gram(u.gram)} Gram</span>` : ''}</div>
      <div class="au-sub">${u.online ? '<span class="green">● сейчас в приложении</span>' : `был ${when(u.updatedAt)}`} · с нами с ${dateOnly.format(u.createdAt)}</div>`;
    $('au-block').textContent = u.blocked ? 'Разблокировать' : 'Заблокировать';
    $('au-block').classList.toggle('danger', !u.blocked);

    const times = (n) =>
      `${fmt(n)} ${n % 10 === 1 && n % 100 !== 11 ? 'раз' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'раза' : 'раз'}`;
    const money = (x) => `${fmt(x.sum)} ⭐ · ${times(x.n)}`;
    $('au-money').innerHTML =
      row('Пополнено звёздами', money(m.deposits)) +
      row('Пополнено Gram', `${gram(m.gramDeposits.sum)} Gram · ${times(m.gramDeposits.n)}`) +
      row('Первое пополнение', when(m.deposits.first)) +
      row('Последнее пополнение', when(m.deposits.last)) +
      row('Выведено', `${both(m.withdrawn.xtr, m.withdrawn.gram)} · ${times(m.withdrawn.n)}`) +
      row('Вывод в обработке', `${both(m.pending.xtr, m.pending.gram)} · ${times(m.pending.n)}`) +
      row('Отменённые выводы', `${both(m.cancelled.xtr, m.cancelled.gram)} · ${times(m.cancelled.n)}`) +
      row('Доход с рефералов', both(m.referral.xtr, m.referral.gram)) +
      row('Задания', money(m.tasks)) +
      row('Изменения админом', `${signed(m.admin.xtr)} ⭐${m.admin.gram ? ` · ${sgnGram(m.admin.gram)} Gram` : ''}`) +
      row('Оборот для вывода', d.wager.required ? `${fmt(d.wager.done)} / ${fmt(d.wager.required)} ⭐` : 'нет') +
      row(
        'Сверка с журналом',
        d.integrity.ok ? 'совпадает' : `журнал ${both(d.integrity.xtr, d.integrity.gram)}`,
        d.integrity.ok ? 'ok' : 'bad',
      );

    $('au-games').innerHTML = Object.entries(d.games)
      .map(([k, g]) => {
        const extra =
          k === 'roulette'
            ? `${fmt(d.roulette.wins)} побед · ${fmt(d.roulette.losses)} поражений`
            : k === 'crash'
              ? `${fmt(d.crash.rounds)} раундов · ${fmt(d.crash.cashouts)} забрал`
              : `${fmt(d.basket.attempts)} попыток · рекорд ${fmt(d.basket.best)}${d.basket.flagged ? ` · <span class="red">подозрительных ${d.basket.flagged}</span>` : ''}`;
        return `<div class="au-game"><div class="au-game-top"><b>${GAMES[k]}</b><span class="num ${g.net > 0 ? 'green' : g.net < 0 ? 'red' : ''}">${signed(g.net)} ⭐</span></div>
          <div class="au-game-sub">Ставок ${fmt(g.bets)} на ${both(g.xtr.staked, g.gram.staked)}</div>
          <div class="au-game-sub">Выигрышей ${fmt(g.wins)} на ${both(g.xtr.won, g.gram.won)}</div>
          <div class="au-game-sub">${extra}</div></div>`;
      })
      .join('');

    $('au-refs').innerHTML =
      row('Пригласил', `${fmt(d.friends)} друзей`) +
      row(
        'Пришёл от',
        d.referrer ? `<button class="link-btn" data-user="${d.referrer.id}">${esc(d.referrer.name)}</button>` : '—',
      );

    $('au-wd').innerHTML = d.withdrawals.length
      ? d.withdrawals
          .map(
            (w) =>
              `<div class="adm-kv"><span>#${w.id} · ${when(w.createdAt)}${w.reason ? ` · ${esc(w.reason)}` : ''}</span><b class="num st-${w.status}">${w.currency === 'GRAM' ? `${gram(w.amount)} Gram` : `${fmt(w.amount)} ⭐`} · ${STATUS[w.status]}</b></div>`,
          )
          .join('')
      : '<div class="adm-empty">Заявок не было</div>';

    $('au-ledger').innerHTML = renderLedger(d.ledger);
    $('au-ledger-more').hidden = s.ledgerEnd;
    $('au-balance-form').hidden = true;
    $('au-msg-form').hidden = true;
  }

  const renderLedger = (list) =>
    list.length
      ? list
          .map(
            (
              l,
            ) => `<div class="adm-led"><span>${LEDGER[l.kind] ?? esc(l.kind)}${l.ref ? ` <small>#${l.ref}</small>` : ''}<small>${when(l.created_at)}</small></span>
              <b class="num ${l.amount > 0 ? 'green' : ''}">${signed(l.amount)} ⭐</b></div>`,
          )
          .join('')
      : '<div class="adm-empty">Действий пока нет</div>';

  async function moreLedger(btn) {
    const d = s.user;
    const before = d.ledger.at(-1)?.id;
    const data = await run(btn, () => api('/api/admin/ledger', { id: d.user.id, before }));
    if (!data) return;
    d.ledger = d.ledger.concat(data.ledger);
    s.ledgerEnd = data.ledger.length < 50;
    $('au-ledger').innerHTML = renderLedger(d.ledger);
    $('au-ledger-more').hidden = s.ledgerEnd;
  }

  async function toggleBlock(btn) {
    const u = s.user.user;
    if (
      !(await confirmAsync(
        u.blocked ? `Разблокировать ${u.name}?` : `Заблокировать ${u.name}? Он не сможет играть и выводить.`,
      ))
    )
      return;
    const data = await run(btn, () => api('/api/admin/block', { id: u.id, blocked: !u.blocked }));
    if (!data) return;
    s.user = data;
    haptic.ok();
    toast(data.user.blocked ? 'Заблокирован' : 'Разблокирован');
    renderUser();
  }

  async function changeBalance(btn) {
    const raw = $('au-delta').value.replace(/\s/g, '').replace(',', '.');
    const cur = $('au-delta-cur').value;
    const ok = cur === 'GRAM' ? /^[+-]?\d{1,7}(\.\d{1,4})?$/.test(raw) : /^[+-]?\d{1,7}$/.test(raw);
    if (!ok || Number(raw) === 0) return toast('Введите число, например 100 или -50', 'err');
    const delta = cur === 'GRAM' ? raw : Number(raw);
    const data = await run(btn, () => api('/api/admin/balance', { id: s.user.user.id, delta, currency: cur }));
    if (!data) return;
    s.user = data;
    haptic.ok();
    const label = (n) => (cur === 'GRAM' ? `${gram(n)} Gram` : `${fmt(n)} ⭐`);
    toast(data.applied >= 0 ? `Начислено ${label(data.applied)}` : `Списано ${label(-data.applied)}`);
    $('au-delta').value = '';
    renderUser();
  }

  async function sendMessage(btn) {
    const text = $('au-msg').value.trim();
    if (!text) return toast('Напишите сообщение', 'err');
    const ok = await run(btn, () => api('/api/admin/message', { id: s.user.user.id, text }));
    if (!ok) return;
    haptic.ok();
    toast('Сообщение доставлено');
    $('au-msg').value = '';
    $('au-msg-form').hidden = true;
  }

  async function loadWithdrawals() {
    const data = await api('/api/admin/withdrawals', {}).catch((e) => toast(e.message, 'err'));
    if (!data) return;
    const card = (w, actions) => `<div class="adm-wd" data-wd="${w.id}">
      <button class="adm-row plain" data-user="${w.user.id}">${avatarHtml(w.user, 'xs')}
        <span class="adm-who"><b>${esc(w.user.name)}</b><small>${w.user.username ? '@' + esc(w.user.username) + ' · ' : ''}ID ${w.user.id}</small></span>
        <span class="adm-bal num">${w.currency === 'GRAM' ? `${gram(w.amount)} Gram` : `${fmt(w.amount)} ⭐`}</span></button>
      ${w.currency === 'GRAM' ? `<button class="copy-row small" data-copy-addr="${esc(w.address)}"><span>Адрес</span><b class="num">${esc(w.address)}</b><svg><use href="#i-copy"/></svg></button>` : ''}
      <div class="adm-wd-sub">#${w.id} · ${when(w.createdAt)} · комиссия ${w.currency === 'GRAM' ? `${gram(w.fee)} Gram` : `${fmt(w.fee)} ⭐`}${w.status !== 'pending' ? ` · <span class="st-${w.status}">${STATUS[w.status]}</span>` : ''}${w.reason ? ` · ${esc(w.reason)}` : ''}</div>
      ${
        actions
          ? `<div class="adm-wd-actions"><button class="btn secondary" data-wd-cancel="${w.id}">Отменить</button><button class="btn primary" data-wd-sent="${w.id}">Отправлено</button></div>
      <div class="adm-inline" data-reason="${w.id}" hidden><input maxlength="300" placeholder="Причина отмены — её увидит игрок"><button class="btn secondary" data-wd-confirm="${w.id}">Отменить заявку</button></div>`
          : ''
      }
    </div>`;
    $('adm-wd-pending').innerHTML = data.pending.length
      ? data.pending.map((w) => card(w, true)).join('')
      : '<div class="adm-empty">Новых заявок нет</div>';
    $('adm-wd-recent').innerHTML = data.recent.length
      ? data.recent.map((w) => card(w, false)).join('')
      : '<div class="adm-empty">Пока пусто</div>';
    const badge = $('adm-wd-n');
    badge.textContent = data.pending.length;
    badge.hidden = !data.pending.length;
  }

  async function wdSent(id, btn) {
    if (!(await confirmAsync(`Заявка #${id} отправлена игроку?`))) return;
    if (await run(btn, () => api('/api/admin/withdrawals/sent', { id }))) {
      haptic.ok();
      toast('Отмечено как отправлено');
      loadWithdrawals();
    }
  }

  async function wdCancel(id, btn) {
    const reason = document.querySelector(`[data-reason="${id}"] input`).value.trim();
    if (!reason) return toast('Укажите причину', 'err');
    if (await run(btn, () => api('/api/admin/withdrawals/cancel', { id, reason }))) {
      haptic.ok();
      toast('Заявка отменена, звёзды возвращены');
      loadWithdrawals();
    }
  }

  async function loadBroadcast() {
    const st = await api('/api/admin/broadcast/status', {}).catch(() => null);
    if (st) renderBroadcastStatus(st);
  }

  function renderBroadcastStatus(st) {
    $('adm-audience').textContent = `Получат ${fmt(st.audience ?? st.total ?? 0)} пользователей`;
    const box = $('adm-bc-status');
    box.hidden = !st.total;
    if (st.total) {
      const done = st.sent + st.failed;
      box.innerHTML = `<div class="adm-kv"><span>${st.running ? 'Рассылка идёт' : 'Последняя рассылка'}</span><b class="num">${fmt(done)} / ${fmt(st.total)}</b></div>
        <div class="wg-bar"><i style="transform:scaleX(${st.total ? done / st.total : 0})"></i></div>
        <div class="adm-wd-sub">Доставлено ${fmt(st.sent)} · не доставлено ${fmt(st.failed)}</div>`;
    }
    $('adm-bc-send').disabled = !!st.running;
    clearInterval(s.poll);
    if (st.running) s.poll = setInterval(loadBroadcast, 2000);
  }

  function pickPhoto(file) {
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return toast('Нужна картинка JPEG, PNG или WebP', 'err');
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 1600 / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k);
      c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      s.photo = c.toDataURL('image/jpeg', 0.86);
      URL.revokeObjectURL(img.src);
      $('adm-bc-preview').innerHTML =
        `<img src="${s.photo}" alt=""><button class="adm-x" id="adm-bc-clear" aria-label="Убрать фото">×</button>`;
      $('adm-bc-preview').hidden = false;
      $('adm-bc-clear').addEventListener('click', clearPhoto);
      updateCounter();
    };
    img.src = URL.createObjectURL(file);
  }

  function clearPhoto() {
    s.photo = null;
    $('adm-bc-file').value = '';
    $('adm-bc-preview').hidden = true;
    $('adm-bc-preview').innerHTML = '';
    updateCounter();
  }

  function updateCounter() {
    const max = s.photo ? 1024 : 4000;
    const n = $('adm-bc-text').value.length;
    $('adm-bc-left').textContent = `${fmt(n)} / ${fmt(max)}`;
    $('adm-bc-left').classList.toggle('red', n > max);
  }

  async function sendBroadcast(btn) {
    const text = $('adm-bc-text').value.trim();
    if (!text && !s.photo) return toast('Добавьте текст или фото', 'err');
    if (!(await confirmAsync('Отправить рассылку всем пользователям?'))) return;
    const st = await run(btn, () => api('/api/admin/broadcast', { text, photo: s.photo ?? undefined }));
    if (!st) return;
    haptic.ok();
    toast('Рассылка запущена');
    $('adm-bc-text').value = '';
    clearPhoto();
    loadBroadcast();
  }

  async function loadTasks() {
    const data = await api('/api/admin/tasks', {}).catch((e) => toast(e.message, 'err'));
    if (data) renderTasks(data.tasks);
  }

  function renderTasks(tasks) {
    $('adm-tasks').innerHTML = tasks.length
      ? tasks
          .map(
            (t) => `<div class="adm-task"><div class="adm-who"><b>${esc(t.title)}</b>
              <small>${t.kind === 'subscribe' ? 'Проверка подписки' : 'За переход'} · +${fmt(t.reward)} ⭐ · выполнили ${fmt(t.done_count)}</small>
              <small class="adm-url">${esc(t.url)}</small></div>
              <button class="adm-del" data-task-del="${t.id}" aria-label="Удалить">Удалить</button></div>`,
          )
          .join('')
      : '<div class="adm-empty">Заданий нет</div>';
  }

  async function addTask(btn) {
    const url = $('adm-t-url').value.trim();
    const reward = Number($('adm-t-reward').value);
    const title = $('adm-t-title').value.trim();
    if (!url) return toast('Укажите ссылку', 'err');
    if (!Number.isSafeInteger(reward) || reward < 1) return toast('Укажите награду', 'err');
    const data = await run(btn, () => api('/api/admin/tasks/add', { url, reward, title }));
    if (!data) return;
    haptic.ok();
    toast(data.note || 'Задание добавлено');
    $('adm-t-url').value = $('adm-t-reward').value = $('adm-t-title').value = '';
    renderTasks(data.tasks);
  }

  async function deleteTask(id, btn) {
    if (!(await confirmAsync('Удалить задание?'))) return;
    const data = await run(btn, () => api('/api/admin/tasks/delete', { id }));
    if (data) renderTasks(data.tasks);
  }

  async function loadStats() {
    const d = await api('/api/admin/overview', {}).catch((e) => toast(e.message, 'err'));
    if (!d) return;
    const col = (p) => `<th>${{ day: '24 ч', week: '7 дн', month: '30 дн' }[p]}</th>`;
    const table = (title, rows) => `<div class="section-title">${title}</div><div class="adm-table"><table>
      <tr><th></th>${['day', 'week', 'month'].map(col).join('')}</tr>
      ${rows.map(([label, fn]) => `<tr><td>${label}</td>${['day', 'week', 'month'].map((p) => `<td class="num">${fn(p)}</td>`).join('')}</tr>`).join('')}
    </table></div>`;
    $('adm-stats').innerHTML =
      `${
        d.price
          ? `<div class="adm-rate"><div><b>Gram — $${d.price.usd.toFixed(3)}</b><span>Цена обновляется сама каждые 10 минут. Обмен: 1 Gram → ${fmt(d.price.gramToStars)} ⭐, ${fmt(d.price.starsToGram)} ⭐ → 1 Gram. В играх 1 Gram = ${fmt(d.price.game)} ⭐.</span></div></div>`
          : ''
      }
      <div class="adm-big"><div><b class="num">${fmt(d.users)}</b><span>Пользователей</span></div>
        <div><b class="num">${fmt(d.pending.n)}</b><span>Выводов ждут · ${fmt(d.pending.sum)} ⭐</span></div></div>` +
      table('Пользователи и деньги', [
        ['Новые', (p) => fmt(d.newUsers[p])],
        ['Пополнения', (p) => `${fmt(d.deposits[p].sum)} ⭐`],
        ['Платежей', (p) => fmt(d.deposits[p].n)],
        ['Пополнения Gram', (p) => gram(d.gramDeposits[p].sum)],
      ]) +
      table('Рулетка', [
        ['Раундов', (p) => fmt(d.games[p].n)],
        ['Оборот', (p) => `${fmt(d.games[p].turnover)} ⭐`],
        ['Доход', (p) => `${fmt(d.games[p].income)} ⭐`],
      ]) +
      table('Racket Crash', [
        ['Оборот', (p) => `${fmt(d.crash[p].staked)} ⭐`],
        ['Доход', (p) => `${signed(d.crash[p].profit)} ⭐`],
      ]) +
      table('Basketball Rush', [
        ['Попыток', (p) => fmt(d.basket[p].attempts)],
        ['Призы', (p) => `${fmt(d.basket[p].prizes)} ⭐`],
        ['Доход', (p) => `${signed(d.basket[p].profit)} ⭐`],
      ]);
  }

  function bind() {
    $('pf-admin').addEventListener('click', () => go('admin'));
    $('adm-tabs').addEventListener('click', (e) => {
      const b = e.target.closest('[data-tab]');
      if (b) {
        haptic.tap();
        b.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
        setTab(b.dataset.tab);
      }
    });
    $('adm-search').addEventListener('input', (e) => {
      clearTimeout(s.searchTimer);
      s.searchTimer = setTimeout(() => {
        s.query = e.target.value.trim();
        loadUsers(true);
      }, 300);
    });
    $('adm-more').addEventListener('click', () => loadUsers(false));
    $('adm-online-btn').addEventListener('click', () => {
      s.onlineOnly = !s.onlineOnly;
      $('adm-online-btn').classList.toggle('on', s.onlineOnly);
      haptic.tap();
      loadUsers(true);
    });
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-copy-addr]');
      if (!b) return;
      navigator.clipboard?.writeText(b.dataset.copyAddr).then(() => toast('Адрес скопирован'));
    });
    document.addEventListener('click', (e) => {
      const u = e.target.closest('[data-user]');
      if (u && (u.closest('#view-admin') || u.closest('#view-admin-user'))) return openUser(Number(u.dataset.user));
      const sent = e.target.closest('[data-wd-sent]');
      if (sent) return wdSent(Number(sent.dataset.wdSent), sent);
      const cancel = e.target.closest('[data-wd-cancel]');
      if (cancel) {
        const box = document.querySelector(`[data-reason="${cancel.dataset.wdCancel}"]`);
        box.hidden = !box.hidden;
        if (!box.hidden) box.querySelector('input').focus();
        return;
      }
      const confirm = e.target.closest('[data-wd-confirm]');
      if (confirm) return wdCancel(Number(confirm.dataset.wdConfirm), confirm);
      const del = e.target.closest('[data-task-del]');
      if (del) return deleteTask(Number(del.dataset.taskDel), del);
    });
    $('au-block').addEventListener('click', (e) => toggleBlock(e.currentTarget));
    $('au-balance').addEventListener('click', () => {
      $('au-balance-form').hidden = !$('au-balance-form').hidden;
      $('au-msg-form').hidden = true;
      if (!$('au-balance-form').hidden) $('au-delta').focus();
    });
    $('au-message').addEventListener('click', () => {
      $('au-msg-form').hidden = !$('au-msg-form').hidden;
      $('au-balance-form').hidden = true;
      if (!$('au-msg-form').hidden) $('au-msg').focus();
    });
    $('au-delta-go').addEventListener('click', (e) => changeBalance(e.currentTarget));
    $('au-msg-go').addEventListener('click', (e) => sendMessage(e.currentTarget));
    $('au-ledger-more').addEventListener('click', (e) => moreLedger(e.currentTarget));
    $('adm-bc-file').addEventListener('change', (e) => pickPhoto(e.target.files[0]));
    $('adm-bc-text').addEventListener('input', updateCounter);
    $('adm-bc-send').addEventListener('click', (e) => sendBroadcast(e.currentTarget));
    $('adm-t-add').addEventListener('click', (e) => addTask(e.currentTarget));
  }

  return {
    bind,
    enable(on) {
      $('pf-admin').hidden = !on;
    },
    show() {
      setTab(s.tab);
    },
    showUser() {
      if (s.user) openUser(s.user.user.id);
    },
    hide() {
      clearInterval(s.poll);
    },
  };
}
