extends Node
## 0.14 fixes, functional tests:
##  * roads vs. ground: country roads have drivable embankments (collision) down to the terrain, so a
##    car that left the road drives back onto it (the old vertical skirt had no collision: a step);
##  * fuel on a phone: taps with ANY finger (the gas pedal held by another one) reach the fuel
##    buttons / the delivery window; the buy button also shows on low fuel; entering a car with an
##    empty tank opens the window;
##  * world map: tap a place -> card «ОТПРАВИТЬСЯ» / «МАРШРУТ»; teleport on foot, in a car, to a vehicle.
##   godot --headless --fixed-fps 60 --path . res://tests/stage9_tests.tscn  -> docs/reports/stage9_tests.txt

var main: Node
var s: CarSession
var wd: WorldData
var ow: OpenWorld
var fs: FuelService
var wm: WorldMapScreen
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
	wm = main.get_node("WorldMap")
	for w in get_tree().get_nodes_in_group(&"weather"):
		w.set("auto_cycle", false)
		w.call("set_state", 0, true)
	var secs: Array = ["touch_fuel", "map", "teleport", "embankment"]
	if not OS.get_cmdline_user_args().is_empty():
		secs = Array(OS.get_cmdline_user_args())
	for sec in secs:
		await call("_t_" + sec)
	print("STAGE9_TESTS ", "ALL PASS" if ok_all else "SOME FAILED", "  (%d checks)" % n)
	var f := FileAccess.open("res://docs/reports/stage9_tests.txt", FileAccess.WRITE)
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


func _board(v: VehiclePrado) -> void:
	if s.driving:
		s.exit()
		await _frames(5)
	s.player.teleport(v.driver_door_point(0.7), 0.0)
	await _frames(20)
	s._select(v)
	s.enter()
	await _frames(5)


## a touch (finger `idx`) at a canvas point, as the phone sends it
func _touch(p: Vector2, idx: int, pressed: bool) -> void:
	var e := InputEventScreenTouch.new()
	e.index = idx
	e.pressed = pressed
	e.position = get_viewport().get_final_transform() * p
	Input.parse_input_event(e)
	Input.flush_buffered_events()
	await get_tree().process_frame


func _tap(c: Control, idx: int) -> void:
	var p := c.get_global_rect().get_center()
	await _touch(p, idx, true)
	await _frames(2)
	await _touch(p, idx, false)
	await _frames(2)


# ------------------------------------------------------------------------------------------ fuel taps
func _t_touch_fuel() -> void:
	var car: VehiclePrado = main.get("car")
	await _board(car)
	s.controls.touch_mode = true                     # as on the phone
	s.controls.visible = true
	await _frames(5)
	# the gas pedal held by finger 0 (as a driver does when the engine dies)
	var r: Rect2 = s.controls._rects()["gas"]
	await _touch(r.get_center(), 0, true)
	await _frames(3)
	_check("finger 0 holds the gas pedal (touch controls): %s" % VehicleInput.touch_gas, VehicleInput.touch_gas)
	car.fuel_l = 0.0
	car.out_of_fuel.emit()
	await _frames(5)
	_check("tank empty -> the delivery window opens", fs._panel.visible)
	fs._panel.visible = false
	await _frames(3)
	_check("window closed -> «КУПИТЬ БЕНЗИН» button shown (%s)" % fs._btn_buy.text, fs._btn_buy.visible and fs._btn_buy.text.contains("КУПИТЬ"))
	await _tap(fs._btn_buy, 1)                     # second finger: Godot emulates no mouse click for it
	_check("tap with a 2nd finger (gas held) on «КУПИТЬ» opens the window", fs._panel.visible)
	var m0 := Wallet.money
	await _tap(fs._panel_btns[0], 1)
	_check("tap «10 л» in the window: fuel %.1f l, money −%d (180)" % [car.fuel_l, m0 - Wallet.money], car.fuel_l > 9.5 and car.fuel_l <= 10.0 and m0 - Wallet.money == 180 and not fs._panel.visible)
	await _touch(r.get_center(), 0, false)
	_check("the tap did not steal the gas finger / no double purchase (money %s)" % Wallet.fmt(Wallet.money), m0 - Wallet.money == 180)
	# low fuel: the buy button is offered before the tank is dry
	car.fuel_l = car.tank_l * 0.1
	await _frames(3)
	_check("low fuel (10 %%): «%s» offered" % fs._btn_buy.text, fs._btn_buy.visible)
	car.fuel_l = car.tank_l * 0.5
	await _frames(3)
	_check("half a tank: no buy button", not fs._btn_buy.visible)
	# entering a car whose tank is empty opens the window at once
	var camry: VehiclePrado = main.get("camry")
	Wallet.money = 3000
	camry.fuel_l = 0.0
	await _board(camry)
	await _frames(5)
	_check("getting into a Camry with an empty tank opens the fuel window", fs._panel.visible)
	fs._panel_choice(2)
	_check("«full tank» from the window: Camry %.0f / %.0f l" % [camry.fuel_l, camry.tank_l], camry.fuel_l >= camry.tank_l - 0.5)
	# at a station: the fill button, tapped with finger 1
	var f: Dictionary = wd.fuel[3]
	var pump := fs.nearest_station_pos(Vector3(f["x"], f["y"], f["z"]))
	ow.preload_at(pump)
	await _frames(10)
	camry.place(pump + Vector3(0, 1, 0), 0.0)
	camry.fuel_l = 5.0
	await _sec(1.5)
	_check("at the pumps: «ЗАПРАВИТЬ» shown", fs._btn_fill.visible)
	m0 = Wallet.money
	await _tap(fs._btn_fill, 1)
	await _sec(10.0)
	_check("tap «ЗАПРАВИТЬ»: Camry filled to %.0f l, paid %s" % [camry.fuel_l, Wallet.fmt(m0 - Wallet.money)], camry.fuel_l > 50.0 and m0 > Wallet.money)
	s.controls.touch_mode = false
	s.exit()
	await _frames(10)


