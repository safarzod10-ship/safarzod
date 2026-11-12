extends Node
## Stage 5 screenshots (real renderer): the Prado from all sides, cabin + dashboard, on a city road,
## drift with tyre smoke, brake marks, damaged / repaired, headlights at night, the character at the
## open driver's door.
##   xvfb-run godot --path . res://scenes/testing/stage5_views.tscn -- out=<dir>
var main: Node
var s: CarSession
var car: VehiclePrado
var out := "/tmp"
var cam: Camera3D
const ROAD := Vector3(-49.0, 0.0, -12.0)


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
	_hour(10.5)
	_ui(false)
	s = main.get("car_session")
	car = s.car
	cam = Camera3D.new()
	cam.fov = 40.0
	cam.far = 9500.0
	add_child(cam)
	# ---- the car on the avenue: four sides + top
	car.place(ROAD, 0.0)
	s.player.teleport(ROAD + Vector3(6, 1, 6), 0.0)
	await _sec(1.5)
	var c := car.global_position + Vector3(0, 0.9, 0)
	var f := -car.global_transform.basis.z
	var r := car.global_transform.basis.x
	await _shot("front", c + f * 7.0 + r * 2.2 + Vector3(0, 0.4, 0), c)
	await _shot("rear", c - f * 7.0 - r * 2.2 + Vector3(0, 0.6, 0), c)
	await _shot("side", c - r * 7.5 + f * 0.3 + Vector3(0, 0.2, 0), c)
	await _shot("top", c + Vector3(0.01, 9.0, 0), c)
	# ---- character at the open driver's door (animated get-in, frozen when the door is open)
	s.player.teleport(car.driver_door_point(1.6), PI * 0.5)
	await _sec(1.0)
	s.enter_animated()
	var t := 0.0
	while float(car.door_open.get(CarSession.DOOR, 0.0)) < 0.99 and t < 8.0:
		await get_tree().physics_frame
		t += 1.0 / 60.0
	await _sec(0.15)
	var pc := s.player.global_position
	await _shot("door_open_character", pc - r * 3.0 + f * 2.6 + Vector3(0, 0.9, 0), pc + Vector3(0, 0.9, 0) + f * 0.4)
	while not s.driving or s.busy:
		await get_tree().physics_frame
	await _sec(1.0)
	# ---- cabin + dashboard (cabin camera of the game)
	s.cam.set_mode(VehicleCamera.Mode.CABIN)
	VehicleInput.scripted = {"steer": 0.4}
	await _sec(1.5)
	await _game_cam("interior")
	var eye := car.driver_eye()
	var sw: Node3D = car.model.find_child("steeringwheel", true, false)
	cam.fov = 55.0
	await _shot("dashboard", eye + f * 0.05 + Vector3(0, -0.05, 0), sw.global_position + f * 0.25 + r * 0.2 + Vector3(0, -0.05, 0))
	cam.fov = 40.0
	s.cam.set_mode(VehicleCamera.Mode.CHASE)
	VehicleInput.scripted = null
	# ---- driving on the city road (game chase camera + HUD)
	car.place(ROAD + Vector3(0, 0, 60), 0.0)
	s.cam.snap()
	VehicleInput.scripted = {"throttle": 0.6}
	await _sec(4.0)
	_ui(true)
	s.controls.touch_mode = true                    # Android HUD + touch controls
	await _game_cam("city_road")
	s.controls.touch_mode = false
	_ui(false)
	VehicleInput.scripted = {"brake": 1.0}
	await _sec(3.0)
	# ---- drift + smoke on the avenue (flat, wide), then brake marks
	car.place(ROAD + Vector3(0, 0, 150), 0.0)
	s.cam.snap()
	await _sec(1.0)
	VehicleInput.scripted = {"throttle": 1.0}
	t = 0.0
	while car.speed_kmh < 55.0 and t < 10.0:
		await get_tree().physics_frame
		t += 1.0 / 60.0
	VehicleInput.scripted = {"throttle": 0.3, "steer": -1.0, "handbrake": true}
	await _sec(0.5)
	VehicleInput.scripted = {"throttle": 0.7, "steer": 0.5}
	await _sec(0.4)
	var cp := car.global_position
	var v := car.linear_velocity.normalized()
	await _shot("drift", cp + Vector3(-v.z, 0, v.x) * 8.0 + v * 6.0 + Vector3(0, 2.0, 0), cp + Vector3(0, 0.6, 0))
	await _shot("tyre_smoke", cp - v * 5.0 + Vector3(-v.z, 0, v.x) * 3.0 + Vector3(0, 1.4, 0), cp + Vector3(0, 0.7, 0))
	VehicleInput.scripted = {"brake": 1.0}
	await _sec(3.0)
	# straight hard stop with the handbrake: rubber marks of the locked rear tyres on the asphalt
	car.place(ROAD + Vector3(0, 0, 150), 0.0)
	await _sec(1.0)
	VehicleInput.scripted = {"throttle": 1.0}
	t = 0.0
	while car.speed_kmh < 60.0 and t < 10.0:
		await get_tree().physics_frame
		t += 1.0 / 60.0
	VehicleInput.scripted = {"brake": 1.0, "handbrake": true}
	await _sec(3.0)
	cp = car.global_position
	f = -car.global_transform.basis.z
	await _shot("brake_marks", cp + f * 5.0 + car.global_transform.basis.x * 3.5 + Vector3(0, 2.4, 0), cp - f * 9.0)
	# ---- damaged (several hits) and repaired, same place
	car.place(ROAD, 0.0)
	await _sec(1.0)
	c = car.global_position
	f = -car.global_transform.basis.z
	r = car.global_transform.basis.x
	car.damage_at(c + f * 2.35 + r * 0.5 + Vector3(0, 0.2, 0), f, 15.0)
	car.damage_at(c + f * 2.3 - r * 0.5 + Vector3(0, 0.3, 0), f, 13.0)
	car.damage_at(c - r * 0.95 + f * 0.9 + Vector3(0, 0.3, 0), -r, 13.0)
	car.damage_at(c - r * 0.95 - f * 0.4 + Vector3(0, 0.5, 0), -r, 11.0)
	await _sec(0.5)
	await _shot("damaged", c + f * 5.0 - r * 3.2 + Vector3(0, 1.0, 0), c + f * 0.8 + Vector3(0, 0.5, 0))
	car.repair()
	await _sec(0.5)
	await _shot("repaired", c + f * 5.0 - r * 3.2 + Vector3(0, 1.0, 0), c + f * 0.8 + Vector3(0, 0.5, 0))
	# ---- night: dipped / main beam, tail lamps, indicator
	_hour(22.5)
	car.lights.beam = VehicleLights.Beam.HIGH
	car.lights.set_turn(-1)
	await _sec(1.0)
	await _shot("headlights_night", c + f * 9.0 + r * 3.0 + Vector3(0, 1.3, 0), c + f * 2.0 + Vector3(0, 0.4, 0))
	VehicleInput.scripted = {"brake": 1.0}
	await _sec(0.4)
	await _shot("taillights_night", c - f * 7.5 - r * 2.5 + Vector3(0, 1.3, 0), c + Vector3(0, 0.6, 0))
	get_tree().quit()


