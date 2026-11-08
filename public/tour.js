const KEY = 'tour-v1';

const STEPS = [
  { text: 'Привет! Я Макс, ваш гид. За минуту покажу, как здесь всё устроено.' },
  { target: '.wallet-bar .bal-xtr', text: 'Это ваши <b>звёзды</b>. На какой баланс нажмёте — в той валюте и играете.' },
  {
    target: '.wallet-bar .bal-gram',
    text: 'А это <b>Gram</b> — криптовалюта Telegram. Нажмите на него, чтобы играть на Gram.',
    gram: true,
  },
  { target: '#balance-btn', text: 'Плюс — <b>пополнить баланс</b> звёздами или Gram.' },
  {
    target: '#wheel',
    view: 'roulette',
    text: 'Это <b>рулетка</b>. Все ставят в общий банк. Чем больше ставка, тем больше ваш сектор и шанс забрать весь банк.',
  },
  {
    target: '#gift-fab',
    view: 'roulette',
    text: '<b>Подарки за друзей.</b> За каждые 5 приглашённых — прокрутка. Можно выиграть звёзды и NFT-подарки.',
  },
  {
    target: '.dock-bet',
    view: 'roulette',
    text: 'Выберите сумму и нажмите <b>«Сделать ставку»</b>. Раунд начнётся, когда сделают ставки хотя бы двое.',
  },
  {
    target: '.nav [data-go="games"]',
    text: 'Здесь ещё игры: <b>Racket Crash</b> и <b>Basketball Rush</b> с призом дня.',
  },
  { target: '.nav [data-go="tasks"]', text: '<b>Задания</b> — звёзды за подписки на каналы.' },
  { target: '.nav [data-go="friends"]', text: '<b>Друзья</b> — приглашайте и получайте 15% с их пополнений.' },
  { target: '.nav [data-go="profile"]', text: '<b>Профиль</b> — пополнение, вывод и ваша статистика. Удачи!' },
];

export function createTour({ go, haptic }) {
  let steps = [];
  let i = 0;
  const el = () => document.getElementById('tour');

  const seen = () => {
    try {
      return localStorage.getItem(KEY) === '1';
    } catch {
      return true;
    }
  };

  function finish() {
    try {
      localStorage.setItem(KEY, '1');
    } catch {}
    el().hidden = true;
    document.body.classList.remove('touring');
    window.removeEventListener('resize', place);
  }

  function place() {
    const step = steps[i];
    const root = el();
    const hole = root.querySelector('.tour-hole');
    const card = root.querySelector('.tour-card');
    const target = step.target && document.querySelector(step.target);
    const vh = window.innerHeight;
    if (!target) {
      hole.style.cssText = `left:50%;top:40%;width:0;height:0`;
      card.style.cssText = 'top:50%;transform:translateY(-50%)';
      return;
    }
    const r = target.getBoundingClientRect();
    const pad = 6;
    hole.style.cssText = `left:${r.left - pad}px;top:${r.top - pad}px;width:${r.width + pad * 2}px;height:${r.height + pad * 2}px`;
    const below = r.bottom + 16;
    if (r.top + r.height / 2 < vh / 2) card.style.cssText = `top:${Math.min(below, vh - 220)}px`;
    else card.style.cssText = `bottom:${Math.max(16, vh - r.top + 16)}px`;
  }

  function show() {
    const step = steps[i];
    if (step.view) go(step.view);
    const root = el();
    root.querySelector('.tour-text').innerHTML = step.text;
    root.querySelector('.tour-count').textContent = `${i + 1} / ${steps.length}`;
    root.querySelector('[data-tour="next"]').textContent = i === steps.length - 1 ? 'Начать играть' : 'Далее';
    root.querySelector('.tour-card').classList.remove('pop');
    void root.offsetWidth;
    root.querySelector('.tour-card').classList.add('pop');
    requestAnimationFrame(place);
  }

  function start({ gram = true } = {}) {
    steps = STEPS.filter((s) => gram || !s.gram);
    i = 0;
    el().hidden = false;
    document.body.classList.add('touring');
    window.addEventListener('resize', place);
    show();
  }

  function bind() {
    el().addEventListener('click', (e) => {
      const act = e.target.closest('[data-tour]')?.dataset.tour;
      if (act === 'skip') return finish();
      if (act === 'next') {
        haptic.tap();
        if (++i >= steps.length) return finish();
        show();
      }
    });
  }

  return { bind, start, seen };
}
