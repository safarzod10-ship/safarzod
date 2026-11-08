import { EventEmitter } from 'node:events';
import { randomInt } from 'node:crypto';
import { AppError } from './db.js';

export const SCALE = 1_000_000;

const NFT = [
  ['snakebox', 'Snake Box'],
  ['candycane', 'Candy Cane'],
  ['lunarsnake', 'Lunar Snake'],
  ['vicecream', 'Vice Cream'],
  ['chillflame', 'Chill Flame'],
  ['lolpop', 'Lol Pop'],
  ['xmasstocking', 'Xmas Stocking'],
  ['poolfloat', 'Pool Float'],
  ['whipcupcake', 'Whip Cupcake'],
  ['instantramen', 'Instant Ramen'],
];

export const PRIZES = [
  ...NFT.map(([slug, name]) => ({ id: slug, kind: 'nft', name, image: `/gifts/${slug}.webp`, weight: 13 })),
  { id: 'stars15', kind: 'stars', amount: 15, name: '15 звёзд', weight: 20_000 },
  { id: 'stars10', kind: 'stars', amount: 10, name: '10 звёзд', weight: 40_000 },
  { id: 'stars5', kind: 'stars', amount: 5, name: '5 звёзд', weight: 140_000 },
];
PRIZES.push({
  id: 'stars1',
  kind: 'stars',
  amount: 1,
  name: '1 звезда',
  weight: SCALE - PRIZES.reduce((a, p) => a + p.weight, 0),
});

const SCHEMA = `
CREATE TABLE IF NOT EXISTS wheel_spins (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  prize       TEXT NOT NULL,
  kind        TEXT NOT NULL,
  amount      INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'done',
  created_at  INTEGER NOT NULL,
  sent_at     INTEGER
);
CREATE INDEX IF NOT EXISTS wheel_spins_user ON wheel_spins(user_id, id);
CREATE INDEX IF NOT EXISTS wheel_spins_status ON wheel_spins(status, id);
CREATE TABLE IF NOT EXISTS promo_codes (
  code        TEXT PRIMARY KEY,
  spins       INTEGER NOT NULL DEFAULT 1,
  uses_max    INTEGER NOT NULL,
  uses        INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS promo_uses (
  code        TEXT NOT NULL REFERENCES promo_codes(code),
  user_id     INTEGER NOT NULL REFERENCES users(id),
  spins       INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (code, user_id)
);
`;

export class WheelService extends EventEmitter {
  constructor(store, { invitesPerSpin = 5, random = randomInt } = {}) {
    super();
    this.store = store;
    this.per = invitesPerSpin;
    this.random = random;
    store.db.exec(SCHEMA);
    const q = (sql) => store.db.prepare(sql);
    this.q = {
      invites: q('SELECT COUNT(*) AS n FROM users WHERE referrer_id = ?'),
      used: q('SELECT COUNT(*) AS n FROM wheel_spins WHERE user_id = ?'),
      add: q('INSERT INTO wheel_spins (user_id, prize, kind, amount, status, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
      recentNft:
        q(`SELECT w.prize, w.created_at, u.first_name, u.username FROM wheel_spins w JOIN users u ON u.id = w.user_id
                    WHERE w.kind = 'nft' ORDER BY w.id DESC LIMIT 5`),
      pending: q(`SELECT w.*, u.first_name, u.last_name, u.username, u.photo_url FROM wheel_spins w
                  JOIN users u ON u.id = w.user_id WHERE w.kind = 'nft' ORDER BY w.status = 'pending' DESC, w.id DESC LIMIT 50`),
      markSent: q("UPDATE wheel_spins SET status = 'sent', sent_at = ? WHERE id = ? AND status = 'pending'"),
      get: q('SELECT * FROM wheel_spins WHERE id = ?'),
      bonus: q('SELECT COALESCE(SUM(spins), 0) AS n FROM promo_uses WHERE user_id = ?'),
      promo: q('SELECT * FROM promo_codes WHERE code = ?'),
      promoUse: q(
        'INSERT INTO promo_uses (code, user_id, spins, created_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING',
      ),
      promoInc: q('UPDATE promo_codes SET uses = uses + 1 WHERE code = ? AND active = 1 AND uses < uses_max'),
      promoAdd: q('INSERT INTO promo_codes (code, spins, uses_max, created_at) VALUES (?, ?, ?, ?)'),
      promoList: q('SELECT * FROM promo_codes WHERE active = 1 ORDER BY created_at DESC'),
      promoOff: q('UPDATE promo_codes SET active = 0 WHERE code = ?'),
    };
  }

  #counts(userId) {
    const invites = this.q.invites.get(userId).n;
    const used = this.q.used.get(userId).n;
    const earned = Math.floor(invites / this.per) + this.q.bonus.get(userId).n;
    return { invites, used, spins: Math.max(0, earned - used), nextIn: this.per - (invites % this.per) };
  }

