import time
from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Setting
from app.money import AmountError, _decimal, milli_to_str, rub_to_kopecks, stars_to_milli


@dataclass(frozen=True)
class SettingDef:
    key: str
    label: str
    group: str
    type: str
    default: str
    min: Decimal | None = None
    max: Decimal | None = None


DEFINITIONS: list[SettingDef] = [
    SettingDef("case_prizes", "Призы кейса: сумма ⭐ : вес, через запятую", "Награды", "prizes", "0.1:40,0.2:25,0.3:15,0.5:12,1:6,2:2"),
    SettingDef("reward_boost", "Награда за оплаченный период буста, ⭐", "Награды", "stars", "0.2", Decimal("0"), Decimal("100")),
    SettingDef("tasks_channel_enabled", "Задания: подписки на каналы", "Награды", "bool", "true"),
    SettingDef("tasks_bot_enabled", "Задания: запуск ботов", "Награды", "bool", "true"),
    SettingDef("tasks_other_enabled", "Задания: прочие типы Flyer", "Награды", "bool", "false"),
    SettingDef("daily_spin_enabled", "Ежедневная рулетка на главной", "Ежедневная рулетка", "bool", "true"),
    SettingDef("daily_spin_tasks", "Заданий за день, чтобы открыть прокрутку", "Ежедневная рулетка", "int", "5", Decimal("1"), Decimal("100")),
    SettingDef("daily_spin_prizes", "Призы ежедневной рулетки: сумма ⭐ : вес", "Ежедневная рулетка", "prizes", "0.5:40,0.6:25,0.7:15,0.8:10,0.9:6,1:4"),
    SettingDef("paid_cases_enabled", "Платные кейсы и пополнение звёздами", "Платные кейсы", "bool", "false"),
    SettingDef("paid_case_1_prizes", "Кейс за 1 ⭐: сумма : вес (отдача не выше 80%)", "Платные кейсы", "prizes", "0.2:42,0.5:28,1:17,2:8,3:4,5:1"),
    SettingDef("paid_case_5_prizes", "Кейс за 5 ⭐: сумма : вес (отдача не выше 80%)", "Платные кейсы", "prizes", "1:42,2.5:28,5:17,10:8,15:4,25:1"),
    SettingDef("paid_case_25_prizes", "Кейс за 25 ⭐: сумма : вес (отдача не выше 80%)", "Платные кейсы", "prizes", "5:42,12:28,25:17,50:8,75:4,150:1"),
    SettingDef("paid_case_100_prizes", "Кейс за 100 ⭐: сумма : вес (отдача не выше 80%)", "Платные кейсы", "prizes", "20:42,50:28,100:17,200:8,300:4,500:1"),
    SettingDef("hold_hours_channel", "Удержание подписки, ч", "Ожидание", "int", "30", Decimal("0"), Decimal("720")),
    SettingDef("hold_hours_bot", "Удержание для ботов, ч", "Ожидание", "int", "0", Decimal("0"), Decimal("720")),
    SettingDef("recheck_hours", "Интервал повторной проверки, ч", "Ожидание", "int", "6", Decimal("1"), Decimal("72")),
    SettingDef("waiting_max_hours", "Максимальное ожидание оплаты Flyer, ч", "Ожидание", "int", "72", Decimal("24"), Decimal("720")),
    SettingDef("boosts_enabled", "Показывать задания-бусты", "Бусты", "bool", "true"),
    SettingDef("boost_recurring_enabled", "Повторные начисления за бусты", "Бусты", "bool", "false"),
    SettingDef("boost_first_check_hours", "Первая повторная проверка буста, ч", "Бусты", "int", "48", Decimal("1"), Decimal("720")),
    SettingDef("boost_interval_hours", "Интервал проверок буста, ч", "Бусты", "int", "24", Decimal("1"), Decimal("720")),
    SettingDef("referrals_enabled", "Реферальная программа", "Рефералы", "bool", "true"),
    SettingDef("referral_threshold", "Подтверждённых кейсов друга на один подарочный кейс", "Рефералы", "int", "3", Decimal("1"), Decimal("100")),
    SettingDef("referral_daily_cases_limit", "Подарочных кейсов на пользователя в сутки", "Рефералы", "int", "10", Decimal("0"), Decimal("1000")),
    SettingDef("tasks_limit", "Заданий за запрос к Flyer", "Лимиты", "int", "10", Decimal("1"), Decimal("10")),
    SettingDef("checks_per_minute", "Проверок заданий в минуту на пользователя", "Лимиты", "int", "20", Decimal("1"), Decimal("120")),
    SettingDef("withdrawals_enabled", "Вывод подарками Telegram", "Вывод", "bool", "true"),
    SettingDef("withdraw_gift_stars", "Номиналы подарков для вывода, ⭐ через запятую", "Вывод", "stars_list", "15,25,50,100"),
    SettingDef("withdraw_min_stars", "Минимальная сумма вывода, ⭐", "Вывод", "int", "15", Decimal("1"), Decimal("100000")),
    SettingDef("withdrawals_per_day", "Заявок на вывод в сутки", "Вывод", "int", "3", Decimal("1"), Decimal("100")),
    SettingDef("withdraw_auto", "Отправлять подарки автоматически, без одобрения", "Вывод", "bool", "false"),
    SettingDef("income_channel_rub", "Доход за подписку, ₽", "Экономика", "rub", "1.00", Decimal("0"), Decimal("10000")),
    SettingDef("income_bot_rub", "Доход за запуск бота, ₽", "Экономика", "rub", "1.00", Decimal("0"), Decimal("10000")),
    SettingDef("income_boost_day_rub", "Доход за оплаченный день буста, ₽", "Экономика", "rub", "0.40", Decimal("0"), Decimal("10000")),
    SettingDef("income_other_rub", "Доход за прочие задания, ₽", "Экономика", "rub", "0", Decimal("0"), Decimal("10000")),
    SettingDef("star_cost_rub", "Стоимость 1 ⭐, ₽", "Экономика", "rub", "1.50", Decimal("0"), Decimal("1000")),
    SettingDef("flyer_fee_usd", "Комиссия вывода Flyer, $", "Экономика", "usd", "3.00", Decimal("0"), Decimal("1000")),
    SettingDef("usd_rub", "Курс доллара, ₽", "Экономика", "rub", "90.00", Decimal("1"), Decimal("10000")),
    SettingDef("flyer_withdraw_threshold_rub", "Порог вывода дохода из Flyer, ₽", "Экономика", "rub", "1000.00", Decimal("1"), Decimal("10000000")),
    SettingDef("maintenance", "Режим технического обслуживания", "Общие", "bool", "false"),
    SettingDef("tasks_enabled", "Раздел заданий", "Общие", "bool", "true"),
    SettingDef("support_url", "Ссылка поддержки (https://t.me/...)", "Общие", "string", ""),
]

