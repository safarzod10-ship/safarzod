extends Node
## Stage 7 functional tests: imported models (CC-BY), DushanbeCity billboards every kilometre,
## guardrails, road-pack props, the national flag, curved city streets with rounded junctions and
## zebra crossings, the grass palette + 3D grass in the open world, the LakLak van (drives, can be
## boarded), the LakLak delivery job (hire -> order -> delivery -> money), the motorboat (floats,
## drives, steers, can be boarded), parked vehicles frozen far away. Runs in the REAL game scene.
##   godot --headless --fixed-fps 60 --path . res://tests/stage7_tests.tscn  -> docs/reports/stage7_tests.txt

var main: Node
var s: CarSession
var wd: WorldData
var ow: OpenWorld
var lines: Array[String] = []
var ok_all := true
var n := 0


func _ready() -> void:
	Wallet.no_save = true
	main = (load("res://scenes/main/main.tscn") as PackedScene).instantiate()
	add_child(main)
	var t0 := Time.get_ticks_msec()
	while (main.get("car_session") == null or main.get("laklak") == null or (main.get("boats") as Array).size() < 1) and Time.get_ticks_msec() - t0 < 60000:
		await get_tree().physics_frame
	await _frames(30)
	s = main.get("car_session")
	wd = WorldData.get_instance()
	ow = main.get("open_world")
	for w in get_tree().get_nodes_in_group(&"weather"):
		w.set("auto_cycle", false)
		w.call("set_state", 0, true)
	for sec in ["models", "billboards", "guardrails", "streets", "flag", "grass", "van", "job", "boat", "freeze"]:
		await call("_t_" + sec)
	print("STAGE7_TESTS ", "ALL PASS" if ok_all else "SOME FAILED", "  (%d checks)" % n)
	var f := FileAccess.open("res://docs/reports/stage7_tests.txt", FileAccess.WRITE)
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
	await _frames(int(t * Engine.physics_ticks_per_second))


func _wait_sectors(p: Vector3) -> void:
	ow.preload_at(p)
	for i in 400:
		await get_tree().process_frame
		if ow._jobs.is_empty() and ow._results.is_empty() and i > 30:
			break


# ------------------------------------------------------------------------------------------ models
func _t_models() -> void:
	var miss := []
	var tris := {}
	for k in ["sky", "villa1", "villa2", "villa3", "villa4", "billboard", "guardrail", "flag", "laklak", "rp_lamp_a", "rp_bench"]:
		var p := WorldModels.parts(k)
		if p.is_empty():
			miss.append(k)
		var a := WorldModels.aabb(k)
		tris[k] = a.size.snapped(Vector3.ONE * 0.1)
	_check("imported models load and are placed by size: %s missing %s" % [str(tris), str(miss)], miss.is_empty())
	var sky := WorldModels.aabb("sky")
	var v4 := WorldModels.aabb("villa4")
	_check("model scale: skyscraper %.0f m high (110..120), villa 4 %.1f x %.1f m footprint (36.8 x 22.1)" % [sky.size.y, v4.size.x, v4.size.z],
		sky.size.y > 110.0 and sky.size.y < 120.0 and absf(v4.size.x - 36.8) < 1.0 and absf(v4.size.z - 22.1) < 1.0)
	var kinds := {}
	for b in wd.buildings:
		var k: String = b[0]
		if k == "sky" or k.begins_with("villa"):
			kinds[k] = int(kinds.get(k, 0)) + 1
	_check("skyscrapers and villas in the world: %s" % str(kinds), int(kinds.get("sky", 0)) >= 3 and kinds.size() >= 4)
	var cred := FileAccess.file_exists("res://docs/CREDITS.md") and FileAccess.get_file_as_string("res://docs/CREDITS.md").contains("CC-BY")
	_check("CC-BY 4.0 attribution of every imported model in docs/CREDITS.md", cred)


