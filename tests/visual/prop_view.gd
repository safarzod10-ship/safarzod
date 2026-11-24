extends Node3D
## prop_view.tscn -- <out.png>   : weapons from the side with axis gizmo
func _ready() -> void:
	var out := OS.get_cmdline_user_args()[0]
	var env := WorldEnvironment.new()
	env.environment = Environment.new()
	env.environment.background_mode = Environment.BG_COLOR
	env.environment.background_color = Color(0.5, 0.55, 0.6)
	env.environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.environment.ambient_light_color = Color.WHITE
	env.environment.ambient_light_energy = 1.0
	add_child(env)
	var sun := DirectionalLight3D.new(); sun.rotation_degrees = Vector3(-40, 120, 0); add_child(sun)
	var y := 0.5
	for wd in WeaponCatalog.WEAPONS:
		var w := WeaponModel.create_weapon(wd["id"])
		add_child(w); w.position = Vector3(0, y, 0)
		for p: Vector3 in [Vector3.ZERO, w.muzzle, w.eject]:
			var s := MeshInstance3D.new(); var sm := SphereMesh.new(); sm.radius = 0.012; sm.height = 0.024
			var mat := StandardMaterial3D.new(); mat.albedo_color = Color.RED if p == Vector3.ZERO else Color.GREEN; mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED; mat.no_depth_test = true
			sm.material = mat; s.mesh = sm; w.add_child(s); s.position = p
		print(wd["id"], " bounds ", w.bounds, " muzzle ", w.muzzle)
		y -= 0.5
	var x := -0.9
	for gd in WeaponCatalog.GRENADES:
		var g := WeaponModel.create_prop(gd["scene"], gd["size"] * 3.0)
		add_child(g); g.position = Vector3(x, -0.55, 0); x += 0.6
	var cam := Camera3D.new(); add_child(cam); cam.projection = Camera3D.PROJECTION_ORTHOGONAL; cam.size = 1.9
	cam.look_at_from_position(Vector3(3, 0.0, 0.0), Vector3(0, 0.0, 0))
	for i in 8: await get_tree().process_frame
	get_viewport().get_texture().get_image().save_png(out)
	get_tree().quit()