# ------------------------------------------------------------------------------------------ map card
func _t_map() -> void:
	wm.toggle()
	await _frames(3)
	_check("map open; the touch controls stay off under it", wm.is_open() and TouchBlock.hit(get_tree(), Vector2(600, 400)))
	var f: Dictionary = wd.fuel[5]
	wm.center = Vector2(f["x"], f["z"]) + Vector2(30, 20)
	wm.mpp = 4.0
	await _frames(2)
	var sp := wm.w2s(f["x"], f["z"])
	# a real tap on the map (finger 0 down / up at the same spot)
	await _touch(sp + Vector2(6, 4), 0, true)
	await _frames(2)
	await _touch(sp + Vector2(6, 4), 0, false)
	await _frames(2)
	_check("tap on a station on the map -> card «%s»" % wm._card_label.text.replace("\n", " · "), wm._card.visible and String(wm._sel.get("name", "")) == "АЗС")
	_check("card has «ОТПРАВИТЬСЯ» and «МАРШРУТ»", wm._btn_go.is_visible_in_tree() and wm._btn_route.is_visible_in_tree())
	# a tap on an empty spot
	wm.select_at(Vector2(40, wm._canvas.size.y - 200))
	_check("tap on an empty spot -> «%s»" % String(wm._sel["name"]), wm._card.visible and String(wm._sel["name"]) != "")
	wm.select_place("АЗС", Vector3(f["x"], f["y"], f["z"]))
	wm._btn_route.pressed.emit()
	await _frames(2)
	_check("«МАРШРУТ» sets the waypoint and closes the map", Minimap.target != Vector3.INF and not wm.is_open())


