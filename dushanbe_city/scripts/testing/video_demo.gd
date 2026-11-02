extends Node
## Scripted demo for verification videos (Godot Movie Maker: fixed time step, so motion is real-time
## in the file even on a slow software renderer):
##   godot --path . --write-movie out.avi --fixed-fps 30 --resolution 960x540 \
##         res://scenes/testing/video_demo.tscn -- mode=player|car
## player: idle -> walk 1 m/s -> run 4 m/s -> standing jump -> running jump -> stop
## car:    get in -> accelerate -> slalom -> handbrake slide -> stop -> hits (dents) -> repair -> get out

var main: Node
var mode := "player"


func _ready() -> void:
	for a in OS.get_cmdline_user_args():
		if a.begins_with("mode="):
			mode = a.substr(5)
	Settings.quality = Settings.Quality.MEDIUM
	main = (load("res://scenes/main/main.tscn") as PackedScene).instantiate()
	add_child(main)
	while main.get("car_session") == null:
		await get_tree().physics_frame
	await _sec(1.0)
	if mode == "car":
		await _car()
	else:
		await _player()
	get_tree().quit()


func _sec(s: float) -> void:
	for i in int(s * Engine.physics_ticks_per_second):
		await get_tree().physics_frame


func _player() -> void:
	var p: PlayerController = main.get("player")
	p.teleport(Vector3(-58, 0.15, 30), PI * 0.5)
	p.set_camera_angles(PI * 0.5 + 0.6, -0.15)
	await _sec(2.0)                                        # idle (arms beside the body)
	PlayerInput.scripted_move = Vector2(0, -1)
	await _sec(4.0)                                        # walk 1 m/s
	PlayerInput.scripted_run = true
	await _sec(3.5)                                        # run 4 m/s
	PlayerInput.scripted_run = false
	PlayerInput.scripted_move = null
	await _sec(1.5)
	PlayerInput.queue_jump()                               # standing jump -> back to idle
	await _sec(2.2)
	PlayerInput.scripted_move = Vector2(0, -1)
	PlayerInput.scripted_run = true
	await _sec(1.6)
	PlayerInput.queue_jump()                               # running jump -> keeps running
	await _sec(2.0)
	PlayerInput.scripted_move = null
	PlayerInput.scripted_run = false
	await _sec(1.5)


func _car() -> void:
	var s: CarSession = main.get("car_session")
	var p: PlayerController = main.get("player")
	var car: VehiclePrado = s.car
	p.teleport(car.driver_door_point(2.2), PI * 0.5)
	p.set_camera_angles(-0.6, -0.2)
	await _sec(1.0)
	PlayerInput.scripted_move = Vector2(0, -1)
	for i in 120:
		await get_tree().physics_frame
		if s.can_enter():
			break
	PlayerInput.scripted_move = null
	s.enter()
	await _sec(1.0)
	VehicleInput.scripted = {"throttle": 1.0}
	await _sec(5.0)                                        # accelerate north along the avenue
	for k in 4:                                            # slalom: body roll, steering
		VehicleInput.scripted = {"throttle": 0.6, "steer": 0.45 if k % 2 == 0 else -0.45}
		await _sec(1.0)
	VehicleInput.scripted = {"throttle": 0.5}
	await _sec(1.0)
	VehicleInput.scripted = {"throttle": 0.4, "steer": -0.9, "handbrake": true}   # handbrake slide
	await _sec(1.2)
	VehicleInput.scripted = {"throttle": 0.3, "steer": 0.4}                       # counter-steer, grip returns
	await _sec(1.5)
	VehicleInput.scripted = {"brake": 1.0}
	for i in 300:
		await get_tree().physics_frame
		if car.speed_kmh < 1.0:
			break
	VehicleInput.scripted = {}
	await _sec(0.5)
	# damage: three hits on the front-left (same path as a crash), orbit camera to show them
	s.cam.orbit_mode = true
	var b := car.global_transform.basis
	car.damage_at(car.global_position + b * Vector3(-0.7, -0.05, -2.25), b * Vector3(0, 0, 1), 9.0)
	await _sec(0.6)
	car.damage_at(car.global_position + b * Vector3(-0.95, 0.05, -0.6), b * Vector3(1, 0, 0), 7.0)
	await _sec(0.6)
	car.damage_at(car.global_position + b * Vector3(-0.55, 0.4, -1.6), b * Vector3(0.3, -1, 0.4).normalized(), 6.0)
	for i in 4 * Engine.physics_ticks_per_second:
		VehicleInput.look_delta = Vector2(-4.0, 0.0)          # orbit around the car
		await get_tree().physics_frame
	car.repair()                                          # «ВОССТАНОВИТЬ»
	for i in 3 * Engine.physics_ticks_per_second:
		VehicleInput.look_delta = Vector2(-4.0, 0.0)
		await get_tree().physics_frame
	s.cam.orbit_mode = false
	VehicleInput.scripted = null
	s.exit()                                              # «ВЫЙТИ»
	await _sec(2.0)