# ------------------------------------------------------------------------------------------ billboards
func _t_billboards() -> void:
	var nb := wd.billboards.size()
	var km := 0.0
	for r in wd.roads:
		if r["cls"] in ["lane", "dirt"]:
			continue
		var pts: Array = r["pts"]
		for k in pts.size() - 1:
			km += Vector2(float(pts[k + 1][0]) - float(pts[k][0]), float(pts[k + 1][2]) - float(pts[k][2])).length() / 1000.0
	_check("advertising billboards: %d along %.0f km of roads (one per km: >= 70 %% of the whole kilometres; dense city streets leave no room for a 15 m board)" % [nb, km], nb >= int(km * 0.7))
	# spacing along each road
	var by_road := {}
	for b in wd.billboards:
		if not by_road.has(b["road"]):
			by_road[b["road"]] = []
		by_road[b["road"]].append(Vector3(b["x"], b["y"], b["z"]))
	var too_close := 0
	for rid in by_road:
		var arr: Array = by_road[rid]
		for i in arr.size():
			for j in range(i + 1, arr.size()):
				if (arr[i] as Vector3).distance_to(arr[j]) < 450.0:
					too_close += 1
	_check("billboards ~1 km apart on each road: %d pairs closer than 450 m" % too_close, too_close == 0)
	var on_road := 0
	for b in wd.billboards:
		if wd.road_edge_dist(float(b["x"]), float(b["z"])) < 3.0:
			on_road += 1
	_check("no billboard stands on a road (edge distance >= 3 m): %d violations" % on_road, on_road == 0)
	# one billboard in the scene: model + poster with the DushanbeCity ad + collision
	var bb: Dictionary = wd.billboards[0]
	var p := Vector3(bb["x"], bb["y"], bb["z"])
	var bcam := Camera3D.new()
	add_child(bcam)
	bcam.global_position = p + Vector3(0, 12, 30)
	bcam.make_current()
	await _wait_sectors(p)
	var node: Node3D = null
	for b2 in get_tree().get_nodes_in_group(&"billboard"):
		if (b2 as Node3D).global_position.distance_to(p) < 1.0:
			node = b2
	var poster: MeshInstance3D = node.get_node_or_null("Poster") if node else null
	var tex: Texture2D = null
	if poster:
		tex = (poster.material_override as ShaderMaterial).get_shader_parameter("poster")
	_check("billboard in the scene with an advertising banner (%s)" % (tex.resource_path if tex else "none"), tex != null and tex.resource_path.contains("/ads/ad_"))
	var used := {}
	for i in wd.billboards.size():
		used[WorldModels.ADS[i % WorldModels.ADS.size()]] = true
	_check("all 4 banners (DCnext, Orienbank, LakLak, Eskhata) are on the roads: %d of %d used" % [used.size(), WorldModels.ADS.size()], used.size() == 4)
	await _frames(3)
	var space := (main as Node3D).get_world_3d().direct_space_state
	var hit := space.intersect_ray(PhysicsRayQueryParameters3D.create(p + Vector3(-3, 2, 0.1), p + Vector3(3, 2, 0.1)))
	_check("billboard post has collision (a car stops at it): %s" % (str(hit.get("collider", null)) if not hit.is_empty() else "no hit"), not hit.is_empty())
	bcam.queue_free()


# ------------------------------------------------------------------------------------------ guardrails
func _t_guardrails() -> void:
	var L := 0.0
	var off := 0
	var cnt := 0
	for g in wd.guardrails:
		var pts: Array = g["p"]
		for k in pts.size() - 1:
			L += Vector2(float(pts[k + 1][0]) - float(pts[k][0]), float(pts[k + 1][2]) - float(pts[k][2])).length()
		for q in pts:
			cnt += 1
			var e := wd.road_edge_dist(float(q[0]), float(q[2]))
			if e < 0.3 or e > 3.0:
				off += 1
	_check("steel guardrails along drops of country / mountain roads: %.1f km in %d runs" % [L / 1000.0, wd.guardrails.size()], L > 8000.0)
	_check("guardrails stand just outside the carriageway (0.3 .. 3 m from the edge): %d of %d points off" % [off, cnt], off <= cnt / 50)
	# collision: a ray across the guardrail hits it
	var g0: Array = (wd.guardrails[wd.guardrails.size() / 2] as Dictionary)["p"]
	var a: Array = g0[g0.size() / 2]
	var b: Array = g0[g0.size() / 2 + 1]
	var pa := Vector3(a[0], a[1], a[2])
	var d := (Vector3(b[0], b[1], b[2]) - pa).normalized()
	var nrm := Vector3(-d.z, 0, d.x)
	var cam := Camera3D.new()
	add_child(cam)
	cam.global_position = pa + Vector3(0, 5, 0)
	cam.make_current()
	await _wait_sectors(pa)
	await _frames(5)
	var space := (main as Node3D).get_world_3d().direct_space_state
	var hit := space.intersect_ray(PhysicsRayQueryParameters3D.create(pa + nrm * 2.0 + Vector3(0, 0.45, 0), pa - nrm * 2.0 + Vector3(0, 0.45, 0)))
	_check("guardrail collision across the barrier: %s" % (String((hit["collider"] as Node).name) if not hit.is_empty() else "no hit"), not hit.is_empty())
	cam.queue_free()


