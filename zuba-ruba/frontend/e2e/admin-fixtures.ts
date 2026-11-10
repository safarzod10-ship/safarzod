const now = Date.now();
const iso = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();
const day = (daysAgo: number) => new Date(now - daysAgo * 86_400_000).toISOString().slice(0, 10);

export const ADMIN_ID = 512345678;
const BEAR = "5170233102089322756";
const ROSE = "5168103777563050263";
const CAKE = "5170144170496491616";
const TROPHY = "5168043875654172773";

export const overview = {
  users_total: 1284,
  users_active_24h: 312,
  users_new_24h: 47,
  tasks_completed: 5310,
  tasks_paid: 4870,
  tasks_waiting: 390,
  tasks_disputed: 3,
  boosts_active: 41,
  income: "5126.40",
  reward_expenses: "2191.50",
  net_profit: "2934.90",
  warning: null,
};

function wave(days: number, base: number, spread: number, phase = 0): number[] {
  return Array.from({ length: days }, (_, i) => Math.max(0, Math.round(base + spread * Math.sin((i + phase) / 3) + (i % 5) * (spread / 6))));
}

export function analytics(days: number) {
  const dates = Array.from({ length: days }, (_, i) => day(days - 1 - i));
  const series = {
    new_users: wave(days, 40, 14),
    active_users: wave(days, 260, 60, 1),
    task_checks: wave(days, 900, 220, 2),
    completions: wave(days, 170, 40, 3),
    confirmed: wave(days, 150, 35, 4),
    cancelled: wave(days, 9, 5, 5),
    cases_opened: wave(days, 160, 40, 6),
    payouts: wave(days, 120, 80, 7),
  };
  const result: Record<string, { points: (number | string)[]; total: number | string }> = {};
  for (const [key, points] of Object.entries(series)) result[key] = { points, total: points.reduce((a, b) => a + b, 0) };
  const rewards = wave(days, 55, 20, 2).map((v) => (v / 1.1).toFixed(1));
  result.rewards = { points: rewards, total: rewards.reduce((a, b) => a + Number(b), 0).toFixed(1) };
  return {
    days,
    dates,
    series: result,
    funnel: [
      { key: "registered", label: "Зарегистрировались", count: 1120 },
      { key: "onboarded", label: "Прошли приветствие", count: 1012 },
      { key: "checked", label: "Проверили задание", count: 804 },
      { key: "completed", label: "Выполнили задание", count: 655 },
      { key: "opened", label: "Открыли кейс", count: 610 },
      { key: "withdrew", label: "Получили вывод", count: 92 },
    ],
    top_referrers: [
      { id: 701, username: "marina_k", first_name: "Марина", invited: 58, confirmed_tasks: 412, referral_cases: 131 },
      { id: 702, username: null, first_name: "Олег", invited: 33, confirmed_tasks: 205, referral_cases: 64 },
      { id: 703, username: "denis", first_name: "Денис", invited: 21, confirmed_tasks: 98, referral_cases: 30 },
    ],
    top_earners: [
      { id: 801, username: "alexey_v", first_name: "Алексей", earned: "182.4", available: "12.4" },
      { id: 802, username: "kate", first_name: "Катя", earned: "141.9", available: "41.9" },
      { id: 803, username: null, first_name: "Игорь", earned: "99.3", available: "0.3" },
    ],
    events: [
      { kind: "withdrawal", at: iso(4), user_id: 801, username: "alexey_v", title: "Вывод 50 ⭐", status: "pending" },
      { kind: "dispute", at: iso(46), user_id: 802, username: null, title: "Новости технологий", status: "Flyer не подтвердил оплату в установленный срок" },
      { kind: "flyer_error", at: iso(120), user_id: null, username: null, title: "get_tasks", status: "get_tasks: HTTP 502" },
    ],
  };
}

const userRow = (id: number, username: string | null, first: string, available: string, earned: string, extra: Record<string, unknown> = {}) => ({
  id,
  username,
  first_name: first,
  registered_at: iso(60 * 24 * (id % 40)),
  last_seen_at: iso(id % 300),
  available,
  pending: "0.6",
  is_blocked: false,
  earned,
  is_suspicious: false,
  withdrawing: "0",
  ...extra,
});

export const users = {
  items: [
    userRow(801, "alexey_v", "Алексей", "12.4", "182.4"),
    userRow(802, "kate", "Катя", "41.9", "141.9", { withdrawing: "50" }),
    userRow(803, null, "Игорь", "0.3", "99.3", { is_suspicious: true }),
    userRow(804, "spam_account_with_a_really_long_username", "Бот", "0", "0", { is_blocked: true }),
    userRow(805, "olya", "Оля", "3.1", "15"),
  ],
  total: 1284,
  page: 1,
  pages: 26,
};

