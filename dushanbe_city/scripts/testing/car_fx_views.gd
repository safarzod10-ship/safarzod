extends Node
## Real-renderer shots of the Prado effects: launch, drift with tyre smoke, skid marks (top view),
## dust on the unpaved terrain, in the city:
##   godot --path . res://scenes/testing/car_fx_views.tscn -- out=<dir>
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
	for c in get_tree().root.find_children("*", "CanvasLayer", true, false):
		(c as CanvasLayer).visible = false
	var s: CarSession = main.get("car_session")
	var car: VehiclePrado = s.car
	var which := "car"
	for a in OS.get_cmdline_user_args():
		if a.begins_with("car="):
			which = a.substr(4)
	if which != "car":
		while main.get("bus") == null:
			await get_tree().physics_frame
		car = main.get(which)
		s._select(car)
	cam = Camera3D.new()
	cam.far = 9500.0
	cam.fov = 60.0
	add_child(cam)
	# drift on the open asphalt road north of the city
	car.place(Vector3(-41.3, 0.0, -425.9), 0.086)
	await _sec(1.0)
	s.enter()
	VehicleInput.scripted = {"throttle": 1.0}
	await _sec(5.0)
	VehicleInput.scripted = {"throttle": 0.5, "steer": -0.9, "handbrake": true}
	await _sec(0.7)
	VehicleInput.scripted = {"throttle": 0.6, "steer": 0.35}
	await _sec(0.15)
	var fx: VehicleFX = car.get_node("FX")
	print("FX smoke=%.2f marks=%d speed=%.0f" % [fx.smoke_level, fx.marks_laid, car.speed_kmh])
	var p := car.global_position
	var v := car.linear_velocity.normalized()
	var side := v.cross(Vector3.UP).normalized()
	await _shot("drift_smoke", p - v * 7.0 + side * 7.0 + Vector3(0, 2.0, 0), p)
	await _shot("drift_close", p + side * 4.0 + Vector3(0, 1.2, 0) + v * 1.0, p)
	if which != "car":
		get_tree().quit()
		return
	VehicleInput.scripted = {"brake": 1.0}
	await _sec(3.0)
	p = car.global_position
	await _shot("skid_marks", p + Vector3(6, 22, 14), p + Vector3(0, 0, 12))
	# dust: leave the road onto the grass/earth beside it
	car.place(car.global_position + Vector3(-25, 0, 0), PI * 0.5 + 0.086)
	await _sec(1.0)
	VehicleInput.scripted = {"throttle": 0.9, "steer": 0.15}
	await _sec(4.0)
	print("FX dust=%.2f speed=%.0f" % [fx.dust_level, car.speed_kmh])
	p = car.global_position
	v = car.linear_velocity.normalized()
	side = v.cross(Vector3.UP).normalized()
	await _shot("dust", p - v * 10.0 + side * 5.0 + Vector3(0, 2.5, 0), p)
	# in the city: Prado moving on the avenue
	VehicleInput.scripted = {}
	car.place(Vector3(-49.0, 0.0, 60.0), 0.0)
	await _sec(1.0)
	VehicleInput.scripted = {"throttle": 0.55}
	await _sec(4.0)
	p = car.global_position
	await _shot("prado_city", p + Vector3(-7, 2.2, 9), p)
	VehicleInput.scripted = null
	get_tree().quit()


func _shot(label: String, from: Vector3, at: Vector3) -> void:
	get_tree().paused = true
	cam.global_position = from
	cam.look_at(at, Vector3.UP)
	cam.make_current()
	for i in 4:
		await RenderingServer.frame_post_draw
	get_viewport().get_texture().get_image().save_png("%s/car_%s.png" % [out, label])
	get_tree().paused = false
	print("FX shot ", label)


func _sec(t: float) -> void:
	for i in int(t * Engine.physics_ticks_per_second):
		await get_tree().physics_frame
