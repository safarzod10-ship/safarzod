export interface Me {
  id: number;
  first_name: string;
  last_name: string | null;
  username: string | null;
  photo_url: string | null;
  registered_at: string;
  onboarded: boolean;
  is_admin: boolean;
  ref_link: string;
}

export interface Config {
  bot_username: string;
  support_url: string | null;
  maintenance: boolean;
  features: { withdrawals: boolean; boosts: boolean; referrals: boolean };
  rewards: { channel: string; bot: string; boost: string; referral_case: string };
  hold_hours: { channel: number; bot: number };
  referral_threshold: number;
  boost: { first_check_hours: number; interval_hours: number; recurring: boolean };
  stars_are_internal: boolean;
}

export interface Balance {
  total: string;
  available: string;
  pending: string;
  withdrawing: string;
}

export type OperationKind = "case_reward" | "boost_reward" | "referral_reward" | "reversal" | "adjustment" | "withdrawal";
export type OperationStatus = "pending" | "completed" | "cancelled" | "failed";

export interface Operation {
  id: string;
  kind: OperationKind;
  title: string;
  amount: string;
  direction: "in" | "out";
  status: OperationStatus;
  reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface Home {
  balance: Balance;
  cases_opened: number;
  cases_ready: number;
  unread_notifications: number;
  recent_operations: Operation[];
}

export interface Page<T> {
  items: T[];
  next_cursor: string | null;
}

export interface NotificationItem {
  id: number;
  title: string;
  text: string;
  created_at: string;
  read: boolean;
}

export type TaskType = "channel" | "bot" | "boost" | "other";
export type TaskStatus = "new" | "incomplete" | "waiting" | "completed" | "cancelled" | "unavailable";

export interface Task {
  signature: string;
  type: TaskType;
  type_label: string;
  title: string;
  conditions: string;
  link: string;
  photo: string | null;
  reward: string;
  status: TaskStatus;
  status_label: string;
  can_check: boolean;
}

export interface TasksResponse {
  items: Task[];
  flyer_error: string | null;
}

export interface CheckResult {
  task: Task;
  result: "incomplete" | "waiting" | "completed" | "cancelled" | "unavailable" | "error";
  message: string;
  case_id: number | null;
}

export interface Case {
  id: number;
  source: "task" | "referral";
  source_label: string;
  state: "ready" | "opened" | "cancelled";
  amount: string | null;
  reward_status: OperationStatus | null;
  created_at: string;
  opened_at: string | null;
}

export interface CasesResponse {
  ready: Case[];
  opened: Case[];
}

export interface Referrals {
  ref_link: string;
  invited: number;
  progress: number;
  threshold: number;
  cases_received: number;
}

export type WithdrawalStatus = "pending" | "approved" | "completed" | "rejected" | "failed";

export interface Withdrawal {
  id: number;
  amount: string;
  status: WithdrawalStatus;
  status_label: string;
  comment: string | null;
  created_at: string;
  updated_at: string;
}

export interface WithdrawalsResponse {
  enabled: boolean;
  disabled_reason: string | null;
  balance: Balance;
  options: string[];
  items: Withdrawal[];
}

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

export interface AdminUserRow {
  id: number;
  username: string | null;
  first_name: string;
  registered_at: string;
  last_seen_at: string | null;
  available: string;
  pending: string;
  is_blocked: boolean;
}

export interface AdminUserFull extends AdminUserRow {
  last_name: string | null;
  language_code: string | null;
  referrer_id: number | null;
  block_reason: string | null;
  is_suspicious: boolean;
  withdrawing: string;
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
  status: "active" | "ended";
  assigned_at: string;
  last_check_at: string | null;
  next_check_at: string | null;
  periods_paid: number;
  rewarded: string;
}

export interface AdminUserCard {
  user: AdminUserFull;
  operations: Operation[];
  referrals: { id: number; username: string | null; first_name: string; registered_at: string; confirmed_tasks: number }[];
  completions: AdminCompletion[];
  boosts: AdminBoost[];
  withdrawals: Withdrawal[];
}

export interface AdminTasks {
  by_type: { type: TaskType; label: string; completed: number; paid: number; waiting: number; cancelled: number; checks: number; checks_success: number }[];
  flyer_errors: { created_at: string; method: string; error: string }[];
  unpaid: AdminCompletion[];
  disputed: AdminCompletion[];
  history: { created_at: string; user_id: number; signature: string; flyer_status: string | null; source: string }[];
}

export interface AdminWithdrawal extends Withdrawal {
  user_id: number;
  username: string | null;
}

export interface AdminAdjustment extends Operation {
  user_id: number;
  admin_id: number;
}

export interface AdminFinance {
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

export type SettingType = "stars" | "rub" | "int" | "bool" | "string" | "usd";

export interface SettingItem {
  key: string;
  label: string;
  group: string;
  type: SettingType;
  value: string | number | boolean | null;
}

export interface BroadcastButton {
  text: string;
  url: string;
}

export interface Broadcast {
  id: number;
  text: string;
  image_url: string | null;
  buttons: BroadcastButton[][];
  status: "draft" | "queued" | "sending" | "done" | "cancelled";
  total: number;
  sent: number;
  failed: number;
  created_at: string;
  finished_at: string | null;
}

export interface AuditEntry {
  id: number;
  admin_id: number;
  action: string;
  target: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}
