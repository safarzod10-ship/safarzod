class_name VegetationSystem
extends Node3D
## Trees, shrubs and grass for the whole map with MultiMeshInstance3D batches.
##
## * Trees / shrubs: positions from assets/world/vegetation_instances.json
##   (generated from OSM layout). Grouped in 50 m cells; per cell and species one
##   LOD0 batch (0 .. tree_detail_distance) and one LOD1 batch (single surface,
##   tree_detail_distance .. tree_distance). Same cell size for both LODs, so the
##   ranges are exact complements (no double drawing, no gaps).
## * Grass: 25 m cells generated on demand around the camera from the splat
##   map (green lawn / dry wild grass), density = preset grass_density via
##   MultiMesh.visible_instance_count, shrink-fade in the shader before the
##   visibility range ends.
## Nothing heavy runs per frame: the grass streamer checks every 0.4 s.

const TREE_CELL := 50.0
const GRASS_CELL := 25.0
const GRASS_MAX_PER_CELL := 1800
const SPECIES := {
	"plane": {"scene": "res://assets/vegetation/plane.glb", "mesh": "Plane", "height": 19.5,
		"leaves": "res://assets/materials/vegetation/leaves_plane.tres", "bark": "res://assets/materials/vegetation/bark_light.tres"},
	"elm": {"scene": "res://assets/vegetation/elm.glb", "mesh": "Elm", "height": 14.0,
		"leaves": "res://assets/materials/vegetation/leaves_elm.tres", "bark": "res://assets/materials/vegetation/bark_dark.tres"},
	"poplar": {"scene": "res://assets/vegetation/poplar.glb", "mesh": "Poplar", "height": 22.6,
		"leaves": "res://assets/materials/vegetation/leaves_poplar.tres", "bark": "res://assets/materials/vegetation/bark_light.tres"},
	"thuja": {"scene": "res://assets/vegetation/thuja.glb", "mesh": "Thuja", "height": 6.8,
		"leaves": "res://assets/materials/vegetation/leaves_thuja.tres", "bark": "res://assets/materials/vegetation/bark_dark.tres"},
	"boxwood": {"scene": "res://assets/vegetation/boxwood.glb", "mesh": "Boxwood", "height": 1.7,
		"leaves": "res://assets/materials/vegetation/leaves_boxwood.tres", "shrub": true},
	"juniper": {"scene": "res://assets/vegetation/juniper.glb", "mesh": "Juniper", "height": 1.5,
		"leaves": "res://assets/materials/vegetation/leaves_juniper.tres", "shrub": true},
	"rose": {"scene": "res://assets/vegetation/rose.glb", "mesh": "Rose", "height": 1.7,
		"leaves": "res://assets/materials/vegetation/leaves_rose.tres", "shrub": true},
}

@export var instances_path := "res://assets/world/vegetation_instances.json"
@export var grass_material: ShaderMaterial = preload("res://assets/materials/vegetation/grass.tres")
@export var enable_grass := true

var tree_batches: Array[MultiMeshInstance3D] = []   # LOD0 + LOD1 + shrubs
var lod0_batches: Array[MultiMeshInstance3D] = []
var lod1_batches: Array[MultiMeshInstance3D] = []
var shrub_batches: Array[MultiMeshInstance3D] = []
var grass_cells: Dictionary = {}                     # Vector2i -> Array[MultiMeshInstance3D]
var counts := {"trees": 0, "shrubs": 0}

var _meshes: Dictionary = {}
var _splat: Image
var _grass_meshes: Array[Mesh] = []
var _accum := 0.0
var _preset: Dictionary = {}


func _ready() -> void:
	_load_meshes()
	_build_trees()
	if enable_grass:
		_prepare_grass()
	SettingsManager.graphics_applied.connect(_on_graphics)
	_on_graphics(SettingsManager.quality, SettingsManager.current_preset())


func _load_meshes() -> void:
	for sp: String in SPECIES:
		var def: Dictionary = SPECIES[sp]
		var root := (load(def["scene"]) as PackedScene).instantiate()
		for lod in [0, 1]:
			var mi := root.find_child("%s_LOD%d" % [def["mesh"], lod], true, false) as MeshInstance3D
			if mi == null:
				push_error("VegetationSystem: missing %s_LOD%d" % [def["mesh"], lod])
				continue
			var mesh := mi.mesh.duplicate() as ArrayMesh
			var leaves := load(def["leaves"]) as Material
			for s in mesh.get_surface_count():
				var mname := mesh.surface_get_material(s).resource_name if mesh.surface_get_material(s) else ""
				if mname.begins_with("M_Bark") and def.has("bark"):
					mesh.surface_set_material(s, load(def["bark"]))
				else:
					mesh.surface_set_material(s, leaves)
			_meshes["%s_%d" % [sp, lod]] = mesh
		root.free()


