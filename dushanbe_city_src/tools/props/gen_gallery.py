#!/usr/bin/env python3
"""Generate res://scenes/testing/props_gallery.tscn: every prop mesh on a paved ground with sun + sky.
Also writes gallery_layout.json (prop -> position) used by shots.py for camera placement."""
import json, math, os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
PROJ = os.path.join(ROOT, "dushanbe_city")
rep = json.load(open(os.path.join(HERE, "build_report.json")))
grep = json.load(open(os.path.join(HERE, "godot_report.json")))

ROWS = [
    ("A", 0.0, ["benches", "urns", "containers"]),
    ("B", -14.0, ["lights", "poles"]),
    ("C", -26.0, ["traffic", "signs"]),
    ("D", -38.0, ["busstop", "fences"]),
    ("E", -50.0, ["playground", "courtyard"]),
    ("F", -62.0, ["misc", "polyhaven"]),
]
WALL = {  # wall-mounted props: mount height on the gallery wall (row W)
    "street_plate_0": 2.6, "street_plate_1": 2.6, "street_plate_2": 2.6, "street_plate_3": 2.6,
    "house_number_0": 2.6, "house_number_1": 2.6, "house_number_2": 2.6, "house_number_3": 2.6,
    "gas_pipe_straight_3m": 2.3, "gas_pipe_elbow": 2.3, "gas_pipe_riser_3m": -1.0, "gas_pipe_ground_entry": 0.0,
    "satellite_dish_060": 3.2, "satellite_dish_090": 3.2, "awning_shop_red": 3.0, "awning_shop_green": 3.0,
    "canopy_porch_metal": 2.7, "ph_aircon_outdoor_unit": 1.2, "ph_aircon_outdoor_unit_rusted": 1.2,
    "ph_rollershutter_door": 0.0, "ph_rollershutter_window": 0.9, "ph_security_camera": 3.0,
}
WALL_Z = -74.0
STATE = {  # demo "on" states via surface overrides
    "traffic_light_pole": {"tl_red": "tl_red_on", "tl_countdown": "tl_countdown_on"},
    "traffic_light_mast": {"tl_green": "tl_green_on"},
    "traffic_light_ped": {"tl_ped_green": "tl_ped_green_on"},
}


