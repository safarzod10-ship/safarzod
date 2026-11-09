import { formatDateTime, formatRub, formatStars } from "../format";
import type { AdminCompletion } from "../types";
import { Badge, Button } from "../ui";

const TONE: Record<AdminCompletion["status"], "neutral" | "pending" | "success" | "danger"> = {
  waiting_payment: "pending",
  holding: "pending",
  confirmed: "success",
  cancelled: "danger",
  disputed: "danger",
};

export function CompletionList({
  items,
  onResolve,
  showUser,
}: {
  items: AdminCompletion[];
  onResolve?: (item: AdminCompletion, action: "confirm" | "cancel") => void;
  showUser?: boolean;
}) {
  return (
    <ul className="list">
      {items.map((item) => (
        <li key={item.id} className="admin-item">
          <div className="admin-item-head">
            <span className="op-title">{item.title}</span>
            <Badge tone={TONE[item.status]}>{item.status_label}</Badge>
          </div>
          <div className="kv">
            {showUser && (
              <>
                <span>Пользователь</span>
                <span className="mono">{item.user_id}</span>
              </>
            )}
            <span>Flyer</span>
            <span>{item.flyer_status ?? "—"}</span>
            <span>Награда / доход</span>
            <span>
              {formatStars(item.reward)} / {formatRub(item.income)}
            </span>
            <span>Выполнено</span>
            <span>{formatDateTime(item.completed_at)}</span>
            {item.hold_until && (
              <>
                <span>Удержание до</span>
                <span>{formatDateTime(item.hold_until)}</span>
              </>
            )}
            {item.next_check_at && (
              <>
                <span>След. проверка</span>
                <span>{formatDateTime(item.next_check_at)}</span>
              </>
            )}
            <span>Signature</span>
            <span className="mono ellipsis">{item.signature}</span>
          </div>
          {item.note && <p className="op-reason">{item.note}</p>}
          {onResolve && item.status === "disputed" && (
            <div className="task-actions">
              <Button size="sm" onClick={() => onResolve(item, "confirm")}>
                Подтвердить
              </Button>
              <Button size="sm" variant="danger" onClick={() => onResolve(item, "cancel")}>
                Отменить
              </Button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
