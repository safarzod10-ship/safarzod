extends Node
## Stage 8 screenshots (real renderer, the game's own streaming): the LakLak van, the LakLak depot,
## a motorboat on the sea (floating, driving), a DushanbeCity billboard, guardrails on a mountain
## road, the national flag, skyscrapers, villas, a rounded junction with zebra crossings, the new
## grass (open world + peninsula lawn), the city from above (curved streets, rounded ring road).
##   xvfb-run godot --path . res://scenes/testing/stage8_views.tscn -- out=<dir>
var main: Node
var out := "/tmp"
var cam: Camera3D
var wd: WorldData
var ow: OpenWorld


func _ready() -> void:
	for a in OS.get_cmdline_user_args():
		if a.begins_with("out="):
			out = a.substr(4)
	Wallet.no_save = true
	Settings.set_mode("high")
	main = (load("res://scenes/main/main.tscn") as PackedScene).instantiate()
	add_child(main)
	while main.get("bus_job") == null or main.get("bus") == null:
		await get_tree().physics_frame
	for i in 30:
		await get_tree().physics_frame
	wd = WorldData.get_instance()
	ow = main.get("open_world")
	for w in get_tree().get_nodes_in_group(&"weather"):
		w.call("set_state", 0, true)
		w.set("auto_cycle", false)
	_hour(11.0)
	_ui(false)
	cam = Camera3D.new()
	cam.far = 9500.0
	cam.fov = 55.0
	add_child(cam)
	cam.make_current()
	var lm := {}
	for l in wd.landmarks:
		lm[l["id"]] = l
	# ---- filling station
	var f: Dictionary = wd.fuel[2 % wd.fuel.size()]
	var yaw := float(f["yaw"])
	var o := Vector3(float(f["ox"]), float(f["y"]), float(f["oz"]))
	var xv := Vector3(cos(yaw), 0, -sin(yaw))
	var zv := Vector3(sin(yaw), 0, cos(yaw))
	await _look("gas_station", o + xv * 40.0 + zv * 22.0 + Vector3(0, 9, 0), o + xv * 4.0 + Vector3(0, 3, 0))
	# ---- the new cars (peninsula avenue, behind the Prado)
	var camry: VehicleCar = main.get("camry")
	var lexus: VehicleCar = main.get("lexus")
	await _look("camry", camry.global_position + Vector3(4.5, 1.6, -5.0), camry.global_position + Vector3(0, 0.6, 0), -1.0, NAN, true)
	await _look("lexus", lexus.global_position + Vector3(4.5, 1.8, 5.5), lexus.global_position + Vector3(0, 0.7, 0), -1.0, NAN, true)
	# ---- the bus at the terminus stop
	var bus: VehicleCar = main.get("bus")
	var bb := bus.global_transform.basis
	await _look("bus", bus.global_position + bb.x * 11.0 - bb.z * 9.0 + Vector3(0, 3.0, 0), bus.global_position + Vector3(0, 1.5, 0), -1.0, NAN, true)
	var job: BusJob = main.get("bus_job")
	var st: Dictionary = job.stops[3]
	var sp: Vector3 = st["p"]
	var r: Vector3 = st["right"]
	await _look("bus_stop", sp - r * 6.0 + Vector3(0, 3, 0) + Vector3(r.z, 0, -r.x) * 14.0, sp + r * 5.0 + Vector3(0, 1.5, 0))
	# ---- school, hospital
	for k in ["school_m", "hospital_m"]:
		for b in wd.buildings:
			if b[0] == k:
				var c := Vector3(b[1], b[8], b[2])
				var dist := 85.0 if k == "school_m" else 45.0
				await _look(k.trim_suffix("_m"), c + Vector3(dist, dist * 0.45, dist * 0.6), c + Vector3(0, 5, 0))
				break
	# ---- HUD while driving: fuel gauge + the delivery window, bus job HUD
	_ui(true)
	var s: CarSession = main.get("car_session")
	var car: VehiclePrado = main.get("car")
	s.player.teleport(car.driver_door_point(0.7), 0.0)
	await get_tree().create_timer(0.3).timeout
	s._select(car)
	s.enter()
	car.fuel_l = 0.0
	var fs: FuelService = main.get("fuel")
	fs.open_delivery()
	await get_tree().create_timer(1.0).timeout
	for i in 6:
		await RenderingServer.frame_post_draw
	get_viewport().get_texture().get_image().save_png("%s/s8_hud_fuel_empty.png" % out)
	fs._panel.visible = false
	car.fuel_l = 50.0
	s.exit()
	await get_tree().create_timer(0.3).timeout
	Wallet.bus_hired = true
	s.player.teleport(bus.driver_door_point(0.7), 0.0)
	await get_tree().create_timer(0.3).timeout
	s._select(bus)
	s.enter()
	ow.preload_at(bus.global_position)
	for i in 400:
		await get_tree().process_frame
		if ow._jobs.is_empty() and ow._results.is_empty() and i > 120:
			break
	await get_tree().create_timer(1.5).timeout
	for i in 6:
		await RenderingServer.frame_post_draw
	get_viewport().get_texture().get_image().save_png("%s/s8_hud_bus.png" % out)
	get_tree().quit()


func _grass_point(near: Vector3) -> Vector3:
	for r in range(0, 900, 15):
		for k in 24:
			var a := TAU * k / 24.0
			var p := near + Vector3(cos(a), 0, sin(a)) * r
			if wd.grass_ok(p.x, p.z) and wd.road_edge_dist(p.x, p.z) > 14.0:
				p.y = wd.height_at(p.x, p.z)
				return p
	return Vector3.INF


func _ground(p: Vector3) -> float:
	return wd.height_at(p.x, p.z) if wd.contains(p.x, p.z) else CityWorld.instance.terrain_height(p.x, p.z)


## camera at `from` (or at its xz + h above the ground) looking at `at` (or its ground + th)
func _look(label: String, from: Vector3, at: Vector3, h := -1.0, th := NAN, settle := false, grass := false) -> void:
	if h >= 0.0:
		from.y = _ground(from) + h
	if not is_nan(th):
		at.y = _ground(at) + th
	cam.global_position = from
	cam.look_at(at, Vector3.UP)
	cam.make_current()
	ow.preload_at(from)
	for i in 600:
		await get_tree().process_frame
		if ow._jobs.is_empty() and ow._results.is_empty() and i > (150 if settle else 90):
			break
	if grass:
		var gf: Node = main.get_node_or_null("Grass")
		if gf:
			gf.set("override_camera", cam)
			gf.call("rebuild", from)
		for i in 10:
			await get_tree().process_frame
	for i in 6:
		await RenderingServer.frame_post_draw
	get_viewport().get_texture().get_image().save_png("%s/s8_%s.png" % [out, label])
	print("S8 shot ", label)


func _hour(h: float) -> void:
	for t in get_tree().get_nodes_in_group(&"time_of_day"):
		t.call("set_hour", h)


func _ui(on: bool) -> void:
	for n in get_tree().root.find_children("*", "CanvasLayer", true, false):
		if n.has_method("set_shown"):
			n.call("set_shown", false)
		elif n.name != "Touch":
			(n as CanvasLayer).visible = on