def main():
    ids = [k for k, v in rep.items() if not v.get("lod_of")]
    ext, nodes, layout = [], [], {}

    def ext_id(path, typ):
        for i, (p, t) in enumerate(ext):
            if p == path:
                return i + 1
        ext.append((path, typ))
        return len(ext)

    def place(pid, x, y, z, label=True):
        mid = ext_id(f"res://assets/models/props/meshes/{pid}.res", "ArrayMesh")
        lines = [f'[node name="{pid}" type="MeshInstance3D" parent="Props"]',
                 f"transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, {x:.3f}, {y:.3f}, {z:.3f})",
                 f'mesh = ExtResource("{mid}")']
        for src, dst in STATE.get(pid, {}).items():
            surfs = grep[pid]["surfaces"]
            if src in surfs:
                lines.append(f'surface_material_override/{surfs.index(src)} = ExtResource("{ext_id(f"res://assets/materials/props/{dst}.tres", "Material")}")')
        nodes.append("\n".join(lines))
        if label:
            nodes.append("\n".join([f'[node name="L_{pid}" type="Label3D" parent="Labels"]',
                                    f"transform = Transform3D(1, 0, 0, 0, 0.5, 0.866, 0, -0.866, 0.5, {x:.3f}, 0.02, {z + max(0.6, rep[pid]['max'][2] + 0.35):.3f})",
                                    "pixel_size = 0.0025", f'text = "{pid}"', "font_size = 48", "outline_size = 8",
                                    "modulate = Color(1, 1, 0.85, 1)"]))
        layout[pid] = [x, y, z]

    for row, z, groups in ROWS:
        x = 0.0
        for pid in ids:
            if rep[pid]["group"] not in groups or pid in WALL:
                continue
            w = rep[pid]["max"][0] - rep[pid]["min"][0]
            x += w / 2 - rep[pid]["min"][0] - w / 2 if False else 0
            cx = x - rep[pid]["min"][0]
            place(pid, cx, 0.0, z)
            x = cx + rep[pid]["max"][0] + 1.4
        layout["_row_" + row] = [x, 0, z]
    # wall row
    x = 0.0
    for pid, h in WALL.items():
        w = rep[pid]["max"][0] - rep[pid]["min"][0]
        cx = x - rep[pid]["min"][0]
        y = h if h >= 0 else 0.0
        place(pid, cx, y, WALL_Z, label=True)
        x = cx + rep[pid]["max"][0] + 1.2
    wall_len = x + 2

    head = [f'[gd_scene load_steps={len(ext) + 8} format=3]', ""]
    for i, (p, t) in enumerate(ext):
        head.append(f'[ext_resource type="{t}" path="{p}" id="{i + 1}"]')
    head += ["", '[ext_resource type="Texture2D" path="res://assets/textures/sidewalk/albedo.jpg" id="g1"]',
             '[ext_resource type="Texture2D" path="res://assets/textures/sidewalk/normal.png" id="g2"]',
             '[ext_resource type="Material" path="res://assets/materials/props/plaster_cream.tres" id="g3"]', "",
             '[sub_resource type="ProceduralSkyMaterial" id="sky_mat"]',
             "sky_top_color = Color(0.32, 0.52, 0.82, 1)", "sky_horizon_color = Color(0.72, 0.78, 0.86, 1)",
             "ground_horizon_color = Color(0.6, 0.6, 0.6, 1)", "",
             '[sub_resource type="Sky" id="sky"]', 'sky_material = SubResource("sky_mat")', "",
             '[sub_resource type="Environment" id="env"]', "background_mode = 2", 'sky = SubResource("sky")',
             "ambient_light_source = 3", "ambient_light_sky_contribution = 0.6", "tonemap_mode = 2", "ssao_enabled = false", "",
             '[sub_resource type="StandardMaterial3D" id="ground_mat"]', 'albedo_texture = ExtResource("g1")',
             "normal_enabled = true", 'normal_texture = ExtResource("g2")', "roughness = 0.9", "uv1_scale = Vector3(100, 100, 1)", "",
             '[sub_resource type="PlaneMesh" id="ground"]', 'material = SubResource("ground_mat")', "size = Vector2(240, 240)", "",
             '[sub_resource type="BoxMesh" id="wall"]', 'material = ExtResource("g3")', f"size = Vector3({wall_len:.2f}, 5, 0.4)", "",
             '[node name="PropsGallery" type="Node3D"]', "",
             '[node name="WE" type="WorldEnvironment" parent="."]', 'environment = SubResource("env")', "",
             '[node name="Sun" type="DirectionalLight3D" parent="."]',
             "transform = Transform3D(0.766, -0.413, 0.492, 0, 0.766, 0.643, -0.643, -0.492, 0.586, 0, 20, 0)",
             "light_energy = 1.2", "shadow_enabled = true", "directional_shadow_max_distance = 80.0", "",
             '[node name="Ground" type="MeshInstance3D" parent="."]', "transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 60, 0, -40)",
             'mesh = SubResource("ground")', "",
             '[node name="Wall" type="MeshInstance3D" parent="."]',
             f"transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, {wall_len / 2 - 1:.2f}, 2.5, {WALL_Z - 0.2:.2f})",
             'mesh = SubResource("wall")', "",
             '[node name="Props" type="Node3D" parent="."]', "", '[node name="Labels" type="Node3D" parent="."]', ""]
    with open(os.path.join(PROJ, "scenes", "testing", "props_gallery.tscn"), "w") as f:
        f.write("\n".join(head) + "\n" + "\n\n".join(nodes) + "\n")
    json.dump(layout, open(os.path.join(HERE, "gallery_layout.json"), "w"), indent=1)
    print("gallery props:", len([k for k in layout if not k.startswith('_')]))


if __name__ == "__main__":
    main()