# ------------------------------------------------------------------------------------------ streets
func _t_streets() -> void:
	var ring: Dictionary = {}
	var curved := 0
	var city := 0
	for r in wd.roads:
		if r["id"] == "ring":
			ring = r
		var pts: Array = r["pts"]
		if absf(float(pts[0][0])) < 2600.0 and float(pts[0][2]) < -900.0 and float(pts[0][2]) > -5000.0 and r["cls"] in ["avenue", "highway", "street"] and pts.size() > 50:
			city += 1
			var a := Vector2(pts[0][0], pts[0][2])
			var b := Vector2(pts[pts.size() - 1][0], pts[pts.size() - 1][2])
			var dmax := 0.0
			for q in pts:
				var p := Vector2(q[0], q[2])
				var t := clampf((p - a).dot(b - a) / maxf((b - a).length_squared(), 1.0), 0.0, 1.0)
				dmax = maxf(dmax, p.distance_to(a + (b - a) * t))
			if dmax > 20.0:
				curved += 1
	_check("city streets follow curves (not ruler-straight): %d of %d deviate > 20 m from their chord" % [curved, city], curved >= city * 0.6)
	var pts2: Array = ring["pts"]
	var max_turn := 0.0
	for k in range(1, pts2.size() - 1):
		var d1 := Vector2(float(pts2[k][0]) - float(pts2[k - 1][0]), float(pts2[k][2]) - float(pts2[k - 1][2]))
		var d2 := Vector2(float(pts2[k + 1][0]) - float(pts2[k][0]), float(pts2[k + 1][2]) - float(pts2[k][2]))
		if d1.length() > 0.5 and d2.length() > 0.5:
			max_turn = maxf(max_turn, rad_to_deg(absf(d1.angle_to(d2))))
	_check("ring road has no square corners: max turn between 4 m segments %.1f deg (< 8)" % max_turn, max_turn < 8.0)
	_check("rounded kerb corners at city junctions: %d, zebra crossings: %d" % [wd.fillets.size(), wd.crossings.size()], wd.fillets.size() >= 200 and wd.crossings.size() >= 200)
	# a fillet in the scene: drivable asphalt (collision) inside the rounded corner
	var fl: Dictionary = wd.fillets[wd.fillets.size() / 3]
	var c := Vector3(fl["c"][0], fl["c"][1], fl["c"][2])
	var o := Vector3(fl["o"][0], fl["c"][1], fl["o"][1])
	var inner := c + (o - c) * 0.12
	var cam := Camera3D.new()
	add_child(cam)
	cam.global_position = c + Vector3(0, 10, 0)
	cam.make_current()
	await _wait_sectors(c)
	await _frames(5)
	var space := (main as Node3D).get_world_3d().direct_space_state
	var hit := space.intersect_ray(PhysicsRayQueryParameters3D.create(inner + Vector3(0, 3, 0), inner + Vector3(0, -3, 0)))
	var on_road := not hit.is_empty() and String((hit["collider"] as Node).name) == "WorldRoad" and absf((hit["position"] as Vector3).y - c.y) < 0.3
	_check("rounded corner is drivable road surface (WorldRoad at %.2f m, junction %.2f m)" % [(hit.get("position", Vector3.ZERO) as Vector3).y, c.y], on_road)
	var zebra := false
	for z in get_tree().root.find_children("Zebra", "MeshInstance3D", true, false):
		if (z as Node3D).is_visible_in_tree():
			zebra = true
	_check("zebra crossings rendered in the loaded city sectors", zebra)
	cam.queue_free()


