class_name MonumentLOD
extends Node3D
## Ismoili Somoni monument v3 wrapper: explicit LOD0/LOD1/LOD2 meshes switched by
## visibility ranges, per-element switch distances MEASURED in Blender
## (docs/reports/monument_v3_build.json -> assets/monuments/ismoili_somoni/lod_ranges.json):
## the distance at which the 99th-percentile geometric error of a LOD projects
## to <= 1 px at 1080p / 70 deg FOV. Presets scale the tolerance
## (Low 2 px -> half the distance) and switch the detail projection
## (triplanar on Medium/Ultra, dominant axis on Low).

const RANGES_PATH := "res://assets/monuments/ismoili_somoni/lod_ranges.json"
const MIN_LOD1_M := 20.0   # never switch closer than this (avoids LOD pops near the player)
const MIN_LOD2_M := 70.0
## No hysteresis margin: Godot's visibility_range_*_margin keeps the previous state inside the
## band, so after a camera jump (spawn, teleport, cut) BOTH neighbouring LODs could stay hidden
## (seen in QA: the arch vanished at 116 m). Exact thresholds; LOD error there is <= 1 px anyway.
const MARGIN := 0.0

var ranges: Dictionary = {}
var px_tolerance := 1.0
## Shadow proxies: while LOD0 is drawn, its shadow is cast by a shadow-only copy of LOD1
## (3x fewer triangles in every shadow cascade; LOD1 error <= 7.5 cm p99, below shadow-map texel size).
var _shadow_proxies := {}


func _ready() -> void:
	var txt := FileAccess.get_file_as_string(RANGES_PATH)
	var parsed: Variant = JSON.parse_string(txt)
	ranges = parsed if typeof(parsed) == TYPE_DICTIONARY else {}
	if ranges.is_empty():
		push_warning("MonumentLOD: %s missing or invalid, using defaults" % RANGES_PATH)
	if Engine.has_singleton("SettingsManager") or get_node_or_null("/root/SettingsManager"):
		var sm := get_node("/root/SettingsManager")
		sm.graphics_applied.connect(_on_graphics)
		_on_graphics(sm.quality, sm.current_preset())
	else:
		apply(1.0, true)


func _on_graphics(quality: int, _preset: Dictionary) -> void:
	# LOW: 2 px tolerance, single-axis detail projection and NO LOD0 (LOD1 from 0 m: 3.2x fewer
	# triangles; measured LOD1 error <= 0.6 cm on sculpture, <= 7.5 cm on the arch)
	var low := quality == GraphicsPresets.Quality.LOW
	apply(2.0 if low else 1.0, not low, not low)


## Returns {element: [lod1_switch_m, lod2_switch_m]} actually applied.
func apply(tolerance_px: float, triplanar: bool, use_lod0 := true) -> Dictionary:
	px_tolerance = tolerance_px
	var applied := {}
	for mi: MeshInstance3D in find_children("*_LOD*", "MeshInstance3D", true, false):
		var parts := mi.name.rsplit("_LOD", true, 1)
		var element := parts[0]
		var level := int(parts[1])
		var r: Array = ranges.get(element, [40.0, 120.0])
		var d1 := maxf(float(r[0]) / tolerance_px, MIN_LOD1_M)
		var d2 := maxf(float(r[1]) / tolerance_px, MIN_LOD2_M)
		d2 = maxf(d2, d1 * 1.5)
		if not use_lod0:
			d1 = 0.0
		mi.visibility_range_fade_mode = GeometryInstance3D.VISIBILITY_RANGE_FADE_DISABLED
		match level:
			0:
				mi.visibility_range_begin = 0.0
				mi.visibility_range_end = d1
				mi.visible = use_lod0
				mi.visibility_range_end_margin = d1 * MARGIN
			1:
				mi.visibility_range_begin = d1
				mi.visibility_range_begin_margin = d1 * MARGIN
				mi.visibility_range_end = d2
				mi.visibility_range_end_margin = d2 * MARGIN
			_:
				mi.visibility_range_begin = d2
				mi.visibility_range_begin_margin = d2 * MARGIN
				mi.visibility_range_end = 0.0
		if level == 0:
			mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
			var proxy := _shadow_proxy(element, mi)
			proxy.visibility_range_end = d1
			proxy.visible = use_lod0
		applied[element] = [snappedf(d1, 0.1), snappedf(d2, 0.1)]
		for s in mi.get_surface_override_material_count():
			var m := mi.get_active_material(s) as ShaderMaterial
			if m:
				m.set_shader_parameter("triplanar", triplanar)
	return applied


func _shadow_proxy(element: String, lod0: MeshInstance3D) -> MeshInstance3D:
	if _shadow_proxies.has(element):
		return _shadow_proxies[element]
	var lod1 := find_child(element + "_LOD1", true, false) as MeshInstance3D
	var p := MeshInstance3D.new()
	p.name = element + "_ShadowProxy"
	p.mesh = lod1.mesh if lod1 else lod0.mesh
	p.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_SHADOWS_ONLY
	p.visibility_range_end_margin = 0.0
	lod0.get_parent().add_child(p)
	p.transform = lod1.transform if lod1 else lod0.transform
	_shadow_proxies[element] = p
	return p


## Only the LOD meshes visible at a camera distance (used by tests / QA captures).
func visible_lod_at(element: String, distance_m: float) -> int:
	for lvl in 3:
		var mi := find_child("%s_LOD%d" % [element, lvl], true, false) as MeshInstance3D
		if mi == null or not mi.visible:
			continue
		var b := mi.visibility_range_begin
		var e := mi.visibility_range_end
		if distance_m >= b and (e <= 0.0 or distance_m < e):
			return lvl
	return -1
