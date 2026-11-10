# API ZUBA RUBA

Все маршруты `/api/*` требуют заголовок `Authorization: tma <initData>`, где `initData` — строка `Telegram.WebApp.initData`. Сервер проверяет подпись HMAC-SHA256 и срок `auth_date`.

Суммы в звёздах передаются строкой в десятичном виде с точкой (`"0.3"`, `"12.05"`). Внутри сервер хранит целые тысячные доли звезды (`milli`). Рубли — строки (`"1.50"`).

Даты — ISO 8601 в UTC (`"2026-11-09T17:42:29Z"`).

Ошибки: HTTP 4xx/5xx и тело `{"error": {"code": "string", "message": "текст для пользователя"}}`.

Коды ошибок: `unauthorized`, `forbidden`, `blocked`, `maintenance`, `rate_limited`, `not_found`, `validation`, `conflict`, `flyer_unavailable`, `feature_disabled`, `insufficient_funds`, `internal`.

## Пользователь

### `POST /api/session`
Тело: `{}`. Регистрирует пользователя или обновляет профиль. `start_param` из initData (`ref_<code>`) учитывается только для нового пользователя.

Ответ `Me`:
```json
{
  "id": 123456789,
  "first_name": "Иван",
  "last_name": null,
  "username": "ivan",
  "photo_url": "https://t.me/i/userpic/...",
  "registered_at": "2026-11-09T17:42:29Z",
  "onboarded": false,
  "is_admin": false,
  "ref_link": "https://t.me/zuba_ruba_bot?start=ref_ab12cd34"
}
```

### `GET /api/me` → `Me`
### `POST /api/me/onboarding` → `Me` (onboarded = true)

### `GET /api/config`
```json
{
  "bot_username": "zuba_ruba_bot",
  "support_url": "https://t.me/support_username",
  "maintenance": false,
  "features": { "withdrawals": true, "boosts": true, "referrals": true, "tasks": true },
  "rewards": { "boost": "0.2" },
  "case_prizes": [{ "amount": "0.1", "weight": 40, "chance": "40.0" }, { "amount": "2", "weight": 2, "chance": "2.0" }],
  "case_expected": "0.295",
  "withdraw": { "min_stars": 15, "gift_stars": [15, 25, 50, 100], "per_day": 3, "auto": false },
  "limits": { "checks_per_minute": 20, "referral_daily_cases": 10 },
  "hold_hours": { "channel": 30, "bot": 0 },
  "referral_threshold": 3,
  "boost": { "first_check_hours": 48, "interval_hours": 24, "recurring": false },
  "stars_are_internal": false
}
```

### `GET /api/home`
```json
{
  "balance": { "total": "1.2", "available": "0.6", "pending": "0.6", "withdrawing": "0" },
  "cases_opened": 4,
  "cases_ready": 1,
  "unread_notifications": 2,
  "recent_operations": [Operation]
}
```

`Operation`:
```json
{
  "id": "uuid",
  "kind": "case_reward | boost_reward | referral_reward | daily_spin | reversal | adjustment | withdrawal",
  "title": "Награда за кейс",
  "amount": "0.3",
  "direction": "in | out",
  "status": "pending | completed | cancelled | failed",
  "reason": "Подписка на канал «Название»",
  "created_at": "...",
  "updated_at": "..."
}
```
`title` уже локализован сервером. Для отменённой награды `status = cancelled`, `title = "Отмена награды"`.

### `GET /api/spin`
Ежедневная рулетка. Одна прокрутка в сутки (по Москве) после `tasks_required` заданий, засчитанных за эти сутки (отменённые не учитываются).
```json
{
  "enabled": true, "tasks_done": 3, "tasks_required": 5, "available": false, "spun": false,
  "amount": null, "next_at": "2026-11-10T21:00:00Z",
  "prizes": [{ "amount": "0.5", "weight": 40, "chance": "40.0" }]
}
```
То же значение приходит в поле `spin` ответа `GET /api/home`.

### `POST /api/spin`
Приз выбирает сервер по таблице `daily_spin_prizes` и сразу зачисляет на доступный баланс (операция `daily_spin`). Повторная прокрутка в те же сутки — 409.
```json
{ "amount": "0.7", "balance": Balance, "spin": SpinStatus }
```

Для администратора `test_available = true`, когда настоящая прокрутка недоступна. Тогда `POST /api/spin` возвращает `"test": true`: приз выбирается по той же таблице, но ничего не начисляется и не записывается.

### `POST /api/cases/test`
Только для администратора: тестовое открытие кейса по таблице `case_prizes` без начисления. Ответ `{ "amount": "0.3", "test": true }`.

### `GET /api/paid-cases`
Платные кейсы (включаются настройкой `paid_cases_enabled`).
```json
{ "enabled": true, "balance": Balance, "tiers": [{ "price": 5, "prizes": [PrizeRow], "max": "25", "max_now": "10", "expected": "3.62" }] }
```
`max_now` — самый крупный приз, который сейчас позволяет призовой фонд.

