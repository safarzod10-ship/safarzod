extends Node3D
## Lighting calibration (TEST scene). Neutral PBR patches with known albedo
## (sRGB authored values), lit by the production EnvironmentRig. Used by
## tests/visual/capture.gd to MEASURE displayed pixel values per renderer and
## time of day (docs/DAY_NIGHT_SYSTEM.md). Technical primitives only.

## name: [albedo sRGB, metallic, roughness]
const PATCHES := {
	"white": [Color(0.90, 0.90, 0.90), 0.0, 0.8],
	"light_grey": [Color(0.70, 0.70, 0.70), 0.0, 0.8],
	"mid_grey18": [Color(0.46, 0.46, 0.46), 0.0, 0.8],
	"dark_grey": [Color(0.20, 0.20, 0.20), 0.0, 0.8],
	"black": [Color(0.06, 0.06, 0.06), 0.0, 0.8],
	"red": [Color(0.70, 0.20, 0.15), 0.0, 0.7],
	"grass_green": [Color(0.30, 0.45, 0.18), 0.0, 0.9],
	"blue": [Color(0.20, 0.30, 0.60), 0.0, 0.7],
	"skin": [Color(0.76, 0.58, 0.47), 0.0, 0.6],
	"loess_soil": [Color(0.66, 0.56, 0.43), 0.0, 0.95],
}

var probes: Dictionary = {}


func _ready() -> void:
	var ground := MeshInstance3D.new()
	ground.name = "TEST_ground_grey18"
	var pm := PlaneMesh.new()
	pm.size = Vector2(80, 80)
	ground.mesh = pm
	ground.material_override = _mat(Color(0.46, 0.46, 0.46), 0.0, 0.9)
	ground.position.y = -0.03
	add_child(ground)
	var i := 0
	for name: String in PATCHES:
		var spec: Array = PATCHES[name]
		var pos := Vector3((i % 5) * 2.4 - 4.8, 0.0, (i / 5) * 2.4)
		_patch(name, pos, spec, Vector3(2, 0.05, 2))
		probes[name] = pos + Vector3(0, 0.03, 0)
		i += 1
	# the same white and grey inside a cast shadow (wall south of them blocks a high sun)
	var wall := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = Vector3(6, 4.0, 0.3)
	wall.mesh = bm
	wall.material_override = _mat(Color(0.5, 0.5, 0.5), 0.0, 0.9)
	wall.position = Vector3(0, 2.0, 7.4)
	add_child(wall)
	_patch("white_shadow", Vector3(-1.2, 0, 6.4), PATCHES["white"], Vector3(2, 0.05, 1.4))
	_patch("grey_shadow", Vector3(1.2, 0, 6.4), PATCHES["mid_grey18"], Vector3(2, 0.05, 1.4))
	probes["white_shadow"] = Vector3(-1.2, 0.03, 6.4)
	probes["grey_shadow"] = Vector3(1.2, 0.03, 6.4)
	for s in [["sphere_white", Color(0.9, 0.9, 0.9), 0.0, 0.5, -3.0], ["sphere_gold", Color(1.0, 0.78, 0.34), 1.0, 0.3, 0.0],
			["sphere_dark", Color(0.06, 0.06, 0.06), 0.0, 0.4, 3.0]]:
		var mi := MeshInstance3D.new()
		mi.name = "TEST_" + s[0]
		mi.mesh = SphereMesh.new()
		mi.material_override = _mat(s[1], s[2], s[3])
		mi.position = Vector3(s[4], 0.5, -2.2)
		add_child(mi)


func _patch(name: String, pos: Vector3, spec: Array, size: Vector3) -> void:
	var mi := MeshInstance3D.new()
	mi.name = "TEST_patch_" + name
	var bm := BoxMesh.new()
	bm.size = size
	mi.mesh = bm
	mi.material_override = _mat(spec[0], spec[1], spec[2])
	mi.position = pos
	add_child(mi)


func _mat(c: Color, metallic: float, rough: float) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = c
	m.metallic = metallic
	m.roughness = rough
	return m


func probe_points() -> Dictionary:
	return probes
