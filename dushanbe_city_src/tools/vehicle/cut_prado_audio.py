"""Cut the real (CC0, Freesound) recordings in raw/sounds/car5 into the Prado's game sounds.

    python3 -I tools/vehicle/cut_prado_audio.py <raw_dir> <out_dir>

Engine: four steady-rpm loops cut from real diesel recordings (seamless equal-power cross-fade at the
loop point), each with its measured firing frequency printed for VehicleAudio.F0, plus an "off-load"
copy of every loop (same recording, low-passed / quieter: the lift-off / engine-braking layer).
One-shots: start, stop, doors, lock, crashes, skids; loops: tyre squeal, gravel, road roar.
Nothing here is synthesised: every output is a cut / filtered / level-matched piece of a recording.
"""
import subprocess
import sys

import numpy as np
from scipy.signal import butter, sosfiltfilt

SR = 32000
RAW = sys.argv[1]
OUT = sys.argv[2]


def load(name: str, sr: int = SR) -> np.ndarray:
    b = subprocess.run(["ffmpeg", "-v", "error", "-i", f"{RAW}/{name}.mp3", "-ac", "1", "-ar", str(sr),
                        "-f", "f32le", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(b, np.float32).astype(np.float64)


def cut(x: np.ndarray, a: float, b: float) -> np.ndarray:
    return x[int(a * SR):int(b * SR)].copy()


def hp(x, f):
    return sosfiltfilt(butter(2, f, "highpass", fs=SR, output="sos"), x)


def lp(x, f):
    return sosfiltfilt(butter(2, f, "lowpass", fs=SR, output="sos"), x)


def loop(x: np.ndarray, xf: float) -> np.ndarray:
    """seamless loop: the tail (xf s) is equal-power cross-faded into the head"""
    n = int(xf * SR)
    body = x[:-n].copy()
    t = np.linspace(0.0, 1.0, n)
    body[:n] = x[:n] * np.sin(t * np.pi / 2) + x[-n:] * np.cos(t * np.pi / 2)
    return body


def rms_norm(x, db):
    r = np.sqrt(np.mean(x ** 2)) + 1e-12
    return x * (10 ** (db / 20) / r)


def peak_norm(x, db=-1.0):
    return x * (10 ** (db / 20) / (np.abs(x).max() + 1e-12))


def fades(x, fi=0.01, fo=0.05):
    a, b = int(fi * SR), int(fo * SR)
    if a:
        x[:a] *= np.linspace(0, 1, a)
    if b:
        x[-b:] *= np.linspace(1, 0, b)
    return x


def write(x: np.ndarray, name: str, ogg=False):
    x = np.clip(x, -1.0, 1.0)
    pcm = (x * 32767).astype("<i2").tobytes()
    path = f"{OUT}/{name}.{'ogg' if ogg else 'wav'}"
    cmd = ["ffmpeg", "-v", "error", "-y", "-f", "s16le", "-ar", str(SR), "-ac", "1", "-i", "-"]
    cmd += (["-c:a", "libvorbis", "-q:a", "5"] if ogg else ["-c:a", "pcm_s16le"]) + [path]
    subprocess.run(cmd, input=pcm, check=True)
    print(f"{name:18s} {len(x) / SR:5.2f} s")


def f0(x: np.ndarray, lo: float, hi: float) -> float:
    """firing frequency: max of the harmonic sum (5 harmonics), 0.05 Hz steps"""
    n = len(x)
    F = np.abs(np.fft.rfft(x * np.hanning(n), 8 * n))
    df = SR / (8 * n)
    best = (0.0, lo)
    for f in np.arange(lo, hi, 0.05):
        v = sum(F[int(round(k * f / df))] for k in range(1, 6))
        if v > best[0]:
            best = (v, f)
    return round(best[1], 2)


# ---------------------------------------------------------------------------------------- engine
hilux = load("379914_hilux_engine_rev")            # Toyota Hilux diesel (Alex_hears_things, CC0)
peug = load("865222_peugeot_rev")                  # 4-cyl 1.5 diesel revving (Mihacappy, CC0)
ENGINE = [
    # name, source, start, end, f0 search range (firing Hz)
    ("eng_idle", hilux, 29.55, 31.45, (20, 30)),
    ("eng_low", hilux, 54.90, 57.55, (40, 48)),
    ("eng_mid", peug, 13.00, 13.86, (55, 68)),
    ("eng_high", peug, 16.95, 17.76, (115, 135)),
]
print("F0 :=", end=" ")
f0s = []
for name, src, a, b, rng in ENGINE:
    s = hp(cut(src, a, b), 22.0)
    f0s.append(f0(s, *rng))
    lp_ = loop(s, 0.10)
    on = rms_norm(lp_, -16.0)
    write(on, name)
    off = rms_norm(lp(lp_, 650.0), -21.0)           # lift-off: same engine, muffled and quieter
    write(off, name + "_off")
print("F0 =", f0s)

# one-shots from the same Hilux recording: starter + catch, and shut-down
write(fades(peak_norm(hp(cut(hilux, 22.20, 25.00), 22.0), -2.0), 0.005, 0.6), "engine_start", True)
write(fades(peak_norm(hp(cut(hilux, 33.45, 35.60), 22.0), -3.0), 0.08, 0.4), "engine_stop", True)

# ---------------------------------------------------------------------------------------- doors / lock
write(fades(peak_norm(cut(load("556690_door_open_close"), 0.55, 1.65), -3.0)), "door_open", True)
write(fades(peak_norm(cut(load("379912_door_close"), 0.62, 1.75), -1.0)), "door_close", True)
write(fades(peak_norm(cut(load("50697_door_handle"), 0.0, 0.55), -4.0)), "door_handle", True)
write(fades(peak_norm(cut(load("433590_locking"), 0.12, 0.98), -3.0)), "door_lock", True)

# ---------------------------------------------------------------------------------------- crashes
write(fades(peak_norm(cut(load("420356_crash"), 0.0, 1.30), -1.0), 0.002, 0.2), "crash_medium", True)
write(fades(peak_norm(cut(load("237375_crash"), 0.0, 2.75), -1.0), 0.002, 0.3), "crash_heavy", True)
write(fades(peak_norm(cut(load("592388_crash_glass"), 0.0, 2.40), -1.0), 0.002, 0.3), "crash_glass", True)

# ---------------------------------------------------------------------------------------- tyres / road
sq = load("71739_tire_squeal")                     # Chrysler LHS tyre squeal (audible-edge, CC0)
write(rms_norm(loop(hp(cut(sq, 5.0, 8.2), 200.0), 0.15), -16.0), "tyre_squeal")
hb = load("71741_handbrake_turn")                  # Nissan Maxima handbrake turn (audible-edge, CC0)
write(fades(peak_norm(cut(hb, 6.0, 7.35), -2.0), 0.02, 0.25), "tyre_skid", True)
gr = load("341069_gravel_road")                    # gravel road under a car (seth-m, CC0)
g = loop(hp(cut(gr, 0.3, 7.25), 60.0), 0.2)
write(rms_norm(g, -18.0), "roll_gravel")
write(rms_norm(lp(g, 1300.0), -19.0), "roll_sand")  # same recording, softer/duller for loose sand
cab = load("237374_interior_tiguan")               # highway cabin (squareal, CC0): tyre / road roar
write(rms_norm(loop(hp(cut(cab, 30.0, 36.2), 40.0), 0.2), -18.0), "road_interior")
amb = load("495795_driving_ambience")              # outside driving ambience (priesjensen, CC0)
write(rms_norm(loop(hp(cut(amb, 4.0, 10.2), 120.0), 0.2), -18.0), "roll_asphalt")
