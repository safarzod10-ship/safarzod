import { formatDateTime, formatStars } from "../format";
import type { Operation, OperationStatus } from "../types";
import { Badge } from "../ui";

const STATUS: Record<OperationStatus, { label: string; tone: "neutral" | "pending" | "success" | "danger" }> = {
  pending: { label: "В ожидании", tone: "pending" },
  completed: { label: "Зачислено", tone: "success" },
  cancelled: { label: "Отменено", tone: "danger" },
  failed: { label: "Ошибка", tone: "danger" },
};

function statusFor(op: Operation) {
  if (op.kind === "withdrawal" && op.status === "completed") return { label: "Выполнено", tone: "success" as const };
  if (op.kind === "withdrawal" && op.status === "pending") return { label: "В обработке", tone: "pending" as const };
  if (op.direction === "out" && op.status === "completed") return { label: "Списано", tone: "neutral" as const };
  return STATUS[op.status];
}

export function OperationRow({ op }: { op: Operation }) {
  const status = statusFor(op);
  const struck = op.status === "cancelled" || op.status === "failed";
  return (
    <li className="op-row">
      <div className="op-main">
        <span className="op-title">{op.title}</span>
        {op.reason && <span className="op-reason">{op.reason}</span>}
        <span className="op-date">{formatDateTime(op.created_at)}</span>
      </div>
      <div className="op-side">
        <span className={["op-amount", op.direction === "in" && !struck ? "op-amount-in" : "", struck ? "op-amount-struck" : ""].join(" ")}>
          {formatStars(op.amount, { sign: op.direction === "in" ? "+" : "-" })}
        </span>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>
    </li>
  );
}

export function OperationList({ items }: { items: Operation[] }) {
  return (
    <ul className="list">
      {items.map((op) => (
        <OperationRow key={op.id} op={op} />
      ))}
    </ul>
  );
}
