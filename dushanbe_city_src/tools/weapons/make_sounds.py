"""Synthesised weapon / explosion sounds (own work, CC0): python3 make_sounds.py <out_dir>"""
import sys, wave, numpy as np
from scipy.signal import butter, lfilter
OUT = sys.argv[1]; SR = 44100
rng = np.random.default_rng(3)

def lp(x, f): b, a = butter(2, f / (SR / 2), "low"); return lfilter(b, a, x)
def hp(x, f): b, a = butter(2, f / (SR / 2), "high"); return lfilter(b, a, x)
def bp(x, f0, f1): b, a = butter(2, [f0 / (SR / 2), f1 / (SR / 2)], "band"); return lfilter(b, a, x)
def env(n, att, dec):
    t = np.arange(n) / SR
    return np.minimum(t / att, 1.0) * np.exp(-t / dec)
def save(name, x):
    x = x / (np.max(np.abs(x)) + 1e-9) * 0.92
    w = wave.open(f"{OUT}/{name}.wav", "wb"); w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((x * 32767).astype(np.int16).tobytes()); w.close()
def reverb(x, secs=0.6, mix=0.25):
    n = int(secs * SR); ir = rng.standard_normal(n) * np.exp(-np.arange(n) / (SR * secs * 0.25))
    return x + mix * np.convolve(x, ir / np.sqrt(n))[:len(x)]

def shot(dur, crack, body_f, body_dec, tail):
    n = int(dur * SR); t = np.arange(n) / SR
    noise = rng.standard_normal(n)
    c = hp(noise, 1800) * env(n, 0.0004, crack) * 1.0                      # supersonic crack
    m = bp(noise, 300, 2500) * env(n, 0.0008, crack * 3) * 0.9             # muzzle blast
    b = np.sin(2 * np.pi * body_f * t * (1 - 0.35 * t / dur)) * env(n, 0.001, body_dec) * 0.9   # thump
    tl = lp(noise, 900) * env(n, 0.01, tail) * 0.35                         # rumble tail
    return reverb(np.tanh((c + m + b + tl) * 1.8), 0.5, 0.18)

save("pistol", shot(0.9, 0.012, 95, 0.05, 0.18))
save("ak47", shot(0.7, 0.01, 75, 0.06, 0.14))
n = int(0.6 * SR); t = np.arange(n) / SR; noise = rng.standard_normal(n)
save("bat_hit", (np.sin(2 * np.pi * 180 * t) * env(n, 0.001, 0.04) + bp(noise, 400, 3000) * env(n, 0.0005, 0.015)) * 1.0)
save("punch_hit", lp(noise, 1200) * env(n, 0.001, 0.03) + np.sin(2 * np.pi * 70 * t) * env(n, 0.002, 0.05))
save("impact", hp(noise, 2500) * env(n, 0.0003, 0.008) + bp(noise, 600, 2000) * env(n, 0.0005, 0.02) * 0.5)
save("metal_hit", sum(np.sin(2 * np.pi * f * t) * env(n, 0.0005, d) for f, d in ((1250, 0.12), (2730, 0.08), (4100, 0.05))) + hp(noise, 3000) * env(n, 0.0003, 0.006))
n = int(3.5 * SR); t = np.arange(n) / SR; noise = rng.standard_normal(n)
boom = lp(noise, 160) * env(n, 0.004, 0.7) * 2.0 + lp(noise, 1400) * env(n, 0.001, 0.12) * 1.2 + np.sin(2 * np.pi * 42 * t) * env(n, 0.005, 0.5)
crackle = hp(noise, 2500) * (rng.random(n) < 0.004) * env(n, 0.2, 1.0) * 3.0
save("explosion", reverb(np.tanh(boom * 1.5) + crackle, 1.2, 0.35))
n = int(4.0 * SR); noise = rng.standard_normal(n)
fire = lp(noise, 700) * (0.6 + 0.4 * np.sin(np.arange(n) / SR * 2 * np.pi * 0.7)) + hp(noise, 3000) * (rng.random(n) < 0.002) * 4
save("fire_loop", fire * 0.6)
n = int(0.25 * SR); t = np.arange(n) / SR
save("empty_click", hp(rng.standard_normal(n), 3000) * env(n, 0.0002, 0.004) + np.sin(2 * np.pi * 2400 * t) * env(n, 0.0003, 0.01) * 0.4)
print("SOUNDS OK")