func _build_trees() -> void:
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(instances_path))
	if typeof(parsed) != TYPE_DICTIONARY:
		push_error("VegetationSystem: cannot read " + instances_path)
		return
	var groups := {}   # "sp|cx|cz" -> Array[Transform3D]
	for kind in ["trees", "shrubs"]:
		for rec: Dictionary in parsed[kind]:
			var sp := String(rec["t"])
			var cx := floori(float(rec["x"]) / TREE_CELL)
			var cz := floori(float(rec["z"]) / TREE_CELL)
			var key := "%s|%d|%d" % [sp, cx, cz]
			var s := float(rec["s"])
			var b := Basis(Vector3.UP, deg_to_rad(float(rec["yaw"]))).scaled(Vector3(s, s * randf_range(0.95, 1.05), s))
			if not groups.has(key):
				groups[key] = []
			groups[key].append(Transform3D(b, Vector3(float(rec["x"]), float(rec["y"]) - 0.05, float(rec["z"]))))
			counts[kind] += 1
	var rng := RandomNumberGenerator.new()
	rng.seed = 7
	for key: String in groups:
		var parts := key.split("|")
		var sp := parts[0]
		var xf: Array = groups[key]
		var is_shrub: bool = SPECIES[sp].get("shrub", false)
		for lod in ([0] if is_shrub else [0, 1]):
			var mm := MultiMesh.new()
			mm.transform_format = MultiMesh.TRANSFORM_3D
			mm.use_colors = true
			mm.mesh = _meshes["%s_%d" % [sp, lod]]
			mm.instance_count = xf.size()
			for i in xf.size():
				mm.set_instance_transform(i, xf[i])
				var v := rng.randf_range(0.86, 1.1)   # per-tree tint variation (same for both LODs)
				mm.set_instance_color(i, Color(v * rng.randf_range(0.95, 1.05), v, v * rng.randf_range(0.9, 1.0)))
			var mmi := MultiMeshInstance3D.new()
			mmi.name = "%s_%s_%s_LOD%d" % [sp, parts[1], parts[2], lod]
			mmi.multimesh = mm
			mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if lod == 0 else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
			add_child(mmi)
			if is_shrub:
				shrub_batches.append(mmi)
			elif lod == 0:
				lod0_batches.append(mmi)
			else:
				lod1_batches.append(mmi)
			tree_batches.append(mmi)


func _on_graphics(_q: int, p: Dictionary) -> void:
	_preset = p
	var d0: float = p["tree_detail_distance"]
	var d1: float = p["tree_distance"]
	for mmi in lod0_batches:
		mmi.visibility_range_end = d0
		mmi.visibility_range_end_margin = 4.0
	for mmi in lod1_batches:
		mmi.visibility_range_begin = d0
		mmi.visibility_range_begin_margin = 4.0
		mmi.visibility_range_end = d1
	for mmi in shrub_batches:
		mmi.visibility_range_end = p["shrub_distance"]
	if grass_material:
		grass_material.set_shader_parameter("fade_end", p["grass_distance"])
		grass_material.set_shader_parameter("fade_start", p["grass_distance"] * 0.7)
	for cell: Vector2i in grass_cells:
		_apply_grass_density(grass_cells[cell])


# ------------------------------------------------------------------ grass
func _prepare_grass() -> void:
	var tex := load(String(WorldConfig.terrain()["splat"])) as Texture2D
	_splat = tex.get_image() if tex else null
	if _splat and _splat.is_compressed():
		_splat.decompress()
	var root := (load("res://assets/vegetation/grass.glb") as PackedScene).instantiate()
	for n in ["Grass_Lawn", "Grass_Wild"]:
		var mi := root.find_child(n, true, false) as MeshInstance3D
		var m := mi.mesh.duplicate() as ArrayMesh
		m.surface_set_material(0, grass_material)
		_grass_meshes.append(m)
	root.free()


func _process(delta: float) -> void:
	if not enable_grass or _splat == null:
		return
	_accum += delta
	if _accum < 0.4:
		return
	_accum = 0.0
	var cam := get_viewport().get_camera_3d()
	if cam == null:
		return
	update_grass(cam.global_position)


