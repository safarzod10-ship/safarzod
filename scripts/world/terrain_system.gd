class_name TerrainSystem
extends Node3D
## Terrain: 8 x 8 chunks of 100 m (+ outskirts rings) imported from
## assets/world/terrain/terrain.glb, one shared terrain material (high / low
## variant by preset), HeightMapShape3D collision per playable chunk.
## Chunks are independent nodes: they can be hidden or streamed later
## (set_chunk_active); for a 600 m map all chunks stay resident (measured cheap).

signal ready_built

@export var terrain_scene: PackedScene = preload("res://assets/world/terrain/terrain.glb")
@export var material_high: ShaderMaterial = preload("res://assets/materials/terrain/terrain_high.tres")
@export var material_low: ShaderMaterial = preload("res://assets/materials/terrain/terrain_low.tres")
@export var build_collision := true

var chunks: Dictionary = {}       # id -> MeshInstance3D
var outskirts: Array[MeshInstance3D] = []
var colliders: Dictionary = {}    # id -> StaticBody3D


func _ready() -> void:
	var root := terrain_scene.instantiate()
	add_child(root)
	for mi: MeshInstance3D in root.find_children("*", "MeshInstance3D", true, false):
		if mi.name.begins_with("Chunk_"):
			chunks[String(mi.name)] = mi
		else:
			outskirts.append(mi)
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF  # flat-ish ground: receives only
	if build_collision:
		_build_collision()
	SettingsManager.graphics_applied.connect(_on_graphics)
	_on_graphics(SettingsManager.quality, SettingsManager.current_preset())
	ready_built.emit()


func _on_graphics(_q: int, p: Dictionary) -> void:
	var low: bool = p.get("terrain_far_lod", false) and SettingsManager.quality == GraphicsPresets.Quality.LOW
	var mat := material_low if low else material_high
	for mi: MeshInstance3D in chunks.values():
		mi.material_override = mat
	for mi in outskirts:
		mi.material_override = material_low


func set_chunk_active(id: String, active: bool) -> void:
	if chunks.has(id):
		(chunks[id] as MeshInstance3D).visible = active
	if colliders.has(id):
		(colliders[id] as StaticBody3D).process_mode = Node.PROCESS_MODE_INHERIT if active else Node.PROCESS_MODE_DISABLED


func _build_collision() -> void:
	var h := WorldConfig.heights()
	var n := WorldConfig.grid_size()
	var step := WorldConfig.grid_step()
	for ch: Dictionary in WorldConfig.data()["chunks"]:
		if not ch["playable"]:
			continue
		var cells := int(float(ch["size"]) / step)
		var i0 := int((float(ch["x0"]) + 400.0) / step)
		var j0 := int((float(ch["z0"]) + 400.0) / step)
		var data := PackedFloat32Array()
		data.resize((cells + 1) * (cells + 1))
		for j in cells + 1:
			for i in cells + 1:
				data[j * (cells + 1) + i] = h[(j0 + j) * n + (i0 + i)]
		var shape := HeightMapShape3D.new()
		shape.map_width = cells + 1
		shape.map_depth = cells + 1
		shape.map_data = data
		var body := StaticBody3D.new()
		body.name = "Col_" + String(ch["id"])
		var cs := CollisionShape3D.new()
		cs.shape = shape
		cs.scale = Vector3(step, 1.0, step)
		body.add_child(cs)
		body.position = Vector3(float(ch["x0"]) + float(ch["size"]) / 2.0, 0.0, float(ch["z0"]) + float(ch["size"]) / 2.0)
		add_child(body)
		colliders[String(ch["id"])] = body
