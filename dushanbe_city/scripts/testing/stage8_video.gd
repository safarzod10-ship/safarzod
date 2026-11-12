extends Node
## Stage 8 video (Movie Maker, real renderer + game sound): edited fragments
##   1. Toyota Camry on the peninsula avenue
##   2. the Prado low on fuel drives to a filling station and fills up (14 smn / l)
##   3. the tank runs dry on the road: the delivery window (18 smn / l), 20 l bought, on we go
##   4. the city bus, route №1: driving to the next stops, passengers get on and off, pay
##   godot --path . --write-movie out.avi --fixed-fps 30 res://scenes/testing/stage8_video.tscn
var main: Node
var s: CarSession
var wd: WorldData
var ow: OpenWorld
var _cap: Label


func _ready() -> void:
	Wallet.no_save = true
	Settings.set_mode("medium")
	main = (load("res://scenes/main/main.tscn") as PackedScene).instantiate()
	add_child(main)
	while main.get("bus_job") == null or main.get("bus") == null:
		await get_tree().physics_frame
	await _frames(30)
	s = main.get("car_session")
	wd = WorldData.get_instance()
	ow = main.get("open_world")
	for w in get_tree().get_nodes_in_group(&"weather"):
		w.call("set_state", 0, true)
		w.set("auto_cycle", false)
	_hour(10.5)
	var fs: FuelService = main.get("fuel")
	Wallet.money = 1500
	var bus_only := OS.get_cmdline_user_args().has("bus_only")
	if bus_only:
		Wallet.money = 746
		await _bus_clip()
		get_tree().quit()
		return
	# ---- 1. Camry
	var camry: VehicleCar = main.get("camry")
	_caption("Toyota Camry: бак 60 л, та же физика")
	await _drive_road(camry, "rudaki", Vector3(-40, 0, -1600), 9.0, 70.0, -80.0)
	# ---- 2. filling station
	var prado: VehiclePrado = main.get("car")
	var f: Dictionary = wd.fuel[2 % wd.fuel.size()]
	var pump := fs.nearest_station_pos(Vector3(float(f["ox"]), 0, float(f["oz"])))
	_caption("Заправка на АЗС: 14 смн за литр")
	prado.fuel_l = 52.0                     # ~65 % after the fill: 28 l at 14 smn = 392 smn
	await _drive_to(prado, str(f["road"]), pump, 160.0)
	prado.place(pump + Vector3(0, 1.0, 0), prado.global_rotation.y)
	await _sec(1.2)
	fs.start_fill()
	await _sec(9.0)
	# ---- 3. empty on the road
	_caption("Бензин закончился: доставка 18 смн за литр")
	prado.fuel_l = 0.25
	await _drive_road(prado, str(f["road"]), pump, 9.0, 60.0, 400.0)
	VehicleInput.scripted = {"brake": 1.0}
	await _sec(2.5)
	VehicleInput.scripted = null
	fs.open_delivery()
	await _sec(3.0)
	fs._panel_choice(1)
	await _sec(2.0)
	await _drive_road(prado, str(f["road"]), prado.global_position, 6.0, 60.0, 0.0)
	s.exit()
	await _frames(5)
	# ---- 4. bus
	var job: BusJob = main.get("bus_job")
	var bus: VehicleCar = main.get("bus")
	Wallet.bus_hired = true
	_caption("Автобус №1: маршрут и остановки")
	s.player.teleport(bus.driver_door_point(0.8), 0.0)
	await _frames(3)
	s._select(bus)
	s.enter()
	await _wait(bus.global_position)
	s.cam.snap()
	for leg in 2:
		var st: Dictionary = job.stops[job.next_stop]
		var served := job.next_stop
		await _drive_to_stop(bus, job, st)
		for i in 300:
			await get_tree().physics_frame
			if job.next_stop != served:
				break
		await _sec(1.5)
	get_tree().quit()


## drive along the road of a point to it and stop there
func _drive_to(v: VehiclePrado, road: String, p: Vector3, back: float) -> void:
	await _drive_road(v, road, p, 30.0, 45.0, -back, p)


## the bus along route №1 to a stop, slowing down and stopping at it
func _drive_to_stop(bus: VehiclePrado, job: BusJob, st: Dictionary) -> void:
	var route: Array = []
	for q in job.route:
		route.append(q)
	await _drive_pts(bus, route, bus.global_position, 35.0, 40.0, 0.0, st["p"], false)


func _frames(k: int) -> void:
	for i in k:
		await get_tree().physics_frame


func _sec(t: float) -> void:
	await _frames(int(t * 60))


func _wait(p: Vector3) -> void:
	ow.preload_at(p)
	for i in 400:
		await get_tree().process_frame
		if ow._jobs.is_empty() and ow._results.is_empty() and i > 40:
			break


func _hour(h: float) -> void:
	for t in get_tree().get_nodes_in_group(&"time_of_day"):
		t.call("set_hour", h)


func _caption(t: String) -> void:
	if _cap == null:
		var cl := CanvasLayer.new()
		cl.layer = 60
		add_child(cl)
		_cap = Label.new()
		_cap.add_theme_font_size_override("font_size", 22)
		_cap.add_theme_color_override("font_outline_color", Color.BLACK)
		_cap.add_theme_constant_override("outline_size", 8)
		_cap.position = Vector2(250, 500)
		cl.add_child(_cap)
	_cap.text = t


func _road_pts(id: String) -> Array:
	for r in wd.roads:
		if r["id"] == id:
			var out: Array = []
			for p in r["pts"]:
				out.append(Vector3(p[0], p[1], p[2]))
			return out
	return []


