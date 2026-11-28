/** Cron (every 30 min): expire orders, mark inactive cities, remind, bot setup, cleanup. */
import { INACTIVITY } from '../src/game/config.ts';
import { rebuildWorldSummary } from './city.ts';
import type { Env } from './env.ts';
import { expireOrders } from './market.ts';
import { ensureBotSetup, sendText, TEXTS } from './telegram.ts';

const DAY = 86_400_000;

/** Days without a visit after which a city is abandoned. */
export function inactiveDays(th: number, actions: number): number {
  if (actions === 0) return INACTIVITY.untouchedDays;
  return INACTIVITY.daysByTh[Math.max(1, Math.min(6, th)) - 1];
}

export async function markAbandoned(env: Env, now: number): Promise<number> {
  const d = INACTIVITY.daysByTh;
  const res = await env.DB.prepare(
    `UPDATE cities SET status = 'abandoned'
     WHERE status = 'active' AND last_seen < ?1 AND (
       (json_extract(data, '$.actions') = 0 AND last_seen < ?1)
       OR (th <= 2 AND last_seen < ?2)
       OR (th BETWEEN 3 AND 4 AND last_seen < ?3)
       OR (th >= 5 AND last_seen < ?4))`,
  )
    .bind(now - INACTIVITY.untouchedDays * DAY, now - d[1] * DAY, now - d[3] * DAY, now - d[5] * DAY)
    .run();
  return res.meta.changes ?? 0;
}

/** Warn players (who started the bot) shortly before their city is abandoned. */
export async function sendReminders(env: Env, now: number): Promise<number> {
  if (!env.BOT_TOKEN) return 0;
  const minWarnAge = (INACTIVITY.untouchedDays - INACTIVITY.warnDaysBefore) * DAY;
  const rows = await env.DB.prepare(
    `SELECT c.name, c.th, c.last_seen, json_extract(c.data, '$.actions') AS actions, u.id AS user_id, u.warned_at
     FROM cities c JOIN users u ON u.id = c.user_id
     WHERE c.status = 'active' AND u.bot_chat = 1 AND c.last_seen < ?1 AND u.warned_at < c.last_seen
     ORDER BY c.last_seen ASC LIMIT 60`,
  )
    .bind(now - minWarnAge)
    .all<{ name: string; th: number; last_seen: number; actions: number; user_id: number; warned_at: number }>();
  let sent = 0;
  for (const r of rows.results) {
    if (sent >= 20) break; // stay far below the 50 subrequests of the free plan
    const deadline = r.last_seen + inactiveDays(r.th, r.actions) * DAY;
    if (now < deadline - INACTIVITY.warnDaysBefore * DAY) continue;
    const days = Math.max(1, Math.ceil((deadline - now) / DAY));
    try {
      await sendText(env, r.user_id, TEXTS.reminder(r.name, days));
      sent++;
    } catch (e) {
      console.warn('reminder failed', r.user_id, String(e)); // blocked the bot etc.
    }
    await env.DB.prepare('UPDATE users SET warned_at = ?1 WHERE id = ?2').bind(now, r.user_id).run();
  }
  return sent;
}

export async function runCron(env: Env, now: number): Promise<Record<string, number | string>> {
  const out: Record<string, number | string> = {};
  out.expired = await expireOrders(env, now);
  out.abandoned = await markAbandoned(env, now);
  out.reminded = await sendReminders(env, now).catch((e) => {
    console.error('reminders', e);
    return 0;
  });
  out.bot = await ensureBotSetup(env)
    .then((ok) => (ok ? 'ok' : 'no token'))
    .catch((e) => `error: ${String(e)}`);
  out.worldCities = await rebuildWorldSummary(env, now);
  // keep a week of trade history
  const del = await env.DB.prepare('DELETE FROM trades WHERE at < ?1').bind(now - 7 * DAY).run();
  out.tradesDeleted = del.meta.changes ?? 0;
  console.log('cron', JSON.stringify(out));
  return out;
}