BY_KEY = {d.key: d for d in DEFINITIONS}


def parse_prizes(raw: str) -> list[tuple[int, int]]:
    table: list[tuple[int, int]] = []
    for part in raw.replace(";", ",").split(","):
        part = part.strip()
        if not part:
            continue
        amount_text, _, weight_text = part.partition(":")
        try:
            amount = stars_to_milli(amount_text)
            weight = int(weight_text.strip())
        except (AmountError, ValueError) as exc:
            raise ValueError(f"Ошибка в «{part}»: нужен формат сумма:вес") from exc
        if not 1 <= amount <= 10_000_000 or not 1 <= weight <= 1_000_000:
            raise ValueError(f"Ошибка в «{part}»: сумма 0,001–10 000 ⭐, вес от 1")
        table.append((amount, weight))
    if not 2 <= len(table) <= 20:
        raise ValueError("Нужно от 2 до 20 призов")
    if len({amount for amount, _ in table}) != len(table):
        raise ValueError("Суммы призов не должны повторяться")
    return sorted(table)


PAID_CASE_PRICES = (1, 5, 25, 100)
PAID_CASE_KEYS = {f"paid_case_{price}_prizes": price for price in PAID_CASE_PRICES}
PAID_RETURN_LIMIT = 0.8


class SettingError(ValueError):
    def __init__(self, key: str, message: str):
        super().__init__(message)
        self.key = key


