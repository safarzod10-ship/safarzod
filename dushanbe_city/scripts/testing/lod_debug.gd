extends Node
func _ready() -> void:
	var scene: Node = (load("res://scenes/main/main.tscn") as PackedScene).instantiate()
	get_tree().root.add_child.call_deferred(scene)
	for i in 10:
		await get_tree().process_frame
	var ch := get_tree().root.find_child("chunk_2_2", true, false)
	for mmi in ch.get_children():
		if mmi is MultiMeshInstance3D and String(mmi.name).begins_with("tree_chinar"):
			var m := mmi as MultiMeshInstance3D
			print(m.name, " lod=", m.get_meta(&"lod_index"), " range ", m.visibility_range_begin, "..", m.visibility_range_end, " count=", m.multimesh.instance_count, " aabb_center=", m.get_aabb().get_center(), " mesh=", m.multimesh.mesh.resource_path.get_file())
	get_tree().quit()