# ------------------------------------------------------------------------------------------ flag
func _t_flag() -> void:
	var fl: Dictionary = {}
	for l in wd.landmarks:
		if l["id"] == "flag":
			fl = l
	var p := Vector3(fl["x"], fl["y"], fl["z"])
	var cam := Camera3D.new()
	add_child(cam)
	cam.global_position = p + Vector3(0, 20, 120)
	cam.make_current()
	await _wait_sectors(p)
	var nf: Node3D = null
	for x in get_tree().root.find_children("NationalFlag", "Node3D", true, false):
		nf = x
	var h := 0.0
	var waving := false
	if nf:
		for mi in nf.find_children("*", "MeshInstance3D", true, false):
			var m := mi as MeshInstance3D
			var bb := m.global_transform * m.get_aabb()
			h = maxf(h, bb.end.y - p.y)
			if m.material_override is ShaderMaterial:
				waving = true
	_check("national flag of Tajikistan (imported model) at the Flag park: %.0f m high (>= 140), cloth waving: %s" % [h, waving], h >= 140.0 and waving)
	cam.queue_free()


# ------------------------------------------------------------------------------------------ grass
func _t_grass() -> void:
	var on_road := 0
	for r in wd.roads.slice(0, 8):
		var pts: Array = r["pts"]
		for k in range(0, pts.size(), 25):
			if wd.grass_ok(float(pts[k][0]), float(pts[k][2])):
				on_road += 1
	_check("no 3D grass on roads (grass_ok on road centre lines): %d" % on_road, on_road == 0)
	var gp := Vector3.INF
	for r in range(0, 1200, 20):
		for k in 16:
			var q := Vector3(300, 0, -2000) + Vector3(cos(TAU * k / 16.0), 0, sin(TAU * k / 16.0)) * r
			if gp == Vector3.INF and wd.grass_ok(q.x, q.z) and wd.road_edge_dist(q.x, q.z) > 12.0:
				gp = q
	gp.y = wd.height_at(gp.x, gp.z)
	var gf: GrassField = main.get_node("Grass")
	gf.rebuild(gp)
	var cnt := gf._mmi.multimesh.instance_count
	_check("3D grass grows on open-world lawns (%d clumps around %s)" % [cnt, str(gp.round())], cnt > 300)
	var sh: Shader = load("res://assets/shaders/world_terrain.gdshader")
	var src := sh.code
	_check("terrain / lawn shaders use the natural palette (#557A3B #668B45 #9A9255 #354D2C #829B54 via grass_palette)",
		src.contains("grass_palette") and FileAccess.get_file_as_string("res://assets/shaders/grass_palette.gdshaderinc").contains("#557A3B")
		and (load("res://assets/shaders/city_pbr.gdshader") as Shader).code.contains("grass_palette")
		and (load("res://assets/shaders/terrain.gdshader") as Shader).code.contains("grass_palette"))
	var dens := []
	for q in 4:
		Settings.set_mode(["low", "medium", "high", "ultra"][q])
		dens.append([Settings.get_value("grass_radius"), Settings.get_value("grass_density")])
	Settings.set_mode("medium")
	_check("grass cost scales with the preset (radius, density per Low..Ultra): %s" % str(dens), float(dens[0][0]) < float(dens[3][0]))


