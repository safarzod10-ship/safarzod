"""City ambience loops (own synthesis, no samples): traffic hum, birds (day), crickets (night), distant horns.
usage: python3 -I city_ambience.py <out_dir>   -> amb_traffic.wav, amb_birds.wav, amb_night.wav, amb_horn.wav"""
import sys, wave, math
import numpy as np

SR = 22050
OUT = sys.argv[1]
rng = np.random.default_rng(11)


def save(name, x, sr=SR):
    x = x / (np.max(np.abs(x)) + 1e-9) * 0.85
    w = wave.open("%s/%s" % (OUT, name), "wb")
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
    w.writeframes((x * 32767).astype(np.int16).tobytes()); w.close()


def lowpass(x, a):
    y = np.zeros_like(x); acc = 0.0
    for i in range(len(x)):
        acc += a * (x[i] - acc); y[i] = acc
    return y


def seamless(x, fade=0.5):
    n = int(fade * SR)
    head = x[:n].copy()
    x = x[n:]
    x[-n:] = x[-n:] * np.linspace(1, 0, n) + head * np.linspace(0, 1, n)
    return x


# traffic hum: brown noise with slow swells (cars passing), 20 s loop
T = 20.5
n = int(T * SR)
brown = np.cumsum(rng.normal(0, 1, n)); brown -= np.convolve(brown, np.ones(2000) / 2000, mode="same")
hum = lowpass(brown, 0.05)
t = np.arange(n) / SR
swell = 0.6 + 0.4 * np.clip(np.sin(2 * np.pi * t / 6.7) * np.sin(2 * np.pi * t / 3.1 + 1.0), 0, 1)
tyre = lowpass(rng.normal(0, 1, n), 0.25) * 0.25 * swell
save("amb_traffic.wav", seamless(hum * swell + tyre))

# birds: random chirps (sparrow-like FM tweets, a few warbles), 24 s
T = 24.5; n = int(T * SR); x = np.zeros(n)
for k in range(70):
    t0 = rng.uniform(0, T - 1)
    dur = rng.uniform(0.05, 0.16)
    f0 = rng.uniform(2800, 5200)
    m = int(dur * SR); tt = np.arange(m) / SR
    f = f0 + rng.uniform(-900, 900) * np.sin(2 * np.pi * rng.uniform(8, 25) * tt)
    ph = 2 * np.pi * np.cumsum(f) / SR
    env = np.sin(np.pi * tt / dur) ** 2
    rep = rng.integers(1, 4)
    for r in range(rep):
        i0 = int((t0 + r * dur * 1.3) * SR)
        if i0 + m < n:
            x[i0:i0 + m] += np.sin(ph) * env * rng.uniform(0.3, 1.0)
save("amb_birds.wav", seamless(x))

# night: crickets (4.5 kHz chirp trains) + soft hum
T = 16.5; n = int(T * SR); t = np.arange(n) / SR
x = np.zeros(n)
for c in range(4):
    f = rng.uniform(4200, 4800); rate = rng.uniform(14, 20); ph0 = rng.uniform(0, 1)
    gate = (np.sin(2 * np.pi * rate * t + ph0 * 6) > 0.3).astype(float)
    groups = (np.sin(2 * np.pi * t / rng.uniform(0.6, 1.1) + ph0) > -0.2).astype(float)
    x += np.sin(2 * np.pi * f * t) * gate * groups * rng.uniform(0.3, 0.7)
x += lowpass(rng.normal(0, 1, n), 0.02) * 0.6
save("amb_night.wav", seamless(x))

# distant car horn (two-tone, with a short echo)
T = 1.4; n = int(T * SR); t = np.arange(n) / SR
x = np.zeros(n); m = int(0.55 * SR); tt = np.arange(m) / SR
for f in (415.0, 523.0):
    tone = np.sign(np.sin(2 * np.pi * f * tt)) * 0.5 + np.sin(2 * np.pi * f * tt)
    x[:m] += tone * np.minimum(1, tt / 0.02) * np.minimum(1, (0.55 - tt) / 0.05)
x = lowpass(x, 0.3)
echo = np.zeros(n); d = int(0.28 * SR); echo[d:] = x[:-d] * 0.35
save("amb_horn.wav", x + echo)
print("ok")
