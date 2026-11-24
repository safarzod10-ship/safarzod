extends Node3D
## Debug viewer: char_view.tscn -- <out.png> <anim> <time> [char ids...] [side=1]
func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	var out := args[0]
	var anim_name := args[1]
	var t := float(args[2])
	var ids: PackedStringArray = []
	var side := false
	for a in args.slice(3):
		if a == "side=1": side = true
		else: ids.append(a)
	if ids.is_empty():
		for c in CharacterCatalog.CHARACTERS: ids.append(c["id"])
	var env := WorldEnvironment.new()
	env.environment = Environment.new()
	env.environment.background_mode = Environment.BG_COLOR
	env.environment.background_color = Color(0.55, 0.6, 0.66)
	env.environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.environment.ambient_light_color = Color(0.8, 0.8, 0.8)
	env.environment.ambient_light_energy = 0.7
	add_child(env)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-45, 150, 0)
	add_child(sun)
	var floor_mesh := MeshInstance3D.new()
	var pm := PlaneMesh.new(); pm.size = Vector2(20, 20)
	floor_mesh.mesh = pm
	add_child(floor_mesh)
	for i in ids.size():
		var rig := CharacterRig.create(ids[i])
		add_child(rig)
		rig.position.x = (i - (ids.size() - 1) * 0.5) * 1.4
		if rig.anim.has_animation(anim_name):
			rig.anim.play(anim_name)
			rig.anim.seek(t, true)
			rig.anim.pause()
	var cam := Camera3D.new()
	add_child(cam)
	cam.fov = 40
	if side:
		cam.look_at_from_position(Vector3(5.5, 1.3, -1.0), Vector3(0, 0.95, 0))
	else:
		cam.look_at_from_position(Vector3(1.5, 1.4, -5.5), Vector3(0, 0.95, 0))
	for i in 8: await get_tree().process_frame
	get_viewport().get_texture().get_image().save_png(out)
	print("CAPTURED ", out)
	get_tree().quit()
