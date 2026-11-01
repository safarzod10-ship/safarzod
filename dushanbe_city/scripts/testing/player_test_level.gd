extends Node3D
## Player test level: 60x60 m grid floor, 0.15 m curb/sidewalk, 0.3 m step, 20 deg ramp,
## 40 deg ramp, wall, sun + procedural sky. Optional demo driving via user args:
##   demo=idle|walk|run|jump  move=x,y (stick vector, camera relative)  camyaw=deg campitch=deg
##   camdist=m  touch=1 (force touch UI)

const CURB_H := 0.15
const STEP_H := 0.30


func _ready() -> void:
	_build_environment()
	_build_geometry()
	var opt := {}
	for a in OS.get_cmdline_user_args():
		var kv := a.split("=", true, 1)
		opt[kv[0]] = kv[1] if kv.size() > 1 else "1"
	var touch := get_node_or_null("TouchControls")
	if touch and opt.get("touch", "0") == "1":
		touch.set_shown(true)
	if opt.has("demo"):
		_run_demo.call_deferred(opt)


func _run_demo(opt: Dictionary) -> void:
	var p: PlayerController = get_tree().get_first_node_in_group(&"player")
	await get_tree().physics_frame
	await get_tree().physics_frame
	var yaw := deg_to_rad(float(opt.get("camyaw", "0")))
	var pitch := deg_to_rad(float(opt.get("campitch", "-12")))
	if opt.has("camdist"):
		p.spring.spring_length = float(opt["camdist"])
	var mv := Vector2(0, -1)
	if opt.has("move"):
		var m := String(opt["move"]).split_floats(",")
		mv = Vector2(m[0], m[1])
	match String(opt["demo"]):
		"walk":
			PlayerInput.scripted_move = mv
		"run":
			PlayerInput.scripted_move = mv
			PlayerInput.scripted_run = true
		"jump":
			PlayerInput.scripted_move = Vector2.ZERO
			await get_tree().create_timer(float(opt.get("jumpdelay", "0.5"))).timeout
			PlayerInput.queue_jump()
		_:
			PlayerInput.scripted_move = Vector2.ZERO
	while true:   # keep the camera angle fixed relative to the world for screenshots
		p.set_camera_angles(yaw, pitch)
		await get_tree().process_frame


func _grid_texture(base: Color, line: Color) -> ImageTexture:
	var n := 256
	var img := Image.create(n, n, true, Image.FORMAT_RGB8)
	img.fill(base)
	for i in n:
		for k in [0, 1, n / 2]:
			var c := line if k != n / 2 else line.lerp(base, 0.55)
			img.set_pixel(i, k, c)
			img.set_pixel(k, i, c)
	img.generate_mipmaps()
	return ImageTexture.create_from_image(img)


func _mat(base: Color, line: Color) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_texture = _grid_texture(base, line)
	m.uv1_triplanar = true
	m.uv1_world_triplanar = true
	m.uv1_scale = Vector3(0.5, 0.5, 0.5)      # texture = 2 m, major line every 2 m, minor every 1 m
	m.roughness = 0.9
	m.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC
	return m


func _box(name_: String, size: Vector3, pos: Vector3, mat: Material, rot := Vector3.ZERO) -> StaticBody3D:
	var body := StaticBody3D.new()
	body.name = name_
	body.position = pos
	body.rotation = rot
	var cs := CollisionShape3D.new()
	var sh := BoxShape3D.new()
	sh.size = size
	cs.shape = sh
	body.add_child(cs)
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = size
	mi.mesh = bm
	mi.material_override = mat
	body.add_child(mi)
	add_child(body)
	return body


func _build_geometry() -> void:
	var ground := _mat(Color(0.42, 0.43, 0.45), Color(0.18, 0.19, 0.2))
	var curb := _mat(Color(0.62, 0.6, 0.56), Color(0.35, 0.34, 0.32))
	var step := _mat(Color(0.55, 0.42, 0.33), Color(0.3, 0.22, 0.17))
	var ramp := _mat(Color(0.38, 0.5, 0.42), Color(0.2, 0.28, 0.22))
	var wall := _mat(Color(0.7, 0.66, 0.58), Color(0.45, 0.42, 0.36))
	_box("Ground", Vector3(60, 1, 60), Vector3(0, -0.5, 0), ground)
	# sidewalk block with a 0.15 m curb, in front of the spawn (z -6 .. -10)
	_box("Curb015", Vector3(6, CURB_H, 4), Vector3(0, CURB_H * 0.5, -8), curb)
	# 0.30 m step (x 6 .. 9, z -6 .. -9)
	_box("Step030", Vector3(3, STEP_H, 3), Vector3(7.5, STEP_H * 0.5, -7.5), step)
	# 20 degree ramp rising towards -Z (x -10 .. -7) + platform on top
	var a20 := deg_to_rad(20.0)
	var l20 := 6.0
	var h20 := l20 * sin(a20)
	_box("Ramp20", Vector3(3, 0.2, l20), Vector3(-8.5, h20 * 0.5 - 0.1 * cos(a20), -4.0 - l20 * 0.5 * cos(a20)), ramp, Vector3(a20, 0, 0))
	var zt := -4.0 - l20 * cos(a20)
	_box("Ramp20Top", Vector3(3, h20, 3), Vector3(-8.5, h20 * 0.5, zt - 1.5), ramp)
	# 40 degree ramp (limit) at x -16
	var a40 := deg_to_rad(39.0)
	_box("Ramp39", Vector3(3, 0.2, 4), Vector3(-16, 2 * sin(a40) - 0.1 * cos(a40), -4.0 - 2 * cos(a40)), ramp, Vector3(a40, 0, 0))
	# wall
	_box("Wall", Vector3(0.4, 3, 10), Vector3(14, 1.5, 0), wall)


func _build_environment() -> void:
	var sun := DirectionalLight3D.new()
	sun.name = "Sun"
	sun.rotation = Vector3(deg_to_rad(-48), deg_to_rad(-35), 0)
	sun.light_energy = 1.25
	sun.shadow_enabled = true
	sun.directional_shadow_max_distance = 60.0
	add_child(sun)
	var env := Environment.new()
	var sky := Sky.new()
	var sm := ProceduralSkyMaterial.new()
	sm.sky_top_color = Color(0.32, 0.5, 0.78)
	sm.sky_horizon_color = Color(0.7, 0.76, 0.84)
	sm.ground_horizon_color = Color(0.6, 0.6, 0.6)
	sky.sky_material = sm
	env.background_mode = Environment.BG_SKY
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	env.ambient_light_energy = 0.9
	env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)