## Creates grass cells within range of `pos`, frees the far ones. Public for tests.
func update_grass(pos: Vector3, max_new_cells := 6) -> void:
	var r: float = _preset.get("grass_distance", 40.0) + GRASS_CELL
	var c0 := Vector2i(floori((pos.x - r) / GRASS_CELL), floori((pos.z - r) / GRASS_CELL))
	var c1 := Vector2i(floori((pos.x + r) / GRASS_CELL), floori((pos.z + r) / GRASS_CELL))
	var keep := {}
	var missing: Array = []
	for cz in range(c0.y, c1.y + 1):
		for cx in range(c0.x, c1.x + 1):
			var cell := Vector2i(cx, cz)
			var centre := Vector3((cx + 0.5) * GRASS_CELL, pos.y, (cz + 0.5) * GRASS_CELL)
			if centre.distance_to(pos) > r + GRASS_CELL * 0.71:
				continue
			keep[cell] = true
			if not grass_cells.has(cell):
				missing.append([centre.distance_to(pos), cell])
	missing.sort_custom(func(a: Array, b: Array) -> bool: return a[0] < b[0])
	for k in missing.size() if max_new_cells < 0 else mini(max_new_cells, missing.size()):
		grass_cells[missing[k][1]] = _build_grass_cell(missing[k][1])
	for cell: Vector2i in grass_cells.keys():
		if not keep.has(cell) and Vector3((cell.x + 0.5) * GRASS_CELL, pos.y, (cell.y + 0.5) * GRASS_CELL).distance_to(pos) > r + GRASS_CELL * 2.0:
			for mmi: MultiMeshInstance3D in grass_cells[cell]:
				mmi.queue_free()
			grass_cells.erase(cell)


func _splat_at(x: float, z: float) -> Color:
	var px := clampi(int(x + 400.0), 0, _splat.get_width() - 1)
	var pz := clampi(int(z + 400.0), 0, _splat.get_height() - 1)
	return _splat.get_pixel(px, pz)


func _build_grass_cell(cell: Vector2i) -> Array:
	var rng := RandomNumberGenerator.new()
	rng.seed = hash(cell)
	var lawn: Array[Transform3D] = []
	var wild: Array[Transform3D] = []
	var lawn_c: Array[Color] = []
	var wild_c: Array[Color] = []
	var x0 := cell.x * GRASS_CELL
	var z0 := cell.y * GRASS_CELL
	if absf(x0 + GRASS_CELL / 2) > 400.0 or absf(z0 + GRASS_CELL / 2) > 400.0:
		return []
	for i in GRASS_MAX_PER_CELL * 2:
		var x := x0 + rng.randf() * GRASS_CELL
		var z := z0 + rng.randf() * GRASS_CELL
		var w := _splat_at(x, z)
		var green := w.r
		var dry := w.g
		if w.a > 0.25 or w.b > 0.75:
			continue  # paved / bare soil
		var y := WorldConfig.height_at(x, z) - 0.02
		var b := Basis(Vector3.UP, rng.randf() * TAU)
		if green > 0.35 and lawn.size() < GRASS_MAX_PER_CELL and rng.randf() < green:
			var s := rng.randf_range(0.8, 1.25)
			lawn.append(Transform3D(b.scaled(Vector3(s, s * rng.randf_range(0.8, 1.3), s)), Vector3(x, y, z)))
			var v := rng.randf_range(0.82, 1.12)
			lawn_c.append(Color(v * rng.randf_range(0.92, 1.05), v, v * rng.randf_range(0.85, 1.0), clampf(dry * 0.7, 0.0, 1.0)))
		elif dry > 0.4 and wild.size() < GRASS_MAX_PER_CELL / 3 and rng.randf() < dry * 0.35:
			var s := rng.randf_range(0.7, 1.3)
			wild.append(Transform3D(b.scaled(Vector3(s, s * rng.randf_range(0.7, 1.4), s)), Vector3(x, y, z)))
			var v := rng.randf_range(0.8, 1.15)
			wild_c.append(Color(v, v * rng.randf_range(0.95, 1.05), v, clampf(0.55 + rng.randf() * 0.45 - green * 0.5, 0.0, 1.0)))
	var out := []
	for pack in [[lawn, lawn_c, 0], [wild, wild_c, 1]]:
		var xf: Array = pack[0]
		if xf.is_empty():
			continue
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.use_colors = true
		mm.mesh = _grass_meshes[pack[2]]
		mm.instance_count = xf.size()
		for i in xf.size():
			mm.set_instance_transform(i, xf[i])
			mm.set_instance_color(i, pack[1][i])
		var mmi := MultiMeshInstance3D.new()
		mmi.multimesh = mm
		mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		mmi.set_meta("full_count", xf.size())
		add_child(mmi)
		out.append(mmi)
	_apply_grass_density(out)
	return out


func _apply_grass_density(batch: Array) -> void:
	var d: float = _preset.get("grass_density", 0.65)
	var end: float = _preset.get("grass_distance", 45.0)
	for mmi: MultiMeshInstance3D in batch:
		var full: int = mmi.get_meta("full_count", mmi.multimesh.instance_count)
		mmi.multimesh.visible_instance_count = int(full * d)   # instances were generated in random order
		mmi.visibility_range_end = end + GRASS_CELL * 0.71


func grass_instance_count() -> int:
	var n := 0
	for cell: Vector2i in grass_cells:
		for mmi: MultiMeshInstance3D in grass_cells[cell]:
			n += mmi.multimesh.visible_instance_count
	return n
