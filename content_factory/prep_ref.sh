#!/usr/bin/env bash
# Clean a user voice recording for cloning.
# usage: prep_ref.sh <input audio/video> <out_dir>
# Produces: clean_full.wav (whole recording, cleaned) and ref_XX.wav clips of 8-12 s for F5-TTS.
set -euo pipefail
IN="$1"; OUT="$2"; HERE="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$OUT"
ffmpeg -v error -y -i "$IN" -vn -ac 1 -ar 24000 \
  -af "highpass=f=70,lowpass=f=11000,afftdn=nf=-28:tn=1,silenceremove=start_periods=1:start_threshold=-45dB:stop_periods=-1:stop_duration=0.6:stop_threshold=-45dB,loudnorm=I=-18:TP=-1.5:LRA=9" \
  "$OUT/clean_full.wav"
"$HERE/voice/venv_f5/bin/python" - "$OUT" <<'EOF'
import sys, soundfile as sf, numpy as np
from faster_whisper import WhisperModel
out = sys.argv[1]
a, sr = sf.read(f"{out}/clean_full.wav", dtype="float32")
a16 = np.interp(np.arange(0, len(a), sr / 16000), np.arange(len(a)), a).astype("float32")
segs = list(WhisperModel("small", device="cpu", compute_type="int8").transcribe(a16, language="ru", vad_filter=True)[0])
# group consecutive sentences into 8-12 s clips with their text
clips, cur = [], []
for s in segs:
    cur.append(s)
    d = cur[-1].end - cur[0].start
    if d >= 8:
        if d <= 12.5: clips.append(cur)
        cur = []
for i, c in enumerate(clips):
    s0, s1 = max(0, c[0].start - 0.15), c[-1].end + 0.25
    sf.write(f"{out}/ref_{i:02d}.wav", a[int(s0 * sr):int(s1 * sr)], sr)
    open(f"{out}/ref_{i:02d}.txt", "w", encoding="utf-8").write(" ".join(x.text.strip() for x in c))
    print(f"ref_{i:02d}: {s1 - s0:.1f}s  {' '.join(x.text.strip() for x in c)}")
print(f"total speech {len(a) / sr:.0f}s, {len(clips)} reference clips")
EOF
