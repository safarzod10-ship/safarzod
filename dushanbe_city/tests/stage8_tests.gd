extends Node
## Stage 8 functional tests: fuel (tanks per vehicle, consumption, running dry -> the car stops,
## fuel delivered at 18 smn/l, filling stations at 14 smn/l along the roads), the Toyota Camry, the
## Lexus RX and the city bus on the shared vehicle physics, the bus driver job (route №1, stops,
## passengers, pay, missed stop, loop bonus), the school / hospital models in the city.
##   godot --headless --fixed-fps 60 --path . res://tests/stage8_tests.tscn  -> docs/reports/stage8_tests.txt

var main: Node
var s: CarSession
var wd: WorldData
var ow: OpenWorld
var fs: FuelService
var lines: Array[String] = []
var ok_all := true
var n := 0


func _ready() -> void:
	Wallet.no_save = true
	main = (load("res://scenes/main/main.tscn") as PackedScene).instantiate()
	add_child(main)
	var t0 := Time.get_ticks_msec()
	while (main.get("bus_job") == null or main.get("bus") == null or (main.get("boats") as Array).size() < 1) and Time.get_ticks_msec() - t0 < 90000:
		await get_tree().physics_frame
	await _frames(30)
	s = main.get("car_session")
	wd = WorldData.get_instance()
	ow = main.get("open_world")
	fs = main.get("fuel")
	for w in get_tree().get_nodes_in_group(&"weather"):
		w.set("auto_cycle", false)
		w.call("set_state", 0, true)
	for sec in ["tanks", "consumption", "empty", "station", "cars", "bus_route", "bus_job", "city"]:
		await call("_t_" + sec)
	print("STAGE8_TESTS ", "ALL PASS" if ok_all else "SOME FAILED", "  (%d checks)" % n)
	var f := FileAccess.open("res://docs/reports/stage8_tests.txt", FileAccess.WRITE)
	if f:
		f.store_string("\n".join(lines) + "\n")
	get_tree().quit(0 if ok_all else 1)


func _check(msg: String, ok: bool) -> void:
	n += 1
	var l := ("PASS " if ok else "FAIL ") + "%2d. " % n + msg
	print(l)
	lines.append(l)
	ok_all = ok_all and ok


func _frames(k: int) -> void:
	for i in k:
		await get_tree().physics_frame


func _sec(t: float) -> void:
	await _frames(int(t * 60))


func _wait_sectors(p: Vector3) -> void:
	ow.preload_at(p)
	for i in 400:
		await get_tree().process_frame
		if ow._jobs.is_empty() and ow._results.is_empty() and i > 30:
			break


## get into vehicle v (player next to it), camera follows
func _board(v: VehiclePrado) -> void:
	if s.driving:
		s.exit()
		await _frames(5)
	s.player.teleport(v.driver_door_point(0.7), 0.0)
	await _frames(20)
	s._select(v)
	s.enter()
	await _frames(5)


# ------------------------------------------------------------------------------------------ fuel
func _t_tanks() -> void:
	var tanks := {}
	for nm in ["car", "camry", "lexus", "van", "bus"]:
		var v: VehiclePrado = main.get(nm)
		tanks[nm] = v.tank_l if v else -1.0
	var bt: VehiclePrado = (main.get("boats") as Array)[0]
	tanks["boat"] = bt.tank_l
	_check("every vehicle has its own tank: %s (Prado 80, Camry 60)" % str(tanks),
		tanks["car"] == 80.0 and tanks["camry"] == 60.0 and tanks["lexus"] == 72.0 and tanks["van"] == 70.0 and tanks["bus"] == 250.0 and tanks["boat"] == 40.0)
	_check("new game money for fuel: %s (500)" % Wallet.fmt(Wallet.money), Wallet.money == 500)


func _t_consumption() -> void:
	var car: VehiclePrado = main.get("car")
	await _board(car)
	var f0 := car.fuel_l
	var p0 := car.global_position
	VehicleInput.scripted = {"throttle": 0.8}
	await _sec(12.0)
	VehicleInput.scripted = {"brake": 1.0}
	await _sec(3.0)
	VehicleInput.scripted = null
	var used := f0 - car.fuel_l
	var km := car.global_position.distance_to(p0) / 1000.0
	var per_km := used / maxf(km, 0.01)
	_check("Prado burns fuel while driving: %.2f l over %.2f km = %.2f l/km (game x%d of ~11 l/100 km: 0.5 .. 1.6)" % [used, km, per_km, int(VehiclePrado.FUEL_GAME_MULT)],
		used > 0.05 and per_km > 0.5 and per_km < 1.6)
	var parked: VehiclePrado = main.get("camry")
	var pf := parked.fuel_l
	await _sec(2.0)
	_check("parked vehicles burn nothing (Camry %.2f -> %.2f l)" % [pf, parked.fuel_l], is_equal_approx(pf, parked.fuel_l))


