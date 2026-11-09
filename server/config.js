const env = (name, fallback = '') => (process.env[name] ?? fallback).trim();

export function channelRef(url) {
  const m = String(url ?? '')
    .trim()
    .match(/^(?:@|(?:https?:\/\/)?(?:t\.me|telegram\.me)\/)([A-Za-z0-9_]{4,})\/?$/i);
  return m ? `@${m[1]}` : '';
}

const channelUrl = env('CHANNEL_URL', 'https://t.me/rulixapp');

export const config = Object.freeze({
  botToken: env('BOT_TOKEN'),
  publicUrl: env('PUBLIC_URL'),
  supportUsername: env('SUPPORT_USERNAME').replace(/^@/, ''),
  adminId: env('ADMIN_ID'),
  channelUrl,
  chatUrl: env('CHAT_URL', 'https://t.me/safroulette_chat'),
  refPercent: Number(env('REF_PERCENT', '15')),
  withdrawChannel: env('WITHDRAW_CHANNEL') || channelRef(channelUrl),
  port: Number(env('PORT', '3000')),
  dataDir: env('DATA_DIR', './data'),
  devMode: env('DEV_MODE') === '1',

  game: Object.freeze({
    countdownMs: Number(env('COUNTDOWN_MS', '15000')),
    spinMs: Number(env('SPIN_MS', '7000')),
    resultMs: Number(env('RESULT_MS', '5000')),
    houseCut: 0.1,
    houseFreeUpTo: Number(env('HOUSE_FREE_UP_TO', '9')),
    minBet: 1,
  }),

  basket: Object.freeze({
    baseMs: Number(env('BASKET_BASE_MS', '30000')),
    bonusMs: Number(env('BASKET_BONUS_MS', '3000')),
    swishBonusMs: Number(env('BASKET_SWISH_BONUS_MS', '5000')),
    countdownMs: Number(env('BASKET_COUNTDOWN_MS', '3000')),
    price: Number(env('BASKET_PRICE', '5')),
    dailyPrize: Number(env('BASKET_DAILY_PRIZE', '50')),
    tzOffsetMin: Number(env('BASKET_TZ_OFFSET_MIN', '180')),
  }),

  crash: Object.freeze({
    houseEdge: Number(env('CRASH_HOUSE_EDGE', '0.05')),
    minBet: Number(env('CRASH_MIN_BET', '5')),
    maxBet: Number(env('CRASH_MAX_BET', '100')),
    maxWin: Number(env('CRASH_MAX_WIN', '1500')),
    maxRoundPayout: Number(env('CRASH_MAX_ROUND_PAYOUT', '4000')),
    bettingMs: Number(env('CRASH_BETTING_MS', '8000')),
  }),

  wager: Object.freeze({
    deposit: Number(env('WAGER_DEPOSIT', '3')),
    bonus: Number(env('WAGER_BONUS', '3')),
  }),

  gram: Object.freeze({
    wallet: env('GRAM_WALLET'),
    apiKey: env('TONCENTER_API_KEY'),
    rate: Number(env('GRAM_RATE', '76')),
    usd: Number(env('GRAM_USD', '1.06')),
    starBuyUsd: Number(env('STAR_BUY_USD', '0.015')),
    starSellUsd: Number(env('STAR_SELL_USD', '0.013')),
    spread: Number(env('EXCHANGE_SPREAD', '0.15')),
    minDeposit: Number(env('GRAM_MIN_DEPOSIT', '0.1')),
    minWithdraw: Number(env('GRAM_MIN_WITHDRAW', '0.5')),
  }),

  limits: Object.freeze({
    maxAmount: 1_000_000,
    minDeposit: 1,
    minWithdraw: 50,
    withdrawFee: 0.1,
  }),
});

export function assertProductionConfig() {
  const missing = [];
  if (!config.botToken) missing.push('BOT_TOKEN');
  if (!config.publicUrl.startsWith('https://')) missing.push('PUBLIC_URL (https://…)');
  if (missing.length && !config.devMode) {
    console.error(`Не заданы настройки: ${missing.join(', ')}. Запустите ./setup.sh`);
    process.exit(1);
  }
}
