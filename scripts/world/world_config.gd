class_name WorldConfig
extends RefCounted
## Read-only access to assets/world/world_config.json (frame, bounds, chunks,
## zones, bookmarks) and the terrain heightmap. One metric frame for every
## scene: +X east, -Z north, +Y up, origin = Ismoili Somoni monument.

const PATH := "res://assets/world/world_config.json"

static var _cfg: Dictionary = {}
static var _heights: PackedFloat32Array
static var _n := 0
static var _step := 2.0
static var _half := 400.0


static func data() -> Dictionary:
	if _cfg.is_empty():
		var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(PATH))
		if typeof(parsed) == TYPE_DICTIONARY:
			_cfg = parsed
		else:
			push_error("WorldConfig: cannot parse " + PATH)
	return _cfg


static func terrain() -> Dictionary:
	return data().get("terrain", {})


static func heights() -> PackedFloat32Array:
	if _heights.is_empty():
		var t := terrain()
		_n = int(t["heightmap_size"][0])
		_step = float(t["grid_step_m"])
		_half = float(data()["bounds"]["detailed_terrain"][2])
		var bytes := FileAccess.get_file_as_bytes(String(t["heightmap"]))
		_heights = bytes.to_float32_array()
		if _heights.size() != _n * _n:
			push_error("WorldConfig: heightmap size %d != %d" % [_heights.size(), _n * _n])
	return _heights


## Terrain height (m) at world x,z; bilinear; clamps to the detailed area.
static func height_at(x: float, z: float) -> float:
	var h := heights()
	if h.is_empty():
		return 0.0
	var fx := clampf((x + _half) / _step, 0.0, _n - 1.001)
	var fz := clampf((z + _half) / _step, 0.0, _n - 1.001)
	var ix := int(fx)
	var iz := int(fz)
	var tx := fx - ix
	var tz := fz - iz
	var i := iz * _n + ix
	return lerpf(lerpf(h[i], h[i + 1], tx), lerpf(h[i + _n], h[i + _n + 1], tx), tz)


static func grid_size() -> int:
	heights()
	return _n


static func grid_step() -> float:
	heights()
	return _step


static func bookmark(name: String) -> Array:
	return data().get("camera_bookmarks", {}).get(name, [])
