import secrets
from decimal import Decimal

from app.money import milli_to_str
from app.settings_store import RuntimeSettings

_random = secrets.SystemRandom()


def draw(settings: RuntimeSettings) -> int:
    return draw_from(settings, "case_prizes")


def draw_from(settings: RuntimeSettings, key: str) -> int:
    table = settings.prizes(key)
    amounts = [amount for amount, _ in table]
    weights = [weight for _, weight in table]
    return _random.choices(amounts, weights=weights, k=1)[0]


def expected_milli(settings: RuntimeSettings, key: str = "case_prizes") -> int:
    table = settings.prizes(key)
    total = sum(weight for _, weight in table)
    return round(sum(amount * weight for amount, weight in table) / total)


def table_view(settings: RuntimeSettings, key: str = "case_prizes") -> list[dict]:
    table = settings.prizes(key)
    total = sum(weight for _, weight in table)
    return [
        {
            "amount": milli_to_str(amount),
            "weight": weight,
            "chance": format((Decimal(weight) * 100 / total).quantize(Decimal("0.1")), "f"),
        }
        for amount, weight in table
    ]


def max_milli(settings: RuntimeSettings) -> int:
    return max(amount for amount, _ in settings.prizes())
