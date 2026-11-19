"""Готовит голос Джарвиса для приложения.

Берёт исходные mp3 из jarvis/sounds/incoming, обрезает тишину, выравнивает
громкость (EBU R128), кодирует в OGG Vorbis и считает огибающую громкости
(50 кадров/сек) — по ней 3D-ядро «дышит» в такт голосу.

Результат: jarvis/android/app/src/main/assets/voice/*.ogg + manifest.json

Запуск: python3 jarvis/tools/build_voice.py
"""
import base64
import json
import subprocess
import tempfile
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "sounds" / "incoming"
OUT = ROOT / "android" / "app" / "src" / "main" / "assets" / "voice"

# id исходного файла -> (событие, текст на экране)
CLIPS = {
    "20cf7b5c": ("wake", "Слушаю, сэр."),
    "69ad0f62": ("wake", "Что прикажете, сэр?"),
    "e533ad00": ("wake", "К вашим услугам, сэр."),
    "5cb5548d": ("yes", "Да, сэр."),
    "8aca5731": ("yes", "Да, сэр."),
    "b5cd31b1": ("greet_morning", "Доброе утро, сэр."),
    "62e2c983": ("greet_day", "Добрый день, сэр. Чем могу помочь?"),
    "b2cbfb95": ("greet_evening", "Добрый вечер, сэр."),
    "a250d47a": ("greet_evening", "Добрый вечер, сэр. Я на связи."),
    "4dd165c3": ("greet_night", "Ночная смена, сэр? Я с вами."),
    "20abdc75": ("ack", "Вас понял, сэр."),
    "1bdfb124": ("ack", "Сию минуту, сэр."),
    "8a6e1ff2": ("ack", "Как пожелаете, сэр."),
    "ebd4d38e": ("done", "Готово, сэр."),
    "441a62e7": ("done", "Всё готово, сэр."),
    "76723cb4": ("done", "Задача выполнена, сэр."),
    "640409c5": ("thinking", "Минуту, сэр."),
    "2684a2ae": ("thinking", "Почти готово, сэр."),
    "66973e6a": ("not_understood", "Простите, сэр, я не понял."),
    "e3e419b5": ("not_understood", "Повторите, пожалуйста, сэр."),
    "b1823ad4": ("error", "Простите, сэр, не получилось."),
    "fdc698a0": ("error", "Произошла ошибка, сэр."),
    "151bafe6": ("error_later", "Простите, сэр, повторите попытку позже."),
    "badf542d": ("cant_do", "Простите, сэр, этого я пока не умею."),
    "f4b27272": ("cant_do", "Пока не умею, сэр. Я пока учусь."),
    "e83dce4b": ("need_permission", "Простите, сэр, но нужные разрешения не обнаружены."),
    "5433c027": ("permissions_missing", "Сэр, не все разрешения выданы."),
    "196d11f3": ("cancel", "Хорошо, сэр. Отбой."),
    "69f7d801": ("cancel", "Хорошо, сэр, отменяю."),
    "b2cef8b2": ("cancel", "Хорошо, сэр, отменяю."),
    "691909a1": ("confirm_ask", "Подтверждаете, сэр?"),
    "f659bb5e": ("confirm_ask", "Подтверждаете, сэр?"),
    "f4127be7": ("confirm_ask", "Вы уверены, сэр?"),
    "286e1bc1": ("thanks_reply", "Рад помочь, сэр."),
    "0f92c8b9": ("thanks_reply", "Всегда пожалуйста, сэр."),
    "fb5c14e5": ("thanks_reply", "Рад стараться, сэр."),
    "848af706": ("bye", "До связи, сэр."),
    "a1ad41fe": ("bye", "Всего доброго, сэр."),
    "56b9e966": ("goodnight", "Спокойной ночи, сэр!"),
    "b101d0cb": ("how_are_you", "Все системы в норме, сэр. Спасибо, что спросили."),
    "4467d13f": ("who_are_you", "Я Джарвис, ваш персональный помощник, сэр."),
    "7ec786b5": ("free_talk_refuse", "Сэр, на данный момент нет возможности свободного общения. Есть другие пожелания?"),
    "cc845e9f": ("call_start", "Набираю, сэр."),
    "7048a0ae": ("call_who", "Кому звонить, сэр?"),
    "3322e81d": ("call_not_found", "Контакт не найден, сэр. Скажите, как он записан, и я запомню."),
    "e482320b": ("app_open", "Открываю, сэр."),
    "33196525": ("app_not_found", "Не нашёл такого приложения, сэр."),
    "0ff3e10d": ("youtube", "Открываю YouTube, сэр."),
    "a520f8c3": ("weather", "Вот прогноз погоды, сэр."),
    "92105c32": ("no_internet", "Сэр, нет подключения к интернету."),
    "bfc87aa6": ("volume_up", "Прибавляю громкость."),
    "3d0d8956": ("volume_down", "Убавляю громкость."),
    "2a7cb996": ("flash_on", "Фонарик включён, сэр."),
    "dad388af": ("flash_off", "Фонарик выключен, сэр."),
    "be41e9a7": ("msg_incoming", "Сэр, у вас новое сообщение."),
}

