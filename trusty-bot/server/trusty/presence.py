import time

TYPING_SECONDS = 6
_typing: dict[tuple[int, int], float] = {}


def typed(chat_id: int, user_id: int) -> None:
    now = time.monotonic()
    _typing[(chat_id, user_id)] = now
    if len(_typing) > 5000:
        for k in [k for k, t in _typing.items() if now - t > TYPING_SECONDS]:
            _typing.pop(k, None)


def is_typing(chat_id: int, user_id: int) -> bool:
    t = _typing.get((chat_id, user_id))
    return t is not None and time.monotonic() - t < TYPING_SECONDS
