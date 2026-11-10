import type { Operation, TaskType, Withdrawal } from "../types";

export interface AdminOverview {
  users_total: number;
  users_active_24h: number;
  users_new_24h: number;
  tasks_completed: number;
  tasks_paid: number;
  tasks_waiting: number;
  tasks_disputed: number;
  boosts_active: number;
  income: string;
  reward_expenses: string;
  net_profit: string;
  warning: string | null;
}

export interface SeriesValue {
  points: (number | string)[];
  total: number | string;
}

export type SeriesKey =
  | "new_users"
  | "active_users"
  | "task_checks"
  | "completions"
  | "confirmed"
  | "cancelled"
  | "cases_opened"
  | "payouts"
  | "rewards";

export interface FunnelStep {
  key: string;
  label: string;
  count: number;
}

export interface TopReferrer {
  id: number;
  username: string | null;
  first_name: string;
  invited: number;
  confirmed_tasks: number;
  referral_cases: number;
}

export interface TopEarner {
  id: number;
  username: string | null;
  first_name: string;
  earned: string;
  available: string;
}

export interface FeedEvent {
  kind: "withdrawal" | "dispute" | "flyer_error";
  at: string;
  user_id: number | null;
  username: string | null;
  title: string;
  status: string | null;
}

export interface AdminAnalytics {
  days: number;
  dates: string[];
  series: Record<SeriesKey, SeriesValue>;
  funnel: FunnelStep[];
  top_referrers: TopReferrer[];
  top_earners: TopEarner[];
  events: FeedEvent[];
}

export interface AdminUserRow {
  id: number;
  username: string | null;
  first_name: string;
  registered_at: string;
  last_seen_at: string | null;
  available: string;
  pending: string;
  is_blocked: boolean;
  earned?: string;
  is_suspicious?: boolean;
  withdrawing?: string;
}

export interface AdminUsersPage {
  items: AdminUserRow[];
  total: number;
  page: number;
  pages: number;
}

export interface AdminUserFull extends AdminUserRow {
  last_name: string | null;
  language_code: string | null;
  referrer_id: number | null;
  block_reason: string | null;
  is_suspicious: boolean;
  withdrawing: string;
  earned: string;
  onboarded: boolean;
  bot_blocked: boolean;
}

export interface AdminCompletion {
  id: number;
  user_id: number;
  signature: string;
  type: TaskType;
  title: string;
  status: "waiting_payment" | "holding" | "confirmed" | "cancelled" | "disputed";
  status_label: string;
  flyer_status: string | null;
  reward: string;
  income: string;
  completed_at: string;
  hold_until: string | null;
  next_check_at: string | null;
  note: string | null;
}

export interface AdminBoost {
  id: number;
  user_id: number;
  channel: string;
  link: string | null;
  status: string;
  assigned_at: string;
  last_check_at: string | null;
  next_check_at: string | null;
  periods_paid: number;
  rewarded: string;
}

export interface AdminCase {
  id: number;
  source: "task" | "referral";
  label: string;
  state: "ready" | "opened" | "cancelled";
  status_label: string;
  amount: string;
  created_at: string;
  opened_at: string | null;
}

export interface AdminUserCard {
  user: AdminUserFull;
  referrer: { id: number; username: string | null; first_name: string } | null;
  cases: AdminCase[];
  operations: Operation[];
  referrals: { id: number; username: string | null; first_name: string; registered_at: string; confirmed_tasks: number }[];
  completions: AdminCompletion[];
  boosts: AdminBoost[];
  withdrawals: AdminGiftWithdrawal[];
}

export interface AdminTasks {
  by_type: { type: TaskType; label: string; completed: number; paid: number; waiting: number; cancelled: number; checks: number; checks_success: number }[];
  flyer_errors: { created_at: string; method: string; error: string }[];
  unpaid: AdminCompletion[];
  disputed: AdminCompletion[];
  history: { created_at: string; user_id: number; signature: string; flyer_status: string | null; source: string }[];
}

export type AdminGiftWithdrawal = Withdrawal & {
  stars?: number;
  gift_id?: string | null;
  gift_name?: string | null;
  gift_emoji?: string | null;
};

export type AdminWithdrawal = AdminGiftWithdrawal & {
  user_id: number;
  username: string | null;
  first_name?: string | null;
  error?: string | null;
};

export type WithdrawalTab = "pending" | "processing" | "done";

export interface AdminWithdrawalQueue {
  items: AdminWithdrawal[];
  total: number;
  pages: number;
  counts: Record<WithdrawalTab, number>;
  pending_stars: number;
  bot_star_balance: number | null;
  auto: boolean;
}

export interface StarTopup {
  id: string;
  admin_id: number;
  amount: number;
  status: "created" | "paid";
  created_at: string;
  paid_at: string | null;
}

export interface AdminStars {
  balance: number | null;
  topped_up: number;
  gifted: number;
  pending_withdrawals: number;
  topups: StarTopup[];
}

export type AdminAdjustment = Operation & {
  user_id: number;
  admin_id: number | null;
};

export interface AdminFinance {
  deposits_stars: string;
  paid_cases_spent: string;
  paid_cases_won: string;
  paid_cases_margin: string;
  paid_cases_margin_percent: string;
  prize_fund: string;
  income_gross: string;
  income_confirmed: string;
  income_flyer_reported: string;
  rewards_pending: string;
  reward_expenses: string;
  referral_expenses: string;
  commissions: string;
  liabilities: string;
  net_profit: string;
  unopened_cases: string;
  flyer_withdraw_threshold: string;
  warning: string | null;
  bot_star_balance: number | null;
  withdrawals: AdminWithdrawal[];
  adjustments: AdminAdjustment[];
}

export interface SettingItem {
  key: string;
  label: string;
  group: string;
  type: string;
  value: string;
  default?: string;
  hint?: string;
}

export interface BroadcastButton {
  text: string;
  url: string;
}

export type Audience = "all" | "active7" | "balance" | "no_tasks";

export interface Broadcast {
  id: number;
  text: string;
  image_url: string | null;
  buttons: BroadcastButton[][];
  audience?: Audience;
  audience_label?: string;
  status: "draft" | "queued" | "sending" | "done" | "cancelled";
  total: number;
  sent: number;
  failed: number;
  created_at: string;
  finished_at: string | null;
}

export interface AudienceSize {
  key: Audience;
  label: string;
  count: number;
}

export interface AuditEntry {
  id: number;
  admin_id: number;
  action: string;
  target: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

export interface AuditPage {
  items: AuditEntry[];
  next_cursor: string | null;
  actions: string[];
  admins: number[];
}

export interface ExportLink {
  url: string;
  file_name: string;
  expires_in: number;
}
