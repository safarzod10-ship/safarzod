// Все настройки приложения в одном месте. Секреты берутся из окружения (.env), не из кода.

const env = (name, fallback = '') => (process.env[name] ?? fallback).trim();

export const config = Object.freeze({
  botToken: env('BOT_TOKEN'),
  publicUrl: env('PUBLIC_URL'), // https://… — адрес, по которому открывается мини-апп
  supportUsername: env('SUPPORT_USERNAME').replace(/^@/, ''),
  adminId: env('ADMIN_ID'), // Telegram ID администратора: ему приходят заявки на вывод
  channelUrl: env('CHANNEL_URL', 'https://t.me/safroulette'),
  chatUrl: env('CHAT_URL', 'https://t.me/safroulette_chat'),
  // Рефералы: награда пригласившему, когда друг подписался на этот канал (бот должен быть его админом)
  refChannel: env('REF_CHANNEL', '@safroulette'),
  refReward: Number(env('REF_REWARD', '1')),
  port: Number(env('PORT', '3000')),
  dataDir: env('DATA_DIR', './data'),
  // Только для локальной разработки: пускает без Telegram. На сервере всегда выключено.
  devMode: env('DEV_MODE') === '1',

  game: Object.freeze({
    countdownMs: Number(env('COUNTDOWN_MS', '15000')), // приём ставок после второго игрока
    spinMs: Number(env('SPIN_MS', '7000')), // анимация вращения
    resultMs: Number(env('RESULT_MS', '5000')), // показ победителя перед новым раундом
    houseCut: 0.1, // удержание из банка раунда
    houseFreeUpTo: Number(env('HOUSE_FREE_UP_TO', '10')), // банк до этой суммы включительно — без комиссии
    minBet: 1,
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
