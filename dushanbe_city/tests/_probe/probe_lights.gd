extends Node3D
var car: VehiclePrado
func _ready() -> void:
	var env := WorldEnvironment.new(); env.environment = Environment.new()
	env.environment.background_mode = Environment.BG_COLOR; env.environment.background_color = Color(0.05,0.05,0.08)
	env.environment.ambient_light_color = Color(0.3,0.3,0.35); env.environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	add_child(env)
	var g := StaticBody3D.new(); var cs := CollisionShape3D.new(); var b := BoxShape3D.new(); b.size = Vector3(100,1,100); cs.shape = b; cs.position.y = -0.5; g.add_child(cs); add_child(g)
	var gm := MeshInstance3D.new(); var pm := PlaneMesh.new(); pm.size = Vector2(100,100); gm.mesh = pm; add_child(gm)
	car = VehiclePrado.new(); add_child(car); car.place(Vector3.ZERO, 0.0)
	await get_tree().create_timer(0.5).timeout
	var cols := {"headlight rf": Color(1,1,1), "taillight rr": Color(1,0,0), "fari.4": Color(1,0.6,0), "fari.2": Color(0,1,0), "fari.3": Color(0,0,1), "fari.6": Color(1,0,1), "body.3": Color(0,1,1), "body.5": Color(1,1,0)}
	for k in cols:
		var m: ShaderMaterial = car._mat_cache.get(k)
		if m: m.set_shader_parameter("emission_color", cols[k]); m.set_shader_parameter("emission_energy", 3.0)
	var cam := Camera3D.new(); add_child(cam); cam.fov = 40
	for v in [["front", Vector3(-2.5, 1.2, -6.5)], ["rear", Vector3(2.5, 1.4, 6.5)], ["side", Vector3(-6.5, 1.3, 0.5)]]:
		cam.global_position = v[1]; cam.look_at(Vector3(0, 0.8, 0)); cam.make_current()
		for i in 6: await RenderingServer.frame_post_draw
		get_viewport().get_texture().get_image().save_png("/tmp/claude-0/-home-user-safarzod/a46b42c2-beab-5efe-837a-7f7bc68c0bbc/scratchpad/probe_%s.png" % v[0])
	get_tree().quit()
