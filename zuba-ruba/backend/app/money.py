from decimal import ROUND_HALF_UP, Decimal, InvalidOperation

MILLI_PER_STAR = 1000
KOPECKS_PER_RUB = 100


class AmountError(ValueError):
    pass


def _decimal(value) -> Decimal:
    if isinstance(value, float):
        value = repr(value)
    try:
        result = Decimal(str(value).strip().replace(",", "."))
    except (InvalidOperation, AttributeError) as exc:
        raise AmountError("Некорректная сумма") from exc
    if not result.is_finite():
        raise AmountError("Некорректная сумма")
    return result


def stars_to_milli(value) -> int:
    amount = _decimal(value) * MILLI_PER_STAR
    if amount != amount.to_integral_value():
        raise AmountError("Точность суммы — не более 0,001 ⭐")
    return int(amount)


def milli_to_str(milli: int) -> str:
    value = Decimal(milli) / MILLI_PER_STAR
    text = format(value.quantize(Decimal("0.001")), "f").rstrip("0").rstrip(".")
    return text if text not in ("", "-0") else "0"


def milli_to_display(milli: int) -> str:
    return milli_to_str(milli).replace(".", ",")


def rub_to_kopecks(value) -> int:
    amount = (_decimal(value) * KOPECKS_PER_RUB).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    return int(amount)


def kopecks_to_str(kopecks: int) -> str:
    return format((Decimal(kopecks) / KOPECKS_PER_RUB).quantize(Decimal("0.01")), "f")


def milli_to_kopecks(milli: int, star_cost_kopecks: int) -> int:
    value = Decimal(milli) * Decimal(star_cost_kopecks) / MILLI_PER_STAR
    return int(value.quantize(Decimal("1"), rounding=ROUND_HALF_UP))
