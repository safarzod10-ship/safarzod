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
  features: { withdrawals: boolean; boosts: boolean; referrals: boolean; tasks: boolean };
  rewards: { boost: string };
  case_prizes: PrizeRow[];
  case_expected: string;
  withdraw: { min_stars: number; gift_stars: number[]; per_day: number; auto: boolean };
  limits: { checks_per_minute: number; referral_daily_cases: number };
  hold_hours: { channel: number; bot: number };
  referral_threshold: number;
  boost: { first_check_hours: number; interval_hours: number; recurring: boolean };
  stars_are_internal: boolean;
  daily_spin: { enabled: boolean; tasks_required: number; prizes: PrizeRow[] };
}

export interface PrizeRow {
  amount: string;
  weight: number;
  chance: string;
}

export interface Balance {
  total: string;
  available: string;
  pending: string;
  withdrawing: string;
}

export type OperationKind = "case_reward" | "boost_reward" | "referral_reward" | "daily_spin" | "reversal" | "adjustment" | "withdrawal";
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

export interface SpinStatus {
  enabled: boolean;
  tasks_done: number;
  tasks_required: number;
  available: boolean;
  spun: boolean;
  amount: string | null;
  next_at: string;
  prizes: PrizeRow[];
}

export interface SpinResult {
  amount: string;
  balance: Balance;
  spin: SpinStatus;
}

export interface Home {
  spin: SpinStatus;
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
  reward_kind: "case" | "stars";
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

export interface GiftOption {
  gift_id: string;
  stars: number;
  emoji: string | null;
  name: string;
}

export interface Withdrawal {
  id: number;
  amount: string;
  stars: number;
  gift_id: string | null;
  gift_emoji: string | null;
  gift_name: string;
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
  options: GiftOption[];
  items: Withdrawal[];
}
