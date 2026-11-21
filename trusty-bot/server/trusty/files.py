"""Uploaded files: chat attachments (screenshots, archives, documents) and portfolio pictures.

Files are served by signed links, so a link works in <img>/<a> without the Telegram auth header but cannot be guessed.
"""
import hashlib
import hmac
import io
import os
import re
import uuid

from fastapi import HTTPException, UploadFile
from PIL import Image, ImageOps

from .config import settings

MAX_FILE = 20 * 1024 * 1024
MAX_PICTURE = 10 * 1024 * 1024
IMAGES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
# what can be sent in a chat besides pictures: documents and archives with the work
DOCS = {
    "application/pdf", "application/zip", "application/x-zip-compressed", "application/x-rar-compressed",
    "application/vnd.rar", "application/x-7z-compressed", "application/gzip", "application/x-tar", "text/plain", "text/csv",
    "application/json", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint", "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "video/mp4", "video/quicktime",
}
EXT = {".pdf", ".zip", ".rar", ".7z", ".gz", ".tar", ".txt", ".csv", ".json", ".doc", ".docx", ".xls", ".xlsx", ".ppt",
       ".pptx", ".mp4", ".mov", ".jpg", ".jpeg", ".png", ".webp", ".gif", ".fig", ".md"}


def sign(kind: str, ident: str | int) -> str:
    return hmac.new(settings.secret, f"{kind}:{ident}".encode(), hashlib.sha256).hexdigest()[:32]


def link(kind: str, ident: str | int) -> str:
    return f"/api/f/{kind}/{ident}?sig={sign(kind, ident)}"


def check(kind: str, ident: str | int, sig: str) -> None:
    if not hmac.compare_digest(sign(kind, ident), sig or ""):
        raise HTTPException(403, "Нет доступа")


def safe_name(name: str) -> str:
    base = os.path.basename(name or "file").strip() or "file"
    base = re.sub(r"[^\w.\- ()\[\]]+", "_", base, flags=re.U)
    return base[-120:]


async def _read(f: UploadFile, limit: int) -> bytes:
    data = await f.read(limit + 1)
    if len(data) > limit:
        raise HTTPException(400, f"Файл больше {limit // 1024 // 1024} МБ")
    if not data:
        raise HTTPException(400, "Пустой файл")
    return data


async def save_attachment(f: UploadFile, chat_id: int) -> tuple[str, str, str, int]:
    """Returns (path, name, mime, size)."""
    name = safe_name(f.filename or "file")
    mime = (f.content_type or "application/octet-stream").lower()
    ext = os.path.splitext(name)[1].lower()
    if mime not in IMAGES and mime not in DOCS and ext not in EXT:
        raise HTTPException(400, "Такой тип файла не принимается. Можно картинки, PDF, документы, архивы и видео")
    data = await _read(f, MAX_FILE)
    folder = os.path.join(settings.upload_dir, "chats", str(chat_id))
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, f"{uuid.uuid4().hex}{ext[:8]}")
    with open(path, "wb") as fh:
        fh.write(data)
    return path, name, mime, len(data)


async def save_picture(f: UploadFile, owner: int) -> str:
    """A portfolio picture, re-encoded to JPEG (at most 1600 px), so only real images are stored. Returns its id."""
    data = await _read(f, MAX_PICTURE)
    try:
        img = Image.open(io.BytesIO(data))
        img = ImageOps.exif_transpose(img).convert("RGB")
    except Exception:  # noqa: BLE001 - anything Pillow cannot read is not a picture
        raise HTTPException(400, "Нужна картинка: JPG, PNG или WEBP") from None
    img.thumbnail((1600, 1600))
    ident = f"{owner}-{uuid.uuid4().hex[:16]}"
    folder = os.path.join(settings.upload_dir, "portfolio")
    os.makedirs(folder, exist_ok=True)
    img.save(os.path.join(folder, f"{ident}.jpg"), "JPEG", quality=86, optimize=True)
    return ident


def picture_path(ident: str) -> str:
    if not re.fullmatch(r"\d+-[0-9a-f]{16}", ident or ""):
        raise HTTPException(404, "Нет такой картинки")
    return os.path.join(settings.upload_dir, "portfolio", f"{ident}.jpg")
