"""Датасет для обучения голоса из записей jarvis/sounds/incoming.

python make_dataset.py <out_dir>

Каждая запись: обрезка тишины, громкость, 22050 Гц моно + две копии с темпом ±7%
(тот же тембр, больше вариантов длительности). Текст — из таблицы CLIPS в build_voice.py.
"""
import importlib.util
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("bv", ROOT / "jarvis/tools/build_voice.py")
bv = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bv)

SKIP = {"8a6e1ff2"}  # в записи слышно «сами» вместо «сэр»
FIX = {"0ff3e10d": "Открываю ютуб, сэр."}  # латиницу — как произносится


def main():
    out = Path(sys.argv[1])
    (out / "wav").mkdir(parents=True, exist_ok=True)
    src = ROOT / "jarvis/sounds/incoming"
    files = {f.split("-")[0]: src / f for f in os.listdir(src)}
    rows = []
    af = ("silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05,areverse,"
          "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.12,areverse,loudnorm=I=-20:TP=-2")
    for sid, (_ev, text) in bv.CLIPS.items():
        if sid in SKIP:
            continue
        t = FIX.get(sid, text).replace("ё", "е")
        for tag, tempo in [("", None), ("_s", 0.93), ("_f", 1.07)]:
            name = f"{sid}{tag}.wav"
            subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", str(files[sid]), "-af", af + (f",atempo={tempo}" if tempo else ""),
                            "-ar", "22050", "-ac", "1", "-sample_fmt", "s16", str(out / "wav" / name)], check=True)
            rows.append(f"{name}|{t}")
    (out / "metadata.csv").write_text("\n".join(rows) + "\n", encoding="utf-8")
    print(len(rows), "записей")


if __name__ == "__main__":
    main()