  state(userId) {
    const c = this.#counts(userId);
    return {
      spins: c.spins,
      invites: c.invites,
      perSpin: this.per,
      nextIn: c.nextIn,
      prizes: PRIZES.map(({ id, kind, amount, name, image }) => ({ id, kind, amount, name, image })),
    };
  }

  pick() {
    const r = this.random(SCALE);
    let acc = 0;
    for (const p of PRIZES) {
      acc += p.weight;
      if (r < acc) return p;
    }
    return PRIZES.at(-1);
  }

  spin(userId) {
    const result = this.store.tx(() => {
      if (this.#counts(userId).spins < 1) {
        throw new AppError('NO_SPINS', `Пригласите ${this.per} друзей, чтобы получить прокрутку`, 409);
      }
      const prize = this.pick();
      const nft = prize.kind === 'nft';
      const id = Number(
        this.q.add.run(userId, prize.id, prize.kind, prize.amount ?? 0, nft ? 'pending' : 'done', Date.now())
          .lastInsertRowid,
      );
      if (!nft) this.store.ledgerCredit(userId, prize.amount, 'wheel', id);
      return { spinId: id, prize };
    });
    if (result.prize.kind === 'nft') this.emit('nft', { userId, spinId: result.spinId, prize: result.prize });
    else this.emit('balance', userId);
    return { prize: result.prize.id, ...this.state(userId) };
  }

  activate(userId, raw) {
    const code = normalizeCode(raw);
    if (!code) throw new AppError('BAD_CODE', 'Введите промокод');
    this.store.tx(() => {
      const p = this.q.promo.get(code);
      if (!p || !p.active) throw new AppError('BAD_CODE', 'Такого промокода нет');
      if (p.uses >= p.uses_max) throw new AppError('CODE_USED_UP', 'Промокод закончился');
      if (this.q.promoUse.run(code, userId, p.spins, Date.now()).changes !== 1) {
        throw new AppError('CODE_ALREADY', 'Вы уже активировали этот промокод', 409);
      }
      if (this.q.promoInc.run(code).changes !== 1) throw new AppError('CODE_USED_UP', 'Промокод закончился');
    });
    return this.state(userId);
  }

  addPromo(raw, usesMax, spins = 1) {
    const code = normalizeCode(raw);
    if (!code || code.length < 3) throw new AppError('BAD_INPUT', 'Промокод — от 3 до 32 букв или цифр');
    if (!Number.isSafeInteger(usesMax) || usesMax < 1 || usesMax > 1_000_000) {
      throw new AppError('BAD_INPUT', 'Количество активаций — от 1 до 1 000 000');
    }
    if (this.q.promo.get(code)) throw new AppError('BAD_INPUT', 'Такой промокод уже есть');
    this.q.promoAdd.run(code, spins, usesMax, Date.now());
    return this.promos();
  }

  promos() {
    return this.q.promoList.all().map((p) => ({ code: p.code, uses: p.uses, usesMax: p.uses_max, spins: p.spins }));
  }

  removePromo(raw) {
    this.q.promoOff.run(normalizeCode(raw));
    return this.promos();
  }

  adminList() {
    return this.q.pending.all().map((w) => ({
      id: w.id,
      prize: PRIZES.find((p) => p.id === w.prize)?.name ?? w.prize,
      image: PRIZES.find((p) => p.id === w.prize)?.image ?? '',
      status: w.status,
      createdAt: w.created_at,
      user: {
        id: w.user_id,
        name: [w.first_name, w.last_name].filter(Boolean).join(' ') || 'Игрок',
        username: w.username,
        photo: w.photo_url,
      },
    }));
  }

  markSent(id) {
    if (this.q.markSent.run(Date.now(), id).changes !== 1) return null;
    return this.q.get.get(id);
  }
}

export function normalizeCode(raw) {
  const s = String(raw ?? '')
    .trim()
    .toUpperCase();
  return /^[A-ZА-ЯЁ0-9_-]{1,32}$/.test(s) ? s : '';
}
