extends Node
## DUSHANBE-X open-world journey test (the mandatory test of the open world request):
## the player starts in Dushanbe, gets into the existing Prado and an autopilot (pure pursuit on the
## road polylines; it only presses the same gas / brake / steering inputs as the player) drives:
##   peninsula avenue -> seam -> Rudaki avenue north through the mainland city -> M34 into the Varzob
##   gorge (bridges) -> Varzob village -> the pass road (serpentine, tunnel) -> mountain lake ->
##   descent to Gissar (serpentine) -> Gissar town (rural) -> Gissar highway back east -> Dusti avenue
##   -> Rudaki avenue south -> back to the peninsula (a different way back).
## Every physics frame checks: no teleport (position jump), the car is on the road (cross-track
## error), never under the ground, the sector under the car has collision; the route is continuous
## (every leg starts where the previous one ended).
##   godot --headless --fixed-fps 60 --path . res://tests/world_drive_test.tscn [-- legs=N]
## -> docs/reports/world_drive_test.txt

var main: Node
var s: CarSession
var car: VehiclePrado
var wd: WorldData
var lines: Array[String] = []
var ok_all := true
var route: Array[Vector3] = []
var hw: Array[float] = []
var leg_of: Array[int] = []
var legs: Array = []          ## [name, start index, end index]


func _ready() -> void:
	main = (load("res://scenes/main/main.tscn") as PackedScene).instantiate()
	add_child(main)
	var wait := 0
	while main.get("car_session") == null:
		await get_tree().physics_frame
		wait += 1
		if wait > 3000:
			print("WORLD_DRIVE FAIL: the game scene did not start")
			get_tree().quit(1)
			return
	s = main.get("car_session")
	car = s.car
	wd = WorldData.get_instance()
	for w in get_tree().get_nodes_in_group(&"weather"):
		w.set("auto_cycle", false)
		w.call("set_state", 0, true)
	_build_route()
	await _sec(1.0)
	await _drive()
	print("WORLD_DRIVE ", "ALL PASS" if ok_all else "SOME FAILED")
	var f := FileAccess.open("res://docs/reports/world_drive_test.txt", FileAccess.WRITE)
	if f:
		f.store_string("\n".join(lines) + "\n")
	get_tree().quit(0 if ok_all else 1)


func _check(msg: String, ok: bool) -> void:
	var l := ("PASS " if ok else "FAIL ") + msg
	print(l)
	lines.append(l)
	ok_all = ok_all and ok


func _sec(t: float) -> void:
	for i in int(t * 60):
		await get_tree().physics_frame


# ------------------------------------------------------------------------------------------ route
func _road(id: String) -> Dictionary:
	for r in wd.roads:
		if r["id"] == id:
			return r
	return {}


func _nearest(pts: Array, p: Vector2) -> int:
	var best := 0
	var bd := INF
	for k in pts.size():
		var d := Vector2(pts[k][0], pts[k][2]).distance_to(p)
		if d < bd:
			bd = d
			best = k
	return best


func _add(name: String, pts: Array, half: float) -> void:
	var a := route.size()
	for p in pts:
		var v := Vector3(p[0], p[1], p[2])
		if not route.is_empty() and route[route.size() - 1].distance_to(v) < 0.5:
			continue
		route.append(v)
		hw.append(half)
		leg_of.append(legs.size())
	legs.append([name, a, route.size() - 1])


## index on road A where road B comes closest, among A's points within 400 m of the hint
func _junction(A: Array, B: Array, hint: Vector2) -> int:
	var best := 0
	var bd := INF
	for i in A.size():
		var pa := Vector2(A[i][0], A[i][2])
		if pa.distance_to(hint) > 900.0:
			continue
		for j in range(0, B.size(), 2):
			var d := pa.distance_to(Vector2(B[j][0], B[j][2]))
			if d < bd:
				bd = d
				best = i
	return best


func _slice(id: String, from: Vector2, to: Vector2) -> Array:
	var r := _road(id)
	var pts: Array = r["pts"]
	var a := _nearest(pts, from)
	var b := _nearest(pts, to)
	if a <= b:
		return pts.slice(a, b + 1)
	var out := pts.slice(b, a + 1)
	out.reverse()
	return out


