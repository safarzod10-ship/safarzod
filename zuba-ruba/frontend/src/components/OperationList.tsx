import type { ReactNode } from "react";
import { formatDateTime } from "../format";
import { IconArrowDown, IconArrowUp, IconBolt, IconCase, IconGift, IconStarLine, IconUndo, IconUsers } from "../icons";
import { Amount } from "../stars";
import type { Operation, OperationKind, OperationStatus } from "../types";
import { Badge } from "../ui";

const STATUS: Record<OperationStatus, { label: string; tone: "neutral" | "pending" | "success" | "danger" }> = {
  pending: { label: "В ожидании", tone: "pending" },
  completed: { label: "Зачислено", tone: "success" },
  cancelled: { label: "Отменено", tone: "danger" },
  failed: { label: "Не выполнено", tone: "danger" },
};

const ICONS: Record<OperationKind, ReactNode> = {
  case_reward: <IconCase size={20} />,
  boost_reward: <IconBolt size={20} />,
  referral_reward: <IconUsers size={20} />,
  daily_spin: <IconStarLine size={20} />,
  deposit: <IconArrowDown size={20} />,
  case_purchase: <IconCase size={20} />,
  paid_case_reward: <IconStarLine size={20} />,
  reversal: <IconUndo size={20} />,
  adjustment: <IconArrowUp size={20} />,
  withdrawal: <IconGift size={20} />,
};

function statusFor(op: Operation) {
  if (op.kind === "withdrawal" && op.status === "completed") return { label: "Отправлено", tone: "success" as const };
  if (op.kind === "withdrawal" && op.status === "pending") return { label: "В обработке", tone: "pending" as const };
  if (op.kind === "withdrawal" && op.status === "failed") return { label: "Возвращено", tone: "neutral" as const };
  if (op.direction === "out" && op.status === "completed") return { label: "Списано", tone: "neutral" as const };
  return STATUS[op.status];
}

export function OperationRow({ op }: { op: Operation }) {
  const status = statusFor(op);
  const struck = op.status === "cancelled" || op.status === "failed";
  const tone = struck ? "op-icon-muted" : op.direction === "in" ? "op-icon-in" : "op-icon-out";
  return (
    <li className="op-row">
      <span className={`op-icon ${tone}`}>{ICONS[op.kind]}</span>
      <div className="op-main">
        <span className="op-title">{op.title}</span>
        {op.reason && <span className="op-reason">{op.reason}</span>}
        <span className="op-date">{formatDateTime(op.created_at)}</span>
      </div>
      <div className="op-side">
        <Amount
          value={op.amount}
          sign={op.direction === "in" ? "+" : "-"}
          size={14}
          className={["op-amount", op.direction === "in" && !struck ? "op-amount-in" : "", struck ? "op-amount-struck" : ""].join(" ")}
        />
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>
    </li>
  );
}

export function OperationList({ items }: { items: Operation[] }) {
  return (
    <ul className="list op-list">
      {items.map((op) => (
        <OperationRow key={op.id} op={op} />
      ))}
    </ul>
  );
}