func _t_empty() -> void:
	var car: VehiclePrado = main.get("car")
	var emitted := [false]
	car.out_of_fuel.connect(func() -> void: emitted[0] = true)
	car.fuel_l = 0.08
	VehicleInput.scripted = {"throttle": 1.0}
	await _sec(6.0)
	var v_dry := car.speed_kmh
	await _sec(4.0)
	var v_later := car.speed_kmh
	VehicleInput.scripted = null
	_check("tank runs dry: out_of_fuel %s, fuel %.2f l, the car does not accelerate (%.0f -> %.0f km/h)" % [emitted[0], car.fuel_l, v_dry, v_later],
		emitted[0] and car.fuel_l == 0.0 and v_later <= v_dry + 0.5)
	VehicleInput.scripted = {"brake": 1.0}
	await _sec(4.0)
	VehicleInput.scripted = null
	await _frames(10)
	_check("the fuel delivery window opens (18 smn/l): %s" % fs._panel_title.text.replace("\n", " "), fs._panel.visible and fs._panel_title.text.contains("18"))
	var m0 := Wallet.money
	var added := fs.buy_delivery(10.0)
	_check("buy 10 l delivered: +%.1f l, money %s -> %s (−180)" % [added, Wallet.fmt(m0), Wallet.fmt(Wallet.money)], is_equal_approx(added, 10.0) and m0 - Wallet.money == 180)
	fs._panel.visible = false
	VehicleInput.scripted = {"throttle": 1.0}
	await _sec(5.0)
	var v_again := car.speed_kmh
	VehicleInput.scripted = {"brake": 1.0}
	await _sec(3.0)
	VehicleInput.scripted = null
	_check("with fuel the car drives again (%.0f km/h after 5 s of gas)" % v_again, v_again > 20.0)


func _t_station() -> void:
	_check("filling stations along the roads: %d" % wd.fuel.size(), wd.fuel.size() >= 20)
	# coverage: from any road point the nearest station is within 7 km
	var worst := 0.0
	for r in wd.roads:
		if r["cls"] in ["dirt", "lane"]:
			continue
		var pts: Array = r["pts"]
		for k in range(0, pts.size(), 50):
			var p := Vector3(pts[k][0], 0, pts[k][2])
			var sp := fs.nearest_station_pos(p)
			worst = maxf(worst, Vector2(sp.x - p.x, sp.z - p.z).length())
	_check("nearest station from any road point: at most %.1f km" % (worst / 1000.0), worst < 7000.0)
	# drive to one: the Prado parked at the pumps
	var car: VehiclePrado = main.get("car")
	car.repair()                 # the earlier drives may have damaged it (a burning car explodes)
	var f: Dictionary = wd.fuel[0]
	var pump := fs.nearest_station_pos(Vector3(float(f.get("ox", f["x"])), 0, float(f.get("oz", f["z"]))))
	car.place(pump + Vector3(0, 40, 0), float(f["yaw"]))       # first above it: the camera follows
	car.freeze = true
	s.cam.snap()
	await _wait_sectors(pump)
	await _sec(1.0)
	car.freeze = false
	car.place(pump + Vector3(0, 2, 0), float(f["yaw"]))
	car.linear_velocity = Vector3.ZERO
	await _sec(1.5)
	car.fuel_l = 20.0
	Wallet.money = 2000
	await _frames(10)
	_check("at the pumps: «ЗАПРАВИТЬ» offered (station found %s, button %s)" % [fs._station != null, fs._btn_fill.visible], fs._station != null and fs._btn_fill.visible)
	var m0 := Wallet.money
	fs.start_fill()
	await _sec(10.0)
	var litres := car.fuel_l - 20.0
	_check("filled at 14 smn/l: +%.1f l to %.0f / %.0f l, paid %s (%.0f x 14)" % [litres, car.fuel_l, car.tank_l, Wallet.fmt(m0 - Wallet.money), litres],
		car.fuel_l >= car.tank_l - 0.1 and m0 - Wallet.money == int(ceil(litres * 14.0)))
	# low fuel: warning + the nearest station on the minimap
	car.fuel_l = car.tank_l * 0.1
	await _frames(5)
	_check("low fuel: nearest station marked on the minimap (%s)" % str(Minimap.fuel_marker.round()), Minimap.fuel_marker != Vector3.INF)
	car.fuel_l = car.tank_l * 0.6
	await _frames(3)
	# money too low at the station
	Wallet.money = 0
	car.fuel_l = 10.0
	fs.start_fill()
	await _frames(5)
	_check("no money: no fuel is given (fuel %.2f l, money %s)" % [car.fuel_l, Wallet.fmt(Wallet.money)], car.fuel_l <= 10.0 and car.fuel_l > 9.9 and Wallet.money == 0)
	Wallet.money = 500


