"""Applies the IT Trusty public profile to the bot: avatar, descriptions, command menu.

Usage:
    TRUSTY_BOT_TOKEN=123:abc python3 setup_profile.py            # everything
    TRUSTY_BOT_TOKEN=123:abc python3 setup_profile.py --no-photo # texts and commands only

The token is read from the environment only and is never written to disk.
The picture/animation of the "What can this bot do?" block has no Bot API method:
upload brand/logo/png/it-trusty-description-640x360.jpg in @BotFather -> Edit Bot -> Edit Description Picture.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request
import uuid

HERE = os.path.dirname(os.path.abspath(__file__))
AVATAR = os.path.join(HERE, "..", "brand", "logo", "png", "telegram-avatar-640.jpg")

DESCRIPTION = ("Безопасный сервис для проведения сделок. Простой и удобный инструмент для прозрачного сотрудничества, "
               "фиксации договорённостей и комфортной работы на каждом этапе.")
SHORT_DESCRIPTION = "Безопасные сделки с разработчиками. Оплата в USDT через гаранта, после приёмки работы."
def call(token, method, params=None, files=None, retries=4):
    url = f"https://api.telegram.org/bot{token}/{method}"
    if files:
        boundary = uuid.uuid4().hex
        body = b""
        for k, v in (params or {}).items():
            body += (f"--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n").encode()
        for k, (name, data, ctype) in files.items():
            body += (f"--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"; filename=\"{name}\"\r\n"
                     f"Content-Type: {ctype}\r\n\r\n").encode() + data + b"\r\n"
        body += f"--{boundary}--\r\n".encode()
        headers = {"Content-Type": f"multipart/form-data; boundary={boundary}"}
    else:
        body = json.dumps(params or {}).encode()
        headers = {"Content-Type": "application/json"}
    for attempt in range(retries):
        req = urllib.request.Request(url, data=body, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            res = json.loads(e.read() or b"{}")
            if e.code >= 500 and attempt < retries - 1:
                time.sleep(2 ** attempt)
                continue
            return res
        except urllib.error.URLError as e:
            if attempt < retries - 1:
                time.sleep(2 ** attempt)
                continue
            return {"ok": False, "description": str(e)}


def main():
    token = os.environ.get("TRUSTY_BOT_TOKEN")
    if not token:
        sys.exit("Set TRUSTY_BOT_TOKEN in the environment.")
    assert len(DESCRIPTION) <= 512 and len(SHORT_DESCRIPTION) <= 120
    steps = [
        ("getMe", lambda: call(token, "getMe")),
        ("setMyDescription", lambda: call(token, "setMyDescription", {"description": DESCRIPTION})),
        ("setMyShortDescription", lambda: call(token, "setMyShortDescription", {"short_description": SHORT_DESCRIPTION})),
        ("deleteMyCommands", lambda: call(token, "deleteMyCommands")),  # the bot works through buttons only
    ]
    if "--no-photo" not in sys.argv:
        with open(AVATAR, "rb") as fh:
            jpg = fh.read()
        steps.append(("setMyProfilePhoto", lambda: call(
            token, "setMyProfilePhoto",
            {"photo": json.dumps({"type": "static", "photo": "attach://avatar"})},
            files={"avatar": ("avatar.jpg", jpg, "image/jpeg")})))
    failed = False
    for name, fn in steps:
        res = fn()
        ok = res.get("ok")
        failed |= not ok
        detail = res.get("result") if name == "getMe" and ok else res.get("description", "")
        print(f"{'OK ' if ok else 'ERR'} {name} {detail if detail is not True else ''}".rstrip())
        if name == "getMe" and not ok:
            break
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
