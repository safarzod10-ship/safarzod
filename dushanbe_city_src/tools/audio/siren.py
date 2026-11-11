"""Police siren loop (own synthesis): two-tone wail with a slight square edge, 2.4 s seamless loop.
usage: python3 -I siren.py out.wav"""
import sys, wave
import numpy as np
SR = 22050
T = 2.4
t = np.arange(int(SR * T)) / SR
# wail: frequency sweeps 650 -> 1350 -> 650 Hz over the loop (smooth cosine), phase-continuous
f = 1000 - 350 * np.cos(2 * np.pi * t / T)
ph = 2 * np.pi * np.cumsum(f) / SR
ph *= round(ph[-1] / (2 * np.pi)) * 2 * np.pi / ph[-1]          # whole number of cycles: seamless
x = np.sin(ph) + 0.35 * np.sign(np.sin(ph)) * 0.6 + 0.15 * np.sin(2 * ph)
x = np.tanh(x * 1.3)
x /= np.max(np.abs(x))
pcm = (x * 0.8 * 32767).astype(np.int16)
w = wave.open(sys.argv[1], "wb"); w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes()); w.close()
print("ok")