# ------------------------------------------------------------------------------------------ van
func _t_van() -> void:
	var van: VehicleVan = main.get("van")
	_check("LakLak van spawned at the depot", van != null)
	if van == null:
		return
	var blue := false
	var logos := 0
	for k in van._mat_cache:
		if String(k).contains("body"):
			var t: Texture2D = (van._mat_cache[k] as ShaderMaterial).get_shader_parameter("albedo_tex")
			blue = t != null and t.resource_path.contains("van_body_blue")
	for mi in van.find_children("LakLakLogo*", "MeshInstance3D", true, false):
		logos += 1
	_check("van painted LakLak blue + LakLak logo on both sides and the rear (%d logos)" % logos, blue and logos == 3)
	_check("van has 4 wheels on the ground after spawning (%d)" % van.wheels_on_ground, van.wheels.size() == 4 and van.wheels_on_ground == 4)
	# board it: player next to the driver's door (the player's camera follows: sectors stay loaded)
	s.player.teleport(van.driver_door_point(0.7), 0.0)
	s.player.get_camera().make_current()
	await _wait_sectors(van.global_position)
	await _frames(40)
	var can := s.can_enter(van)
	s.enter_vehicle(van)
	await _sec(2.5)
	_check("player can get into the van (can_enter %s, driving %s, car = van %s)" % [can, s.driving, s.car == van], can and s.driving and s.car == van)
	# drive on the avenue next to the depot (ave. Aini), along the road
	var av: Dictionary = {}
	for r in wd.roads:
		if r["id"] == "ave_e":
			av = r
	var apts: Array = av["pts"]
	var bk := 0
	var bd := INF
	for k in apts.size():
		var d := Vector2(float(apts[k][0]) - van.global_position.x, float(apts[k][2]) - van.global_position.z).length()
		if d < bd:
			bd = d
			bk = k
	bk = clampi(bk, 0, apts.size() - 60)
	var a0 := Vector3(apts[bk][0], apts[bk][1], apts[bk][2])
	var a1 := Vector3(apts[bk + 5][0], apts[bk + 5][1], apts[bk + 5][2])
	var start := a0 + (a1 - a0).normalized().cross(Vector3.UP) * 3.5
	await _wait_sectors(start)
	van.place(start + Vector3(0, 1.0, 0), atan2(-(a1.x - a0.x), -(a1.z - a0.z)))
	await _sec(1.0)
	var p0 := van.global_position
	VehicleInput.scripted = {"throttle": 1.0, "brake": 0.0, "steer": 0.0}
	await _sec(6.0)
	var v1 := van.speed_kmh
	var yaw0 := van.global_rotation.y
	VehicleInput.scripted = {"throttle": 0.4, "brake": 0.0, "steer": 0.6}
	await _sec(2.0)
	var dyaw := absf(wrapf(van.global_rotation.y - yaw0, -PI, PI))
	VehicleInput.scripted = {"throttle": 0.0, "brake": 1.0, "steer": 0.0}
	var vmin := INF
	for i in 240:
		await get_tree().physics_frame
		vmin = minf(vmin, van.speed_kmh)
	VehicleInput.scripted = null
	_check("van drives: %.0f km/h after 6 s full throttle (> 35), turns %.0f deg in 2 s, moved %.0f m, brakes to %.1f km/h" % [v1, rad_to_deg(dyaw), van.global_position.distance_to(p0), vmin],
		v1 > 35.0 and dyaw > 0.3 and vmin < 3.0)


# ------------------------------------------------------------------------------------------ job
func _t_job() -> void:
	var job: LakLakJob = main.get("laklak")
	var van: VehicleVan = main.get("van")
	Wallet.laklak_hired = false
	Wallet.money = 0
	# leave the van, walk to the office door, interact
	VehicleInput.scripted = null
	s.exit()
	await _frames(10)
	s.player.teleport(job.depot_point(LakLakJob.DEPOT_JOB_POINT) + Vector3(0, 0.2, 0), 0.0)
	await _sec(0.6)
	var office: Node = job.get_node("LakLakOffice")
	var lbl := String(office.call("interaction_label", s.player))
	var it: CharacterInteraction = s.player.get("interaction")
	await _sec(0.3)
	var cur_is_office := it != null and it.current == office
	_check("office door is an interactable: «%s», selected by the player: %s" % [lbl, cur_is_office], lbl == "УСТРОИТЬСЯ В LAKLAK" and cur_is_office)
	if it:
		it.trigger()
	await _frames(5)
	_check("hired by LakLak (Wallet.laklak_hired)", Wallet.laklak_hired)
	# into the van -> an order
	s.player.teleport(van.driver_door_point(0.7), 0.0)
	await _frames(40)
	s.enter_vehicle(van)
	await _sec(2.5)
	await _frames(5)
	var has_order := not job.order.is_empty()
	var dest: Vector3 = job.order.get("dest", Vector3.INF)
	var dist := van.global_position.distance_to(dest) if has_order else 0.0
	_check("order assigned on getting into the van: %s, %.0f m away, pay %s, beacon + map target %s" % [job.order.get("addr", "-"), dist, Wallet.fmt(int(job.order.get("pay", 0))), Minimap.target != Vector3.INF],
		has_order and dist > 400.0 and dist < 2800.0 and Minimap.target == dest)
	# deliver: the van is put next to the drop-off (job logic test, not a driving test) and stopped
	var pay := int(job.order.get("pay", 0))
	if not has_order:
		_check("delivery completes (no order)", false)
		return
	await _wait_sectors(dest)
	van.place(dest + Vector3(2.0, 0, 0), van.global_rotation.y)
	await _sec(1.5)
	_check("delivery completes when the van stops at the drop-off: money %s (pay %s + bonus), deliveries %d, next order %s" % [Wallet.fmt(Wallet.money), Wallet.fmt(pay), Wallet.deliveries, not job.order.is_empty()],
		Wallet.money >= pay and Wallet.deliveries >= 1)
	s.exit()
	await _frames(10)


