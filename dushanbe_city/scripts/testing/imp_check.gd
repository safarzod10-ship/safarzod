extends SceneTree
func _init() -> void:
	for id in ["chinar_mature", "elm_a", "thuja_cone"]:
		var m: Mesh = load("res://assets/models/vegetation/meshes/%s_far.res" % id)
		var mat := m.surface_get_material(0) as ShaderMaterial
		var t: Variant = mat.get_shader_parameter("albedo_tex") if mat else null
		print(id, " mat=", mat, " tex=", t, " path=", (t as Texture2D).resource_path if t else "-", " size=", (t as Texture2D).get_size() if t else Vector2.ZERO)
	quit()
