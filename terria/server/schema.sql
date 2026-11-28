-- TERRIA D1 schema. Apply with:
--   npx wrangler d1 execute terria --remote --file server/schema.sql   (production)
--   npx wrangler d1 execute terria --local  --file server/schema.sql   (local dev)
-- Idempotent: safe to run again.

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,                 -- Telegram user id
  name TEXT NOT NULL DEFAULT '',
  username TEXT NOT NULL DEFAULT '',
  region_id INTEGER,                      -- current city, NULL when none
  crystals INTEGER NOT NULL DEFAULT 0 CHECK (crystals >= 0),
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  bot_chat INTEGER NOT NULL DEFAULT 0,    -- 1 once the user started the bot (we may message them)
  warned_at INTEGER NOT NULL DEFAULT 0    -- last inactivity reminder
);

CREATE TABLE IF NOT EXISTS cities (
  region_id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE,
  name TEXT NOT NULL,
  th INTEGER NOT NULL DEFAULT 1,
  pop INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',  -- 'active' | 'abandoned'
  coins REAL NOT NULL DEFAULT 0 CHECK (coins >= 0),
  wood  REAL NOT NULL DEFAULT 0 CHECK (wood >= 0),
  stone REAL NOT NULL DEFAULT 0 CHECK (stone >= 0),
  iron  REAL NOT NULL DEFAULT 0 CHECK (iron >= 0),
  food  REAL NOT NULL DEFAULT 0 CHECK (food >= 0),
  goods REAL NOT NULL DEFAULT 0 CHECK (goods >= 0),
  data TEXT NOT NULL,                     -- CityState JSON without res / crystals
  ver INTEGER NOT NULL DEFAULT 0,
  last_seen INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS cities_status_seen ON cities (status, last_seen);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  region_id INTEGER NOT NULL,
  side TEXT NOT NULL,                     -- 'buy' | 'sell'
  res TEXT NOT NULL,
  qty INTEGER NOT NULL,
  remaining INTEGER NOT NULL CHECK (remaining >= 0),
  total REAL NOT NULL,                    -- price of the whole order
  escrow REAL NOT NULL CHECK (escrow >= 0), -- buy: coins held; sell: coins still to be paid
  status TEXT NOT NULL,                   -- open | filled | cancelled | expired
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
-- unit price in the index so the order book reads only the 50 rows it returns
CREATE INDEX IF NOT EXISTS orders_book ON orders (res, side, status, total / qty);
CREATE INDEX IF NOT EXISTS orders_owner ON orders (region_id, status);
CREATE INDEX IF NOT EXISTS orders_expiry ON orders (status, expires_at);

CREATE TABLE IF NOT EXISTS trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  res TEXT NOT NULL,
  qty INTEGER NOT NULL,
  unit REAL NOT NULL,
  at INTEGER NOT NULL,
  kind TEXT NOT NULL,                     -- 'exchange' | 'system'
  seller INTEGER NOT NULL,                -- region id, -1 = system
  buyer INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS trades_res_at ON trades (res, at);

CREATE TABLE IF NOT EXISTS prices (
  res TEXT PRIMARY KEY,
  ref REAL NOT NULL
);
INSERT OR IGNORE INTO prices (res, ref) VALUES ('wood', 1), ('stone', 1.2), ('iron', 2.5), ('food', 0.75), ('goods', 7);

CREATE TABLE IF NOT EXISTS payments (
  charge_id TEXT PRIMARY KEY,             -- telegram_payment_charge_id: a repeated update cannot credit twice
  user_id INTEGER NOT NULL,
  pack TEXT NOT NULL,
  stars INTEGER NOT NULL,
  crystals INTEGER NOT NULL,
  at INTEGER NOT NULL,
  refunded INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Optimistic-lock trick: inserting NULL here fails the whole batch.
CREATE TABLE IF NOT EXISTS guard (x INTEGER NOT NULL);
