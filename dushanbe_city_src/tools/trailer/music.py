"""Original synthesized trailer music (no samples): 96 BPM, A Phrygian-dominant / Hijaz flavour,
Karplus-Strong plucked 'dutar' melody, doira-like frame drum pattern, sub bass, string pad, risers.
usage: python3 music.py out.wav seconds"""
import sys, math
import numpy as np

SR = 44100
out = sys.argv[1]
DUR = float(sys.argv[2])
N = int(SR * DUR)
BPM = 96.0
BEAT = 60.0 / BPM
rng = np.random.default_rng(7)
mix = np.zeros((N, 2))


def add(sig, t0, gain=1.0, pan=0.0):
    i0 = int(t0 * SR)
    if i0 >= N:
        return
    sig = sig[: N - i0]
    l = math.cos((pan + 1) * math.pi / 4)
    r = math.sin((pan + 1) * math.pi / 4)
    mix[i0:i0 + len(sig), 0] += sig * gain * l
    mix[i0:i0 + len(sig), 1] += sig * gain * r


def env(n, a, d):
    e = np.ones(n)
    na = max(1, int(a * SR))
    e[:na] = np.linspace(0, 1, na)
    e *= np.exp(-np.arange(n) / (d * SR))
    return e


def midi(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def pluck(f, dur, bright=0.5):
    n = int(dur * SR)
    p = max(2, int(SR / f))
    buf = rng.uniform(-1, 1, p)
    out = np.zeros(n)
    for i in range(n):
        out[i] = buf[i % p]
        j = (i + 1) % p
        buf[i % p] = (0.5 + bright * 0.0) * (buf[i % p] + buf[j]) * 0.996
    return out * env(n, 0.002, dur * 0.6)


def kick():
    n = int(0.35 * SR)
    t = np.arange(n) / SR
    f = 50 + 90 * np.exp(-t * 30)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 9)


def doira(low=True):
    n = int(0.25 * SR)
    t = np.arange(n) / SR
    tone = np.sin(2 * np.pi * (110 if low else 230) * t) * np.exp(-t * (18 if low else 30))
    noise = rng.normal(0, 1, n) * np.exp(-t * (40 if low else 25))
    return tone * 0.8 + noise * (0.15 if low else 0.35)


def hat():
    n = int(0.06 * SR)
    x = rng.normal(0, 1, n)
    x = np.diff(np.concatenate([[0], x]))
    return x * np.exp(-np.arange(n) / SR * 60)


def pad(freqs, dur):
    n = int(dur * SR)
    t = np.arange(n) / SR
    s = np.zeros(n)
    for f in freqs:
        for det in (-0.12, 0.0, 0.11):
            ph = rng.uniform(0, 2 * np.pi)
            saw = 2 * ((f * (1 + det / 100) * t + ph / (2 * np.pi)) % 1.0) - 1
            s += saw
    # gentle low-pass (one-pole)
    y = np.zeros(n)
    a = 0.06
    acc = 0.0
    for i in range(n):
        acc += a * (s[i] - acc)
        y[i] = acc
    fade = np.minimum(1, np.minimum(t / 0.8, (dur - t) / 0.8))
    return y / (len(freqs) * 3) * fade


def bass(f, dur):
    n = int(dur * SR)
    t = np.arange(n) / SR
    return (np.sin(2 * np.pi * f * t) + 0.3 * np.sin(4 * np.pi * f * t)) * env(n, 0.005, dur * 0.7)


def riser(dur):
    n = int(dur * SR)
    t = np.arange(n) / SR
    x = rng.normal(0, 1, n)
    y = np.zeros(n)
    acc = 0.0
    for i in range(n):
        a = 0.02 + 0.5 * (i / n) ** 2
        acc += a * (x[i] - acc)
        y[i] = acc
    return y * (t / dur) ** 2


# A Hijaz: A Bb C# D E F G
SCALE = [57, 58, 61, 62, 64, 65, 67, 69, 70, 73, 74, 76]
CHORDS = [[45, 52, 57, 61], [46, 53, 58, 62], [45, 52, 57, 61], [43, 50, 55, 62]]  # A, Bb, A, G
bar = BEAT * 4
intro = bar * 2
n_bars = int((DUR - 0.5) / bar)
mel = [7, 8, 9, 8, 7, 5, 4, 5, 7, 4, 3, 1, 0, 1, 3, 4]
for b in range(n_bars):
    t0 = b * bar
    ch = CHORDS[b % 4]
    add(pad([midi(m) for m in ch[1:]], bar + 0.4), t0, 0.35, 0.0)
    last = b >= n_bars - 1
    if b >= 2 and not last:
        add(bass(midi(ch[0] - 12), bar * 0.9), t0, 0.55)
        # doira: dum . tek dum | tek . tek .  (+ kick on 1 and 3)
        for k, (pos, low) in enumerate([(0, True), (1.0, False), (1.5, True), (2.0, False), (3.0, False), (3.5, False)]):
            add(doira(low), t0 + pos * BEAT, 0.5 if low else 0.35, -0.2 if low else 0.25)
        add(kick(), t0, 0.9)
        add(kick(), t0 + 2 * BEAT, 0.8)
        for h in range(8):
            add(hat(), t0 + h * BEAT / 2, 0.12 if h % 2 else 0.2, 0.4)
    # dutar melody: eighth notes from bar 1 on
    if b >= 1 and not last:
        for k in range(8):
            if (b + k) % 5 == 4:
                continue
            note = SCALE[mel[(b * 8 + k) % len(mel)] % len(SCALE)]
            add(pluck(midi(note), BEAT * 1.2), t0 + k * BEAT / 2, 0.45, -0.35 + 0.1 * (k % 3))
            if k % 4 == 0:
                add(pluck(midi(note - 12), BEAT * 1.5), t0 + k * BEAT / 2, 0.3, 0.35)
    if b % 4 == 3 and not last:
        add(riser(bar), t0, 0.08)
# final hit
tf = n_bars * bar - bar
add(kick(), tf, 1.2)
add(doira(True), tf, 0.9)
add(pad([midi(m) for m in [57, 61, 64, 69]], DUR - tf), tf, 0.5)
for m in [57, 61, 64, 69]:
    add(pluck(midi(m), 3.0), tf, 0.35)
# master: soft clip, normalise, fade out
mix = np.tanh(mix * 0.9)
mix /= np.max(np.abs(mix)) + 1e-9
mix *= 0.9
fo = int(1.5 * SR)
mix[-fo:] *= np.linspace(1, 0, fo)[:, None]
pcm = (mix * 32767).astype(np.int16)
import wave
w = wave.open(out, "wb")
w.setnchannels(2)
w.setsampwidth(2)
w.setframerate(SR)
w.writeframes(pcm.tobytes())
w.close()
print("ok", DUR)
