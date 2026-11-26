// Balance check: bot-only 3v3 matches and 1v1 duels in the real Match code, no rendering.
//   npx vite --port 5179 &  then  node scripts/balance.mjs [matches=24] [duelsPerPair=24]
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const pw = require('playwright');
const [N3 = '24', ND = '24'] = process.argv.slice(2);
const b = await pw.chromium.launch();
const p = await b.newPage();
p.on('pageerror', (e) => console.log('err', e.message));
p.on('console', (m) => { if (m.type() === 'error') console.log('console', m.text()); });
await p.goto('http://127.0.0.1:5179/app.html');
const res = await p.evaluate(async ([n3, nd]) => {
  const THREE = await import('/node_modules/.vite/deps/three.js');
  const { Match } = await import('/src/app/game/match.ts');
  const { MATCH } = await import('/src/app/game/kits.ts');
  const { load, loadColliders } = await import('/src/app/assets.ts');
  const { HEROES } = await import('/src/app/data.ts');
  const { lineup } = await import('/src/app/game/match.ts');
  const ids = HEROES.map((h) => h.id);
  const heroes = {}; for (const h of HEROES) heroes[h.id] = await load(h.model);
  const cols = await loadColliders(); const props = await load('PROPS');
  const ev = { damage() {}, kill() {}, end() {} };
  const inp = { move: [0, 0], attack: null, auto: false, a1: false, a2: false, dash: false };
  const dt = 1 / 30;
  // 3v3, three random different heroes per side
  const st = {}; for (const id of ids) st[id] = { dealt: 0, healed: 0, kills: 0, deaths: 0, zone: 0, n: 0, won: 0 };
  let wins = [0, 0, 0];
  for (let i = 0; i < n3; i++) {
    const scene = new THREE.Scene();
    const blue = lineup(), red = lineup();
    const m = new Match(scene, heroes, cols, blue[0], ev, props, { blue, red, allBots: true });
    m.start();
    while (!m.ended) {
      m.update(dt, inp);
      for (const u of m.units) if (u.alive && Math.hypot(u.x - MATCH.zone.x, u.z - MATCH.zone.z) < MATCH.zone.r) st[u.hero.id].zone += dt;
    }
    const win = m.score[0] > m.score[1] ? 0 : m.score[1] > m.score[0] ? 1 : -1;
    for (const u of m.units) { const s = st[u.hero.id]; s.dealt += u.dealt; s.healed += u.healed; s.kills += u.kills; s.deaths += u.deaths; s.n++; if (u.team === win) s.won++; }
    wins[m.score[0] > m.score[1] ? 0 : m.score[1] > m.score[0] ? 1 : 2]++;
    m.dispose();
  }
  // 1v1 duels: first kill wins; 40 s timeout -> higher HP share wins
  const duel = {};
  for (const a of ids) for (const c of ids) {
    if (a >= c) continue;
    let wa = 0, wc = 0, ttk = 0, done = 0;
    for (let i = 0; i < nd; i++) {
      const flip = i % 2 === 1;
      const scene = new THREE.Scene();
      const m = new Match(scene, heroes, cols, flip ? c : a, ev, props, { blue: [flip ? c : a], red: [flip ? a : c], allBots: true });
      m.start();
      let t = 0;
      while (t < 40 && m.units.every((u) => u.deaths === 0)) { m.update(dt, inp); t += dt; }
      const [ub, ur] = m.units;
      let winner;
      if (ub.deaths || ur.deaths) { winner = ub.deaths ? ur : ub; ttk += t; done++; } else winner = ub.hp / ub.kit.hp >= ur.hp / ur.kit.hp ? ub : ur;
      if (winner.hero.id === a) wa++; else wc++;
      m.dispose();
    }
    duel[`${a} vs ${c}`] = { [a]: wa, [c]: wc, kills: done, avgTTK: done ? +(ttk / done).toFixed(1) : null };
  }
  for (const id of ids) { const s = st[id]; st[id] = { teamWin: +(s.won / s.n).toFixed(2), dealtPerMatch: Math.round(s.dealt / s.n), healedPerMatch: Math.round(s.healed / s.n), kills: +(s.kills / s.n).toFixed(2), deaths: +(s.deaths / s.n).toFixed(2), zoneSec: +(s.zone / s.n).toFixed(1) }; }
  return { matches: n3, blueWins: wins[0], redWins: wins[1], draws: wins[2], perHero: st, duel };
}, [+N3, +ND]);
console.log(JSON.stringify(res, null, 1));
await b.close();