# ------------------------------------------------------------------------------------------ cars
func _t_cars() -> void:
	for nm in ["camry", "lexus", "bus"]:
		var v: VehicleCar = main.get(nm)
		if v == null:
			_check("%s spawned" % nm, false)
			continue
		var spin_meshes := 0
		for w in v.wheels:
			spin_meshes += (w["mesh"] as Node).find_children("*", "MeshInstance3D", true, false).size()
		_check("%s: 4 wheels (%d) with spinning meshes (%d), radius %.3f m, on the ground %d" % [v.spec["name"], v.wheels.size(), spin_meshes, v.wheel_radius, v.wheels_on_ground],
			v.wheels.size() == 4 and spin_meshes >= 4 and v.wheels_on_ground == 4)
	var bus: VehicleCar = main.get("bus")
	var draw := bus.model.find_children("*", "MeshInstance3D", true, false).size()
	_check("bus: 829 source parts merged into %d meshes (draw calls)" % draw, draw < 40)
	# drive the Camry on a test strip far away (flat collision box)
	var strip := StaticBody3D.new()
	var cs := CollisionShape3D.new()
	var bs := BoxShape3D.new()
	bs.size = Vector3(60, 1, 3000)
	cs.shape = bs
	cs.position = Vector3(7000, -0.5, 6000)
	strip.add_child(cs)
	add_child(strip)
	for nm in ["camry", "bus"]:
		var v: VehicleCar = main.get(nm)
		await _board(v)
		v.place(Vector3(7000, 0, 7400), 0.0)
		v.fuel_l = v.tank_l
		s.cam.snap()
		await _sec(0.5)
		var t100 := -1.0
		var t := 0.0
		VehicleInput.scripted = {"throttle": 1.0}
		while t < 25.0:
			await get_tree().physics_frame
			t += 1.0 / 60.0
			if t100 < 0.0 and v.speed_kmh >= (100.0 if nm == "camry" else 60.0):
				t100 = t
		var vmax := v.speed_kmh
		VehicleInput.scripted = {"brake": 1.0}
		await _sec(5.0)
		VehicleInput.scripted = null
		if nm == "camry":
			_check("Camry drives on the shared physics: 0-100 km/h in %.1f s (6..14), %.0f km/h after 25 s" % [t100, vmax], t100 > 6.0 and t100 < 14.0)
		else:
			_check("bus: 0-60 km/h in %.1f s (8..20), limited to %.0f km/h (<= 92)" % [t100, vmax], t100 > 8.0 and t100 < 20.0 and vmax <= 92.0)
	s.exit()
	await _frames(5)
	strip.queue_free()


# ------------------------------------------------------------------------------------------ bus
func _t_bus_route() -> void:
	var job: BusJob = main.get("bus_job")
	var L := 0.0
	for k in range(1, job.route.size()):
		L += job.route[k].distance_to(job.route[k - 1])
	_check("bus route №1: a %.1f km loop over 4 city roads, %d stops" % [L / 1000.0, job.stops.size()], L > 4000.0 and job.stops.size() >= 8)
	var off := 0
	var names := []
	for st in job.stops:
		var p: Vector3 = st["p"]
		var e := wd.road_edge_dist(p.x, p.z)
		if e > -0.5 or e < -4.0:
			off += 1
		names.append(st["name"])
	_check("stops in the kerb lane (0.5 .. 4 m inside the edge): %d off; names %s" % [off, str(names.slice(0, 5))], off == 0)
	var shelters := job._stop_nodes.get_child_count()
	_check("a shelter + sign at every stop (%d)" % shelters, shelters == job.stops.size())


