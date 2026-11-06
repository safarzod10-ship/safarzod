extends Node
## Scripted demo for verification videos (Godot Movie Maker: fixed time step, so motion is real-time
## in the file even on a slow software renderer):
##   godot --path . --write-movie out.avi --fixed-fps 30 --resolution 960x540 \
##         res://scenes/testing/video_demo.tscn -- mode=player|car
## player: idle -> walk 1 m/s -> run 4 m/s -> standing jump -> running jump -> stop
## car:    get in -> accelerate -> slalom -> handbrake slide -> stop -> hits (dents) -> repair -> get out
## car5:   stage 5 sound demo (REAL recordings): door, engine start, idle, full-throttle run with
##         shifts, lift-off, ABS stop, handbrake drift, crash into a concrete block, cabin view with
##         muffled sound, stop, get out, door, central lock; captions say what is heard

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
	elif mode == "car5":
		await _car5()
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


var _cap: Label


func _caption(t: String) -> void:
	if _cap == null:
		var cl := CanvasLayer.new()
		cl.layer = 50
		add_child(cl)
		_cap = Label.new()
		_cap.add_theme_font_size_override("font_size", 22)
		_cap.add_theme_color_override("font_outline_color", Color.BLACK)
		_cap.add_theme_constant_override("outline_size", 8)
		_cap.position = Vector2(120, 78)
		cl.add_child(_cap)
	_cap.text = t
	print("DEMO ", t)


func _car5() -> void:
	var s: CarSession = main.get("car_session")
	var p: PlayerController = main.get("player")
	var car: VehiclePrado = s.car
	for w in get_tree().get_nodes_in_group(&"weather"):
		w.call("set_state", 0, true)
		w.set("auto_cycle", false)
	var road := Vector3(-49.0, 0.0, 150.0)
	car.place(road, 0.0)
	await _sec(1.0)
	p.teleport(car.driver_door_point(3.0) + car.global_transform.basis.z * 1.5, PI * 0.5)
	p.set_camera_angles(PI * 0.5 + 0.8, -0.2)
	_caption("Дверь: ручка, открывание, посадка, закрывание (реальные записи)")
	await _sec(0.8)
	await p.walk_to(car.driver_door_point(1.3), null, 5.0)
	p.end_sequence()
	await s.enter_animated()
	_caption("Запуск дизеля (стартер + схватывание, Toyota Hilux, CC0)")
	VehicleInput.scripted = {"throttle": 0.0}
	await _sec(3.0)
	_caption("Холостой ход ~750 об/мин")
	await _sec(3.0)
	_caption("Полный газ: обороты, нагрузка, переключения АКПП")
	VehicleInput.scripted = {"throttle": 1.0}
	await _sec(11.0)
	_caption("Сброс газа: торможение двигателем (слой без нагрузки)")
	VehicleInput.scripted = {"throttle": 0.0}
	await _sec(3.0)
	_caption("Резкое торможение с ABS: визг шин")
	VehicleInput.scripted = {"brake": 1.0}
	for i in 360:
		await get_tree().physics_frame
		if car.speed_kmh < 1.0:
			break
	VehicleInput.scripted = {"throttle": 0.0}
	await _sec(1.0)
	_caption("Дрифт: ручник, занос, дым, следы, визг шин")
	VehicleInput.scripted = {"throttle": 1.0}
	for i in 600:
		await get_tree().physics_frame
		if car.speed_kmh > 55.0:
			break
	VehicleInput.scripted = {"throttle": 0.3, "steer": -1.0, "handbrake": true}
	await _sec(0.5)
	VehicleInput.scripted = {"throttle": 0.7, "steer": 0.5}
	await _sec(1.5)
	VehicleInput.scripted = {"throttle": 0.0, "brake": 1.0}
	await _sec(2.5)
	# a concrete block on the road ahead (demo prop) for a real collision
	var f := -car.global_transform.basis.z
	var block := StaticBody3D.new()
	block.name = "Prop_concrete_block_demo"
	var cs := CollisionShape3D.new()
	var bx := BoxShape3D.new()
	bx.size = Vector3(4, 1.6, 1.2)
	cs.shape = bx
	block.add_child(cs)
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = bx.size
	var mat := StandardMaterial3D.new()
	mat.albedo_color = Color(0.62, 0.6, 0.56)
	bm.material = mat
	mi.mesh = bm
	block.add_child(mi)
	add_child(block)
	block.global_position = car.global_position + f * 32.0 + Vector3(0, 0.0, 0)
	block.global_rotation.y = car.global_rotation.y
	_caption("Удар в бетонный блок ~35 км/ч: звук по силе удара, вмятина")
	VehicleInput.scripted = {"throttle": 0.8}
	for i in 600:
		await get_tree().physics_frame
		if car.health < 99.0:
			break
	VehicleInput.scripted = {"throttle": 0.0, "brake": 0.3}
	await _sec(2.5)
	block.queue_free()
	_caption("ВОССТАНОВИТЬ")
	car.repair()
	await _sec(1.0)
	_caption("Вид из салона: приглушённый звук, шум дороги в салоне")
	s.cam.set_mode(VehicleCamera.Mode.CABIN)
	car.place(road + Vector3(0, 0, -20), 0.0)
	await _sec(0.5)
	VehicleInput.scripted = {"throttle": 0.7}
	await _sec(8.0)
	VehicleInput.scripted = {"throttle": 0.0, "brake": 1.0}
	for i in 360:
		await get_tree().physics_frame
		if car.speed_kmh < 1.0:
			break
	VehicleInput.scripted = {"throttle": 0.0}
	s.cam.set_mode(VehicleCamera.Mode.CHASE)
	await _sec(1.0)
	_caption("Высадка: дверь, остановка двигателя, центральный замок")
	VehicleInput.scripted = null
	await s.exit_animated()
	await _sec(2.5)
