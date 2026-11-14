"""Telegram bot: downloads videos from Instagram, TikTok and Pinterest.

Speed tricks:
  * yt-dlp runs in a thread pool, many users are served in parallel;
  * fragmented downloads use many concurrent connections;
  * ready-made mp4 formats are preferred (no re-encoding, ffmpeg only remuxes);
  * every sent file is cached by Telegram file_id -> a repeated link is answered instantly.
"""

import asyncio
import html
import logging
import os
import re
import shutil
import sqlite3
import tempfile
import time
from pathlib import Path

from aiogram import Bot, Dispatcher, F
from aiogram.client.default import DefaultBotProperties
from aiogram.client.session.aiohttp import AiohttpSession
from aiogram.enums import ChatAction, ParseMode
from aiogram.filters import CommandStart
from aiogram.types import FSInputFile, InputMediaPhoto, InputMediaVideo, Message
from yt_dlp import YoutubeDL

BASE_DIR = Path(__file__).resolve().parent


def load_env(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


load_env(BASE_DIR / ".env")

BOT_TOKEN = os.environ.get("BOT_TOKEN", "")
MAX_PARALLEL = int(os.environ.get("MAX_PARALLEL", "8"))
# Regular Telegram Bot API lets bots upload files up to 50 MB.
MAX_FILE_MB = int(os.environ.get("MAX_FILE_MB", "50"))
COOKIES_FILE = os.environ.get("COOKIES_FILE", str(BASE_DIR / "cookies.txt"))
DATA_DIR = Path(os.environ.get("DATA_DIR", str(BASE_DIR / "data")))
DATA_DIR.mkdir(parents=True, exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
log = logging.getLogger("tgvbot")

URL_RE = re.compile(
    r"https?://(?:[a-z0-9-]+\.)*"
    r"(?:instagram\.com|instagr\.am|tiktok\.com|pinterest\.[a-z.]+|pin\.it)"
    r"/[^\s<>\"']*",
    re.IGNORECASE,
)

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
)

# ---------------------------------------------------------------- file_id cache
_db = sqlite3.connect(DATA_DIR / "cache.sqlite3", check_same_thread=False)
_db.execute("CREATE TABLE IF NOT EXISTS cache (url TEXT PRIMARY KEY, kind TEXT, file_ids TEXT, ts INTEGER)")
_db.commit()


def cache_get(url: str):
    row = _db.execute("SELECT kind, file_ids FROM cache WHERE url = ?", (url,)).fetchone()
    if not row:
        return None
    return row[0], row[1].split("\n")


def cache_put(url: str, kind: str, file_ids: list[str]) -> None:
    _db.execute(
        "INSERT OR REPLACE INTO cache VALUES (?, ?, ?, ?)",
        (url, kind, "\n".join(file_ids), int(time.time())),
    )
    _db.commit()


def normalize(url: str) -> str:
    url = url.strip().rstrip(".,!?)")
    # Drop tracking parameters so the same video maps to the same cache key.
    if "instagram.com" in url or "tiktok.com" in url:
        url = url.split("?", 1)[0]
    return url


# ---------------------------------------------------------------- downloading
VIDEO_EXT = {".mp4", ".mov", ".webm", ".mkv", ".m4v"}
PHOTO_EXT = {".jpg", ".jpeg", ".png", ".webp"}


def ydl_opts(workdir: str) -> dict:
    max_bytes = MAX_FILE_MB * 1024 * 1024
    opts = {
        "outtmpl": os.path.join(workdir, "%(id)s_%(autonumber)s.%(ext)s"),
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "noplaylist": False,
        "restrictfilenames": True,
        "concurrent_fragment_downloads": 16,
        "http_chunk_size": 10 * 1024 * 1024,
        "retries": 5,
        "fragment_retries": 5,
        "socket_timeout": 20,
        "http_headers": {"User-Agent": UA},
        # Best quality that fits into Telegram limit, mp4 preferred (plays inline, no re-encode).
        "format": (
            f"b[ext=mp4][filesize<{max_bytes}]/b[ext=mp4][filesize_approx<{max_bytes}]"
            f"/bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b"
        ),
        "format_sort": ["res:1080", "vcodec:h264", "ext:mp4:m4a"],
        "merge_output_format": "mp4",
        "max_filesize": max_bytes * 4,
    }
    if os.path.isfile(COOKIES_FILE):
        opts["cookiefile"] = COOKIES_FILE
    return opts


def _download(url: str, workdir: str) -> tuple[list[Path], str]:
    with YoutubeDL(ydl_opts(workdir)) as ydl:
        info = ydl.extract_info(url, download=True)
    title = ""
    if info:
        title = (info.get("description") or info.get("title") or "").strip()
    files = sorted(
        p for p in Path(workdir).iterdir()
        if p.is_file() and p.suffix.lower() in VIDEO_EXT | PHOTO_EXT
    )
    return files, title


async def _fallback_og(url: str, workdir: str, session) -> list[Path]:
    """Pinterest image pins / pages without video: grab og:video or og:image."""
    import aiohttp

    async with session.get(url, headers={"User-Agent": UA}, allow_redirects=True) as r:
        page = await r.text(errors="ignore")
    media = None
    for prop in ("og:video:secure_url", "og:video", "og:image"):
        m = re.search(
            rf'<meta[^>]+(?:property|name)=["\']{re.escape(prop)}["\'][^>]+content=["\']([^"\']+)',
            page,
        ) or re.search(
            rf'<meta[^>]+content=["\']([^"\']+)["\'][^>]+(?:property|name)=["\']{re.escape(prop)}["\']',
            page,
        )
        if m:
            media = html.unescape(m.group(1))
            break
    if not media:
        return []
    ext = os.path.splitext(media.split("?", 1)[0])[1].lower() or ".jpg"
    if ext not in VIDEO_EXT | PHOTO_EXT:
        ext = ".jpg"
    target = Path(workdir) / f"media{ext}"
    async with session.get(media, headers={"User-Agent": UA}, timeout=aiohttp.ClientTimeout(total=120)) as r:
        r.raise_for_status()
        with open(target, "wb") as fh:
            async for chunk in r.content.iter_chunked(1 << 20):
                fh.write(chunk)
    return [target]


# ---------------------------------------------------------------- bot
dp = Dispatcher()
semaphore = asyncio.Semaphore(MAX_PARALLEL)
http_session = None  # aiohttp.ClientSession, created on startup


@dp.message(CommandStart())
async def start(message: Message) -> None:
    await message.answer(
        "👋 Пришли мне ссылку на видео из <b>Instagram</b>, <b>TikTok</b> или <b>Pinterest</b> — "
        "я скачаю его и отправлю тебе.\n\n"
        "Send me an Instagram / TikTok / Pinterest link and I will send the video back."
    )


async def chat_action_loop(bot: Bot, chat_id: int, action: ChatAction, stop: asyncio.Event) -> None:
    while not stop.is_set():
        try:
            await bot.send_chat_action(chat_id, action)
        except Exception:
            pass
        try:
            await asyncio.wait_for(stop.wait(), timeout=4)
        except asyncio.TimeoutError:
            pass


async def send_files(message: Message, files: list[Path], caption: str) -> tuple[str, list[str]]:
    limit = MAX_FILE_MB * 1024 * 1024
    files = [f for f in files if f.stat().st_size <= limit]
    if not files:
        raise ValueError("too_big")

    if len(files) == 1:
        f = files[0]
        if f.suffix.lower() in VIDEO_EXT:
            msg = await message.answer_video(
                FSInputFile(f), caption=caption, supports_streaming=True,
                reply_to_message_id=message.message_id,
            )
            return "video", [msg.video.file_id]
        msg = await message.answer_photo(
            FSInputFile(f), caption=caption, reply_to_message_id=message.message_id,
        )
        return "photo", [msg.photo[-1].file_id]

    # Carousel / several files -> albums of up to 10 items.
    ids: list[str] = []
    for i in range(0, len(files), 10):
        group = []
        for j, f in enumerate(files[i:i + 10]):
            cap = caption if i == 0 and j == 0 else None
            if f.suffix.lower() in VIDEO_EXT:
                group.append(InputMediaVideo(media=FSInputFile(f), caption=cap, supports_streaming=True))
            else:
                group.append(InputMediaPhoto(media=FSInputFile(f), caption=cap))
        sent = await message.answer_media_group(group, reply_to_message_id=message.message_id)
        for m in sent:
            if m.video:
                ids.append("v:" + m.video.file_id)
            elif m.photo:
                ids.append("p:" + m.photo[-1].file_id)
    return "album", ids


async def send_cached(message: Message, kind: str, ids: list[str], caption: str) -> None:
    if kind == "video":
        await message.answer_video(ids[0], caption=caption, reply_to_message_id=message.message_id)
    elif kind == "photo":
        await message.answer_photo(ids[0], caption=caption, reply_to_message_id=message.message_id)
    else:
        for i in range(0, len(ids), 10):
            group = []
            for j, item in enumerate(ids[i:i + 10]):
                cap = caption if i == 0 and j == 0 else None
                t, fid = item.split(":", 1)
                group.append(InputMediaVideo(media=fid, caption=cap) if t == "v"
                             else InputMediaPhoto(media=fid, caption=cap))
            await message.answer_media_group(group, reply_to_message_id=message.message_id)


@dp.message(F.text | F.caption)
async def handle(message: Message, bot: Bot) -> None:
    text = message.text or message.caption or ""
    urls = [normalize(u) for u in URL_RE.findall(text)]
    if not urls:
        if message.chat.type == "private":
            await message.answer("Пришли ссылку на Instagram, TikTok или Pinterest 🙂")
        return

    for url in dict.fromkeys(urls):
        await process(message, bot, url)


async def process(message: Message, bot: Bot, url: str) -> None:
    me = await bot.me()
    caption = f"📥 @{me.username}"

    cached = cache_get(url)
    if cached:
        try:
            await send_cached(message, cached[0], cached[1], caption)
            return
        except Exception as e:  # file_id may become invalid -> download again
            log.warning("cached send failed for %s: %s", url, e)

    status = await message.reply("⏳ Скачиваю…")
    stop = asyncio.Event()
    action = asyncio.create_task(chat_action_loop(bot, message.chat.id, ChatAction.UPLOAD_VIDEO, stop))
    workdir = tempfile.mkdtemp(prefix="dl_", dir=DATA_DIR)
    t0 = time.monotonic()
    try:
        async with semaphore:
            files: list[Path] = []
            try:
                files, _title = await asyncio.to_thread(_download, url, workdir)
            except Exception as e:
                log.info("yt-dlp failed for %s: %s", url, str(e).splitlines()[0][:300])
            if not files and ("pinterest" in url or "pin.it" in url):
                try:
                    files = await _fallback_og(url, workdir, http_session)
                except Exception as e:
                    log.info("og fallback failed for %s: %s", url, e)
            if not files:
                await status.edit_text(
                    "❌ Не удалось скачать. Проверь, что ссылка верная и пост публичный."
                )
                return

            kind, ids = await send_files(message, files, caption)
            cache_put(url, kind, ids)
            log.info("sent %s (%d file(s)) in %.1fs", url, len(files), time.monotonic() - t0)
        await status.delete()
    except ValueError as e:
        if str(e) == "too_big":
            await status.edit_text(f"❌ Видео больше {MAX_FILE_MB} МБ — Telegram не даёт боту отправить его.")
        else:
            raise
    except Exception as e:
        log.exception("error for %s", url)
        try:
            await status.edit_text(f"❌ Ошибка: {html.escape(str(e))[:300]}")
        except Exception:
            pass
    finally:
        stop.set()
        action.cancel()
        shutil.rmtree(workdir, ignore_errors=True)


async def main() -> None:
    global http_session
    import aiohttp

    if not BOT_TOKEN:
        raise SystemExit("BOT_TOKEN is not set (put it into .env)")

    # Clean leftovers of a previous crash.
    for p in DATA_DIR.glob("dl_*"):
        shutil.rmtree(p, ignore_errors=True)

    http_session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=60))
    bot = Bot(
        BOT_TOKEN,
        session=AiohttpSession(timeout=600),
        default=DefaultBotProperties(parse_mode=ParseMode.HTML),
    )
    log.info("bot started")
    try:
        await bot.delete_webhook(drop_pending_updates=False)
        await dp.start_polling(bot, handle_as_tasks=True)
    finally:
        await http_session.close()
        await bot.session.close()


if __name__ == "__main__":
    asyncio.run(main())