func _build_route() -> void:
	# peninsula: the city avenue (x = -40) from the parking spot to its north end, then the country
	# road (paths.json "av") to the seam
	var P: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://data/terrain/paths.json"))
	var av: Array = []
	for p in P["paths"]:
		if p["id"] == "av" and float(p["pts"][0][1]) < 0.0:      # the northern one (towards the mainland)
			av = p["pts"]
	var city_leg: Array = []
	for z in range(0, -330, -8):
		city_leg.append([-40.0 + 6.75, CityWorld.city_relief(-33.25, z), float(z)])   # northbound lanes (median fence ends at z -300)
	_add("Душанбе (полуостров): проспект", city_leg, 13.5)
	var ext: Array = []
	for q in av:
		if float(q[1]) > -800.0 and float(q[1]) < -345.0:
			var h := CityWorld.instance.terrain_height(q[0], q[1]) if CityWorld.instance else 0.0
			ext.append([q[0], h, q[1]])
	# merge from the avenue's northbound lanes onto the country road (manual join, interpolated)
	var j0: Array = city_leg[city_leg.size() - 1]
	var j1: Array = ext[0]
	var join: Array = []
	for k in range(1, 6):
		var t := k / 6.0
		join.append([lerpf(j0[0], j1[0], t), lerpf(j0[1], j1[1], t), lerpf(j0[2], j1[2], t)])
	_add("Загородная дорога к материку", join + ext, 13.5)
	# mainland legs: each leg runs along its road from where the previous one ended to the point
	# where it really meets the next road (junction found on the geometry, near a hint)
	var plan := [
		["Проспект Рудаки на север (материк)", "rudaki", 13.5, Vector2(-40, -4700)],
		["М34 по ущелью Варзоба", "m34", 7.0, Vector2(480, -7000)],
		["Перевальная дорога (серпантин, тоннель)", "pass", 3.75, Vector2(-3300, -7880)],
		["Озёрная дорога (западный берег)", "lake_s", 3.75, Vector2(-3850, -8150)],
		["Спуск в Гиссар (серпантин)", "lake_down", 3.75, Vector2(-4150, -5500)],
		["Гиссар — с гор в город (сельская местность)", "gissar_n", 4.0, Vector2(-4200, -2450)],
		["Гиссарская трасса на восток", "gissar", 7.0, Vector2(-1950, -2400)],
		["Проспект Дусти", "ew2400", 7.0, Vector2(-40, -2400)],
		["Проспект Рудаки на юг (другим путём)", "rudaki", 13.5, Vector2(-74, -794)],
	]
	for li in plan.size():
		var leg: Array = plan[li]
		var pts: Array = _road(leg[1])["pts"]
		var cur := route[route.size() - 1]
		var a := _nearest(pts, Vector2(cur.x, cur.z))
		var b := 0
		if li + 1 < plan.size():
			var nxt: Array = _road(plan[li + 1][1])["pts"]
			b = _junction(pts, nxt, leg[3])
		else:
			b = _nearest(pts, leg[3])
		var sl: Array
		if a <= b:
			sl = pts.slice(a, b + 1)
		else:
			sl = pts.slice(b, a + 1)
			sl.reverse()
		_add(leg[0], sl, leg[2])
	var back := ext.duplicate()
	back.reverse()
	for k in range(1, 6):
		var t := k / 6.0
		back.append([lerpf(j1[0], -46.75, t), lerpf(j1[1], CityWorld.city_relief(-46.75, -330), t), lerpf(j1[2], -330.0, t)])
	for z in range(-322, 0, 8):
		back.append([-46.75, CityWorld.city_relief(-46.75, z), float(z)])     # southbound lanes
	_add("Обратно на полуостров", back, 13.5)
	# continuity of the route (every leg starts where the previous one ended)
	var gaps := []
	for k in range(1, route.size()):
		var d := route[k].distance_to(route[k - 1])
		if d > 12.0:
			gaps.append("%.0f m at %s (%s)" % [d, str(route[k].round()), legs[leg_of[k]][0]])
	var L := 0.0
	for k in range(1, route.size()):
		L += Vector2(route[k].x - route[k - 1].x, route[k].z - route[k - 1].z).length()
	_check("route: %d legs, %.1f km, continuous (gaps > 12 m between consecutive points: %s)" % [legs.size(), L / 1000.0, str(gaps)], gaps.is_empty())


