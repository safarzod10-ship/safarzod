extends Node
func _ready() -> void:
	var c := VehicleCar.new()
	c.configure("lexus")
	add_child(c)
	c.freeze = true
	for n in c.model.find_children("*", "MeshInstance3D", true, false):
		var m := n as MeshInstance3D
		if m.get_parent().name == "Interior" or String(m.get_path()).contains("Interior") or String(m.get_path()).contains("wheel_"):
			continue
		var bb := m.global_transform * m.mesh.get_aabb()
		for k in m.mesh.get_surface_count():
			var mat := m.mesh.surface_get_material(k)
			var col := ""
			if mat is BaseMaterial3D:
				col = str((mat as BaseMaterial3D).albedo_color) + (" tex" if (mat as BaseMaterial3D).albedo_texture else "")
			print("M ", m.name, " vis ", m.is_visible_in_tree(), " s", k, " ", mat.resource_name if mat else "-", " ", col, " aabb ", bb.position.snapped(Vector3.ONE * 0.01), " .. ", bb.end.snapped(Vector3.ONE * 0.01))
	get_tree().quit()
