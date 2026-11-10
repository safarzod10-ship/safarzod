const now = Date.now();
const iso = (offsetMinutes: number) => new Date(now - offsetMinutes * 60_000).toISOString();

export const me = {
  id: 512345678,
  first_name: "Алексей",
  last_name: "Смирнов",
  username: "alexey_s",
  photo_url: null,
  registered_at: iso(60 * 24 * 12),
  onboarded: true,
  is_admin: true,
  ref_link: "https://t.me/zuba_ruba_bot?start=ref_ab12cd34",
};

export const config = {
  bot_username: "zuba_ruba_bot",
  support_url: "https://t.me/zuba_support",
  maintenance: false,
  features: { withdrawals: true, boosts: true, referrals: true, tasks: true },
  rewards: { boost: "0.2" },
  case_prizes: [
    { amount: "0.1", weight: 40, chance: "40.0" },
    { amount: "0.2", weight: 25, chance: "25.0" },
    { amount: "0.3", weight: 15, chance: "15.0" },
    { amount: "0.5", weight: 12, chance: "12.0" },
    { amount: "1", weight: 6, chance: "6.0" },
    { amount: "2", weight: 2, chance: "2.0" },
  ],
  case_expected: "0.295",
  withdraw: { min_stars: 15, gift_stars: [15, 25, 50, 100], per_day: 3, auto: false },
  limits: { checks_per_minute: 20, referral_daily_cases: 10 },
  daily_spin: {
    enabled: true,
    tasks_required: 5,
    prizes: [
      { amount: "0.5", weight: 40, chance: "40.0" },
      { amount: "0.6", weight: 25, chance: "25.0" },
      { amount: "0.7", weight: 15, chance: "15.0" },
      { amount: "0.8", weight: 10, chance: "10.0" },
      { amount: "0.9", weight: 6, chance: "6.0" },
      { amount: "1", weight: 4, chance: "4.0" },
    ],
  },
  hold_hours: { channel: 30, bot: 0 },
  referral_threshold: 3,
  boost: { first_check_hours: 48, interval_hours: 24, recurring: false },
  stars_are_internal: false,
};

const balance = { total: "21.45", available: "18.3", pending: "3.15", withdrawing: "0" };

const operations = [
  { id: "a1", kind: "case_reward", title: "Награда за кейс", amount: "0.3", direction: "in", status: "pending", reason: "Подписка на канал «Новости технологий и науки каждый день»", created_at: iso(15), updated_at: iso(15) },
  { id: "a2", kind: "boost_reward", title: "Награда за буст", amount: "0.2", direction: "in", status: "completed", reason: "Буст канала «Дизайн»", created_at: iso(120), updated_at: iso(120) },
  { id: "a3", kind: "case_reward", title: "Отмена награды", amount: "0.3", direction: "in", status: "cancelled", reason: "Подписка не подтверждена в обязательный период", created_at: iso(600), updated_at: iso(300) },
  { id: "a4", kind: "referral_reward", title: "Реферальная награда", amount: "0.3", direction: "in", status: "completed", reason: "Подарочный кейс за приглашённого друга", created_at: iso(1600), updated_at: iso(1600) },
  { id: "a5", kind: "withdrawal", title: "Вывод", amount: "15", direction: "out", status: "completed", reason: "Заявка №3", created_at: iso(4000), updated_at: iso(3900) },
];

const spinPrizes = [
  { amount: "0.5", weight: 40, chance: "40.0" },
  { amount: "0.6", weight: 25, chance: "25.0" },
  { amount: "0.7", weight: 15, chance: "15.0" },
  { amount: "0.8", weight: 10, chance: "10.0" },
  { amount: "0.9", weight: 6, chance: "6.0" },
  { amount: "1", weight: 4, chance: "4.0" },
];

export const spinProgress = { enabled: true, tasks_done: 3, tasks_required: 5, available: false, spun: false, amount: null, next_at: iso(-600), prizes: spinPrizes };
export const spinReady = { ...spinProgress, tasks_done: 5, available: true };
export const spinDone = { ...spinReady, available: false, spun: true, amount: "0.8" };
export const spinResult = { amount: "0.8", balance: { ...balance, available: "19.1", total: "22.25" }, spin: spinDone };

export const home = { balance, cases_opened: 14, cases_ready: 2, unread_notifications: 2, recent_operations: operations, spin: spinProgress };