const withdrawal = (id: number, userId: number, username: string | null, giftId: string, name: string, stars: number, status: string, label: string, minutes: number, extra: Record<string, unknown> = {}) => ({
  id,
  amount: String(stars),
  stars,
  gift_id: giftId,
  gift_name: name,
  gift_emoji: null,
  status,
  status_label: label,
  comment: null,
  created_at: iso(minutes),
  updated_at: iso(minutes - 2),
  user_id: userId,
  username,
  first_name: username ? null : "Игорь",
  error: null,
  ...extra,
});

export const userCard = {
  user: {
    ...userRow(802, "kate", "Катя", "41.9", "141.9", { withdrawing: "50" }),
    last_name: "Смирнова",
    language_code: "ru",
    referrer_id: 701,
    block_reason: null,
    onboarded: true,
    bot_blocked: false,
  },
  referrer: { id: 701, username: "marina_k", first_name: "Марина" },
  cases: [
    { id: 91, source: "task", label: "Подписка на канал «Новости технологий»", state: "opened", status_label: "В ожидании", amount: "0.5", created_at: iso(70), opened_at: iso(60) },
    { id: 90, source: "referral", label: "Подарочный кейс за @olya", state: "opened", status_label: "Зачислен", amount: "1", created_at: iso(900), opened_at: iso(880) },
    { id: 89, source: "task", label: "Запуск бота «Weather Bot»", state: "ready", status_label: "Не открыт", amount: "0.1", created_at: iso(20), opened_at: null },
  ],
  operations: [
    { id: "o1", kind: "withdrawal", title: "Вывод", amount: "50", direction: "out", status: "pending", reason: "Вывод 50 ⭐ подарком Telegram", created_at: iso(30), updated_at: iso(30) },
    { id: "o2", kind: "case_reward", title: "Награда за кейс", amount: "0.5", direction: "in", status: "pending", reason: "Подписка на канал «Новости технологий»", created_at: iso(60), updated_at: iso(60) },
    { id: "o3", kind: "referral_reward", title: "Реферальная награда", amount: "1", direction: "in", status: "completed", reason: "Подарочный кейс за @olya", created_at: iso(880), updated_at: iso(880) },
    { id: "o4", kind: "adjustment", title: "Корректировка баланса", amount: "5", direction: "in", status: "completed", reason: "Компенсация за сбой проверки", created_at: iso(2000), updated_at: iso(2000) },
  ],
  referrals: [{ id: 805, username: "olya", first_name: "Оля", registered_at: iso(5000), confirmed_tasks: 7 }],
  completions: [
    {
      id: 301,
      user_id: 802,
      signature: "fa0c9b1e7d2a44c1b8e1d0f7a6c2e9b3",
      type: "channel",
      title: "Новости технологий",
      status: "holding",
      status_label: "Период удержания",
      flyer_status: "complete",
      reward: "0.5",
      income: "1.00",
      completed_at: iso(70),
      hold_until: iso(-1700),
      next_check_at: iso(-1700),
      note: null,
    },
  ],
  boosts: [],
  withdrawals: [withdrawal(17, 802, "kate", CAKE, "Торт", 50, "pending", "На рассмотрении", 30)],
};

export const withdrawalQueue = {
  items: [
    withdrawal(17, 802, "kate", CAKE, "Торт", 50, "pending", "На рассмотрении", 30),
    withdrawal(18, 801, "alexey_v", BEAR, "Мишка", 15, "pending", "На рассмотрении", 12),
    withdrawal(19, 803, null, TROPHY, "Кубок", 100, "pending", "На рассмотрении", 3),
  ],
  total: 3,
  pages: 1,
  counts: { pending: 3, processing: 1, done: 54 },
  pending_stars: 180,
  bot_star_balance: 120,
  auto: false,
};

export const stars = {
  balance: 120,
  topped_up: 1500,
  gifted: 1380,
  pending_withdrawals: 180,
  topups: [
    { id: "t2", admin_id: ADMIN_ID, amount: 1000, status: "paid", created_at: iso(3000), paid_at: iso(2995) },
    { id: "t1", admin_id: ADMIN_ID, amount: 500, status: "paid", created_at: iso(9000), paid_at: iso(8990) },
  ],
};

export const tasks = {
  by_type: [
    { type: "channel", label: "Подписки", completed: 3210, paid: 2950, waiting: 210, cancelled: 50, checks: 9100, checks_success: 3400 },
    { type: "bot", label: "Боты", completed: 1900, paid: 1840, waiting: 20, cancelled: 40, checks: 4100, checks_success: 1950 },
    { type: "boost", label: "Бусты", completed: 200, paid: 80, waiting: 120, cancelled: 0, checks: 500, checks_success: 210 },
    { type: "other", label: "Прочие", completed: 0, paid: 0, waiting: 0, cancelled: 0, checks: 0, checks_success: 0 },
  ],
  flyer_errors: [{ created_at: iso(120), method: "get_tasks", error: "get_tasks: HTTP 502" }],
  unpaid: userCard.completions,
  disputed: [{ ...userCard.completions[0], id: 302, status: "disputed", status_label: "На ручной проверке", flyer_status: "waiting", note: "Flyer не подтвердил оплату в установленный срок" }],
  history: [{ created_at: iso(5), user_id: 802, signature: "fa0c9b1e7d2a44c1b8e1d0f7a6c2e9b3", flyer_status: "complete", source: "job" }],
};

