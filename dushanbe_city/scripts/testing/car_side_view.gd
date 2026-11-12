extends Node3D
## orthographic side / top views of a VehicleCar preset with a 0.25 m grid (door cut tuning)
##   godot --path . res://scenes/testing/car_side_view.tscn -- <preset> <out.png> [side|top|open]
func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	var c := VehicleCar.new()
	c.configure(args[0])
	add_child(c)
	c.set_physics_process(false)
	c.gravity_scale = 0.0
	c.freeze = true
	c.global_position = Vector3.ZERO
	var l := DirectionalLight3D.new()
	l.rotation_degrees = Vector3(-40, -60, 0)
	add_child(l)
	var we := WorldEnvironment.new()
	var e := Environment.new()
	e.background_mode = Environment.BG_COLOR
	e.background_color = Color(0.8, 0.82, 0.85)
	e.ambient_light_color = Color.WHITE
	e.ambient_light_energy = 0.6
	e.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	we.environment = e
	add_child(we)
	var mode := args[2] if args.size() > 2 else "side"
	# grid lines (red every 0.5 m, thin every 0.25)
	var im := ImmediateMesh.new()
	var gm := StandardMaterial3D.new()
	gm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	gm.vertex_color_use_as_albedo = true
	gm.no_depth_test = true
	im.surface_begin(Mesh.PRIMITIVE_LINES, gm)
	for k in range(-12, 13):
		var v := k * 0.25
		var col := Color(1, 0, 0, 1) if k % 2 == 0 else Color(0.3, 0.3, 1, 1)
		if k == 0:
			col = Color(0, 0.7, 0)
		if mode == "top":
			im.surface_set_color(col); im.surface_add_vertex(Vector3(-3, 2, v)); im.surface_set_color(col); im.surface_add_vertex(Vector3(3, 2, v))
			im.surface_set_color(col); im.surface_add_vertex(Vector3(v, 2, -3)); im.surface_set_color(col); im.surface_add_vertex(Vector3(v, 2, 3))
		else:
			im.surface_set_color(col); im.surface_add_vertex(Vector3(-3, v, -3)); im.surface_set_color(col); im.surface_add_vertex(Vector3(-3, v, 3))
			im.surface_set_color(col); im.surface_add_vertex(Vector3(-3, -3, v)); im.surface_set_color(col); im.surface_add_vertex(Vector3(-3, 3, v))
	im.surface_end()
	var gi := MeshInstance3D.new()
	gi.mesh = im
	add_child(gi)
	var cam := Camera3D.new()
	cam.projection = Camera3D.PROJECTION_ORTHOGONAL
	cam.size = 3.4
	add_child(cam)
	if mode == "top":
		cam.look_at_from_position(Vector3(0, 8, 0), Vector3.ZERO, Vector3.FORWARD)
		cam.size = 5.6
	elif mode == "cabin":
		cam.projection = Camera3D.PROJECTION_PERSPECTIVE
		cam.fov = 70
		var seat: Node3D = c.model.find_child("ped_frontseat", true, false)
		var eye := seat.global_position + Vector3(0, 0.62, 0.12)
		cam.look_at_from_position(eye, eye + Vector3(0.15, -0.22, -1.0))
	elif mode == "open":
		cam.projection = Camera3D.PROJECTION_PERSPECTIVE
		cam.fov = 50
		cam.look_at_from_position(Vector3(-4.2, 1.4, 1.8), Vector3(-0.6, 0.0, -0.2))
		await get_tree().process_frame
		c.set_door("door_lf_dummy", true)
		for i in 60:
			await get_tree().process_frame
	else:
		await get_tree().process_frame
		var wc := Vector3.ZERO
		var nw := 0
		for d in c.model.get_children():
			if String(d.name).begins_with("wheel_"):
				wc += (d as Node3D).global_position
				nw += 1
		wc /= maxf(nw, 1)
		print("WHEEL_CENTRE_Y ", wc.y, " model y ", c.model.global_position.y, " ground_y ", c.get("_ground_y"))
		cam.look_at_from_position(Vector3(-8, wc.y + 0.6, 0), Vector3(0, wc.y + 0.6, 0))
		cam.size = 5.6
	for i in 8:
		await get_tree().process_frame
	for n in c.find_children("*", "GeometryInstance3D", true, false):
		var g := n as GeometryInstance3D
		if not (g is MeshInstance3D and String(g.get_parent().name) == "Spin"):
			if false: print("GI ", g.get_class(), " ", c.get_path_to(g), " ", g.global_position.snapped(Vector3.ONE * 0.01), " vis ", g.is_visible_in_tree())
	await RenderingServer.frame_post_draw
	get_viewport().get_texture().get_image().save_png(args[1])
	get_tree().quit()
