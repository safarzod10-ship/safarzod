extends Node3D
## renders a model from a few directions: -- <res path> <out prefix> <distance> <look height>
func _ready() -> void:
	var a := OS.get_cmdline_user_args()
	var m: Node3D = (load(a[0]) as PackedScene).instantiate()
	add_child(m)
	var l := DirectionalLight3D.new()
	l.rotation_degrees = Vector3(-38, -35, 0)
	l.shadow_enabled = true
	add_child(l)
	var we := WorldEnvironment.new()
	var e := Environment.new()
	e.background_mode = Environment.BG_SKY
	var sky := Sky.new()
	sky.sky_material = ProceduralSkyMaterial.new()
	e.sky = sky
	e.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	e.reflected_light_source = Environment.REFLECTION_SOURCE_SKY
	e.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	we.environment = e
	add_child(we)
	var ground := MeshInstance3D.new()
	var pm := PlaneMesh.new()
	pm.size = Vector2(400, 400)
	ground.mesh = pm
	var gm := StandardMaterial3D.new()
	gm.albedo_color = Color(0.45, 0.5, 0.4)
	ground.material_override = gm
	add_child(ground)
	var cam := Camera3D.new()
	cam.fov = 50
	cam.far = 2000
	add_child(cam)
	var dist := float(a[2])
	var hh := float(a[3])
	var views := [["front", Vector3(0.25, 0.25, -1.0)], ["side", Vector3(-1.0, 0.2, -0.35)], ["back", Vector3(0.3, 0.3, 1.0)], ["close", Vector3(0.15, 0.1, -0.5)]]
	for v in views:
		var d: Vector3 = (v[1] as Vector3).normalized()
		var dd := dist * (0.45 if v[0] == "close" else 1.0)
		var at := Vector3(0, hh * (1.2 if v[0] == "close" else 1.0), 0)
		cam.look_at_from_position(at + d * dd, at)
		for i in 8:
			await get_tree().process_frame
		await RenderingServer.frame_post_draw
		get_viewport().get_texture().get_image().save_png("%s_%s.png" % [a[1], v[0]])
	get_tree().quit()
