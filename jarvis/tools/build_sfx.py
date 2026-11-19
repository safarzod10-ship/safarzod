"""Синтезирует звуки интерфейса Джарвиса (оригинальные, без чужих сэмплов).

Результат: jarvis/android/app/src/main/assets/sfx/*.ogg
Запуск: python3 jarvis/tools/build_sfx.py
"""
import subprocess
from pathlib import Path

import numpy as np
from scipy.signal import butter, fftconvolve, sosfilt

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "android" / "app" / "src" / "main" / "assets" / "sfx"
SR = 48000
rng = np.random.default_rng(7)


def t(d):
    return np.arange(int(SR * d)) / SR


def env_adsr(n, a, d, s, r, sustain_level=0.6):
    a, d, r = int(SR * a), int(SR * d), int(SR * r)
    s = max(0, n - a - d - r)
    e = np.concatenate([
        np.linspace(0, 1, a, endpoint=False) ** 0.6,
        1 - (1 - sustain_level) * (np.linspace(0, 1, d, endpoint=False) ** 0.7),
        np.full(s, sustain_level),
        sustain_level * (1 - np.linspace(0, 1, r)) ** 2.2,
    ])
    return e[:n] if len(e) >= n else np.pad(e, (0, n - len(e)))


def bell(freq, dur, ratio=3.5, index=1.6, decay=5.0):
    x = t(dur)
    mod = index * np.exp(-x * decay * 1.6) * np.sin(2 * np.pi * freq * ratio * x)
    y = np.sin(2 * np.pi * freq * x + mod) * np.exp(-x * decay)
    y += 0.25 * np.sin(2 * np.pi * freq * 2.001 * x) * np.exp(-x * decay * 2.2)
    atk = int(SR * 0.003)
    y[:atk] *= np.linspace(0, 1, atk)
    return y


def sweep(f0, f1, dur, curve=1.0):
    x = t(dur)
    k = (x / dur) ** curve
    f = f0 * (f1 / f0) ** k
    ph = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(ph)


def reverb(x, size=0.9, mix=0.22, tone=6000):
    n = int(SR * size)
    ir = rng.standard_normal(n) * np.exp(-np.linspace(0, 7, n))
    ir = sosfilt(butter(2, tone, "low", fs=SR, output="sos"), ir)
    ir[: int(SR * 0.012)] = 0  # pre-delay
    ir /= np.sqrt(np.sum(ir**2))
    wet = np.pad(fftconvolve(x, ir), (0, 1))[: len(x) + n]
    dry = np.pad(x, (0, n))
    return dry * (1 - mix) + wet * mix * 0.9


def place(buf, sig, at):
    i = int(SR * at)
    end = min(len(buf), i + len(sig))
    buf[i:end] += sig[: end - i]


def finish(x, peak=0.8):
    x = x - np.mean(x)
    x = x / (np.max(np.abs(x)) + 1e-9) * peak
    tail = min(len(x), int(SR * 0.03))
    x[-tail:] *= np.linspace(1, 0, tail)
    return x


def save(name, x):
    OUT.mkdir(parents=True, exist_ok=True)
    if name != "thinking":
        loud = np.where(np.abs(x) > 10 ** (-58 / 20))[0]
        if len(loud):
            x = x[: loud[-1] + 1].copy()
            fo = min(len(x), int(SR * 0.02))
            x[-fo:] *= np.linspace(1, 0, fo)
    pcm = (np.clip(x, -1, 1) * 32767).astype("<i2").tobytes()
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-f", "s16le", "-ar", str(SR), "-ac", "1", "-i", "-",
         "-c:a", "libvorbis", "-q:a", "6", str(OUT / f"{name}.ogg")],
        input=pcm, check=True,
    )
    print(f"{name:14s} {len(x)/SR:.2f}s")


def listen_start():
    buf = np.zeros(int(SR * 0.45))
    place(buf, bell(1046.5, 0.35, ratio=2.0, index=0.9, decay=9) * 0.7, 0.0)
    place(buf, bell(1567.98, 0.40, ratio=2.0, index=0.8, decay=8) * 0.85, 0.07)
    s = sweep(600, 2400, 0.14, 0.7) * env_adsr(int(SR * 0.14), 0.01, 0.05, 0, 0.08, 0.3) * 0.12
    place(buf, s, 0.0)
    return finish(reverb(buf, 0.7, 0.25))


def listen_end():
    buf = np.zeros(int(SR * 0.4))
    place(buf, bell(1567.98, 0.3, ratio=2.0, index=0.7, decay=10) * 0.6, 0.0)
    place(buf, bell(1046.5, 0.35, ratio=2.0, index=0.6, decay=9) * 0.75, 0.06)
    return finish(reverb(buf, 0.6, 0.2), 0.65)