# ------------------------------------------------------------------------------------------ autopilot
func _drive() -> void:
	# get in at the parking spot (instant entry: the animated one is tested in stage 4/5 tests)
	car.place(Vector3(route[0].x, 0.0, route[0].z), 0.0)
	s.player.teleport(car.driver_door_point(1.0), 0.0)
	await _sec(1.0)
	car.fuel_l = car.tank_l          # a full tank for the 38 km journey (fuel is tested in stage 8)
	s.enter()
	await _sec(1.0)
	var idx := 0
	var t := 0.0
	var prev := car.global_position
	var jumps := 0
	var max_jump := 0.0
	var off_road := 0
	var max_xte := 0.0
	var under := 0
	var no_col := 0
	var frames := 0
	var stuck_t := 0.0
	var leg := 0
	var leg_t0 := 0.0
	var leg_res: Array[String] = []
	var max_speed := 0.0
	var dist := 0.0
	var visited := {}
	var ow: OpenWorld = main.get("open_world")
	var limit_legs := 999
	for a in OS.get_cmdline_user_args():
		if a.begins_with("legs="):
			limit_legs = int(a.substr(5))
	var end_idx: int = legs[mini(limit_legs, legs.size()) - 1][2]
	var integral := 0.0
	var recoveries := 0
	while idx < end_idx - 3 and t < 5400.0:
		await get_tree().physics_frame
		t += 1.0 / 60.0
		frames += 1
		var p := car.global_position
		var step := p.distance_to(prev)
		var v := car.linear_velocity.length()
		dist += Vector2(p.x - prev.x, p.z - prev.z).length()
		if step > v / 60.0 * 1.6 + 0.3:
			jumps += 1
		max_jump = maxf(max_jump, step - v / 60.0)
		prev = p
		max_speed = maxf(max_speed, car.speed_kmh)
		# progress along the route: nearest point within a window ahead
		var best := idx
		var bd := INF
		for k in range(idx, mini(idx + 60, route.size())):
			var d := Vector2(route[k].x - p.x, route[k].z - p.z).length()
			if d < bd:
				bd = d
				best = k
		if best > idx:
			idx = best
			stuck_t = 0.0
		else:
			stuck_t += 1.0 / 60.0
		if bd > hw[idx] + 3.0:
			off_road += 1
		max_xte = maxf(max_xte, bd - hw[idx])
		# under the ground?
		var g := wd.height_at(p.x, p.z) if wd.contains(p.x, p.z) else (CityWorld.instance.terrain_height(p.x, p.z) if CityWorld.instance else -100.0)
		if p.y < g - 2.5 and not _in_tunnel(p):
			under += 1
			if under <= 6:
				lines.append("    below the terrain at (%.0f, %.1f, %.0f): ground %.1f, leg %s" % [p.x, p.y, p.z, g, legs[leg][0]])
		if wd.contains(p.x, p.z) and not ow.is_ready_at(p):
			no_col += 1
		visited[_region(p)] = true
		# leg bookkeeping
		if leg_of[idx] != leg:
			leg_res.append("%s: %.0f s" % [legs[leg][0], t - leg_t0])
			leg = leg_of[idx]
			leg_t0 = t
		if OS.get_cmdline_user_args().has("verbose") and frames % 60 == 0:
			var cols := []
			for b in car.get_colliding_bodies():
				cols.append(String(b.name) + "/" + String(b.get_parent().name))
			print(cols, " wheels ", [car.wheels[0]["contact"], car.wheels[1]["contact"], car.wheels[2]["contact"], car.wheels[3]["contact"]], " slip ", car.slip_amount)
			print("t %.0f p %s v %.0f idx %d th %.2f br %.2f st %.2f gear %d" % [t, str(p.round()), car.speed_kmh, idx, float(VehicleInput.scripted.get("throttle", 0)) if VehicleInput.scripted else 0.0, float(VehicleInput.scripted.get("brake", 0)) if VehicleInput.scripted else 0.0, float(VehicleInput.scripted.get("steer", 0)) if VehicleInput.scripted else 0.0, car.gear])
		if stuck_t > 4.0 and stuck_t < 4.02:
			var st := PhysicsServer3D.body_get_direct_state(car.get_rid())
			for ci in st.get_contact_count():
				var sh: int = st.get_contact_collider_shape(ci)
				var obj: Object = st.get_contact_collider_object(ci)
				var fi: int = int(st.call("get_contact_collider_face_index", ci)) if st.has_method("get_contact_collider_face_index") else -1
				if obj is StaticBody3D and fi >= 0:
					var shp := ((obj as StaticBody3D).get_child(sh) as CollisionShape3D).shape
					if shp is ConcavePolygonShape3D:
						var F := (shp as ConcavePolygonShape3D).get_faces()
						print("   face ", fi, ": ", F[fi * 3].snapped(Vector3.ONE * 0.01), F[fi * 3 + 1].snapped(Vector3.ONE * 0.01), F[fi * 3 + 2].snapped(Vector3.ONE * 0.01))
				print("CONTACT ", st.get_contact_collider_object(ci).name if st.get_contact_collider_object(ci) else "?", " at ", st.get_contact_local_position(ci).snapped(Vector3.ONE * 0.01), " n ", st.get_contact_local_normal(ci).snapped(Vector3.ONE * 0.01), " car ", p.snapped(Vector3.ONE * 0.01), " fwd ", (-car.global_transform.basis.z).snapped(Vector3.ONE * 0.01))
		if stuck_t > 3.0 and fmod(stuck_t, 6.0) < 1.6:
			# like a driver who touched a wall: back up a little with the wheel the other way, then go on
			VehicleInput.scripted = {"throttle": 0.0, "brake": 0.6, "steer": -clampf(atan2((route[mini(idx + 4, route.size() - 1)] - p).dot(car.global_transform.basis.x), (route[mini(idx + 4, route.size() - 1)] - p).dot(-car.global_transform.basis.z)) * 2.0, -1.0, 1.0)}
			recoveries += 1 if fmod(stuck_t, 6.0) < 1.0 / 60.0 + 1e-3 else 0
			continue
		if stuck_t > 25.0:
			_check("autopilot stuck at %s on «%s»" % [str(p.round()), legs[leg][0]], false)
			break
		# pure pursuit
		var look := (9.0 + v * 0.9) if hw[idx] > 5.0 else (5.0 + v * 0.55)
		var tgt := idx
		var acc := 0.0
		while tgt < route.size() - 1 and acc < look:
			acc += route[tgt].distance_to(route[tgt + 1])
			tgt += 1
		var to := route[tgt] - p
		var fwd := -car.global_transform.basis.z
		var right := car.global_transform.basis.x
		var ang := atan2(to.dot(right), to.dot(fwd))
		var steer := clampf(ang * 2.2, -1.0, 1.0)
		# speed from the curvature ahead (hairpins slow), lane class
		var turn := 0.0
		var a0 := (route[mini(idx + 2, route.size() - 1)] - route[idx])
		var k2 := idx
		var acc2 := 0.0
		while k2 < route.size() - 2 and acc2 < 45.0:
			var d1 := route[k2 + 1] - route[k2]
			var d2 := route[k2 + 2] - route[k2 + 1]
			turn += absf(Vector2(d1.x, d1.z).angle_to(Vector2(d2.x, d2.z)))
			acc2 += d1.length()
			k2 += 1
		var vmax := 65.0 if hw[idx] > 6.0 else 45.0
		var vt := clampf(vmax - turn * 38.0, 14.0, vmax)
		var err := vt - car.speed_kmh
		integral = clampf(integral + err / 60.0, -20.0, 20.0)
		var th := clampf(err * 0.08 + integral * 0.02, 0.0, 1.0)
		var br := clampf(-err * 0.06, 0.0, 1.0) if err < -4.0 else 0.0
		VehicleInput.scripted = {"throttle": th, "brake": br, "steer": steer}
	leg_res.append("%s: %.0f s" % [legs[leg][0], t - leg_t0])
	VehicleInput.scripted = {"brake": 1.0}
	await _sec(2.0)
	VehicleInput.scripted = null
	var done := idx >= end_idx - 3
	_check("journey completed: %.1f km driven in %.0f min (game time), route progress %d / %d points, max %.0f km/h" % [dist / 1000.0, t / 60.0, idx, end_idx, max_speed], done)
	lines.append("    autopilot recoveries (backing up after touching a wall / kerb): %d" % recoveries)
	print("    autopilot recoveries: ", recoveries)
	_check("no teleport: %d frames with a position jump (max excess %.2f m per frame)" % [jumps, max_jump], jumps == 0)
	_check("stayed on the roads: %d of %d frames off the road surface (> 3 m beyond the edge), max %.1f m" % [off_road, frames, max_xte], off_road < frames * 0.01)
	_check("never fell through the ground: %d frames below the terrain" % under, under == 0)
	_check("streaming kept up: %d frames without loaded collision under the car" % no_col, no_col == 0)
	_check("regions crossed without borders / loading screens: %s" % str(visited.keys()), visited.size() >= 4)
	for l in leg_res:
		lines.append("    leg " + l)
		print("    leg ", l)


func _in_tunnel(p: Vector3) -> bool:
	for r in wd.roads:
		for tu in r["tunnels"]:
			var pts: Array = r["pts"]
			for k in range(int(tu[0]), int(tu[1]) + 1, 4):
				if Vector2(pts[k][0] - p.x, pts[k][2] - p.z).length() < 12.0:
					return true
	return false


func _region(p: Vector3) -> String:
	if p.z > -800.0:
		return "Душанбе (полуостров)"
	var pl := wd.place_at(p.x, p.z)
	if not pl.is_empty():
		return str(pl["name"])
	if p.y > 300.0:
		return "Горы"
	return "Сельская местность"