### `POST /api/paid-cases/{price}/open`
Заголовок `Idempotency-Key`. Списывает цену, 80% цены добавляет в призовой фонд, выбирает приз среди тех, что не больше фонда, и зачисляет его. Ответ `{ "id": 1, "price": 5, "prize": "10", "balance": Balance, "tiers": [...] }`. 409 — не хватает звёзд.

### `POST /api/deposits`
Тело `{ "stars": 50 }` → `{ "id": "uuid", "stars": 50, "url": "https://t.me/$..." }`. Ссылку открывает `Telegram.WebApp.openInvoice`. Звёзды зачисляются после `successful_payment` (операция `deposit`).

### `GET /api/operations?cursor=<string>&limit=30`
```json
{ "items": [Operation], "next_cursor": "string | null" }
```

### `GET /api/notifications`
```json
{ "items": [{ "id": 1, "title": "Награда подтверждена", "text": "Начислено: +0,3 ⭐", "created_at": "...", "read": false }] }
```
### `POST /api/notifications/read` → `{ "ok": true }`

## Задания

### `GET /api/tasks?type=all|channel|bot|boost`
```json
{
  "items": [Task],
  "flyer_error": null
}
```
`Task`:
```json
{
  "signature": "string",
  "type": "channel | bot | boost | other",
  "type_label": "Подписка на канал",
  "title": "Название ресурса",
  "conditions": "Подпишись и не отписывайся 30 ч",
  "link": "https://t.me/...",
  "photo": "https://... | null",
  "reward_kind": "case | stars",
  "reward": "2",
  "status": "new | incomplete | waiting | completed | cancelled | unavailable",
  "status_label": "Не выполнено",
  "can_check": true
}
```
Для `reward_kind = case` поле `reward` — максимальный приз кейса, для `stars` — фиксированная награда.

`flyer_error` — текст для пользователя, если Flyer недоступен (список тогда содержит ранее сохранённые незавершённые задания или пуст).

### `POST /api/tasks/{signature}/check`
Ответ:
```json
{ "task": Task, "result": "incomplete | waiting | completed | cancelled | unavailable | error", "message": "текст", "case_id": 15 }
```
`case_id` — номер созданного кейса (для каналов и ботов) или `null`.

## Кейсы

### `GET /api/cases`
```json
{
  "ready": [Case],
  "opened": [Case]
}
```
`Case`:
```json
{
  "id": 15,
  "source": "task | referral",
  "source_label": "Подписка на канал «Название»",
  "state": "ready | opened | cancelled",
  "amount": "0.3 | null",
  "reward_status": "pending | completed | cancelled | null",
  "created_at": "...",
  "opened_at": "... | null"
}
```
`amount` не раскрывается до открытия (`null`). Сумма кейса выбирается сервером по таблице `case_prizes` в момент выдачи кейса и не меняется.

### `POST /api/cases/{id}/open` → `Case` (идемпотентно, повторный вызов возвращает тот же результат)

## Рефералы

### `GET /api/referrals`
```json
{
  "ref_link": "https://t.me/zuba_ruba_bot?start=ref_ab12cd34",
  "invited": 5,
  "progress": 2,
  "threshold": 3,
  "cases_received": 1
}
```

## Вывод

### `GET /api/withdrawals`
```json
{
  "enabled": false,
  "disabled_reason": "Вывод временно недоступен",
  "balance": { "total": "1.2", "available": "0.6", "pending": "0.6", "withdrawing": "0" },
  "options": [{ "gift_id": "5170233102089322756", "stars": 15, "emoji": "🧸", "name": "Мишка" }],
  "items": [Withdrawal]
}
```
`Withdrawal`:
```json
{ "id": 3, "amount": "15", "stars": 15, "gift_id": "5170233102089322756", "gift_emoji": "🧸", "gift_name": "Мишка", "status": "pending | approved | completed | rejected | failed", "status_label": "На рассмотрении", "comment": null, "created_at": "...", "updated_at": "..." }
```

### `POST /api/withdrawals`
Заголовок `Idempotency-Key: <uuid>`. Тело `{ "gift_id": "5170233102089322756" }` → `Withdrawal`. Подарок должен быть в `options`; с баланса резервируется его цена в ⭐.

## Администрирование

Все маршруты `/api/admin/*` доступны только Telegram ID из `ADMIN_IDS`.

