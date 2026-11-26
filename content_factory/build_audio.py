"""episode dir -> timeline.json + mix.wav (voice lines + music by mood + chimes/whooshes).
usage: python build_audio.py <ep_dir>"""
import json, sys, wave, subprocess, os
import numpy as np

EP = sys.argv[1]
E = json.load(open(f"{EP}/episode.json", encoding="utf-8"))
SR = 22050
LEAD, TAIL = 0.35, 2.2

def load(path):
    w = wave.open(path); assert w.getframerate() == SR, path
    return np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768

voice = []
for i, ln in enumerate(E["lines"], 1):
    src = f"{EP}/voice/l{i}.wav"
    p = ln.get("pitch", 0)
    if p:
        dst = f"{EP}/voice/l{i}_p.wav"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src, "-af", f"rubberband=pitch={2 ** (p / 12):.4f}:formant=preserved", "-ar", str(SR), dst], check=True)
        src = dst
    voice.append(load(src))

t, timeline = LEAD, []
for ln, v in zip(E["lines"], voice):
    d = len(v) / SR
    timeline.append({"text": ln["text"].replace("+", ""), "start": round(t, 3), "end": round(t + d, 3)})
    t += d + ln.get("gap", 0.42)
total = timeline[-1]["end"] + TAIL
n = int(total * SR)
mix = np.zeros(n, np.float32)
for seg, v in zip(timeline, voice):
    s = int(seg["start"] * SR); mix[s:s + len(v)] += v * 0.95

MOODS = {
    "warm":    ([[220.0, 261.63, 329.63], [174.61, 220.0, 261.63], [196.0, 261.63, 329.63], [196.0, 246.94, 293.66]], 2.4, 0.07),
    "sad":     ([[220.0, 261.63, 329.63], [174.61, 220.0, 261.63], [146.83, 174.61, 220.0], [164.81, 207.65, 246.94]], 3.0, 0.065),
    "mystery": ([[146.83, 174.61, 220.0], [155.56, 185.0, 233.08], [146.83, 174.61, 207.65], [138.59, 164.81, 207.65]], 3.2, 0.075),
    "happy":   ([[261.63, 329.63, 392.0], [196.0, 246.94, 293.66], [220.0, 261.63, 329.63], [174.61, 220.0, 261.63]], 1.9, 0.07),
    "tense":   ([[164.81, 196.0, 246.94], [174.61, 207.65, 261.63], [164.81, 196.0, 246.94], [155.56, 185.0, 233.08]], 1.6, 0.075),
}
chords, CL, vol = MOODS.get(E.get("music", "warm"), MOODS["warm"])
tt = np.arange(n) / SR
music = np.zeros(n, np.float32)
for k in range(int(total / CL) + 1):
    a, b = int(k * CL * SR), min(n, int((k + 1) * CL * SR + 0.6 * SR))
    if a >= n: break
    seg = tt[a:b] - k * CL
    env = np.minimum(1, seg / 0.5) * np.exp(-seg * 0.35)
    for f in chords[k % 4]:
        music[a:b] += (np.sin(2 * np.pi * f * seg) + 0.3 * np.sin(4 * np.pi * f * seg)) * env
    for j in range(4):
        p0 = a + int(j * CL / 4 * SR)
        if p0 >= n: break
        ps = np.arange(min(int(0.4 * SR), n - p0)) / SR
        music[p0:p0 + len(ps)] += 0.5 * np.sin(2 * np.pi * chords[k % 4][j % 3] * 2 * ps) * np.exp(-ps * 9)
music /= np.abs(music).max()
fade = np.minimum(1, (total - tt) / 1.5).clip(0, 1)
mix += music * vol * fade

def add(sig, at):
    o = int(at * SR)
    if o < 0: sig, o = sig[-o:], 0
    if o < n and len(sig): mix[o:o + len(sig)] += sig[: n - o]
for ln, seg in zip(E["lines"], timeline):
    if ln.get("chime"):
        cs = np.arange(int(1.5 * SR)) / SR
        for k, f in enumerate([1046.5, 1318.5, 1568.0, 2093.0]):
            add(np.sin(2 * np.pi * f * cs) * np.exp(-cs * 4) * 0.11, seg["start"] - 0.15 + k * 0.07)
    if ln.get("whoosh") or ln.get("flash"):
        ws = np.arange(int(0.6 * SR)) / SR
        noise = np.random.default_rng(1).standard_normal(len(ws)).astype(np.float32)
        env = np.sin(np.pi * ws / ws[-1]) ** 2
        add(np.convolve(noise, np.ones(12) / 12, "same") * env * 0.25, seg["start"] - 0.45)
    if ln.get("boom"):
        bs = np.arange(int(1.0 * SR)) / SR
        add(np.sin(2 * np.pi * (60 - 20 * bs) * bs) * np.exp(-bs * 4) * 0.45, seg["start"] - 0.1)

mix = np.clip(mix / max(1.0, np.abs(mix).max() / 0.95), -1, 1)
with wave.open(f"{EP}/mix.wav", "wb") as o:
    o.setnchannels(1); o.setsampwidth(2); o.setframerate(SR); o.writeframes((mix * 32767).astype(np.int16).tobytes())
# voice-only track for the user
vo = np.zeros(n, np.float32)
for seg, v in zip(timeline, voice):
    s = int(seg["start"] * SR); vo[s:s + len(v)] += v
with wave.open(f"{EP}/voice_only.wav", "wb") as o:
    o.setnchannels(1); o.setsampwidth(2); o.setframerate(SR); o.writeframes((np.clip(vo, -1, 1) * 32767).astype(np.int16).tobytes())
json.dump({"duration": round(total, 3), "lines": timeline}, open(f"{EP}/timeline.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(f"duration {total:.1f}s, {len(timeline)} lines")