# ------------------------------------------------------------------------------------------ boat
func _t_boat() -> void:
	var boats: Array = main.get("boats")
	_check("motorboats placed: %d (sea + lakes)" % boats.size(), boats.size() >= 2)
	var bt: VehicleBoat = boats[0]
	var cam := Camera3D.new()
	add_child(cam)
	cam.global_position = bt.global_position + Vector3(0, 6, 12)
	cam.make_current()
	await _sec(5.0)
	var lvl := VehicleBoat.water_level_at(bt.global_position.x, bt.global_position.z)
	var tilt := rad_to_deg(acos(clampf(bt.global_transform.basis.y.dot(Vector3.UP), -1.0, 1.0)))
	_check("boat floats: %.2f m above the water surface (|..| < 0.5), tilt %.1f deg (< 12), in water %s" % [bt.global_position.y - lvl, tilt, bt.in_water],
		absf(bt.global_position.y - lvl) < 0.5 and tilt < 12.0 and bt.in_water)
	# board from the water's edge: player swims / stands next to the hull
	s.player.teleport(bt.global_position + bt.global_transform.basis.x * 2.2 + Vector3(0, 0.3, 0), 0.0)
	await _frames(15)
	var can := s.can_enter(bt)
	print("boat board: player ", s.player.global_position, " boat ", bt.global_position, " driving ", s.driving, " busy ", s.busy, " speed ", bt.speed_kmh)
	s.enter_vehicle(bt)
	await _frames(10)
	_check("player boards the boat (can_enter %s, driving %s)" % [can, s.driving and s.car == bt], can and s.driving and s.car == bt)
	var p0 := bt.global_position
	VehicleInput.scripted = {"throttle": 1.0, "brake": 0.0, "steer": 0.0}
	await _sec(8.0)
	var v := bt.speed_kmh
	var yaw0 := bt.global_rotation.y
	VehicleInput.scripted = {"throttle": 0.8, "brake": 0.0, "steer": 1.0}
	await _sec(3.0)
	var dyaw := absf(wrapf(bt.global_rotation.y - yaw0, -PI, PI))
	var lvl2 := VehicleBoat.water_level_at(bt.global_position.x, bt.global_position.z)
	var float_ok := is_nan(lvl2) or absf(bt.global_position.y - lvl2) < 0.8
	VehicleInput.scripted = {"throttle": 0.0, "brake": 0.0, "steer": 0.0}
	await _sec(6.0)
	var v_coast := bt.speed_kmh
	VehicleInput.scripted = null
	_check("boat drives: %.0f km/h after 8 s (> 25), %.0f m, turns %.0f deg in 3 s, stays afloat %s, slows down by itself (%.0f km/h)" % [v, bt.global_position.distance_to(p0), rad_to_deg(dyaw), float_ok, v_coast],
		v > 25.0 and dyaw > 0.6 and float_ok and v_coast < v)
	s.exit()
	await _frames(10)
	_check("getting off the boat: player in the scene again (%s)" % str(s.player.global_position.round()), not s.driving and s.player.visible)
	cam.queue_free()


# ------------------------------------------------------------------------------------------ freeze
func _t_freeze() -> void:
	var prado: VehiclePrado = main.get("car")
	var cam := Camera3D.new()
	add_child(cam)
	cam.global_position = prado.global_position + Vector3(0, 50, 900)
	cam.make_current()
	await _sec(1.2)
	var frozen := prado.freeze
	cam.global_position = prado.global_position + Vector3(0, 3, 8)
	await _sec(1.2)
	_check("parked vehicles sleep far from the camera (frozen at 900 m: %s, awake near: %s)" % [frozen, not prado.freeze], frozen and not prado.freeze)
	cam.queue_free()
