const $ = (id) => document.getElementById(id);
const fmt = (n) => new Intl.NumberFormat('ru-RU').format(n);
const mul = (m100) => (m100 / 100).toFixed(2);
const STAR = '<svg class="star"><use href="#i-star"/></svg>';
const BET_CHIPS = [5, 10, 25, 50, 100];
const AUTO_CHIPS = [1.5, 2, 3, 5, 10];

const tone = (m100) => (m100 < 200 ? 'low' : m100 < 1000 ? 'mid' : 'high');

export function createCrash({ api, haptic, toast, avatarHtml, esc, me, onProfile, go }) {
  const s = {
    st: null,
    offset: 0,
    amount: 10,
    autoOn: false,
    auto: 2,
    active: false,
    raf: 0,
    view: { w: 0, h: 0, dpr: 1 },
    stars: [],
    particles: [],
    boom: null,
    lastStatus: null,
    lastId: null,
    busy: false,
  };
  const serverNow = () => Date.now() + s.offset;
  try {
    const saved = JSON.parse(localStorage.getItem('crash-prefs') || '{}');
    if (saved.amount) s.amount = saved.amount;
    if (saved.auto) s.auto = saved.auto;
    s.autoOn = !!saved.autoOn;
  } catch {}
  const savePrefs = () => {
    try {
      localStorage.setItem('crash-prefs', JSON.stringify({ amount: s.amount, auto: s.auto, autoOn: s.autoOn }));
    } catch {}
  };

  function onState(st) {
    s.offset = st.serverNow - Date.now();
    const prev = s.st;
    s.st = st;
    const mine = myBet(st);
    if (prev && prev.id === st.id && prev.status === 'flying' && st.status === 'crashed') {
      explode();
      const prevMine = myBet(prev);
      if (prevMine && prevMine.cashout === null && mine?.cashout === null) haptic.err();
    }
    if (st.status === 'betting' && prev?.status !== 'betting') s.boom = null;
    const pm = prev && prev.id === st.id ? myBet(prev) : null;
    if (mine?.cashout && !pm?.cashout) {
      haptic.ok();
      toast(`Забрано ×${mul(mine.cashout)} · +${fmt(mine.payout)} ⭐`);
    }
    render();
  }

  const myBet = (st) => st?.bets.find((b) => b.id === me()?.id) ?? null;

  function multiplierNow() {
    const st = s.st;
    if (!st) return 100;
    if (st.status === 'crashed') return st.crash;
    if (st.status !== 'flying') return 100;
    return Math.max(100, Math.floor(100 * Math.exp((st.growth * (serverNow() - st.startAt)) / 1000)));
  }

  function render() {
    const st = s.st;
    if (!st) return;
    const hist = st.history.map((h) => `<span class="ch-pill ${tone(h.crash)}">×${mul(h.crash)}</span>`).join('');
    if ($('cr-history').dataset.v !== hist) {
      $('cr-history').dataset.v = hist;
      $('cr-history').innerHTML = hist;
    }
    const total = st.bets.reduce((a, b) => a + b.amount, 0);
    $('cr-count').textContent = st.bets.length ? `${st.bets.length} · ${fmt(total)} ⭐` : 'Ставок пока нет';
    const myId = me()?.id;
    $('cr-bets').innerHTML = st.bets
      .map((b) => {
        let res = '<span class="cb-wait">в игре</span>';
        if (b.cashout) res = `<span class="cb-win">×${mul(b.cashout)} · +${fmt(b.payout)}</span>`;
        else if (st.status === 'crashed') res = '<span class="cb-lose">сгорела</span>';
        else if (st.status === 'betting')
          res = b.auto
            ? `<span class="cb-wait">авто ×${mul(b.auto)}</span>`
            : '<span class="cb-wait">ждёт старт</span>';
        return `<div class="cb${b.id === myId ? ' me' : ''}">${avatarHtml(b, 'xs')}
          <span class="cb-name">${b.id === myId ? 'Вы' : esc(b.name)}</span>
          <span class="cb-amt num">${fmt(b.amount)}${STAR}</span>${res}</div>`;
      })
      .join('');
    $('cr-limits').textContent =
      `Ставка ${st.limits.minBet}–${st.limits.maxBet} ⭐ · выигрыш до ${fmt(st.limits.maxWin)} ⭐`;
    renderPanel();
  }

  function renderPanel() {
    const st = s.st;
    if (!st) return;
    const mine = myBet(st);
    const btn = $('cr-main');
    const sub = $('cr-main-sub');
    $('cr-amount').value = s.amount;
    $('cr-auto-toggle').classList.toggle('on', s.autoOn);
    $('cr-auto').disabled = !s.autoOn;
    $('cr-auto').value = s.auto.toFixed(2);
    document
      .querySelectorAll('#cr-chips button')
      .forEach((b) => b.classList.toggle('on', Number(b.dataset.v) === s.amount));
    document
      .querySelectorAll('#cr-auto-chips button')
      .forEach((b) => b.classList.toggle('on', s.autoOn && Number(b.dataset.v) === s.auto));
    const lockSettings = !!mine && st.status !== 'crashed';
    $('cr-panel').classList.toggle('locked', lockSettings);
    btn.className = 'btn block cr-main';
    btn.disabled = false;
    let text = '';
    let note = '';
    if (st.status === 'betting') {
      if (mine) {
        btn.classList.add('secondary');
        text = 'Отменить ставку';
        note = `Ставка ${fmt(mine.amount)} ⭐${mine.auto ? ` · автовывод ×${mul(mine.auto)}` : ''}`;
      } else {
        btn.classList.add('primary');
        const poor = (me()?.balance ?? 0) < s.amount;
        text = poor ? 'Пополнить баланс' : `Поставить ${fmt(s.amount)} ⭐`;
        note = poor
          ? 'Не хватает звёзд на ставку'
          : s.autoOn
            ? `Автовывод ×${s.auto.toFixed(2)}`
            : 'Заберите выигрыш до взрыва ракеты';
      }
    } else if (st.status === 'flying' && mine && !mine.cashout) {
      btn.classList.add('cashout');
      text = 'Забрать';
      note = '';
    } else if (mine?.cashout) {
      btn.classList.add('won');
      btn.disabled = true;
      text = `+${fmt(mine.payout)} ⭐`;
      note = `Вы забрали на ×${mul(mine.cashout)}`;
    } else {
      btn.classList.add('secondary');
      btn.disabled = true;
      text = st.status === 'flying' ? 'Раунд идёт' : 'Следующий раунд…';
      note = 'Ставки откроются после взрыва';
    }
    if (btn.dataset.text !== text) {
      btn.dataset.text = text;
      btn.innerHTML = `<span>${text}</span>`;
    }
    sub.textContent = note;
  }

  async function onMain() {
    const st = s.st;
    if (!st || s.busy) return;
    const mine = myBet(st);
    s.busy = true;
    try {
      if (st.status === 'betting' && !mine) {
        if ((me()?.balance ?? 0) < s.amount) {
          s.busy = false;
          return go('deposit');
        }
        const res = await api('/api/crash/bet', { amount: s.amount, auto: s.autoOn ? s.auto : null });
        onProfile(res);
        onState(res);
        haptic.impact('medium');
      } else if (st.status === 'betting' && mine) {
        const res = await api('/api/crash/cancel', {});
        onProfile(res);
        onState(res);
        haptic.tap();
      } else if (st.status === 'flying' && mine && !mine.cashout) {
        const res = await api('/api/crash/cashout', {});
        onProfile(res);
        onState(res);
      }
    } catch (e) {
      haptic.err();
      toast(e.message, 'err');
    } finally {
      s.busy = false;
    }
  }

  function setAmount(v) {
    const L = s.st?.limits ?? { minBet: 5, maxBet: 100 };
    s.amount = Math.max(L.minBet, Math.min(L.maxBet, Math.round(v) || L.minBet));
    savePrefs();
    renderPanel();
  }

  function setAuto(v) {
    const n = Math.round(Number(v) * 100) / 100;
    s.auto = Math.max(1.01, Math.min(1000, Number.isFinite(n) ? n : 2));
    savePrefs();
    renderPanel();
  }

  function resize() {
    const c = $('cr-canvas');
    const r = c.getBoundingClientRect();
    if (!r.width) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(r.width * dpr);
    c.height = Math.round(r.height * dpr);
    s.view = { w: r.width, h: r.height, dpr };
    s.stars = Array.from({ length: 70 }, () => ({
      x: Math.random() * r.width,
      y: Math.random() * r.height,
      z: 0.3 + Math.random() * 0.7,
      p: Math.random() * Math.PI * 2,
    }));
  }

  function explode() {
    const pos = s.rocketPos;
    if (!pos) return;
    s.boom = { t: performance.now(), x: pos.x, y: pos.y };
    s.particles = Array.from({ length: 46 }, () => {
      const a = Math.random() * Math.PI * 2;
      const v = 60 + Math.random() * 220;
      return {
        x: pos.x,
        y: pos.y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        life: 0.6 + Math.random() * 0.6,
        c: Math.random() < 0.5 ? '#ffb347' : '#ff5d6c',
      };
    });
  }

  let lastT = 0;
  function frame(t) {
    s.raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (t - (lastT || t)) / 1000);
    lastT = t;
    const st = s.st;
    const v = s.view;
    if (!st || !v.w) return;
    const ctx = $('cr-canvas').getContext('2d');
    ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
    const m = multiplierNow();
    const flying = st.status === 'flying';
    const crashed = st.status === 'crashed';
    const elapsed = flying
      ? (serverNow() - st.startAt) / 1000
      : crashed && st.startAt
        ? Math.log(st.crash / 100) / st.growth
        : 0;

    const bg = ctx.createLinearGradient(0, 0, 0, v.h);
    bg.addColorStop(0, '#13111d');
    bg.addColorStop(1, '#171427');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, v.w, v.h);
    const speed = flying ? 20 + Math.min(180, (m / 100) * 25) : 6;
    for (const p of s.stars) {
      p.x -= speed * p.z * dt;
      p.y += speed * 0.35 * p.z * dt;
      if (p.x < -2) p.x += v.w + 4;
      if (p.y > v.h + 2) p.y -= v.h + 4;
      ctx.globalAlpha = 0.25 + 0.55 * p.z * (0.6 + 0.4 * Math.sin(t / 600 + p.p));
      ctx.fillStyle = '#e8dcff';
      ctx.fillRect(p.x, p.y, p.z * 1.6, p.z * 1.6);
    }
    ctx.globalAlpha = 1;

    const padL = 14;
    const padB = 26;
    const padT = 18;
    const W = v.w - padL - 18;
    const H = v.h - padB - padT;
    const tMax = Math.max(8, elapsed * 1.25);
    const mMax = Math.max(2, (m / 100) * 1.3);
    const X = (sec) => padL + (sec / tMax) * W;
    const Y = (mult) => padT + H - ((mult - 1) / (mMax - 1)) * H;
    ctx.strokeStyle = 'rgba(190,160,255,0.08)';
    ctx.lineWidth = 1;
    ctx.fillStyle = 'rgba(220,205,255,0.4)';
    ctx.font = '600 10px -apple-system, Roboto, sans-serif';
    ctx.textAlign = 'left';
    const stepM = mMax > 20 ? 10 : mMax > 6 ? 2 : mMax > 3 ? 1 : 0.5;
    for (let g = 1 + stepM; g < mMax; g += stepM) {
      const y = Y(g);
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(v.w, y);
      ctx.stroke();
      ctx.fillText(`×${g.toFixed(stepM < 1 ? 1 : 0)}`, padL + 4, y - 4);
    }

    let rocket = { x: X(0), y: Y(1), a: -0.35 };
    if (flying || crashed) {
      const n = 60;
      const pts = [];
      for (let i = 0; i <= n; i++) {
        const sec = (elapsed * i) / n;
        pts.push([X(sec), Y(Math.exp(st.growth * sec))]);
      }
      const area = ctx.createLinearGradient(0, padT, 0, padT + H);
      area.addColorStop(0, crashed ? 'rgba(239,90,95,0.16)' : 'rgba(124,92,255,0.2)');
      area.addColorStop(1, 'rgba(124,92,255,0)');
      ctx.fillStyle = area;
      ctx.beginPath();
      ctx.moveTo(pts[0][0], padT + H);
      for (const [x, y] of pts) ctx.lineTo(x, y);
      ctx.lineTo(pts[n][0], padT + H);
      ctx.closePath();
      ctx.fill();
      const line = ctx.createLinearGradient(X(0), 0, X(elapsed), 0);
      line.addColorStop(0, crashed ? '#ef5a5f' : '#7c5cff');
      line.addColorStop(1, crashed ? '#ef5a5f' : '#a993ff');
      ctx.strokeStyle = line;
      ctx.lineWidth = 3.5;
      ctx.lineCap = 'round';
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
      ctx.shadowBlur = 0;
      const [x1, y1] = pts[n];
      const [x0, y0] = pts[n - 2];
      rocket = { x: x1, y: y1, a: Math.atan2(y1 - y0, x1 - x0) };
    }
    s.rocketPos = rocket;
    if (!crashed || !s.boom) drawRocket(ctx, rocket, t, flying);
    drawBoom(ctx, dt, t);
    renderCenter(m, t);
    if (flying) renderCashoutValue(m);
  }

  function drawRocket(ctx, r, t, flying) {
    ctx.save();
    ctx.translate(r.x, r.y);
    ctx.rotate(flying ? r.a : -0.6);
    const sz = Math.max(20, Math.min(32, s.view.w / 12));
    const fl = (flying ? 1 : 0.45) * (0.85 + 0.15 * Math.sin(t / 35));
    const flame = ctx.createLinearGradient(-sz * 2.6 * fl, 0, -sz * 0.6, 0);
    flame.addColorStop(0, 'rgba(255,80,40,0)');
    flame.addColorStop(0.5, 'rgba(255,140,40,0.85)');
    flame.addColorStop(1, '#fff3c4');
    ctx.fillStyle = flame;
    ctx.beginPath();
    ctx.moveTo(-sz * 0.6, -sz * 0.28);
    ctx.quadraticCurveTo(-sz * 2.6 * fl, 0, -sz * 0.6, sz * 0.28);
    ctx.closePath();
    ctx.fill();
    const body = ctx.createLinearGradient(0, -sz * 0.4, 0, sz * 0.4);
    body.addColorStop(0, '#ffffff');
    body.addColorStop(1, '#bba6ff');
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(sz, 0);
    ctx.quadraticCurveTo(sz * 0.55, -sz * 0.42, -sz * 0.6, -sz * 0.34);
    ctx.lineTo(-sz * 0.6, sz * 0.34);
    ctx.quadraticCurveTo(sz * 0.55, sz * 0.42, sz, 0);
    ctx.fill();
    ctx.fillStyle = '#f5bf4f';
    ctx.beginPath();
    ctx.moveTo(sz, 0);
    ctx.quadraticCurveTo(sz * 0.78, -sz * 0.26, sz * 0.55, -sz * 0.3);
    ctx.lineTo(sz * 0.55, sz * 0.3);
    ctx.quadraticCurveTo(sz * 0.78, sz * 0.26, sz, 0);
    ctx.fill();
    ctx.fillStyle = '#8b6cff';
    for (const k of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(-sz * 0.2, k * sz * 0.3);
      ctx.lineTo(-sz * 0.7, k * sz * 0.62);
      ctx.lineTo(-sz * 0.6, k * sz * 0.2);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = '#2a1856';
    ctx.beginPath();
    ctx.arc(sz * 0.15, 0, sz * 0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#f5bf4f';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }

  function drawBoom(ctx, dt, t) {
    if (!s.boom) return;
    const k = (t - s.boom.t) / 1000;
    if (k < 0.35) {
      const g = ctx.createRadialGradient(s.boom.x, s.boom.y, 0, s.boom.x, s.boom.y, 70 * (0.4 + k * 2));
      g.addColorStop(0, `rgba(255,220,150,${0.9 - k * 2})`);
      g.addColorStop(1, 'rgba(255,90,60,0)');
      ctx.fillStyle = g;
      ctx.fillRect(s.boom.x - 120, s.boom.y - 120, 240, 240);
    }
    for (const p of s.particles) {
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vx *= 0.97;
      p.vy = p.vy * 0.97 + 80 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 1.4));
      ctx.fillStyle = p.c;
      ctx.fillRect(p.x, p.y, 3, 3);
    }
    ctx.globalAlpha = 1;
  }

  let lastCenter = '';
  function renderCenter(m, t) {
    const st = s.st;
    const el = $('cr-center');
    let html;
    if (st.status === 'betting') {
      const left = Math.max(0, st.bettingEndsAt - serverNow());
      const total = 8000;
      html = `<div class="cc-label">Старт через</div><div class="cc-big num">${(left / 1000).toFixed(1)}</div>
        <div class="cc-bar"><i style="transform:scaleX(${Math.min(1, left / total).toFixed(3)})"></i></div>`;
      el.className = 'cr-center betting';
    } else if (st.status === 'flying') {
      html = `<div class="cc-big num ${tone(m)}">×${mul(m)}</div>`;
      el.className = 'cr-center flying';
    } else {
      html = `<div class="cc-big num crashed">×${mul(st.crash)}</div><div class="cc-label">Ракета улетела</div>`;
      el.className = 'cr-center crashed';
    }
    if (html !== lastCenter) {
      lastCenter = html;
      el.innerHTML = html;
    }
  }

  function renderCashoutValue(m) {
    const mine = myBet(s.st);
    const btn = $('cr-main');
    if (!mine || mine.cashout || !btn.classList.contains('cashout')) return;
    const v = Math.min(s.st.limits.maxWin, Math.floor((mine.amount * m) / 100));
    const text = `Забрать ${fmt(v)} ⭐`;
    if (btn.dataset.live !== text) {
      btn.dataset.live = text;
      btn.innerHTML = `<span>${text}</span>`;
    }
    $('cr-main-sub').textContent = `×${mul(m)} от ставки ${fmt(mine.amount)} ⭐`;
  }

  async function openFair() {
    haptic.tap();
    try {
      const { edge, rounds } = await api('/api/crash/fair');
      $('cr-fair-body').innerHTML =
        `<p>Точка взрыва каждого раунда определяется <b>до его начала</b>. Перед стартом публикуется хэш
        SHA-256 секретного ключа, после взрыва ключ раскрывается — любой может проверить, что результат не меняли.</p>
        <p class="mono">взрыв = max(1, ⌊100·(1−${edge}) / (1−r)⌋ / 100),<br>r = первые 52 бита HMAC-SHA256(ключ, «crash:номер»)</p>
        <p>Возврат игрокам — <b>${Math.round((1 - edge) * 100)}%</b> на дистанции при любой стратегии.</p>
        <div class="fair-list">${rounds
          .map(
            (r) => `<div class="fair-row"><b>#${r.id}</b><span class="ch-pill ${tone(r.crash)}">×${mul(r.crash)}</span>
            <code title="ключ">${esc(r.seed.slice(0, 16))}…</code></div>`,
          )
          .join('')}</div>`;
      const w = $('cr-fair');
      w.classList.remove('closing');
      w.hidden = false;
    } catch (e) {
      toast(e.message, 'err');
    }
  }

  function bind() {
    $('cr-chips').innerHTML = BET_CHIPS.map((v) => `<button data-v="${v}" class="num">${v}</button>`).join('');
    $('cr-auto-chips').innerHTML = AUTO_CHIPS.map((v) => `<button data-v="${v}" class="num">×${v}</button>`).join('');
    $('cr-chips').addEventListener('click', (e) => {
      const v = e.target.dataset.v;
      if (v) (setAmount(Number(v)), haptic.tap());
    });
    $('cr-auto-chips').addEventListener('click', (e) => {
      const v = e.target.dataset.v;
      if (!v) return;
      s.autoOn = true;
      setAuto(Number(v));
      haptic.tap();
    });
    $('cr-minus').addEventListener('click', () => (setAmount(s.amount - (s.amount > 25 ? 10 : 5)), haptic.tap()));
    $('cr-plus').addEventListener('click', () => (setAmount(s.amount + (s.amount >= 25 ? 10 : 5)), haptic.tap()));
    $('cr-amount').addEventListener('change', (e) => setAmount(Number(e.target.value)));
    $('cr-auto').addEventListener('change', (e) => setAuto(e.target.value));
    $('cr-auto-toggle').addEventListener('click', () => {
      s.autoOn = !s.autoOn;
      savePrefs();
      renderPanel();
      haptic.tap();
    });
    $('cr-main').addEventListener('click', onMain);
    $('cr-fair-btn').addEventListener('click', openFair);
    $('cr-fair').addEventListener('click', (e) => {
      if (!e.target.matches('[data-close]')) return;
      const w = $('cr-fair');
      w.classList.add('closing');
      setTimeout(() => (w.hidden = true), 240);
    });
    window.addEventListener('resize', () => s.active && resize());
  }

  return {
    bind,
    onState,
    async load() {
      try {
        onState(await api('/api/crash'));
      } catch {}
    },
    show() {
      s.active = true;
      requestAnimationFrame(() => {
        resize();
        cancelAnimationFrame(s.raf);
        s.raf = requestAnimationFrame(frame);
      });
      if (!s.st) this.load();
      else render();
    },
    hide() {
      s.active = false;
      cancelAnimationFrame(s.raf);
    },
    players: () => s.st?.bets.length ?? 0,
  };
}