def normalize(key: str, raw) -> str:
    definition = BY_KEY.get(key)
    if definition is None:
        raise SettingError(key, "Неизвестная настройка")
    if definition.type == "bool":
        if isinstance(raw, bool):
            return "true" if raw else "false"
        text = str(raw).strip().lower()
        if text in ("true", "1", "yes", "on"):
            return "true"
        if text in ("false", "0", "no", "off"):
            return "false"
        raise SettingError(key, "Ожидается да или нет")
    if definition.type == "prizes":
        try:
            table = parse_prizes(str(raw))
        except ValueError as exc:
            raise SettingError(key, str(exc)) from exc
        price = PAID_CASE_KEYS.get(key)
        if price is not None:
            total = sum(weight for _, weight in table)
            expected = sum(amount * weight for amount, weight in table) / total
            if expected > price * 1000 * PAID_RETURN_LIMIT:
                raise SettingError(key, f"Средний приз {expected / 1000:.2f} ⭐ выше 80% цены кейса ({price * PAID_RETURN_LIMIT:.2f} ⭐)")
            if table[0][0] > price * 1000 * PAID_RETURN_LIMIT:
                raise SettingError(key, "Самый маленький приз должен быть не больше 80% цены кейса")
        return ",".join(f"{milli_to_str(amount)}:{weight}" for amount, weight in table)
    if definition.type == "stars_list":
        parts = [part.strip() for part in str(raw).replace(";", ",").split(",") if part.strip()]
        if not parts or not all(part.isdigit() and 1 <= int(part) <= 100000 for part in parts):
            raise SettingError(key, "Целые номиналы через запятую, например 15,25,50,100")
        return ",".join(str(value) for value in sorted({int(part) for part in parts}))
    if definition.type == "string":
        text = str(raw).strip()
        if len(text) > 500:
            raise SettingError(key, "Слишком длинное значение")
        if key == "support_url" and text and not text.startswith("https://"):
            raise SettingError(key, "Ссылка должна начинаться с https://")
        return text
    try:
        value = _decimal(raw)
    except AmountError as exc:
        raise SettingError(key, "Некорректное число") from exc
    if definition.type == "int" and value != value.to_integral_value():
        raise SettingError(key, "Ожидается целое число")
    if definition.min is not None and value < definition.min:
        raise SettingError(key, f"Минимум {definition.min}")
    if definition.max is not None and value > definition.max:
        raise SettingError(key, f"Максимум {definition.max}")
    if definition.type == "stars":
        try:
            stars_to_milli(value)
        except AmountError as exc:
            raise SettingError(key, str(exc)) from exc
        return format(value.normalize(), "f")
    if definition.type == "int":
        return str(int(value))
    return format(value.quantize(Decimal("0.01")), "f")


class RuntimeSettings:
    def __init__(self, values: dict[str, str]):
        self._values = {d.key: d.default for d in DEFINITIONS}
        self._values.update({k: v for k, v in values.items() if k in BY_KEY})

    def raw(self, key: str) -> str:
        return self._values[key]

    def bool(self, key: str) -> bool:
        return self._values[key] == "true"

    def int(self, key: str) -> int:
        return int(self._values[key])

    def milli(self, key: str) -> int:
        return stars_to_milli(self._values[key])

    def kopecks(self, key: str) -> int:
        return rub_to_kopecks(self._values[key])

    def prizes(self, key: str = "case_prizes") -> list[tuple[int, int]]:
        try:
            return parse_prizes(self._values[key])
        except ValueError:
            return parse_prizes(BY_KEY[key].default)

    def int_list(self, key: str) -> list[int]:
        return [int(part) for part in self._values[key].split(",") if part.strip().isdigit()]

    def decimal(self, key: str) -> Decimal:
        return Decimal(self._values[key])

    def items(self) -> list[dict]:
        return [
            {"key": d.key, "label": d.label, "group": d.group, "type": d.type, "value": self._values[d.key]}
            for d in DEFINITIONS
        ]


_cache: tuple[float, RuntimeSettings] | None = None
CACHE_TTL = 5.0


def invalidate_cache() -> None:
    global _cache
    _cache = None


async def load(session: AsyncSession, fresh: bool = False) -> RuntimeSettings:
    global _cache
    if not fresh and _cache is not None and time.monotonic() - _cache[0] < CACHE_TTL:
        return _cache[1]
    rows = (await session.execute(select(Setting.key, Setting.value))).all()
    settings = RuntimeSettings({key: value for key, value in rows})
    _cache = (time.monotonic(), settings)
    return settings


async def update(session: AsyncSession, values: dict, admin_id: int) -> dict[str, tuple[str, str]]:
    current = await load(session, fresh=True)
    errors: dict[str, str] = {}
    normalized: dict[str, str] = {}
    for key, raw in values.items():
        try:
            normalized[key] = normalize(key, raw)
        except SettingError as exc:
            errors[key] = str(exc)
    if errors:
        raise SettingErrors(errors)
    changes: dict[str, tuple[str, str]] = {}
    for key, value in normalized.items():
        old = current.raw(key)
        if old == value:
            continue
        stmt = insert(Setting).values(key=key, value=value, updated_by=admin_id)
        stmt = stmt.on_conflict_do_update(
            index_elements=[Setting.key], set_={"value": value, "updated_by": admin_id, "updated_at": func.now()}
        )
        await session.execute(stmt)
        changes[key] = (old, value)
    invalidate_cache()
    return changes


class SettingErrors(ValueError):
    def __init__(self, errors: dict[str, str]):
        super().__init__("; ".join(f"{k}: {v}" for k, v in errors.items()))
        self.errors = errors
