import json
import time

import httpx
import pytest
from conftest import BOT_TOKEN, init_data_for

from app.flyer import FlyerClient, FlyerError, parse_task
from app.money import AmountError, kopecks_to_str, milli_to_display, milli_to_kopecks, milli_to_str, rub_to_kopecks, stars_to_milli
from app.settings_store import SettingError, normalize
from app.telegram_auth import InitDataError, validate


def test_money_conversions():
    assert stars_to_milli("0.3") == 300
    assert stars_to_milli("2") == 2000
    assert stars_to_milli("0,1") == 100
    assert milli_to_str(300) == "0.3"
    assert milli_to_str(2000) == "2"
    assert milli_to_str(-1250) == "-1.25"
    assert milli_to_display(300) == "0,3"
    assert rub_to_kopecks("1.50") == 150
    assert rub_to_kopecks(0.4) == 40
    assert kopecks_to_str(40) == "0.40"
    assert milli_to_kopecks(300, 150) == 45
    with pytest.raises(AmountError):
        stars_to_milli("0.0001")
    with pytest.raises(AmountError):
        stars_to_milli("abc")
    with pytest.raises(AmountError):
        stars_to_milli("NaN")


def test_init_data_valid_and_tampered():
    raw = init_data_for(42, start_param="ref_abcdef12")
    data = validate(raw, BOT_TOKEN, 3600)
    assert data.user.id == 42
    assert data.start_param == "ref_abcdef12"
    with pytest.raises(InitDataError):
        validate(raw.replace("user42", "user43"), BOT_TOKEN, 3600)
    with pytest.raises(InitDataError):
        validate(raw, "999:other", 3600)
    with pytest.raises(InitDataError):
        validate(init_data_for(42, auth_date=int(time.time()) - 7200), BOT_TOKEN, 3600)
    with pytest.raises(InitDataError):
        validate("", BOT_TOKEN, 3600)


def test_settings_validation():
    assert normalize("reward_boost", "0,40") == "0.4"
    assert normalize("case_prizes", "0.5:10; 0.1:90") == "0.1:90,0.5:10"
    assert normalize("withdraw_gift_stars", "100, 15,25") == "15,25,100"
    assert normalize("maintenance", True) == "true"
    assert normalize("hold_hours_channel", "30") == "30"
    for key, value in [("reward_boost", "-1"), ("case_prizes", "0.1:1"), ("case_prizes", "0.1:5,0.1:5"), ("case_prizes", "x:1,0.2:1"), ("withdraw_gift_stars", "15,abc"), ("hold_hours_channel", "1.5"), ("support_url", "http://x"), ("unknown", "1"), ("tasks_limit", "11")]:
        with pytest.raises(SettingError):
            normalize(key, value)


def test_parse_task_mapping():
    task = parse_task({"signature": "s1", "task": "subscribe channel", "price": 1.2, "links": ["https://t.me/x"], "name": "X"})
    assert task.task_type == "channel" and task.price_kopecks == 120
    assert parse_task({"signature": "s2", "task": "give boost", "links": ["https://t.me/boost/x"]}).task_type == "boost"
    assert parse_task({"signature": "s3", "task": "view posts", "links": ["https://t.me/x"]}).task_type == "other"
    assert parse_task({"signature": "s4", "task": "start bot", "links": []}) is None
    assert parse_task({"task": "start bot", "links": ["https://t.me/x"]}) is None


async def test_flyer_client_errors():
    responses = iter(
        [
            httpx.Response(200, json={"result": None, "error": "Invalid key"}),
            httpx.Response(500, text="oops"),
            httpx.Response(200, text="not json"),
            httpx.Response(200, json={"result": "strange"}),
            httpx.Response(200, json={"result": "waiting"}),
        ]
    )
    seen = []

    def handler(request):
        seen.append(json.loads(request.content))
        return next(responses)

    client = FlyerClient("FL-k", "https://flyer.test", transport=httpx.MockTransport(handler))
    for _ in range(4):
        with pytest.raises(FlyerError):
            await client.check_task("sig")
    assert await client.check_task("sig") == "waiting"
    assert seen[0] == {"key": "FL-k", "signature": "sig"}
    await client.close()
    with pytest.raises(FlyerError):
        await FlyerClient("").get_tasks(1, "ru", 5)


def test_case_prize_draw_distribution():
    from collections import Counter

    from app.services import prizes
    from app.settings_store import RuntimeSettings

    settings = RuntimeSettings({"case_prizes": "0.1:70,0.5:25,2:5"})
    counts = Counter(prizes.draw(settings) for _ in range(20000))
    assert set(counts) == {100, 500, 2000}
    assert 0.67 < counts[100] / 20000 < 0.73 and 0.035 < counts[2000] / 20000 < 0.065
    assert prizes.expected_milli(settings) == 295
    assert [row["chance"] for row in prizes.table_view(settings)] == ["70.0", "25.0", "5.0"]