# ------------------------------------------------------------------------------------------ teleport
func _t_teleport() -> void:
	# on foot to a village far away
	var vil: Dictionary = {}
	for pl in wd.places:
		if pl["kind"] == "village" and Vector2(pl["x"], pl["z"]).length() > 5000.0:
			vil = pl
			break
	var dest := Vector3(vil["x"], 0, vil["z"])
	wm.toggle()
	wm.select_place(str(vil["name"]), dest)
	var t0 := Time.get_ticks_msec()
	wm._btn_go.pressed.emit()
	while wm.busy:
		await get_tree().process_frame
	var ms := Time.get_ticks_msec() - t0
	await _sec(2.0)
	var pp := s.player.global_position
	var d := Vector2(pp.x - dest.x, pp.z - dest.z).length()
	var g := wd.height_at(pp.x, pp.z)
	_check("ОТПРАВИТЬСЯ on foot → %s: %.0f m from the village centre (on its road), %.1f s load, map closed" % [vil["name"], d, ms / 1000.0], d < 400.0 and not wm.is_open())
	_check("landed on the ground, standing (y %.1f, terrain %.1f, on floor %s)" % [pp.y, g, s.player.is_on_floor()], s.player.is_on_floor() and absf(pp.y - g) < 3.0)
	# in the Prado to a filling station: the car comes along, upright, on the road
	var car: VehiclePrado = main.get("car")
	car.fuel_l = car.tank_l
	await _board(car)
	var f: Dictionary = wd.fuel[10]
	var fp := Vector3(f["x"], f["y"], f["z"])
	wm.toggle()
	wm.select_place("АЗС", fp)
	wm._btn_go.pressed.emit()
	while wm.busy:
		await get_tree().process_frame
	await _sec(3.0)
	var cp := car.global_position
	_check("ОТПРАВИТЬСЯ in the Prado → station: car %.0f m from it, still driving %s" % [Vector2(cp.x - fp.x, cp.z - fp.z).length(), s.driving and s.car == car],
		Vector2(cp.x - fp.x, cp.z - fp.z).length() < 80.0 and s.driving and s.car == car)
	_check("the car stands on its wheels (up %.2f, speed %.1f km/h, %d/4 wheels on ground)" % [car.global_transform.basis.y.y, car.speed_kmh, _wheels(car)],
		car.global_transform.basis.y.y > 0.9 and car.speed_kmh < 5.0 and _wheels(car) >= 3)
	VehicleInput.scripted = {"throttle": 0.7}
	await _sec(4.0)
	VehicleInput.scripted = null
	_check("drives away after the teleport (%.0f km/h)" % car.speed_kmh, car.speed_kmh > 15.0)
	VehicleInput.scripted = {"brake": 1.0}
	await _sec(3.0)
	VehicleInput.scripted = null
	# to a vehicle: on foot next to its door
	var lexus: VehiclePrado = main.get("lexus")
	wm.toggle()
	wm.select_place("Lexus RX", lexus.global_position)
	wm._btn_go.pressed.emit()
	while wm.busy:
		await get_tree().process_frame
	await _sec(1.0)
	var dl := s.player.global_position.distance_to(lexus.global_position)
	_check("ОТПРАВИТЬСЯ to the Lexus: out of the Prado, %.1f m from the Lexus, can get in %s" % [dl, s.can_enter(lexus)], not s.driving and dl < 4.0 and s.can_enter(lexus))


func _wheels(v: VehiclePrado) -> int:
	var k := 0
	for w in v.get("wheels"):
		if w.get("contact"):
			k += 1
	return k