export const tasks = {
  items: [
    { signature: "s1", type: "channel", type_label: "Подписка на канал", title: "Новости технологий и науки каждый день", conditions: "Подпишись и не отписывайся 30 ч", link: "https://t.me/example_channel", photo: null, reward_kind: "case", reward: "2", status: "new", status_label: "Не выполнено", can_check: true },
    { signature: "s2", type: "bot", type_label: "Запуск бота", title: "Weather Bot", conditions: "Запусти бота командой /start", link: "https://t.me/example_bot", photo: null, reward_kind: "case", reward: "2", status: "incomplete", status_label: "Не выполнено", can_check: true },
    { signature: "s3", type: "boost", type_label: "Буст канала", title: "Дизайн", conditions: "Отдай буст каналу и сохраняй его", link: "https://t.me/boost/example", photo: null, reward_kind: "stars", reward: "0.2", status: "waiting", status_label: "Ожидает подтверждения", can_check: false },
    { signature: "s4", type: "channel", type_label: "Подписка на канал", title: "Кулинария", conditions: "Подпишись и не отписывайся 30 ч", link: "https://t.me/example_food", photo: null, reward_kind: "case", reward: "2", status: "completed", status_label: "Выполнено", can_check: false },
  ],
  flyer_error: null,
};

export const checkResult = {
  task: { ...tasks.items[0], status: "waiting", status_label: "Ожидает подтверждения", can_check: false },
  result: "waiting",
  message: "Задание выполнено. Кейс доступен, награда ждёт подтверждения.",
  case_id: 99,
};

export const cases = {
  ready: [
    { id: 99, source: "task", source_label: "Подписка на канал «Новости технологий»", state: "ready", amount: null, reward_status: null, created_at: iso(5), opened_at: null },
    { id: 98, source: "referral", source_label: "Приглашённый друг выполнил 3 задания", state: "ready", amount: null, reward_status: null, created_at: iso(50), opened_at: null },
  ],
  opened: [
    { id: 90, source: "task", source_label: "Запуск бота «Weather Bot»", state: "opened", amount: "0.3", reward_status: "completed", created_at: iso(500), opened_at: iso(490) },
    { id: 89, source: "task", source_label: "Подписка на канал «Кулинария»", state: "opened", amount: "0.3", reward_status: "pending", created_at: iso(900), opened_at: iso(880) },
    { id: 88, source: "task", source_label: "Подписка на канал «Спорт»", state: "opened", amount: "0.3", reward_status: "cancelled", created_at: iso(3000), opened_at: iso(2990) },
  ],
};

export const openedCase = { ...cases.ready[0], state: "opened", amount: "0.3", reward_status: "pending", opened_at: iso(0) };

export const referrals = { ref_link: me.ref_link, invited: 5, progress: 2, threshold: 3, cases_received: 1 };

export const withdrawals = {
  enabled: true,
  disabled_reason: null,
  balance,
  options: [
    { gift_id: "5170145012310081615", stars: 15, emoji: "💝", name: "Сердце" },
    { gift_id: "5170233102089322756", stars: 15, emoji: "🧸", name: "Мишка" },
    { gift_id: "5168103777563050263", stars: 25, emoji: "🌹", name: "Роза" },
    { gift_id: "5170250947678437525", stars: 25, emoji: "🎁", name: "Подарок" },
    { gift_id: "5170144170496491616", stars: 50, emoji: "🎂", name: "Торт" },
    { gift_id: "5170564780938756245", stars: 50, emoji: "🚀", name: "Ракета" },
    { gift_id: "5168043875654172773", stars: 100, emoji: "🏆", name: "Кубок" },
    { gift_id: "5170521118301225164", stars: 100, emoji: "💎", name: "Алмаз" },
  ],
  items: [
    { id: 4, amount: "15", stars: 15, gift_id: "5170233102089322756", gift_emoji: "🧸", gift_name: "Мишка", status: "pending", status_label: "На рассмотрении", comment: null, created_at: iso(30), updated_at: iso(30) },
    { id: 3, amount: "25", stars: 25, gift_id: "5168103777563050263", gift_emoji: "🌹", gift_name: "Роза", status: "completed", status_label: "Отправлено", comment: null, created_at: iso(4000), updated_at: iso(3900) },
  ],
};

export const notifications = {
  items: [
    { id: 2, title: "Награда подтверждена", text: "Начислено: +0,3 ⭐\nНаграда доступна на балансе.", created_at: iso(20), read: false },
    { id: 1, title: "Начисление за буст", text: "Начислено: +0,2 ⭐", created_at: iso(200), read: true },
  ],
};

export const operationsPage = { items: operations, next_cursor: null };
