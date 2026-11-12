#!/usr/bin/env python3
"""props_catalog.json from the prop build report (sizes, collisions, visibility, light points)."""
import json, os
ROOT = "/home/user/safarzod/dushanbe_city"
rep = json.load(open("/home/user/safarzod/dushanbe_city_src/tools/props/godot_report.json"))
RU = {"bench": "скамейка", "urn": "урна", "bin": "урна", "container": "мусорный контейнер", "light": "фонарь",
      "traffic": "светофор", "sign": "дорожный знак", "bus": "остановка", "fence": "ограждение", "playground": "детская площадка",
      "gate": "ворота", "utility": "столб", "satellite": "спутниковая тарелка", "ph_aircon": "кондиционер", "tapchan": "топчан",
      "planter": "клумба/вазон", "gas": "газовая труба", "wall": "дувал", "bike": "велопарковка", "manhole": "люк",
      "storm": "ливневая решётка", "street": "табличка улицы", "house": "номер дома", "carpet": "выбивалка для ковров",
      "clothes": "столбы для белья", "courtyard": "стол со скамейками", "awning": "навес", "canopy": "козырёк",
      "barrier": "пешеходное ограждение", "bollard": "столбик", "electrical": "электрощит", "curb": "колесоотбойник"}
POLE = ("light_", "traffic_light", "sign_", "utility_pole", "bollard")
NOCOL = ("ph_aircon", "satellite", "street_plate", "house_number", "manhole", "storm_grate", "awning", "canopy", "gas_pipe",
         "ph_security", "ph_rollershutter", "curb_wheel")
VIS = {"light_": 260, "utility_pole": 260, "traffic_light": 200, "bus_stop": 220, "sign_": 120, "fence": 110,
       "wall_havli": 300, "gate": 200, "playground": 140, "container": 120, "ph_aircon": 90, "satellite": 90,
       "house_number": 40, "street_plate": 50, "manhole": 60, "storm_grate": 50, "gas_pipe": 70}
out = []
for pid, v in rep.items():
    if pid.endswith("_lod1"):
        continue
    pos, size = v["aabb_pos"], v["aabb_size"]
    e = {"id": pid, "ru": next((r for k, r in RU.items() if pid.startswith(k)), pid),
         "mesh": f"res://assets/models/props/meshes/{pid}.res", "size": [round(s, 3) for s in size], "tris": v["tris"]}
    if pid + "_lod1" in rep:
        e["mesh_lod1"] = f"res://assets/models/props/meshes/{pid}_lod1.res"
    e["visibility_end"] = next((d for k, d in VIS.items() if pid.startswith(k)), 120)
    if pid.startswith(NOCOL):
        e["collision"] = None
    elif pid.startswith(POLE):
        e["collision"] = {"type": "cylinder", "radius": 0.13, "height": round(size[1], 2), "offset": [0, round(size[1] / 2, 2), 0]}
    else:
        c = [pos[i] + size[i] / 2 for i in range(3)]
        e["collision"] = {"type": "box", "size": [round(max(s, 0.05), 3) for s in size], "offset": [round(x, 3) for x in c]}
    lp = [m for k, m in v["markers"].items() if k.startswith("light_point")]
    if lp:
        e["light_points"] = lp
    if pid.startswith(("fence", "barrier", "wall_havli")):
        e["segment_length"] = round(size[0], 3)
    out.append(e)
json.dump({"version": 1, "props": out}, open(ROOT + "/data/props_catalog.json", "w"), ensure_ascii=False, indent=1)
print(len(out), "props")
