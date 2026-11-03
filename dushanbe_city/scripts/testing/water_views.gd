extends Node
## Real-renderer shots of the character in the sea: wading (knee / waist deep) and swimming
## (side, front, back, top) - xvfb + lavapipe:
##   godot --path . res://scenes/testing/water_views.tscn -- out=<dir>
var main: Node
var out := "/tmp"
var cam: Camera3D


func _ready() -> void:
	for a in OS.get_cmdline_user_args():
		if a.begins_with("out="):
			out = a.substr(4)
	Settings.set_mode("high")
	main = (load("res://scenes/main/main.tscn") as PackedScene).instantiate()
	add_child(main)
	while main.get("car_session") == null:
		await get_tree().physics_frame
	var tod := get_tree().root.find_children("*", "TimeOfDay", true, false)
	for t in tod:
		t.set("hour", 11.0)
	for c in get_tree().root.find_children("*", "CanvasLayer", true, false):
		(c as CanvasLayer).visible = false
	var p: PlayerController = main.get("player")
	cam = Camera3D.new()
	cam.far = 9500.0
	cam.fov = 55.0
	add_child(cam)
	# wading: in the water at increasing depth, walking towards the open sea
	for z in [398.0, 406.0, 414.0]:
		p.teleport(Vector3(-30, 1.0, z), PI)
		p.set_camera_angles(PI, -0.2)
		PlayerInput.scripted_move = Vector2(0, -1)
		await _sec(1.6)
		print("WATER wade z=%.0f mode=%d depth=%.2f" % [p.global_position.z, p.water.mode, p.water.depth])
		await _shot("wading_%d" % int(z), p, Vector3(3.2, 0.9, 1.0), Vector3(0, 1.0, 0))
	# swimming in deep water
	p.teleport(Vector3(-30, 1.0, 432), PI)
	PlayerInput.scripted_move = Vector2(0, -1)
	await _sec(4.0)
	print("WATER mode=%d y=%.2f floor_depth=%.2f" % [p.water.mode, p.global_position.y, p.water.floor_depth])
	await _shot("swim_side", p, Vector3(3.5, 0.7, 0.0), Vector3(0, 1.2, 0))
	await _shot("swim_front", p, Vector3(0.0, 0.8, -3.8), Vector3(0, 1.2, 0))
	await _shot("swim_back", p, Vector3(0.0, 1.0, 3.8), Vector3(0, 1.2, 0))
	await _shot("swim_top", p, Vector3(0.6, 4.0, 2.0), Vector3(0, 1.2, 0))
	PlayerInput.scripted_move = null
	await _sec(1.5)
	await _shot("swim_idle", p, Vector3(3.0, 0.8, 1.5), Vector3(0, 1.2, 0))
	get_tree().quit()


func _shot(label: String, p: Node3D, off: Vector3, look: Vector3) -> void:
	# offsets in the character's frame (+Z = behind/back side is -Z? use the body basis)
	var b := p.global_transform.basis
	var base := Vector3(p.global_position.x, maxf(p.global_position.y, PlayerWater.SEA_LEVEL), p.global_position.z)
	cam.global_position = base + b * off                  # heights relative to the water surface
	cam.look_at(Vector3(base.x, p.global_position.y, base.z) + look, Vector3.UP)
	cam.make_current()
	for i in 4:
		await RenderingServer.frame_post_draw
	get_viewport().get_texture().get_image().save_png("%s/water_%s.png" % [out, label])
	print("WATER shot ", label)


func _sec(s: float) -> void:
	for i in int(s * Engine.physics_ticks_per_second):
		await get_tree().physics_frame
