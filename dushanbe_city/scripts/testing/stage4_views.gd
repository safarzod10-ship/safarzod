extends Node
## Stage 4 screenshots (real renderer): character views and close-ups, locomotion phases, stairs,
## swimming, getting into the Prado, camera situations and the Android touch UI.
##   xvfb-run godot --path . res://scenes/testing/stage4_views.tscn -- out=<dir>
var main: Node
var p: PlayerController
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
	for w in get_tree().get_nodes_in_group(&"weather"):
		w.call("set_state", 0, true)
		w.set("auto_cycle", false)
	for t in get_tree().get_nodes_in_group(&"time_of_day"):
		t.call("set_hour", 10.5)
	_ui(false)
	p = main.get("player")
	cam = Camera3D.new()
	cam.fov = 45.0
	cam.far = 9500.0
	add_child(cam)
	# ---- full body views on the sidewalk
	var spot := Vector3(-58.0, 0.0, 30.0)
	p.teleport(spot + Vector3(0, CityWorld.city_relief(spot.x, spot.z) + 1.0, 0), PI * 0.5)
	p.set_camera_angles(PI * 0.5, -0.2)
	await _sec(2.0)
	var c := p.global_position + Vector3(0, 0.95, 0)
	var f := Vector3(-sin(p.facing), 0, -cos(p.facing))
	var r := Vector3(cos(p.facing), 0, -sin(p.facing))
	await _shot("char_front", c + f * 3.4 + Vector3(0, 0.1, 0), c)
	await _shot("char_back", c - f * 3.4 + Vector3(0, 0.1, 0), c)
	await _shot("char_left", c - r * 3.4, c)
	await _shot("char_right", c + r * 3.4, c)
	cam.fov = 30.0
	await _shot("hands_closeup", c + f * 1.3 + r * 0.5 + Vector3(0, -0.15, 0), c + Vector3(0, -0.12, 0))
	await _shot("shoulders_closeup", c + f * 1.1 + Vector3(0, 0.55, 0), c + Vector3(0, 0.5, 0))
	cam.fov = 45.0
	# ---- locomotion (player camera = standard 3rd person view)
	PlayerInput.scripted_move = Vector2(0, -1)
	await _sec(2.2)
	await _shot_side("walk", 3.6)
	await _game_cam("cam_standard")
	PlayerInput.scripted_run = true
	await _sec(2.0)
	await _shot_side("run", 5.0)
	await _game_cam("cam_running")
	PlayerInput.queue_jump()
	await _sec(0.45)
	await _shot_side("jump", -5.0)
	await _sec(0.33)
	await _shot_side("landing", -5.0)
	PlayerInput.scripted_move = null
	PlayerInput.scripted_run = false
	await _sec(2.5)
	# side step / backwards
	PlayerInput.scripted_move = Vector2(1, 0)
	await _sec(1.5)
	await _shot_side("strafe", 3.2)
	PlayerInput.scripted_move = Vector2(0, 1)
	await _sec(1.5)
	await _shot_side("walk_back", 3.2)
	PlayerInput.scripted_move = null
	await _sec(1.5)
	# ---- camera near a wall: back to a building facade
	p.teleport(Vector3(-62.5, CityWorld.city_relief(-62.5, -255) + 1.0, -255), -PI * 0.5)
	p.set_camera_angles(-PI * 0.5 + 0.35, -0.12)
	await _sec(1.5)
	await _game_cam("cam_wall")
	# ---- stairs of the embankment (walk up from the beach)
	var P: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://data/terrain/paths.json"))
	var st: Dictionary = P["promenade_stairs"][4]
	var top := Vector3(st["top"][0], st["top"][1], st["top"][2])
	var dir := Vector3(st["dir"][0], 0, st["dir"][1])
	p.teleport(top + dir * 5.0 + Vector3.UP, atan2(dir.x, dir.z))
	p.set_camera_angles(atan2(dir.x, dir.z), -0.2)
	await _sec(1.0)
	PlayerInput.scripted_move = Vector2(0, -1)
	await _sec(2.4)
	var sp := p.global_position
	var side := Vector3(-dir.z, 0, dir.x)
	await _shot("stairs", sp + side * 4.0 + dir * 1.0 + Vector3(0, 1.2, 0), sp + Vector3(0, 0.8, 0))
	PlayerInput.scripted_move = null
	# ---- swimming
	p.teleport(Vector3(-30, 1.0, 432), PI)
	p.set_camera_angles(PI, -0.18)
	PlayerInput.scripted_move = Vector2(0, -1)
	await _sec(5.0)
	await _game_cam("cam_swimming")
	var b := p.global_position
	await _shot("swimming", Vector3(b.x + 3.0, PlayerWater.SEA_LEVEL + 0.8, b.z - 1.0), b + Vector3(0, 1.0, 0))
	PlayerInput.scripted_move = null
	# ---- Android touch UI (walking on the avenue, near the Prado: ACTION «СЕСТЬ» visible)
	var s: CarSession = main.get("car_session")
	s.car.place(Vector3(-49.0, 0.0, -12.0), 0.0)
	await _sec(1.0)
	p.teleport(s.car.driver_door_point(3.5), PI * 0.5)          # beside the car (a ray from above 1 m away hits the roof)
	p.set_camera_angles(PI * 0.5 + 0.6, -0.25)
	await _sec(1.0)
	p.walk_to(s.car.driver_door_point(1.3), null, 4.0)
	await _sec(3.0)
	p.end_sequence()
	_ui(true)
	await _sec(0.5)
	await _game_cam("android_ui")
	_ui(false)
	# ---- getting into the Prado (animated)
	s.enter_animated()
	var shots := {"car_get_in_door": 1.1, "car_get_in_sit": 1.0}
	for k in shots:
		await _sec(shots[k])
		var pc := p.global_position
		var bx := s.car.global_transform.basis.x
		var bz := s.car.global_transform.basis.z
		await _shot(k, pc - bx * 3.2 - bz * 2.0 + Vector3(0, 1.3, 0), pc + Vector3(0, 0.9, 0))
	await _sec(2.0)
	get_tree().quit()


func _ui(on: bool) -> void:
	for n in get_tree().root.find_children("*", "CanvasLayer", true, false):
		if n.has_method("set_shown"):
			n.call("set_shown", on)
		elif n.name != "Touch":
			(n as CanvasLayer).visible = on and false


func _shot_side(label: String, d: float) -> void:
	var c := p.global_position + Vector3(0, 0.95, 0)
	var r := Vector3(cos(p.facing), 0, -sin(p.facing))
	var f := Vector3(-sin(p.facing), 0, -cos(p.facing))
	await _shot(label, c + r * d + f * 0.8 + Vector3(0, 0.25, 0), c)


func _shot(label: String, from: Vector3, at: Vector3) -> void:
	get_tree().paused = true
	cam.global_position = from
	cam.look_at(at, Vector3.UP)
	cam.make_current()
	for i in 4:
		await RenderingServer.frame_post_draw
	get_viewport().get_texture().get_image().save_png("%s/s4_%s.png" % [out, label])
	get_tree().paused = false
	print("S4 shot ", label)


func _game_cam(label: String) -> void:
	get_tree().paused = true
	p.get_camera().make_current()
	for i in 4:
		await RenderingServer.frame_post_draw
	get_viewport().get_texture().get_image().save_png("%s/s4_%s.png" % [out, label])
	get_tree().paused = false
	print("S4 shot ", label)


func _sec(t: float) -> void:
	for i in int(t * Engine.physics_ticks_per_second):
		await get_tree().physics_frame
