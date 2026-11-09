import logging
from dataclasses import dataclass

import httpx

from app.money import AmountError, rub_to_kopecks

log = logging.getLogger(__name__)

TASK_TYPES = {
    "subscribe channel": "channel",
    "start bot": "bot",
    "give boost": "boost",
}
CHECK_STATUSES = {"incomplete", "waiting", "complete", "abort", "unavailable"}


class FlyerError(Exception):
    pass


@dataclass(frozen=True)
class FlyerTaskData:
    signature: str
    flyer_type: str
    task_type: str
    title: str
    links: list[str]
    photo: str | None
    resource_id: int | None
    price_kopecks: int
    status: str | None


def parse_task(raw: dict) -> FlyerTaskData | None:
    signature = raw.get("signature")
    if not isinstance(signature, str) or not signature or len(signature) > 512:
        return None
    flyer_type = str(raw.get("task") or "")
    links = [link for link in (raw.get("links") or []) if isinstance(link, str) and link.startswith(("https://", "http://", "tg://"))]
    if not links:
        return None
    try:
        price = rub_to_kopecks(raw.get("price") or 0)
    except AmountError:
        price = 0
    resource_id = raw.get("resource_id")
    return FlyerTaskData(
        signature=signature,
        flyer_type=flyer_type,
        task_type=TASK_TYPES.get(flyer_type, "other"),
        title=str(raw.get("name") or "").strip()[:300],
        links=links,
        photo=raw.get("photo") if isinstance(raw.get("photo"), str) else None,
        resource_id=resource_id if isinstance(resource_id, int) else None,
        price_kopecks=max(price, 0),
        status=raw.get("status") if isinstance(raw.get("status"), str) else None,
    )


class FlyerClient:
    def __init__(self, key: str, base_url: str = "https://api.flyerhubs.com", transport: httpx.AsyncBaseTransport | None = None, timeout: float = 8.0):
        self._key = key
        self._client = httpx.AsyncClient(base_url=base_url, timeout=timeout, transport=transport)

    @property
    def configured(self) -> bool:
        return bool(self._key)

    async def close(self) -> None:
        await self._client.aclose()

    async def _call(self, method: str, **params) -> dict:
        if not self._key:
            raise FlyerError("Ключ Flyer не задан")
        try:
            response = await self._client.post(f"/{method}", json={"key": self._key, **params})
        except httpx.HTTPError as exc:
            raise FlyerError(f"{method}: сетевая ошибка {type(exc).__name__}") from exc
        if response.status_code != 200:
            raise FlyerError(f"{method}: HTTP {response.status_code}")
        try:
            data = response.json()
        except ValueError as exc:
            raise FlyerError(f"{method}: ответ не JSON") from exc
        if not isinstance(data, dict):
            raise FlyerError(f"{method}: неожиданный ответ")
        if data.get("error") and data.get("result") is None:
            raise FlyerError(f"{method}: {data['error']}")
        if data.get("warning"):
            log.warning("flyer %s warning: %s", method, data["warning"])
        return data

    async def get_me(self) -> dict:
        return await self._call("get_me")

    async def get_tasks(self, user_id: int, language_code: str | None, limit: int) -> list[FlyerTaskData]:
        params: dict = {"user_id": user_id, "limit": max(1, min(limit, 10))}
        if language_code:
            params["language_code"] = language_code
        data = await self._call("get_tasks", **params)
        result = data.get("result")
        if result is None:
            raise FlyerError("get_tasks: пустой результат")
        if not isinstance(result, list):
            raise FlyerError("get_tasks: неожиданный формат")
        tasks = []
        for raw in result:
            if isinstance(raw, dict):
                parsed = parse_task(raw)
                if parsed is not None:
                    tasks.append(parsed)
        return tasks

    async def check_task(self, signature: str) -> str:
        data = await self._call("check_task", signature=signature)
        status = data.get("result")
        if status not in CHECK_STATUSES:
            raise FlyerError(f"check_task: неизвестный статус {status!r}")
        return status