- `GET /api/admin/overview`
- `GET /api/admin/users?q=<id|username>` → `{ "items": [AdminUserRow] }`
- `GET /api/admin/users/{id}` → карточка пользователя
- `POST /api/admin/users/{id}/block` — `{ "blocked": true, "reason": "..." }`
- `POST /api/admin/users/{id}/adjust` — `{ "amount": "-0.5", "reason": "..." }`, заголовок `Idempotency-Key`
- `GET /api/admin/tasks`
- `POST /api/admin/completions/{id}/resolve` — `{ "action": "confirm | cancel", "note": "..." }`
- `GET /api/admin/finance`
- `POST /api/admin/withdrawals/{id}/approve`, `POST /api/admin/withdrawals/{id}/reject` — `{ "comment": "..." }`
- `GET /api/admin/settings`, `PATCH /api/admin/settings` — `{ "values": { "key": value } }`
- `GET /api/admin/broadcasts`, `POST /api/admin/broadcasts` (multipart: `text`, `buttons` JSON, `image` файл), `POST /api/admin/broadcasts/{id}/preview`, `POST /api/admin/broadcasts/{id}/send`, `POST /api/admin/broadcasts/{id}/cancel`
- `GET /api/admin/audit?cursor=`

Публичные маршруты:
- `GET /health`
- `POST /flyer/webhook/{secret}` — уведомления Flyer.

## Ответы административных маршрутов

`GET /api/admin/overview`:
```json
{
  "users_total": 120, "users_active_24h": 30, "users_new_24h": 5,
  "tasks_completed": 300, "tasks_paid": 250, "tasks_waiting": 40, "tasks_disputed": 2,
  "boosts_active": 7,
  "income": "250.00", "reward_expenses": "112.50", "net_profit": "130.00",
  "warning": "текст | null"
}
```
Денежные значения в обзоре и финансах — рубли.

`AdminUserRow`: `{ "id": 1, "username": "a", "first_name": "A", "registered_at": "...", "last_seen_at": "...", "available": "0.6", "pending": "0.3", "is_blocked": false }`

`GET /api/admin/users/{id}`:
```json
{
  "user": AdminUserRow & { "last_name": null, "language_code": "ru", "referrer_id": null, "block_reason": null, "is_suspicious": false, "withdrawing": "0" },
  "operations": [Operation],
  "referrals": [{ "id": 2, "username": "b", "first_name": "B", "registered_at": "...", "confirmed_tasks": 4 }],
  "completions": [AdminCompletion],
  "boosts": [AdminBoost],
  "withdrawals": [Withdrawal]
}
```
`AdminCompletion`: `{ "id": 1, "user_id": 1, "signature": "...", "type": "channel", "title": "...", "status": "waiting_payment | holding | confirmed | cancelled | disputed", "status_label": "...", "flyer_status": "waiting", "reward": "0.3", "income": "1.00", "completed_at": "...", "hold_until": "...", "next_check_at": "...", "note": null }`

`AdminBoost`: `{ "id": 1, "user_id": 1, "channel": "...", "link": "...", "status": "active | ended", "assigned_at": "...", "last_check_at": "...", "next_check_at": "...", "periods_paid": 2, "rewarded": "0.4" }`

`GET /api/admin/tasks`:
```json
{
  "by_type": [{ "type": "channel", "label": "Подписки", "completed": 10, "paid": 8, "waiting": 1, "cancelled": 1, "checks": 40, "checks_success": 12 }],
  "flyer_errors": [{ "created_at": "...", "method": "check_task", "error": "..." }],
  "unpaid": [AdminCompletion],
  "disputed": [AdminCompletion],
  "history": [{ "created_at": "...", "user_id": 1, "signature": "...", "flyer_status": "waiting", "source": "user | job | webhook" }]
}
```

`GET /api/admin/finance`:
```json
{
  "income_gross": "300.00", "income_confirmed": "250.00", "income_flyer_reported": "245.10",
  "rewards_pending": "12.00", "reward_expenses": "100.50", "referral_expenses": "12.00",
  "commissions": "270.00", "liabilities": "40.50", "net_profit": "-132.50",
  "unopened_cases": "3.00", "flyer_withdraw_threshold": "1000.00",
  "warning": "текст | null",
  "bot_star_balance": 120,
  "withdrawals": [Withdrawal & { "user_id": 1, "username": "a" }],
  "adjustments": [Operation & { "user_id": 1, "admin_id": 2 }]
}
```

`GET /api/admin/settings`: `{ "items": [{ "key": "reward_channel", "label": "Награда за подписку, ⭐", "group": "Награды", "type": "stars | rub | int | bool | string | usd", "value": "0.3" }] }`. `PATCH` принимает `{ "values": { "reward_channel": "0.4" } }` и возвращает тот же список.

`GET /api/admin/broadcasts`: `{ "items": [{ "id": 1, "text": "...", "image_url": "/api/admin/broadcasts/1/image | null", "buttons": [[{ "text": "...", "url": "..." }]], "status": "draft | queued | sending | done | cancelled", "total": 100, "sent": 98, "failed": 2, "created_at": "...", "finished_at": null }] }`

`GET /api/admin/audit`: `{ "items": [{ "id": 1, "admin_id": 1, "action": "settings.update", "target": "reward_channel", "details": {}, "created_at": "..." }], "next_cursor": null }`
