"""Car radio stations (own synthesized music, no samples):
  1 «Радио Ватан»  : Hijaz mode, dutar plucks, doira, 96 bpm
  2 «Dushanbe FM»  : pop / dance, major key, four-on-the-floor, saw synth chords, 116 bpm
  3 «Дутор»        : slow acoustic, plucks and frame drum only, 78 bpm
usage: python3 -I radio.py <out_dir> [seconds]  -> radio_1.wav .. radio_3.wav"""
import sys, wave, math
import numpy as np

OUT = sys.argv[1]
DUR = float(sys.argv[2]) if len(sys.argv) > 2 else 90.0
SR = 32000
rng = np.random.default_rng(5)


def midi(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def env(n, a, d):
    e = np.ones(n); na = max(1, int(a * SR)); e[:na] = np.linspace(0, 1, na)
    return e * np.exp(-np.arange(n) / (d * SR))


def pluck(f, dur):
    n = int(dur * SR); p = max(2, int(SR / f))
    buf = rng.uniform(-1, 1, p); out = np.zeros(n)
    idx = 0
    for i in range(n):
        j = (idx + 1) % p
        out[i] = buf[idx]
        buf[idx] = 0.5 * (buf[idx] + buf[j]) * 0.996
        idx = j
    return out * env(n, 0.002, dur * 0.6)


def kick():
    n = int(0.3 * SR); t = np.arange(n) / SR
    return np.sin(2 * np.pi * np.cumsum(50 + 100 * np.exp(-t * 35)) / SR) * np.exp(-t * 10)


def snare():
    n = int(0.2 * SR); t = np.arange(n) / SR
    return rng.normal(0, 1, n) * np.exp(-t * 22) * 0.6 + np.sin(2 * np.pi * 190 * t) * np.exp(-t * 30) * 0.5


def hat():
    n = int(0.05 * SR); x = np.diff(np.concatenate([[0], rng.normal(0, 1, n)]))
    return x * np.exp(-np.arange(n) / SR * 70)


def doira(low):
    n = int(0.25 * SR); t = np.arange(n) / SR
    return np.sin(2 * np.pi * (110 if low else 230) * t) * np.exp(-t * (18 if low else 30)) * 0.8 + rng.normal(0, 1, n) * np.exp(-t * 35) * (0.15 if low else 0.35)


def saw_chord(fs, dur):
    n = int(dur * SR); t = np.arange(n) / SR; s = np.zeros(n)
    for f in fs:
        for det in (-0.15, 0.15):
            s += 2 * ((f * (1 + det / 100) * t) % 1.0) - 1
    # simple one-pole low-pass, vectorised by cumulative filter approximation
    y = np.zeros(n); acc = 0.0; a = 0.12
    for i in range(n):
        acc += a * (s[i] - acc); y[i] = acc
    return y / (len(fs) * 2) * env(n, 0.01, dur * 0.9)


def bass(f, dur):
    n = int(dur * SR); t = np.arange(n) / SR
    return (np.sin(2 * np.pi * f * t) + 0.25 * np.sin(4 * np.pi * f * t)) * env(n, 0.005, dur * 0.6)


def render(station):
    N = int(DUR * SR); mix = np.zeros((N, 2))

    def add(sig, t0, g=1.0, pan=0.0):
        i0 = int(t0 * SR)
        if i0 >= N:
            return
        sig = sig[:N - i0]
        mix[i0:i0 + len(sig), 0] += sig * g * math.cos((pan + 1) * math.pi / 4)
        mix[i0:i0 + len(sig), 1] += sig * g * math.sin((pan + 1) * math.pi / 4)

    if station == 1:
        bpm = 96.0; scale = [57, 58, 61, 62, 64, 65, 67, 69, 70, 73]; roots = [45, 46, 45, 43]
    elif station == 2:
        bpm = 116.0; scale = [60, 62, 64, 67, 69, 72, 74, 76]; roots = [48, 45, 41, 43]
    else:
        bpm = 78.0; scale = [62, 63, 66, 67, 69, 70, 72, 74]; roots = [50, 50, 48, 50]
    beat = 60.0 / bpm; bar = beat * 4; nb = int(DUR / bar)
    mel = [0, 2, 4, 2, 5, 4, 2, 1, 0, 1, 2, 4, 6, 4, 2, 0]
    for b in range(nb):
        t0 = b * bar; r = roots[b % 4]
        if station == 2:
            for k in range(4):
                add(kick(), t0 + k * beat, 0.9)
                add(hat(), t0 + k * beat + beat / 2, 0.25, 0.3)
            add(snare(), t0 + beat, 0.5); add(snare(), t0 + 3 * beat, 0.5)
            ch = [midi(r + 12), midi(r + 16 if r != 45 else r + 15), midi(r + 19)]
            for k in range(4):
                add(saw_chord(ch, beat * 0.9), t0 + k * beat + beat * 0.5, 0.35)
            for k in range(8):
                add(bass(midi(r - 12), beat * 0.45), t0 + k * beat / 2, 0.5)
            if b % 8 >= 4:
                for k in range(8):
                    note = scale[mel[(b * 8 + k) % 16] % len(scale)] + 12
                    add(pluck(midi(note), beat * 0.8), t0 + k * beat / 2, 0.35, -0.2)
        else:
            drum = [(0, True), (1.0, False), (1.5, True), (2.0, False), (3.0, False), (3.5, False)]
            if station == 3:
                drum = [(0, True), (2.0, True), (2.5, False), (3.5, False)]
            for pos, low in drum:
                add(doira(low), t0 + pos * beat, 0.5 if low else 0.35, -0.2 if low else 0.25)
            if station == 1:
                add(kick(), t0, 0.6)
                add(bass(midi(r - 12), bar * 0.8), t0, 0.45)
            steps = 8 if station == 1 else 6
            for k in range(steps):
                if (b + k) % 5 == 4:
                    continue
                note = scale[mel[(b * steps + k) % 16] % len(scale)]
                add(pluck(midi(note), beat * 1.4), t0 + k * bar / steps, 0.5, -0.3 + 0.12 * (k % 3))
                if k % 4 == 0:
                    add(pluck(midi(note - 12), beat * 2.0), t0 + k * bar / steps, 0.3, 0.3)
    mix = np.tanh(mix * 0.9); mix /= np.max(np.abs(mix)) + 1e-9; mix *= 0.85
    f = int(0.4 * SR); mix[:f] *= np.linspace(0, 1, f)[:, None]; mix[-f:] *= np.linspace(1, 0, f)[:, None]
    w = wave.open("%s/radio_%d.wav" % (OUT, station), "wb")
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((mix * 32767).astype(np.int16).tobytes()); w.close()


for st in (1, 2, 3):
    render(st)
print("ok")
