#!/usr/bin/env python3
"""Synthesize the sound track for the "wake up to 10k" video (all original sounds).

Usage: python3 sfx.py notif_times.json out.wav
notif_times.json: {"duration": 18.5, "notifs": [t1, t2, ...], "alarm": [0.6, 2.4], "boom": 11.0, "rewind": 12.4}
"""
import json
import subprocess
import sys

import numpy as np

SR = 48000
cfg = json.load(open(sys.argv[1]))
out = np.zeros(int(cfg['duration'] * SR) + SR, np.float32)


def add(t, sig, gain=1.0):
    i = int(t * SR)
    n = min(len(sig), len(out) - i)
    if n > 0:
        out[i:i + n] += sig[:n] * gain


def tone(freq, dur, decay=8.0, harm=(1, .3, .1)):
    tt = np.arange(int(dur * SR)) / SR
    s = sum(a * np.sin(2 * np.pi * freq * (k + 1) * tt) for k, a in enumerate(harm))
    return (s * np.exp(-decay * tt)).astype(np.float32)


# alarm: bright two-note marimba-like pattern, repeating
a0, a1 = cfg['alarm']
t = a0
while t < a1:
    for k, f in enumerate([1318.5, 1760.0, 1318.5, 1760.0]):
        add(t + k * .12, tone(f, .25, 14, (1, .5, .2, .1)), .25)
    t += .62
# notification pings: short rising chirp; slightly varied pitch, quieter as they get dense
for i, nt in enumerate(cfg['notifs']):
    dur = .16
    tt = np.arange(int(dur * SR)) / SR
    f0 = 1500 + (i % 3) * 60
    s = np.sin(2 * np.pi * (f0 * tt + 900 * tt * tt)) * np.exp(-22 * tt)
    add(nt, s.astype(np.float32), .22 if i < 15 else .14)
# boom at 10k: low hit + shimmer
bt = cfg['boom']
tt = np.arange(int(1.8 * SR)) / SR
add(bt, (np.sin(2 * np.pi * 55 * tt * (1 - tt * .2)) * np.exp(-2.5 * tt)).astype(np.float32), .9)
noise = np.random.default_rng(3).standard_normal(len(tt)).astype(np.float32)
add(bt, noise * np.exp(-3 * tt).astype(np.float32) * .12)
for k, f in enumerate([2093, 2637, 3136, 4186]):
    add(bt + .05 * k, tone(f, 1.2, 3.5, (1, .2)), .08)
# rewind: descending tape-stop sweep
rt = cfg['rewind']
tt = np.arange(int(.9 * SR)) / SR
freq = 900 * np.exp(-3.2 * tt)
add(rt, (np.sin(2 * np.pi * np.cumsum(freq) / SR) * (1 - tt / .9)).astype(np.float32), .35)
# soft ambient pad under everything
tt = np.arange(len(out)) / SR
pad = (np.sin(2 * np.pi * 110 * tt) + .6 * np.sin(2 * np.pi * 164.8 * tt) + .4 * np.sin(2 * np.pi * 220.5 * tt)) * .025
out += pad.astype(np.float32) * np.minimum(1, tt / 2)
out = out[:int(cfg['duration'] * SR)]
out /= max(1e-6, np.abs(out).max()) / .9
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'f32le', '-ar', str(SR), '-ac', '1', '-i', '-', sys.argv[2]],
               input=out.tobytes(), check=True)
print('ok', len(cfg['notifs']), 'pings')