SR = 44100
ENV_FPS = 50


def run(cmd):
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)


def decode(path: Path) -> np.ndarray:
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-f", "f32le", "-ac", "1", "-ar", str(SR), "-"],
        check=True, capture_output=True,
    ).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()


def trim(x: np.ndarray) -> np.ndarray:
    """Срезать тишину по краям, оставив 40 мс до и 120 мс после."""
    win = int(SR * 0.01)
    n = len(x) // win
    rms = np.sqrt(np.mean(x[: n * win].reshape(n, win) ** 2, axis=1) + 1e-12)
    db = 20 * np.log10(rms)
    thr = max(db.max() - 42, -60)
    idx = np.where(db > thr)[0]
    if len(idx) == 0:
        return x
    a = max(0, idx[0] * win - int(SR * 0.04))
    b = min(len(x), (idx[-1] + 1) * win + int(SR * 0.12))
    y = x[a:b].copy()
    fi, fo = int(SR * 0.008), int(SR * 0.06)
    y[:fi] *= np.linspace(0, 1, fi)
    y[-fo:] *= np.linspace(1, 0, fo) ** 2
    return y


def envelope(x: np.ndarray) -> bytes:
    hop = SR // ENV_FPS
    n = int(np.ceil(len(x) / hop))
    pad = np.zeros(n * hop, dtype=np.float32)
    pad[: len(x)] = x
    rms = np.sqrt(np.mean(pad.reshape(n, hop) ** 2, axis=1))
    db = 20 * np.log10(rms + 1e-6)
    v = np.clip((db + 50) / 44, 0, 1)
    # лёгкое сглаживание: атака быстрая, спад плавный
    out = np.zeros_like(v)
    s = 0.0
    for i, t in enumerate(v):
        s = t if t > s else s + (t - s) * 0.35
        out[i] = s
    return bytes((out * 255).astype(np.uint8))


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("*.ogg"):
        old.unlink()
    files = {p.name.split("-")[0]: p for p in SRC.glob("*.mp3")}
    missing = set(CLIPS) - set(files)
    assert not missing, f"нет файлов: {missing}"
    counters: dict[str, int] = {}
    clips = []
    with tempfile.TemporaryDirectory() as tmp:
        for sid, (event, text) in CLIPS.items():
            counters[event] = counters.get(event, 0) + 1
            name = f"{event}_{counters[event]:02d}"
            x = trim(decode(files[sid]))
            wav = Path(tmp) / f"{name}.wav"
            pcm = (np.clip(x, -1, 1) * 32767).astype("<i2").tobytes()
            subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "s16le", "-ar", str(SR), "-ac", "1", "-i", "-", str(wav)],
                           input=pcm, check=True)
            ogg = OUT / f"{name}.ogg"
            run(["ffmpeg", "-y", "-v", "error", "-i", str(wav),
                 "-af", "loudnorm=I=-16:TP=-1.5:LRA=7,aresample=44100",
                 "-c:a", "libvorbis", "-q:a", "6", str(ogg)])
            final = decode(ogg)
            clips.append({
                "id": name,
                "event": event,
                "text": text,
                "file": f"voice/{name}.ogg",
                "durationMs": int(len(final) / SR * 1000),
                "envFps": ENV_FPS,
                "env": base64.b64encode(envelope(final)).decode(),
            })
            print(f"{name:24s} {len(final)/SR:5.2f}s  {text}")
    (OUT / "manifest.json").write_text(json.dumps({"clips": clips}, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"OK: {len(clips)} clips, {len(counters)} events")


if __name__ == "__main__":
    main()