func _unused_find_open_asphalt() -> Vector3:
	## a straight stretch of the country asphalt road on the terrain (flat, nothing around)
	var cw := CityWorld.instance
	var best := ROAD + Vector3(0, 0, 60)
	for i in 6000:
		var x := randf_range(-900, 900)
		var z := randf_range(-900, 900)
		var ok := true
		for k in range(-6, 7):
			if cw.surface_at(x, z + k * 8.0) != CityWorld.Surface.ASPHALT:
				ok = false
				break
		if ok and absf(cw.terrain_height(x, z) - cw.terrain_height(x, z - 48.0)) < 1.5:
			return Vector3(x, cw.terrain_height(x, z), z + 40.0)
	return best


func _hour(h: float) -> void:
	for t in get_tree().get_nodes_in_group(&"time_of_day"):
		t.call("set_hour", h)


func _ui(on: bool) -> void:
	for n in get_tree().root.find_children("*", "CanvasLayer", true, false):
		if n.has_method("set_shown"):
			n.call("set_shown", on and false)
		elif n.name != "Touch":
			(n as CanvasLayer).visible = on


func _shot(label: String, from: Vector3, at: Vector3) -> void:
	get_tree().paused = true
	cam.global_position = from
	cam.look_at(at, Vector3.UP if absf((at - from).normalized().y) < 0.99 else Vector3.FORWARD)
	cam.make_current()
	for i in 4:
		await RenderingServer.frame_post_draw
	get_viewport().get_texture().get_image().save_png("%s/s5_%s.png" % [out, label])
	get_tree().paused = false
	print("S5 shot ", label)


func _game_cam(label: String) -> void:
	get_tree().paused = true
	s.cam.make_current()
	for i in 4:
		await RenderingServer.frame_post_draw
	get_viewport().get_texture().get_image().save_png("%s/s5_%s.png" % [out, label])
	get_tree().paused = false
	print("S5 shot ", label)


func _sec(t: float) -> void:
	for i in int(t * Engine.physics_ticks_per_second):
		await get_tree().physics_frame
