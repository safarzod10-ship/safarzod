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
	Settings.set_mode("medium")          # fixed preset: no adaptive downgrade during the recording
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
	## stage 4: idle -> walk 1 m/s -> stop -> side steps -> backwards -> turn on the spot -> run 4.5 m/s
	## -> running jump -> run stop -> standing jump
	var p: PlayerController = main.get("player")
	p.teleport(Vector3(-58, 0.15 + CityWorld.city_relief(-58, 30), 30), PI * 0.5)
	p.set_camera_angles(PI * 0.5 + 0.5, -0.18)
	await _sec(2.0)                                        # idle (arms beside the body)
	PlayerInput.scripted_move = Vector2(0, -1)
	await _sec(4.0)                                        # start + walk 1 m/s
	PlayerInput.scripted_move = null
	await _sec(2.2)                                        # captured walk stop
	PlayerInput.scripted_move = Vector2(1, 0)
	await _sec(2.5)                                        # side steps right
	PlayerInput.scripted_move = Vector2(-1, 0)
	await _sec(2.5)                                        # side steps left
	PlayerInput.scripted_move = Vector2(0, 1)
	await _sec(2.5)                                        # walking backwards
	PlayerInput.scripted_move = null
	await _sec(1.0)
	p.set_camera_angles(p.cam_yaw + PI, -0.18)             # camera turned around ...
	PlayerInput.scripted_move = Vector2(0, -0.4)
	await _sec(2.0)                                        # ... turn on the spot (stepping), then walk
	PlayerInput.scripted_move = Vector2(0, -1)
	PlayerInput.scripted_run = true
	await _sec(3.0)                                        # start run -> 4.5 m/s
	PlayerInput.queue_jump()                               # running jump: keeps running
	await _sec(1.8)
	PlayerInput.scripted_move = null
	PlayerInput.scripted_run = false
	await _sec(2.0)                                        # captured run stop
	PlayerInput.queue_jump()                               # standing jump -> back to idle
	await _sec(2.5)


func _car() -> void:
	## stage 4: walk up to the Prado, «СЕСТЬ» (door, sit down), drive, stop, get out, walk away
	var s: CarSession = main.get("car_session")
	var p: PlayerController = main.get("player")
	var car: VehiclePrado = s.car
	car.place(Vector3(-49.0, 0.0, -12.0), 0.0)
	await _sec(1.0)
	p.teleport(car.driver_door_point(4.0) + car.global_transform.basis.z * 2.0, PI * 0.5)
	p.set_camera_angles(PI * 0.5 + 0.7, -0.2)
	await _sec(1.0)
	await p.walk_to(car.driver_door_point(1.3), null, 5.0)
	p.end_sequence()
	await _sec(0.5)
	await s.enter_animated()
	await _sec(1.0)
	VehicleInput.scripted = {"throttle": 0.6}
	await _sec(5.0)
	VehicleInput.scripted = {"brake": 1.0}
	for i in 300:
		await get_tree().physics_frame
		if car.speed_kmh < 1.0:
			break
	VehicleInput.scripted = null
	await _sec(0.5)
	await s.exit_animated()
	await _sec(0.5)
	PlayerInput.scripted_move = Vector2(0, -1)
	await _sec(3.0)
	PlayerInput.scripted_move = null
	await _sec(1.5)