export const finance = {
  deposits_stars: "1240",
  paid_cases_spent: "1180",
  paid_cases_won: "861.4",
  paid_cases_margin: "318.6",
  paid_cases_margin_percent: "27.0",
  prize_fund: "82.6",
  income_gross: "5400.00",
  income_confirmed: "5126.40",
  income_flyer_reported: "5098.10",
  rewards_pending: "210.00",
  reward_expenses: "2191.50",
  referral_expenses: "120.00",
  commissions: "540.00",
  liabilities: "3020.50",
  net_profit: "2274.90",
  unopened_cases: "45.00",
  flyer_withdraw_threshold: "1000.00",
  warning: null,
  bot_star_balance: 120,
  withdrawals: withdrawalQueue.items,
  adjustments: [{ ...userCard.operations[3], user_id: 802, admin_id: ADMIN_ID }],
};

export const settings = {
  items: [
    { key: "case_prizes", label: "Призы кейса: сумма ⭐ : вес, через запятую", group: "Награды", type: "prizes", value: "0.1:40,0.2:25,0.3:15,0.5:12,1:6,2:2", default: "0.1:40,0.2:25,0.3:15,0.5:12,1:6,2:2", hint: "Сумма приза и её вес." },
    { key: "reward_boost", label: "Награда за оплаченный период буста, ⭐", group: "Награды", type: "stars", value: "0.25", default: "0.2", hint: "" },
    { key: "tasks_channel_enabled", label: "Задания: подписки на каналы", group: "Награды", type: "bool", value: "true", default: "true", hint: "" },
    { key: "hold_hours_channel", label: "Удержание подписки, ч", group: "Ожидание", type: "int", value: "30", default: "30", hint: "Сколько часов пользователь должен оставаться подписанным." },
    { key: "withdrawals_enabled", label: "Вывод Telegram Stars", group: "Вывод", type: "bool", value: "true", default: "true", hint: "" },
    { key: "withdraw_auto", label: "Отправлять подарки автоматически, без одобрения", group: "Вывод", type: "bool", value: "false", default: "false", hint: "" },
    { key: "withdraw_gift_stars", label: "Номиналы подарков для вывода, ⭐ через запятую", group: "Вывод", type: "stars_list", value: "15,25,50,100", default: "15,25,50,100", hint: "" },
    { key: "star_cost_rub", label: "Стоимость 1 ⭐, ₽", group: "Экономика", type: "rub", value: "1.50", default: "1.50", hint: "" },
    { key: "maintenance", label: "Режим технического обслуживания", group: "Общие", type: "bool", value: "false", default: "false", hint: "" },
    { key: "support_url", label: "Ссылка поддержки (https://t.me/...)", group: "Общие", type: "string", value: "https://t.me/zuba_support", default: "", hint: "" },
  ],
};

export const audience = {
  items: [
    { key: "all", label: "Все пользователи бота", count: 1190 },
    { key: "active7", label: "Активные за 7 дней", count: 640 },
    { key: "balance", label: "С доступным балансом", count: 410 },
    { key: "no_tasks", label: "Ещё не выполняли задания", count: 380 },
  ],
};

export const broadcasts = {
  items: [
    { id: 4, text: "Новые задания уже в приложении — загляни.", image_url: null, buttons: [], audience: "active7", audience_label: "Активные за 7 дней", status: "sending", total: 640, sent: 412, failed: 3, created_at: iso(15), finished_at: null },
    { id: 3, text: "Черновик про подарки", image_url: null, buttons: [[{ text: "Открыть", url: "https://t.me/zuba_ruba_bot" }]], audience: "all", audience_label: "Все пользователи бота", status: "draft", total: 0, sent: 0, failed: 0, created_at: iso(200), finished_at: null },
  ],
};

export const audit = {
  items: [
    { id: 3, admin_id: ADMIN_ID, action: "settings.update", target: "reward_boost", details: { old: "0.2", new: "0.25" }, created_at: iso(10) },
    { id: 2, admin_id: ADMIN_ID, action: "stars.topup_paid", target: "t2", details: { amount: 1000 }, created_at: iso(2995) },
    { id: 1, admin_id: ADMIN_ID, action: "balance.adjust", target: "802", details: { amount: "5", reason: "Компенсация за сбой проверки" }, created_at: iso(2000) },
  ],
  next_cursor: null,
  actions: ["balance.adjust", "settings.update", "stars.topup_paid"],
  admins: [ADMIN_ID],
};

export { BEAR, ROSE };