def success():
    buf = np.zeros(int(SR * 0.8))
    for i, f in enumerate([1318.5, 1760.0, 2637.0]):
        place(buf, bell(f, 0.6, ratio=3.01, index=1.2, decay=6) * (0.8 - i * 0.18), i * 0.055)
    return finish(reverb(buf, 1.0, 0.28))


def error():
    buf = np.zeros(int(SR * 0.6))
    for i, f in enumerate([392.0, 311.1]):
        x = t(0.22)
        tone = (np.sin(2 * np.pi * f * x) + 0.35 * np.sin(2 * np.pi * f * 2 * x)
                + 0.12 * np.sin(2 * np.pi * f * 3.01 * x))
        tone *= env_adsr(len(x), 0.008, 0.06, 0, 0.12, 0.55)
        place(buf, tone * 0.7, i * 0.13)
    buf = sosfilt(butter(2, 2500, "low", fs=SR, output="sos"), buf)
    return finish(reverb(buf, 0.6, 0.18), 0.7)


def notify():
    buf = np.zeros(int(SR * 1.0))
    place(buf, bell(2093.0, 0.8, ratio=2.76, index=1.4, decay=4.5) * 0.8, 0.0)
    place(buf, bell(2637.0, 0.7, ratio=2.76, index=1.0, decay=5.0) * 0.5, 0.09)
    return finish(reverb(buf, 1.1, 0.3))


def tap():
    x = t(0.05)
    y = np.sin(2 * np.pi * 2600 * x) * np.exp(-x * 120) * 0.6
    y += rng.standard_normal(len(x)) * np.exp(-x * 400) * 0.15
    y = sosfilt(butter(2, [800, 9000], "band", fs=SR, output="sos"), y)
    return finish(y, 0.45)


def boot():
    dur = 2.4
    n = int(SR * dur)
    x = np.arange(n) / SR
    buf = np.zeros(n + int(SR * 0.2))
    # нарастающий низкий гул
    hum_f = 55 * (1 + 0.5 * (x / dur))
    hum = np.sin(2 * np.pi * np.cumsum(hum_f) / SR) + 0.4 * np.sin(2 * np.pi * np.cumsum(hum_f * 2.0) / SR)
    hum *= np.clip(x / 1.4, 0, 1) ** 1.5 * np.clip((dur - x) / 0.6, 0, 1)
    place(buf, hum * 0.35, 0)
    # шумовой «вдох» с открывающимся фильтром
    noise = rng.standard_normal(n)
    out = np.zeros(n)
    blk = 1024
    for i in range(0, n, blk):
        fc = 300 + 7000 * (i / n) ** 2
        sos = butter(2, min(fc, SR / 2 - 100), "low", fs=SR, output="sos")
        out[i:i + blk] = sosfilt(sos, noise[i:i + blk])
    out *= (x / dur) ** 2 * np.clip((dur - x) / 0.25, 0, 1)
    place(buf, out * 0.18, 0)
    # раскрытие аккорда в конце
    for i, f in enumerate([523.25, 783.99, 1046.5, 1567.98]):
        place(buf, bell(f, 1.2, ratio=2.0, index=0.7, decay=2.6) * (0.55 - i * 0.07), 1.55 + i * 0.045)
    return finish(reverb(buf, 1.6, 0.3), 0.8)


def thinking():
    """Тихая зацикливаемая «обработка» 2 сек: мягкие тики с пульсацией."""
    dur = 2.0
    n = int(SR * dur)
    buf = np.zeros(n)
    for k in range(8):
        f = [1760, 2093, 1975.5, 2349.3][k % 4]
        place(buf, bell(f, 0.2, ratio=2.0, index=0.4, decay=22) * 0.35, k * dur / 8)
    pad = np.sin(2 * np.pi * 220 * t(dur)) * 0.05 * (0.5 + 0.5 * np.sin(2 * np.pi * t(dur) / dur))
    buf += pad
    # бесшовная петля: реверб с переносом хвоста в начало
    wet = reverb(buf, 0.5, 0.35)
    loop = wet[:n].copy()
    loop[: len(wet) - n] += wet[n:]
    loop = loop / (np.max(np.abs(loop)) + 1e-9) * 0.5
    return loop


def main():
    for old in OUT.glob("*.ogg"):
        old.unlink()
    save("listen_start", listen_start())
    save("listen_end", listen_end())
    save("success", success())
    save("error", error())
    save("notify", notify())
    save("tap", tap())
    save("boot", boot())
    save("thinking", thinking())


if __name__ == "__main__":
    main()
