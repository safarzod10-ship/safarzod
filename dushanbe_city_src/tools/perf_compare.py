#!/usr/bin/env python3
"""Compare two perf_set.sh runs (JSONL): frame/GPU time, draw calls, primitives, VRAM per view.
Usage: perf_compare.py before.jsonl after.jsonl [out.md]"""
import json, sys

def load(p):
    d = {}
    for line in open(p):
        line = line.strip()
        if line:
            j = json.loads(line)
            d[j["label"]] = j
    return d

a, b = load(sys.argv[1]), load(sys.argv[2])
VIEWS = {"-50,1.7,-60,15,3": "проспект", "-262,1.7,-205,200,4": "двор", "285,1.7,60,-90,2": "край города → море"}
rows = ["| Пресет | Вид | Кадр, мс (до → после) | GPU, мс | Draw calls | Треугольники, млн | VRAM, МБ |", "|---|---|---|---|---|---|---|"]
for k in a:
    if k not in b:
        continue
    q, cam = k.split("@", 1)
    x, y = a[k], b[k]
    rows.append("| %s | %s | %.0f → %.0f (%+.0f%%) | %.0f → %.0f | %d → %d | %.2f → %.2f | %.0f → %.0f |" % (
        q.capitalize(), VIEWS.get(cam, cam), x["frame_ms"], y["frame_ms"], (y["frame_ms"] / x["frame_ms"] - 1) * 100,
        x["gpu_ms"], y["gpu_ms"], x["draw_calls"], y["draw_calls"], x["primitives"] / 1e6, y["primitives"] / 1e6,
        x["vram_mb"], y["vram_mb"]))
out = "\n".join(rows)
print(out)
if len(sys.argv) > 3:
    open(sys.argv[3], "w").write(out + "\n")