func _t_bus_job() -> void:
	var job: BusJob = main.get("bus_job")
	var bus: VehicleCar = main.get("bus")
	Wallet.bus_hired = false
	# hire at the terminus
	s.player.teleport(job.office_point() + Vector3(0, 0.3, 0), 0.0)
	s.player.get_camera().make_current()
	await _wait_sectors(job.office_point())
	await _sec(0.8)
	var it: CharacterInteraction = s.player.get("interaction")
	var office: Node = job.get_node("BusOffice")
	await _sec(0.3)
	_check("terminus sign is an interactable «%s», selected: %s" % [String(office.call("interaction_label", s.player)), it.current == office], it.current == office)
	it.trigger()
	await _frames(3)
	_check("hired as a bus driver", Wallet.bus_hired)
	# the bus back at the terminus, get in
	var xf := job.bus_spawn()
	await _wait_sectors(xf.origin)
	bus.place(xf.origin, xf.basis.get_euler().y)
	bus.fuel_l = 200.0
	await _sec(1.0)
	await _board(bus)
	await _frames(10)
	var st: Dictionary = job.stops[job.next_stop]
	_check("in the bus: next stop «%s» marked (beacon %s, minimap %s)" % [st["name"], job._beacon.visible, Minimap.target == st["p"]], job._beacon.visible and Minimap.target == st["p"])
	# drive (placed) to the stop and stop there
	var m0 := Wallet.money
	var p: Vector3 = st["p"]
	var k: int = st["k"]
	var dir := (job.route[k + 1] - job.route[k - 1]).normalized()
	await _wait_sectors(p)
	bus.place(p - dir * 3.0, atan2(-dir.x, -dir.z))
	await _sec(4.0)
	_check("stop served after 2.5 s standing: passengers %d, pay %s, next stop %d" % [job.passengers, Wallet.fmt(Wallet.money - m0), job.next_stop],
		job.passengers > 0 and Wallet.money > m0 and job.next_stop == 2)
	# a missed stop: the bus passes the next one without stopping
	var st2: Dictionary = job.stops[job.next_stop]
	var k2: int = st2["k"]
	var d2 := (job.route[k2 + 1] - job.route[k2 - 1]).normalized()
	var beyond := job.route[mini(k2 + 18, job.route.size() - 1)]
	await _wait_sectors(beyond)
	bus.place(beyond, atan2(-d2.x, -d2.z))
	await _sec(1.0)
	_check("driving past a stop misses it (next stop now %d)" % job.next_stop, job.next_stop == 3)
	# the rest of the loop: bonus at the end
	var loops0 := job.loops
	var m1 := Wallet.money
	while job.next_stop != 1:
		job.serve_stop()
	_check("a full loop pays the bonus: loops %d -> %d, earned %s this shift %s" % [loops0, job.loops, Wallet.fmt(Wallet.money - m1), Wallet.fmt(job.shift_pay)], job.loops == loops0 + 1)
	s.exit()
	await _frames(5)


# ------------------------------------------------------------------------------------------ city
func _t_city() -> void:
	var kinds := {}
	var first := {}
	for b in wd.buildings:
		var k: String = b[0]
		if k in ["school_m", "hospital_m"]:
			kinds[k] = int(kinds.get(k, 0)) + 1
			if not first.has(k):
				first[k] = Vector3(b[1], b[8], b[2])
	_check("school and hospital models in the city: %s" % str(kinds), int(kinds.get("school_m", 0)) >= 2 and int(kinds.get("hospital_m", 0)) >= 2)
	var sch := WorldModels.aabb("school_m")
	var hos := WorldModels.aabb("hospital_m")
	_check("model sizes: school %s, hospital %s (real-world metres)" % [str(sch.size.round()), str(hos.size.round())], sch.size.x > 50.0 and sch.size.y > 8.0 and hos.size.x > 25.0)
	var p: Vector3 = first.get("school_m", Vector3.ZERO)
	var cam := Camera3D.new()
	add_child(cam)
	cam.global_position = p + Vector3(0, 40, 80)
	cam.make_current()
	await _wait_sectors(p)
	var found := false
	for mm in get_tree().root.find_children("*", "MultiMeshInstance3D", true, false):
		var m := mm as MultiMeshInstance3D
		if m.multimesh and m.multimesh.instance_count > 0 and m.multimesh.mesh in (WorldModels.parts("school_m").map(func(x): return x[0])):
			found = true
	_check("school model rendered in its sector", found)
	cam.queue_free()
