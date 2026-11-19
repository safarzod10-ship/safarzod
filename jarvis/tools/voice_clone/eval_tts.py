"""Проверка синтезированного голоса: генерирует фразы через sherpa-onnx (как в приложении),
оценивает разборчивость офлайн-распознавателем Vosk и сравнивает тембр с оригинальными записями.

python eval_tts.py <model_dir> <espeak-ng-data> <vosk-model> <orig_wav_dir> <out_dir>
"""
import json
import subprocess
import sys
import wave
from pathlib import Path

import numpy as np
import sherpa_onnx

PHRASES = [
    "Сейчас четырнадцать часов тридцать пять минут, сэр.",
    "Звоню маме, сэр.",
    "Сэр, напоминаю: купить хлеб по дороге домой.",
    "Саша пишет: мы уже у входа, ждём тебя.",
    "Заряд восемьдесят шесть процентов, идёт зарядка.",
    "Будильник на семь часов тридцать минут, сэр.",
    "Кого именно, сэр? Первый — Саша Иванов, второй — Саша Спорт.",
    "Все системы в норме. Чем могу помочь?",
]


def words(t):
    import re
    return re.sub(r"[^а-яё ]", " ", t.lower().replace("ё", "е")).split()


def wer(ref, hyp):
    r, h = words(ref), words(hyp)
    d = np.zeros((len(r) + 1, len(h) + 1), dtype=int)
    d[:, 0] = range(len(r) + 1)
    d[0, :] = range(len(h) + 1)
    for i in range(1, len(r) + 1):
        for j in range(1, len(h) + 1):
            d[i, j] = min(d[i - 1, j] + 1, d[i, j - 1] + 1, d[i - 1, j - 1] + (r[i - 1] != h[j - 1]))
    return d[len(r), len(h)] / max(1, len(r))


def pitch_stats(x, sr):
    """Медиана основного тона (простая автокорреляция по кадрам)."""
    f0 = []
    hop, win = sr // 100, sr // 25
    for i in range(0, len(x) - win, hop):
        fr = x[i:i + win] * np.hanning(win)
        if np.sqrt(np.mean(fr ** 2)) < 0.02:
            continue
        ac = np.correlate(fr, fr, "full")[win - 1:]
        lo, hi = sr // 350, sr // 60
        k = lo + np.argmax(ac[lo:hi])
        if ac[k] > 0.3 * ac[0]:
            f0.append(sr / k)
    return float(np.median(f0)) if f0 else 0.0


def spectral_centroid(x, sr):
    spec = np.abs(np.fft.rfft(x[: sr * 3] if len(x) > sr * 3 else x))
    freqs = np.fft.rfftfreq(len(x[: sr * 3] if len(x) > sr * 3 else x), 1 / sr)
    return float((spec * freqs).sum() / (spec.sum() + 1e-9))


def read_wav(p):
    with wave.open(str(p)) as w:
        sr = w.getframerate()
        x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
    return x, sr


def main():
    model_dir, espeak, vosk_dir, orig_dir, out = map(Path, sys.argv[1:6])
    out.mkdir(parents=True, exist_ok=True)
    cfg = sherpa_onnx.OfflineTtsConfig(
        model=sherpa_onnx.OfflineTtsModelConfig(
            vits=sherpa_onnx.OfflineTtsVitsModelConfig(
                model=str(model_dir / "jarvis.onnx"), lexicon="", tokens=str(model_dir / "tokens.txt"), data_dir=str(espeak),
                noise_scale=0.5, noise_scale_w=0.8, length_scale=1.0,
            ),
            num_threads=2,
        ),
    )
    tts = sherpa_onnx.OfflineTts(cfg)
    from vosk import KaldiRecognizer, Model, SetLogLevel
    SetLogLevel(-1)
    vm = Model(str(vosk_dir))
    total_wer = []
    f0s, cents = [], []
    import time
    for i, ph in enumerate(PHRASES):
        t0 = time.time()
        a = tts.generate(ph, sid=0, speed=1.0)
        dt = time.time() - t0
        x = np.array(a.samples, dtype=np.float32)
        p = out / f"s{i}.wav"
        with wave.open(str(p), "wb") as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(a.sample_rate)
            w.writeframes((np.clip(x, -1, 1) * 32767).astype(np.int16).tobytes())
        pcm16 = subprocess.run(["ffmpeg", "-v", "error", "-i", str(p), "-ar", "16000", "-ac", "1", "-f", "s16le", "-"], capture_output=True).stdout
        r = KaldiRecognizer(vm, 16000)
        r.AcceptWaveform(pcm16)
        hyp = json.loads(r.FinalResult()).get("text", "")
        e = wer(ph, hyp)
        total_wer.append(e)
        f0s.append(pitch_stats(x, a.sample_rate)); cents.append(spectral_centroid(x, a.sample_rate))
        print(f"[{dt:4.2f}s, RTF {dt / (len(x) / a.sample_rate):.2f}] WER {e:.2f} | {hyp}")
    of0, oc = [], []
    for p in sorted(orig_dir.glob("*.wav"))[:60]:
        if "_" in p.stem:
            continue
        x, sr = read_wav(p)
        of0.append(pitch_stats(x, sr)); oc.append(spectral_centroid(x, sr))
    print(f"\nсредний WER: {np.mean(total_wer):.2f}")
    print(f"тон (медиана F0): синтез {np.median(f0s):.0f} Гц / оригинал {np.median(of0):.0f} Гц")
    print(f"тембр (спектр. центроид): синтез {np.median(cents):.0f} Гц / оригинал {np.median(oc):.0f} Гц")


if __name__ == "__main__":
    main()