# ------------------------------------------------------------------------------------------ embankments
## stretches where the road lies above the ground beside it (country roads: the field; city streets:
## the lawn behind the sidewalk): a Toyota Camry (smaller wheels than the Prado) on that ground drives
## at the road almost square on (70 degrees), slowly, and must end up on the carriageway
func _t_embankment() -> void:
	var car: VehiclePrado = main.get("camry")
	car.fuel_l = car.tank_l
	await _board(car)
	var cases: Array = []
	for city in [false, true]:
		var found := 0
		for r in wd.roads:
			if not r["cls"] in (["street", "avenue"] if city else ["road", "highway", "mountain"]) or r["surf"] == "dirt":
				continue
			var pts: Array = r["pts"]
			var hw := float(r["w"]) * 0.5
			var bad := {}
			for t in r["bridges"] + r["tunnels"]:
				for i in range(int(t[0]) - 12, int(t[1]) + 13):
					bad[i] = true
			var last := -999
			for k in range(20, pts.size() - 20, 5):
				if k - last < 120 or bad.has(k):
					continue
				var a := Vector3(pts[k][0], pts[k][1], pts[k][2])
				var b := Vector3(pts[k + 2][0], pts[k + 2][1], pts[k + 2][2])
				var dir := (b - a).normalized()
				var right := dir.cross(Vector3.UP).normalized()
				var in_city := absf(a.x) < 2000.0 and a.z < -950.0 and a.z > -4800.0
				if in_city != city:
					continue
				var off := hw + (3.5 + 9.0 if city else 14.0)
				var out := a + right * off
				var drop := a.y - wd.height_at(out.x, out.z)
				var slope := absf(wd.height_at(out.x + 6, out.z) - wd.height_at(out.x - 6, out.z)) + absf(wd.height_at(out.x, out.z + 6) - wd.height_at(out.x, out.z - 6))
				if drop > (0.2 if city else 0.5) and drop < 2.5 and slope < 2.5 and wd.road_edge_dist(out.x, out.z) > off - 2.0:
					cases.append([("город " if city else "") + str(r["id"]), a, dir, right, hw, drop, off])
					last = k
					found += 1
				if found >= 14:
					break
			if found >= 14:
				break
	_check("found %d stretches with the road above the ground beside it (country + city)" % cases.size(), cases.size() >= 12)
	var tried := 0
	var passed := 0
	for c in cases:
		var a: Vector3 = c[1]
		var dir: Vector3 = c[2]
		var right: Vector3 = c[3]
		var hw: float = c[4]
		var start := a + right * (float(c[6]) + 2.0)
		ow.hold = a
		ow.preload_at(a)
		await _frames(5)
		# nothing (a house, a wall, a tree trunk, a lamp post) between the start and the road
		var g := wd.height_at(start.x, start.z)
		var space := car.get_world_3d().direct_space_state
		var q := PhysicsRayQueryParameters3D.create(Vector3(start.x, maxf(g, a.y) + 1.0, start.z), a + right * (hw - 1.0) + Vector3(0, 1.0, 0), 1, [car.get_rid()])
		if not space.intersect_ray(q).is_empty():
			continue
		var head := (-right * 0.94 + dir * 0.34).normalized()
		# the whole car's path (a 2.2 x 1 x 4.8 box 0.4 .. 1.4 m over the road level) must be clear
		var box := BoxShape3D.new()
		box.size = Vector3(2.2, 1.0, 4.8)
		var sq := PhysicsShapeQueryParameters3D.new()
		sq.shape = box
		sq.collision_mask = 1
		sq.exclude = [car.get_rid()]
		sq.transform = Transform3D(Basis(Vector3.UP, atan2(-head.x, -head.z)), Vector3(start.x, maxf(g, a.y) + 0.9, start.z))
		sq.motion = head * ((float(c[6]) + 2.0 - hw + 2.0) / 0.94)
		var cm := space.cast_motion(sq)
		if cm.size() == 2 and cm[0] < 1.0:
			print("   %s %s: path blocked (a post / tree / house) - skipped" % [c[0], str(a.round())])
			continue
		var gh := space.intersect_ray(PhysicsRayQueryParameters3D.create(Vector3(start.x, g + 30.0, start.z), Vector3(start.x, g - 30.0, start.z), 1, [car.get_rid()]))
		if gh.is_empty() or not str(gh.collider.name).contains("Terrain"):
			print("   %s %s: the start spot is in a yard / building - skipped" % [c[0], str(a.round())])
			continue
		car.place(start, atan2(-head.x, -head.z))
		await _sec(1.0)
		if car.wheels_on_ground < 3 or car.speed_kmh > 3.0:
			print("   %s %s: the start spot is not flat ground (trees / a hollow) - skipped" % [c[0], str(a.round())])
			continue
		var on_road := false
		var t := 0.0
		var wall := ""
		while t < 14.0:
			VehicleInput.scripted = {"throttle": 0.45, "steer": 0.0}
			await get_tree().physics_frame
			t += 1.0 / 60.0
			var lat := (car.global_position - a).dot(right)
			if t > 2.0 and car.speed_kmh < 0.5 and int(t * 60) % 60 == 0:
				var hits: Array = []
				for bd in car.get_colliding_bodies():
					var nm := str(bd.get_parent().name if bd.get_parent() else "") + "/" + str(bd.name)
					hits.append(nm)
					if not nm.contains("WorldRoad") and not nm.contains("WorldTerrain"):
						wall = nm
				print("      stuck against: ", hits)
				if wall != "":
					break
			if lat < hw - 1.5 and lat > -hw:
				on_road = true
				break
		VehicleInput.scripted = {"brake": 1.0}
		await _sec(1.0)
		VehicleInput.scripted = null
		if wall != "":
			print("   %s %s: a wall / fence (%s) between the lawn and the road - skipped" % [c[0], str(a.round()), wall])
			continue
		tried += 1
		if on_road and car.global_transform.basis.y.y > 0.8:
			passed += 1
		print("   %s %s: road %.2f m above the ground, back on the road %s (%.1f s)" % [c[0], str(a.round()), c[5], on_road, t])
		if tried >= 10:
			break
	_check("Camry drives from the ground beside the road back onto it (square on, slowly): %d / %d stretches" % [passed, tried], tried >= 6 and passed == tried)
	ow.hold = Vector3.INF
	s.exit()
