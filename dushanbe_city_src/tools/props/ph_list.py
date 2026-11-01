"""Poly Haven assets kept for the DUSHANBE prop library (all CC0).

polyhaven id -> settings
  tex:     game texture resolution
  extra:   additional texture map keys to download (missing from the 1k glTF bundle)
  out:     list of produced props:
             prop:   our prop id (GLB / mesh name)
             keep:   object names to keep from the glTF (None = all)
             tris:   target triangle count after decimation (None = keep)
             origin: "ground" (bbox centre on XZ, bottom at y=0) or "wall" (centre X, back at z=0, bottom y=0)
             yaw:    rotation (deg, around up) applied so that the front faces +Z (game)
"""
PH_ASSETS = {
    "exterior_aircon_unit": {"tex": 1024, "extra": ["02_diff", "rusted_02_diff"], "out": [
        {"prop": "ph_aircon_outdoor_unit", "keep": ["exterior_aircon_unit"], "tris": 2500, "origin": "wall", "yaw": 0},
        {"prop": "ph_aircon_outdoor_unit_rusted", "keep": ["exterior_aircon_unit_rusted"], "tris": 2500, "origin": "wall", "yaw": 0},
    ]},
    "plastic_monobloc_chair_01": {"tex": 512, "out": [
        {"prop": "ph_plastic_chair", "keep": None, "tris": 1800, "origin": "ground", "yaw": 0}]},
    "concrete_road_barrier_02": {"tex": 1024, "out": [
        {"prop": "ph_concrete_block_barrier", "keep": None, "tris": 1500, "origin": "ground", "yaw": 0}]},
    "plastic_crate_02": {"tex": 512, "out": [
        {"prop": "ph_plastic_crate", "keep": None, "tris": 1500, "origin": "ground", "yaw": 0}]},
    "barrel_03": {"tex": 512, "out": [
        {"prop": "ph_barrel_blue", "keep": None, "tris": None, "origin": "ground", "yaw": 0}]},
    "trashbag": {"tex": 512, "out": [
        {"prop": "ph_trash_bag", "keep": None, "tris": 1000, "origin": "ground", "yaw": 0}]},
    "rollershutter_door": {"tex": 1024, "out": [
        {"prop": "ph_rollershutter_door", "keep": ["rollershutter_door"], "tris": None, "origin": "wall", "yaw": 0}]},
    "rollershutter_window_01": {"tex": 1024, "out": [
        {"prop": "ph_rollershutter_window", "keep": ["rollershutter_window_01"], "tris": None, "origin": "wall", "yaw": 0}]},
    "security_camera_02": {"tex": 512, "out": [
        {"prop": "ph_security_camera", "keep": None, "tris": 1500, "origin": "wall", "yaw": 0}]},
    "planter_pot_clay": {"tex": 512, "out": [
        {"prop": "ph_clay_pot", "keep": None, "tris": 1200, "origin": "ground", "yaw": 0}]},
    "potted_plant_04": {"tex": 512, "out": [
        {"prop": "ph_potted_aloe", "keep": None, "tris": 2500, "origin": "ground", "yaw": 0}]},
    "cardboard_box_01": {"tex": 512, "out": [
        {"prop": "ph_cardboard_box", "keep": None, "tris": 800, "origin": "ground", "yaw": 0}]},
}
