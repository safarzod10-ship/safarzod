#!/usr/bin/env python3
"""Build the screenshot list for the prop gallery and run Godot once to capture all of them.
  python3 shots.py [only=substr]
Screens go to dushanbe_city/docs/screenshots/props/."""
import json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
PROJ = os.path.join(ROOT, "dushanbe_city")
OUTDIR = os.path.join(PROJ, "docs", "screenshots", "props")
lay = json.load(open(os.path.join(HERE, "gallery_layout.json")))
rep = json.load(open(os.path.join(HERE, "build_report.json")))

ROWNAME = {0.0: "street_furniture", -14.0: "lights_poles", -26.0: "traffic_signs", -38.0: "busstop_fences",
           -50.0: "playground_courtyard", -62.0: "small_details", -74.0: "wall_props"}


def overview_shots():
    shots = []
    rows = {}
    for pid, p in lay.items():
        if pid.startswith("_"):
            continue
        rows.setdefault(p[2], []).append((p[0], pid))
    for z, items in rows.items():
        items.sort()
        tall = z == -14.0
        win = 16.0 if tall else 8.5
        chunks, cur = [], []
        for x, pid in items:
            x0 = x + rep[pid]["min"][0]
            if cur and x + rep[pid]["max"][0] - (cur[0][0] + rep[cur[0][1]]["min"][0]) > win:
                chunks.append(cur)
                cur = []
            cur.append((x, pid))
        if cur:
            chunks.append(cur)
        for i, ch in enumerate(chunks):
            a = ch[0][0] + rep[ch[0][1]]["min"][0]
            b = ch[-1][0] + rep[ch[-1][1]]["max"][0]
            cx = (a + b) / 2
            if tall:
                cam = [cx, 2.0, z + 13.0, 0, 14]
            elif z == -74.0:
                cam = [cx, 2.2, z + 6.5, 0, 2]
            else:
                cam = [cx, 1.8, z + 5.5, 0, -12]
            shots.append({"name": f"{ROWNAME[z]}_{i + 1}", "cam": cam, "fov": 70})
    return shots


def near(pid, dx, dy, dz, yaw=0, pitch=0, fov=55, name=None):
    x, y, z = lay[pid]
    return {"name": name or f"close_{pid}", "cam": [x + dx, y + dy, z + dz, yaw, pitch], "fov": fov}


CLOSE = [
    near("bench_park_soviet", 0.9, 1.1, 1.6, 20, -18),
    near("bench_courtyard", -0.6, 1.0, 1.5, -15, -20),
    near("bench_concrete_slats", 0.8, 1.0, 1.5, 20, -22),
    near("bench_modern_metal", 0.8, 1.0, 1.6, 20, -18),
    near("urn_concrete_round", 0.5, 1.2, 1.2, 20, -32),
    near("urn_tilting", 0.5, 1.2, 1.3, 20, -25),
    near("bin_modern_steel", 0.4, 1.2, 1.1, 18, -25),
    near("container_trash_green", 1.4, 1.7, 2.2, 30, -22),
    near("container_euro_wheeled", 1.2, 1.6, 2.2, 25, -18),
    near("sign_5_19_1", 0.0, 1.9, 1.7, 0, 15, name="close_sign_5_19_1"),
    near("sign_2_4", 0.0, 1.9, 1.7, 0, 15),
    near("sign_3_24_60", 0.0, 1.9, 1.7, 0, 15),
    near("traffic_light_pole", 0.3, 2.2, 1.9, 5, 25),
    near("traffic_light_ped", 0.3, 1.8, 1.6, 5, 22),
    near("traffic_light_mast", 3.0, 1.7, 7.5, 5, 22, fov=65),
    near("bus_stop_shelter", 1.5, 1.6, 4.0, 15, -6, fov=70),
    near("bus_stop_shelter", -1.0, 1.5, 0.3, 10, -10, fov=75, name="close_bus_stop_inside"),
    near("bus_stop_shelter", 4.0, 1.6, 1.5, 70, -5, fov=60, name="close_bus_stop_adbox"),
    near("gate_havli_blue", 0.0, 1.6, 5.5, 0, 0, fov=60),
    near("light_park_4m", 0.6, 2.4, 2.0, 15, 30),
    near("light_avenue_double", 0.0, 1.7, 4.0, 0, 60, fov=70),
    near("street_plate_1", 0.0, 2.4, 1.3, 0, 5, name="close_street_plates"),
    near("ph_aircon_outdoor_unit", 0.0, 0.8, 2.2, 0, 5),
    near("gas_pipe_riser_3m", 0.8, 1.6, 2.5, 20, -5),
    near("playground_sandbox_mushroom", 0.0, 2.0, 4.5, 0, -12, fov=60),
    near("tapchan", 1.5, 1.6, 2.5, 30, -22),
    near("manhole_cover", 0.0, 1.3, 1.0, 0, -50),
    near("storm_grate", 0.0, 1.2, 1.0, 0, -50),
]


def main():
    args = dict(a.split("=", 1) for a in sys.argv[1:])
    shots = overview_shots() + CLOSE
    p = os.path.join(HERE, "shots.json")
    json.dump(shots, open(p, "w"), indent=1)
    os.makedirs(OUTDIR, exist_ok=True)
    cmd = ["xvfb-run", "-a", "-s", "-screen 0 1280x720x24", "godot", "--path", PROJ, "--resolution", "1280x720",
           "--rendering-method", "mobile", "res://scenes/testing/props_shots.tscn", "--", f"shots={p}", f"outdir={args.get('outdir', OUTDIR)}"]
    if "only" in args:
        cmd.append(f"only={args['only']}")
    print(len(shots), "shots")
    subprocess.run(cmd, check=False)


if __name__ == "__main__":
    main()
