#!/usr/bin/env python3
"""Build a voice track for an episode and a time-warp so the animation follows the voice.

Usage:  python3 build_voice.py episode1.html voice/ep1_map.json out/ep1_voice
Writes: <prefix>.wav  (48 kHz mono voice track)
        <prefix>.json (knots anim->out time, mouth envelope at 30 fps, duration)
"""
import json, re, subprocess, sys
import numpy as np

SR = 48000
FPS = 30
html_path, map_path, prefix = sys.argv[1:4]

html = open(html_path, encoding='utf-8').read()
subs = [(float(a), float(b), w) for a, b, w in
        re.findall(r"^\s*\[\s*([\d.]+),\s*([\d.]+),\s*'(\w)',\s*'.*?'\],?\s*$", html, re.M)]
assert subs, 'SUBS not found'
cfg = json.load(open(map_path, encoding='utf-8'))
vdir = cfg['voiceDir']
phone = set(cfg.get('phoneFilter', []))

cache = {}
def load(name, filt=None):
    key = (name, filt)
    if key not in cache:
        cmd = ['ffmpeg', '-loglevel', 'error', '-i', f'{vdir}/{name}']
        if filt:
            cmd += ['-af', filt]
        cmd += ['-f', 'f32le', '-ac', '1', '-ar', str(SR), '-']
        cache[key] = np.frombuffer(subprocess.run(cmd, capture_output=True, check=True).stdout, np.float32)
    return cache[key]

def rms(x, win, hop):
    n = max(1, (len(x) - win) // hop + 1)
    return np.array([np.sqrt(np.mean(x[i * hop:i * hop + win] ** 2) + 1e-12) for i in range(n)])

# --- match map lines to subtitle lines
lines = []
for e in cfg['lines']:
    m = [s for s in subs if abs(s[0] - e['a']) < 0.15]
    assert len(m) == 1, f"no subtitle line at {e['a']}"
    lines.append(dict(e, a=m[0][0], b=m[0][1], who=m[0][2]))

# --- refine shared boundaries inside one file to the quietest point
for p, n in zip(lines, lines[1:]):
    if p['file'] == n['file'] and abs(p['to'] - n['from']) < 1e-6:
        x = load(p['file'])
        B = n['from']
        lo, hi = int(max(p['from'], B - 0.45) * SR), int(min(len(x) / SR, B + 0.12) * SR)
        env = rms(x[lo:hi], int(.02 * SR), int(.005 * SR))
        cut = (lo + int(np.argmin(env)) * int(.005 * SR) + int(.01 * SR)) / SR
        p['to'] = n['from'] = cut

# --- extract + trim clips
for ln in lines:
    x = load(ln['file'])
    lo, hi = int(ln['from'] * SR), min(len(x), int(ln['to'] * SR))
    seg = x[lo:hi]
    hop = int(.01 * SR)
    env = rms(seg, hop, hop)
    thr = 0.08 * np.percentile(env, 95)
    on = np.where(env > thr)[0]
    s0 = max(0, on[0] * hop - int(.06 * SR)) if len(on) else 0
    s1 = min(len(seg), (on[-1] + 1) * hop + int(.10 * SR)) if len(on) else len(seg)
    if ln['who'] in phone:
        xf = load(ln['file'], 'highpass=f=380,lowpass=f=3200,acompressor=threshold=-20dB:ratio=4,volume=1.6')
        seg = xf[lo:hi]
    clip = seg[s0:s1].copy()
    f = min(len(clip) // 2, int(.012 * SR))
    if f:
        clip[:f] *= np.linspace(0, 1, f); clip[-f:] *= np.linspace(1, 0, f)
    ln['clip'] = clip
    ln['dur'] = len(clip) / SR

# --- timeline: animation follows the voice
LEAD, TAIL = 0.08, 0.22
by_a = {ln['a']: ln for ln in lines}
knots = [(0.0, 0.0)]
cur, prev_b = 0.0, 0.0
place = []
for a, b, who in subs:
    gap = a - prev_b
    out_gap = gap if gap <= 2 else min(gap, 3.6)
    start = cur + out_gap
    slot = b - a
    ln = by_a.get(a)
    if ln:
        L = max(ln['dur'] + LEAD + TAIL, 0.6 * slot)
        place.append((start + LEAD, ln['clip']))
    else:
        L = 0.7 * slot
    knots.append((a, start)); knots.append((b, start + L))
    cur, prev_b = start + L, b
end_anim = float(re.search(r'const DUR = ([\d.]+)', html).group(1))
knots.append((end_anim, cur + 2.0))
duration = cur + 2.0

track = np.zeros(int(duration * SR) + SR, np.float32)
for t0, clip in place:
    i = int(t0 * SR)
    track[i:i + len(clip)] += clip
track = track[:int(duration * SR)]
peak = np.max(np.abs(track)) or 1
track = (track / peak * 0.9).astype(np.float32)

# mouth envelope per video frame
hop = SR // FPS
env = rms(np.concatenate([track, np.zeros(hop, np.float32)]), hop, hop)
ref = np.percentile(env[env > 1e-3], 90) if np.any(env > 1e-3) else 1
env = np.clip(env / ref, 0, 1.2)
env = np.convolve(env, [0.25, 0.5, 0.25], mode='same')

subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'f32le', '-ar', str(SR), '-ac', '1', '-i', '-',
                f'{prefix}.wav'], input=track.tobytes(), check=True)
json.dump({'duration': duration, 'knots': knots, 'env': [round(float(v), 3) for v in env]},
          open(f'{prefix}.json', 'w'))
print(f'lines with voice: {len(lines)} / {len(subs)}; duration {duration:.1f}s')
for ln in lines:
    print(f"  {ln['a']:6.1f}  {ln['who']}  {ln['dur']:.2f}s  slot {ln['b'] - ln['a']:.2f}s")
