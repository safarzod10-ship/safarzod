extends Node
## Stage 7 video (Movie Maker, real renderer + game sound): edited fragments (each starts with the
## vehicle placed at its start point; the cuts are editing, not gameplay):
##   1. LakLak: the player gets the job at the depot office, gets into the van, the order appears,
##      the van drives along ave. Aini (autopilot: same pedals / steering as the player)
##   2. the motorboat on the sea: full throttle, turns over the waves
##   3. the Prado on a mountain road along the steel guardrails
##   4. driving past a DushanbeCity billboard
##   5. a rounded junction with zebra crossings, the flag in the distance
##   godot --path . --write-movie out.avi --fixed-fps 30 --resolution 960x540 res://scenes/testing/stage7_video.tscn
var main: Node
var s: CarSession
var wd: WorldData
var ow: OpenWorld
var _cap: Label


func _ready() -> void:
	Wallet.no_save = true
	Wallet.laklak_hired = false
	Settings.set_mode("medium")
	main = (load("res://scenes/main/main.tscn") as PackedScene).instantiate()
	add_child(main)
	while main.get("car_session") == null or main.get("laklak") == null or (main.get("boats") as Array).size() < 2:
		await get_tree().physics_frame
	await _frames(30)
	s = main.get("car_session")
	wd = WorldData.get_instance()
	ow = main.get("open_world")
	for w in get_tree().get_nodes_in_group(&"weather"):
		w.call("set_state", 0, true)
		w.set("auto_cycle", false)
	_hour(10.5)
	var job: LakLakJob = main.get("laklak")
	var van: VehicleVan = main.get("van")
	# ---- 1. LakLak
	_caption("LakLak: устройство на работу")
	s.player.teleport(job.depot_point(LakLakJob.DEPOT_JOB_POINT) + Vector3(-3.0, 0.2, 0.0), -PI * 0.5)
	s.player.get_camera().make_current()
	await _wait(job.depot_point(LakLakJob.DEPOT_JOB_POINT))
	await _sec(1.5)
	s.player.teleport(job.depot_point(LakLakJob.DEPOT_JOB_POINT) + Vector3(0, 0.2, 0), -PI * 0.5)
	await _sec(0.8)
	job.hire()
	await _sec(3.0)
	_caption("LakLak: фургон и первый заказ")
	s.player.teleport(van.driver_door_point(1.0), 0.0)
	await _sec(0.8)
	s.enter_vehicle(van)
	await _sec(4.0)
	await _drive_road(van, "ave_e", van.global_position, 14.0, 50.0)
	s.exit()
	await _frames(5)
	# ---- 2. boat
	var bt: VehicleBoat = (main.get("boats") as Array)[0]
	_caption("Моторная лодка: море у полуострова")
	s.player.teleport(bt.global_position + bt.global_transform.basis.x * 2.0, 0.0)
	await _frames(5)
	s.enter_vehicle(bt)
	s.cam.snap()
	for i in int(14.0 * 60):
		var t := i / 60.0
		VehicleInput.scripted = {"throttle": 1.0 if t < 11.0 else 0.0, "brake": 0.0, "steer": 0.0 if t < 3.0 else (0.7 if t < 7.0 else -0.5)}
		await get_tree().physics_frame
	VehicleInput.scripted = null
	s.exit()
	await _frames(5)
	# ---- 3. guardrails (the Prado on the mountain road)
	var prado: VehiclePrado = main.get("car")
	var best: Dictionary = wd.guardrails[0]
	for g in wd.guardrails:
		if (g["p"] as Array).size() > (best["p"] as Array).size():
			best = g
	var gp: Array = best["p"]
	var q: Array = gp[0]
	_caption("Горная дорога: металлические ограждения")
	await _drive_from_point(prado, Vector3(q[0], q[1], q[2]), 12.0, 45.0)
	# ---- 4. billboard
	var bb: Dictionary = wd.billboards[2]
	_caption("Билборды банка DushanbeCity — каждый километр")
	await _drive_road(prado, str(bb["road"]), Vector3(bb["x"], bb["y"], bb["z"]), 11.0, 55.0, -160.0)
	# ---- 5. junction + flag
	var fl: Dictionary = wd.fillets[60 % wd.fillets.size()]
	_caption("Плавные улицы: скруглённые перекрёстки, зебры")
	await _drive_from_point(prado, Vector3(fl["c"][0], fl["c"][1], fl["c"][2]), 10.0, 35.0, -120.0)
	get_tree().quit()


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


func _drive_road(v: VehiclePrado, id: String, near: Vector3, secs: float, vmax: float, back := 0.0) -> void:
	await _drive_pts(v, _road_pts(id), near, secs, vmax, back)


## autopilot along road points (pure pursuit, same pedals / steering as the player), starting `back`
## metres before the point of the road nearest to `near`, in the right-hand lane
func _drive_pts(v: VehiclePrado, route: Array, near: Vector3, secs: float, vmax: float, back: float) -> void:
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
	await _wait(start)
	if not s.driving or s.car != v:
		if s.driving:
			s.exit()
		s.player.teleport(v.driver_door_point(1.0), 0.0)
		await _frames(3)
		s._select(v)
		s.enter()
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
		var to := tp - pos
		var ang := atan2(to.dot(v.global_transform.basis.x), to.dot(-v.global_transform.basis.z))
		var err := vmax - v.speed_kmh
		VehicleInput.scripted = {"throttle": clampf(err * 0.08, 0.0, 1.0), "brake": clampf(-err * 0.06, 0.0, 1.0) if err < -4.0 else 0.0,
			"steer": clampf(ang * 2.2, -1.0, 1.0)}
	VehicleInput.scripted = null