## the road nearest to p, its points
func _nearest_road(p: Vector3) -> Array:
	var best: Array = []
	var bd := INF
	for r in wd.roads:
		if r["cls"] in ["dirt", "lane"]:
			continue
		for q in r["pts"]:
			var d := Vector2(float(q[0]) - p.x, float(q[2]) - p.z).length()
			if d < bd:
				bd = d
				best = _road_pts(r["id"])
	return best


func _drive_from_point(v: VehiclePrado, p: Vector3, secs: float, vmax: float, back := -40.0) -> void:
	var pts := _nearest_road(p)
	await _drive_pts(v, pts, p, secs, vmax, back)


func _drive_road(v: VehiclePrado, id: String, near: Vector3, secs: float, vmax: float, back := 0.0, stop_at := Vector3.INF) -> void:
	await _drive_pts(v, _road_pts(id), near, secs, vmax, back, stop_at)


## autopilot along road points (pure pursuit, same pedals / steering as the player), starting `back`
## metres before the point of the road nearest to `near`, in the right-hand lane
func _drive_pts(v: VehiclePrado, route: Array, near: Vector3, secs: float, vmax: float, back: float, stop_at := Vector3.INF, place := true) -> void:
	if route.size() < 10:
		return
	var k := 0
	var bd := INF
	for i in route.size():
		var d := Vector2((route[i] as Vector3).x - near.x, (route[i] as Vector3).z - near.z).length()
		if d < bd:
			bd = d
			k = i
	k = clampi(k + int(back / 4.0), 0, route.size() - 30)
	var a: Vector3 = route[k]
	var b: Vector3 = route[k + 3]
	var dir := (b - a).normalized()
	var start := a + dir.cross(Vector3.UP) * 3.0             # right-hand traffic: the right lane
	if place:
		await _wait(start)
	if not s.driving or s.car != v:
		if s.driving:
			s.exit()
		s.player.teleport(v.driver_door_point(1.0), 0.0)
		await _frames(3)
		s._select(v)
		s.enter()
	if place:
		v.place(start + Vector3(0, 1.0, 0), atan2(-dir.x, -dir.z))
		v.linear_velocity = -v.global_transform.basis.z * 8.0
		s.cam.snap()
	var idx := k
	var t := 0.0
	while t < secs:
		await get_tree().physics_frame
		t += 1.0 / 60.0
		var pos := v.global_position
		var best := INF
		for j in range(idx, mini(idx + 40, route.size())):
			var d := Vector2((route[j] as Vector3).x - pos.x, (route[j] as Vector3).z - pos.z).length()
			if d < best:
				best = d
				idx = j
		var look := 8.0 + v.linear_velocity.length() * 0.8
		var tgt := idx
		var acc := 0.0
		while tgt < route.size() - 1 and acc < look:
			acc += (route[tgt] as Vector3).distance_to(route[tgt + 1])
			tgt += 1
		var tp: Vector3 = route[tgt]
		var rd := ((route[mini(tgt + 1, route.size() - 1)] as Vector3) - tp).normalized()
		tp += rd.cross(Vector3.UP) * 3.0
		if stop_at != Vector3.INF and Vector2(stop_at.x - pos.x, stop_at.z - pos.z).length() < 70.0:
			tp = stop_at                                    # pull in to the kerb at the stop
		var to := tp - pos
		var ang := atan2(to.dot(v.global_transform.basis.x), to.dot(-v.global_transform.basis.z))
		var vt := vmax
		if stop_at != Vector3.INF:
			var ds := Vector2(stop_at.x - pos.x, stop_at.z - pos.z).length()
			vt = minf(vmax, maxf(ds - 6.0, 0.0) * 1.2)
			if ds < 8.0:
				break
		var err := vt - v.speed_kmh
		VehicleInput.scripted = {"throttle": clampf(err * 0.08, 0.0, 1.0), "brake": clampf(-err * 0.06, 0.0, 1.0) if err < -4.0 else 0.0,
			"steer": clampf(ang * 2.2, -1.0, 1.0)}
	if stop_at != Vector3.INF:
		VehicleInput.scripted = {"brake": 1.0}
		for i in 120:
			await get_tree().physics_frame
			if v.speed_kmh < 1.0:
				break
	VehicleInput.scripted = null


## the bus clip: placed ~150 m before each of two stops (edited cuts), pulls in, serves the stop
func _bus_clip() -> void:
	var job: BusJob = main.get("bus_job")
	var bus: VehicleCar = main.get("bus")
	Wallet.bus_hired = true
	_caption("Автобус №1: остановка — посадка и высадка пассажиров, оплата")
	s.player.teleport(bus.driver_door_point(0.8), 0.0)
	await _frames(3)
	s._select(bus)
	s.enter()
	for leg in 2:
		var st: Dictionary = job.stops[job.next_stop]
		var k: int = st["k"]
		var k0 := maxi(k - 38, 1)
		var a: Vector3 = job.route[k0]
		var dir := (job.route[k0 + 2] - job.route[k0 - 1]).normalized()
		var start := a + dir.cross(Vector3.UP) * 3.0
		await _wait(start)
		bus.place(start + Vector3(0, 1.0, 0), atan2(-dir.x, -dir.z))
		bus.linear_velocity = -bus.global_transform.basis.z * 7.0
		s.cam.snap()
		var served := job.next_stop
		var route: Array = []
		for q in job.route:
			route.append(q)
		await _drive_pts(bus, route, bus.global_position, 30.0, 32.0, 0.0, st["p"], false)
		for i in 300:
			await get_tree().physics_frame
			if job.next_stop != served:
				break
		await _sec(3.5)
