extends "res://scripts/testing/stage8_views.gd"
## 0.14 screenshots: the road edge (country embankment, city lawn -> sidewalk slope), the fuel buttons
## on the phone layout, the map card «ОТПРАВИТЬСЯ».
##   xvfb-run godot --path . --resolution 1600x900 res://scenes/testing/stage9_views.tscn -- out=<dir> [tag=old]
var tag := "new"


func _ready() -> void:
	for a in OS.get_cmdline_user_args():
		if a.begins_with("out="):
			out = a.substr(4)
		if a.begins_with("tag="):
			tag = a.substr(4)
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
	if OS.get_cmdline_user_args().has("map"):
		_ui(true)
		var wm: WorldMapScreen = main.get_node("WorldMap")
		wm.toggle()
		wm.center = Vector2(0, -4600)
		wm.mpp = 9.0
		await get_tree().create_timer(1.0).timeout
		await _snap("map_overview")
		wm.center = Vector2(200, -3000)
		wm.mpp = 3.0
		await get_tree().create_timer(0.5).timeout
		await _snap("map_city")
		get_tree().quit()
		return
	if OS.get_cmdline_user_args().has("dealer"):
		_hour(16.0)
		var dl: CarDealer = main.get_node("CarDealer")
		var ow3: OpenWorld = main.get("open_world")
		ow3.hold = dl.global_position
		await _sec(5.0)
		var t := dl.global_transform
		for br in ["mb", "bmw"]:
			var d2: CarDealer = main.get_node_or_null("CarDealer_" + br)
			if d2:
				var t2 := d2.global_transform
				await _look("dealer_%s" % br, t2 * Vector3(22, 13, 4), t2 * Vector3(0, 4, 0))
				await _look("dealer_%s_in" % br, t2 * Vector3(6.5, 2.0, 12.0), t2 * Vector3(-4, 1.5, -6))
		await _look("dealer_front", t * Vector3(38, 6, 14), t * Vector3(0, 5, 0))
		await _look("dealer_wide", t * Vector3(46, 18, -30), t * Vector3(4, 3, 0))
		await _look("dealer_inside", t * Vector3(6.5, 2.0, 12.0), t * Vector3(-4, 1.5, -6))
		await _look("dealer_wall", t * Vector3(5.0, 2.2, 0.0), t * Vector3(-8, 2.6, 0))
		get_tree().quit()
		return
	if OS.get_cmdline_user_args().has("wash"):
		_hour(13.0)
		var w0: Dictionary = wd.washes[0]
		var wp := Vector3(float(w0["ox"]), wd.height_at(float(w0["ox"]), float(w0["oz"])), float(w0["oz"]))
		var wb := Basis(Vector3.UP, float(w0["yaw"]))
		var sw: CarSession = main.get("car_session")
		sw.player.teleport(wp + wb * Vector3(10, 0.5, 6), 0.0)
		await _sec(4.0)
		await _look("wash_street", wp + wb * Vector3(45, 9, 22), wp + wb * Vector3(4, 1, 0))
		await _look("wash_top", wp + Vector3(0, 75, 0) + wb * Vector3(14, 0, 0), wp + wb * Vector3(14, 0, 0))
		get_tree().quit()
		return
	if OS.get_cmdline_user_args().has("survey"):
		# eye-level views at the kerb of random city streets, both directions + a low aerial
		_hour(13.0)
		var rng9 := RandomNumberGenerator.new()
		rng9.seed = 77
		var rds: Array = []
		for r9 in wd.roads:
			if String(r9["cls"]) in ["avenue", "street"] and not String(r9.get("id", "")).begins_with("drive"):
				rds.append(r9)
		var shots := 0
		for k9 in 40:
			if shots >= 10:
				break
			var r9: Dictionary = rds[rng9.randi() % rds.size()]
			var pts9: Array = r9["pts"]
			var i9 := rng9.randi_range(2, pts9.size() - 3)
			var p9 := Vector3(pts9[i9][0], pts9[i9][1], pts9[i9][2])
			if absf(p9.x) > 2000.0 or p9.z > -1000.0 or p9.z < -4800.0:
				continue
			var q9 := Vector3(pts9[i9 + 2][0], pts9[i9 + 2][1], pts9[i9 + 2][2])
			var d9 := (q9 - p9).normalized()
			var s9 := d9.cross(Vector3.UP)
			var hw9 := float(r9["w"]) * 0.5
			ow.hold = p9
			ow.preload_at(p9)
			await _sec(2.0)
			await _look("survey_%d_side" % shots, p9 + s9 * (hw9 + 1.6) + Vector3(0, 1.7, 0), p9 + s9 * (hw9 + 8.0) + d9 * 25.0 + Vector3(0, 1.0, 0))
			await _look("survey_%d_air" % shots, p9 - d9 * 25.0 + s9 * 20.0 + Vector3(0, 22, 0), p9)
			shots += 1
		get_tree().quit()
		return
	if OS.get_cmdline_user_args().has("dusti"):
		_hour(17.0)
		var ppd: PhotoPlaces = main.get_node("PhotoPlaces")
		var site: Dictionary = {}
		for st in ppd.sites:
			if st["id"] == "city_park":
				site = st
		var xfp: Transform3D = site["xf"]
		var snd: CarSession = main.get("car_session")
		snd.player.teleport(xfp * Vector3(0, 1, 70), 0.0)
		ow.hold = xfp.origin
		ow.preload_at(xfp.origin)
		await _sec(3.0)
		if site["node"] == null:
			ppd.build_site(site)
		await _sec(2.0)
		for k in 8:
			var a := k * TAU / 8.0
			await _look("dusti_around_%d" % k, xfp * Vector3(sin(a) * 120.0, 45.0, cos(a) * 120.0), xfp * Vector3(0, 0, 0))
		await _look("dusti_gate_street", xfp * Vector3(-14, 1.8, 82), xfp * Vector3(0, 8, 60))
		await _look("dusti_inside_gate", xfp * Vector3(0, 1.8, 54), xfp * Vector3(0, 3, 0))
		var fr: Node3D = ppd.get_node_or_null("FerrisRideDusti")
		if fr:
			for k2 in 4:
				var a2 := k2 * TAU / 4.0 + 0.4
				await _look("wheel_side_%d" % k2, fr.to_global(Vector3(sin(a2) * 34.0, 6.0, cos(a2) * 34.0)), fr.to_global(Vector3(0, 16, 0)))
			await _look("wheel_below", fr.to_global(Vector3(6, 1.7, 9)), fr.to_global(Vector3(0, 22, 0)))
			await _look("wheel_ticket", fr.to_global(Vector3(10, 2.0, 16)), fr.to_global(Vector3(5.5, 2, 6.5)))
		get_tree().quit()
		return
	if OS.get_cmdline_user_args().has("ferris"):
		_hour(17.5)
		var fr: FerrisRide = main.get_node("FerrisRide")
		var sn0: CarSession = main.get("car_session")
		sn0.player.teleport(fr.interaction_point(null), 0.0)
		ow.hold = fr.global_position
		ow.preload_at(fr.global_position)
		await _sec(3.0)
		await _look("ferris_wide", fr.to_global(Vector3(-40, 24, 62)), fr.to_global(Vector3(0, 14, 0)))
		await _look("ferris_deck", fr.to_global(Vector3(9, 1.7, 14)), fr.to_global(Vector3(0, 4, 0)))
		await _look("ferris_gondola", fr.to_global(Vector3(4, 5, 6)), fr.to_global(Vector3(0, 2.2, 0)))
		var m0 := Wallet.money
		fr.interact(sn0.player)
		print("FERRIS paid %d riding %s" % [m0 - Wallet.money, fr.riding])
		for frac: float in [0.25, 0.5]:
			while fr.ride_t < 75.0 * frac:
				await get_tree().process_frame
				fr.ride_t += 1.0                      # captures: fast forward
			await _sec(2.0)
			get_viewport().get_texture().get_image().save_png("%s/s9_ferris_ride_%d.png" % [out, int(frac * 100)])
			print("S8 shot ferris_ride_%d" % int(frac * 100))
		fr._yaw = PI * 0.5
		await _sec(1.0)
		get_viewport().get_texture().get_image().save_png("%s/s9_ferris_ride_side.png" % out)
		fr.ride_t = 75.0
		await _sec(1.0)
		print("FERRIS done riding %s player visible %s" % [fr.riding, sn0.player.visible])
		get_tree().quit()
		return
	if OS.get_cmdline_user_args().has("home"):
		_hour(16.5)
		var hh9: HeroHome = main.get_node("HeroHome")
		await _sec(3.0)
		var t9 := hh9.global_transform
		await _look("home_top", t9 * Vector3(-55, 60, -231), t9 * Vector3(10, 0, -231))
		await _look("home_garden", t9 * Vector3(-30, 14, -231), t9 * Vector3(8, 1.0, -226))
		await _look("home_orchard", t9 * Vector3(-4, 3.0, -200), t9 * Vector3(22, 1.5, -184))
		if OS.get_cmdline_user_args().has("dbg"):
			print("HOME xf ", t9, " lot y ", hh9.floor_y())
		await _look("home_tapchan", t9 * Vector3(4, 3.5, -266), t9 * Vector3(24, 1.0, -280))
		await _look("home_waterfall", t9 * Vector3(19, 2.2, -277), t9 * Vector3(30, 1.4, -280))
		await _look("home_edge_low", t9 * Vector3(-30, 1.6, -262), t9 * Vector3(-16, 0.2, -235))
		await _look("home_edge_top", t9 * Vector3(-36, 22, -231), t9 * Vector3(-18, 0, -231))
		await _look("home_front", t9 * Vector3(-30, 2.2, -212), t9 * Vector3(8, 3, -228))
		_hour(21.0)
		await _sec(1.5)
		await _look("home_night", t9 * Vector3(-45, 26, -231), t9 * Vector3(10, 0, -231))
		get_tree().quit()
		return
	if OS.get_cmdline_user_args().has("night"):
		var sn: CarSession = main.get("car_session")
		var hp9: Vector3 = (sn.player as Node3D).global_position
		var life9: CityLife = main.get_node("CityLife")
		life9.enabled = true
		cam.make_current()
		cam.global_position = hp9 + Vector3(0, 3, 0)
		_hour(22.0)
		await _sec(6.0)
		var best9 := Vector3.ZERO
		var dir9 := Vector3.FORWARD
		var bd9 := INF
		for R9 in life9._roads:
			if R9["cls"] != "avenue":
				continue
			var P9: PackedVector3Array = R9["p"]
			for qi in range(1, P9.size()):
				var dd9 := P9[qi].distance_to(hp9)
				if dd9 < bd9:
					bd9 = dd9
					best9 = P9[qi]
					dir9 = (P9[qi] - P9[qi - 1]).normalized()
		await _look("night_avenue", best9 - dir9 * 30.0 + dir9.cross(Vector3.UP) * 6.0 + Vector3(0, 3, 0), best9 + dir9 * 40.0 + Vector3(0, 2, 0))
		await _look("night_aerial", best9 + Vector3(-120, 90, 120), best9)
		await _look("night_street", hp9 + Vector3(10, 2, 10), hp9 + Vector3(-20, 3, -20))
		get_tree().quit()
		return
	if OS.get_cmdline_user_args().has("stops"):
		_hour(15.0)
		var bj: BusJob = main.get("bus_job")
		for si in [0, 3]:
			if si >= bj.stops.size():
				continue
			var st9: Dictionary = bj.stops[si]
			var rgt: Vector3 = st9["right"]
			var sp: Vector3 = (st9["p"] as Vector3) + rgt * 5.2
			ow.hold = sp
			ow.preload_at(sp)
			await _sec(2.0)
			var fw9 := rgt.cross(Vector3.UP)
			await _look("stop_%d" % si, sp - rgt * 9.0 + fw9 * 7.0 + Vector3(0, 2.2, 0), sp + Vector3(0, 1.4, 0))
			var xb: Transform3D = Transform3D(Basis(Vector3.UP, atan2(rgt.x, rgt.z)), sp)
			await _look("stop_%d_ad" % si, xb * Vector3(-3.1, 1.4, 3.2), xb * Vector3(-3.1, 1.2, 0.3))
			await _look("stop_%d_panel" % si, xb * Vector3(-1.2, 1.3, -2.6), xb * Vector3(-2.3, 1.2, 0.0))
		get_tree().quit()
		return
	if OS.get_cmdline_user_args().has("missions"):
		_hour(19.0)
		var mis9: Missions = main.get_node("Missions")
		await _sec(1.0)
		for id9 in mis9.markers:
			var mp: Vector3 = mis9.markers[id9]["pos"]
			ow.hold = mp
			ow.preload_at(mp)
			await _sec(2.0)
			await _look("mission_%s" % id9, mp + Vector3(7, 3.0, 7), mp + Vector3(0, 2.5, 0))
		get_tree().quit()
		return
	if OS.get_cmdline_user_args().has("parked"):
		_hour(14.0)
		var life8: CityLife = main.get_node("CityLife")
		life8.enabled = true
		life8.max_parked = 12
		life8.max_cars = 4
		var s8: CarSession = main.get("car_session")
		cam.make_current()
		cam.global_position = (s8.player as Node3D).global_position + Vector3(0, 3, 0)
		await _sec(8.0)
		var n8 := 0
		for c8 in life8.cars:
			if not c8.get("parked", false):
				continue
			var cn8: Node3D = c8["node"]
			life8.enabled = false
			await _look("parked_%d" % n8, cn8.global_position + cn8.global_basis * Vector3(4.0, 2.2, -9.0), cn8.global_position + cn8.global_basis * Vector3(0, 0.6, 3.0))
			life8.enabled = true
			n8 += 1
			if n8 >= 3:
				break
		get_tree().quit()
		return
	if OS.get_cmdline_user_args().has("flowers"):
		_hour(12.0)
		var pp9: PhotoPlaces = main.get_node("PhotoPlaces")
		for st9 in pp9.sites:
			if st9["id"] != "city_park":
				continue
			var x9: Transform3D = st9["xf"]
			ow.hold = x9.origin
			ow.preload_at(x9.origin)
			pp9.build_site(st9)
			await _sec(3.0)
			await _look("flowers_close", x9 * Vector3(4.5, 1.2, 36.0), x9 * Vector3(7.5, 0.2, 39.5))
			await _look("flowers_bed", x9 * Vector3(2.0, 2.2, 30.0), x9 * Vector3(7.5, 0.3, 40.0))
			await _look("roses", x9 * Vector3(0, 1.5, 15.5), x9 * Vector3(0, 0.3, 10.5))
		get_tree().quit()
		return
	if OS.get_cmdline_user_args().has("police"):
		_hour(18.3)
		var pol: Police = main.get_node("Police")
		var s7: CarSession = main.get("car_session")
		var life3: CityLife = main.get_node("CityLife")
		life3.enabled = true
		cam.make_current()
		cam.global_position = (s7.player as Node3D).global_position + Vector3(0, 3, 0)
		await _sec(6.0)
		pol.set_stars(3)
		for q7 in 14:
			await _sec(1.0)
		var tp7: Vector3 = (s7.player as Node3D).global_position
		var best7: Node3D = null
		for c7 in pol.cops:
			var cn: Node3D = c7["node"]
			if best7 == null or cn.global_position.distance_to(tp7) < best7.global_position.distance_to(tp7):
				best7 = cn
		if best7:
			pol.enabled = false
			await _look("police_car", best7.global_position + best7.global_basis * Vector3(3.5, 1.6, -6.0), best7.global_position + Vector3(0, 0.9, 0))
			await _look("police_arrive", tp7 + Vector3(-6, 2.5, 6), best7.global_position + Vector3(0, 1.0, 0))
		print("POLICE cops=", pol.cops.size())
		get_tree().quit()
		return
	if OS.get_cmdline_user_args().has("cabins"):
		_hour(13.0)
		var s6: CarSession = main.get("car_session")
		var keys := ["car", "camry", "w123", "e30", "e30m", "r12", "gls"]
		for a6 in OS.get_cmdline_user_args():
			if a6.begins_with("only="):
				keys = a6.substr(5).split(",")
		for key in keys:
			var c6: VehiclePrado = main.get(key)
			if c6 == null:
				continue
			if s6.driving:
				s6.exit()
				await _sec(0.5)
			ow.hold = c6.global_position
			s6.player.teleport(c6.driver_door_point(0.7), 0.0)
			await _sec(1.0)
			s6._select(c6)
			s6.enter()
			await _sec(0.5)
			if OS.get_cmdline_user_args().has("side"):
				var b6 := c6.global_basis
				await _look("side_%s" % key, c6.global_position + b6.x * -4.5 + Vector3(0, 1.0, 0), c6.global_position + Vector3(0, 0.8, 0))
			s6.cam.make_current()
			s6.cam.set_mode(VehicleCamera.Mode.CABIN)
			await _sec(1.5)
			await _snap("cabin_%s" % key)
			var gg: Node3D = c6.model.get_node_or_null("Gauges")
			if gg and OS.get_cmdline_user_args().has("gauges"):
				c6.speed_kmh = 0.0
				VehicleInput.scripted = {"throttle": 0.8}
				await _sec(2.5)
				VehicleInput.scripted = {"brake": 0.0}
				await _look("gauges_%s" % key, c6.driver_eye(), gg.global_position)
				VehicleInput.scripted = null
			s6.cam.set_mode(VehicleCamera.Mode.CHASE)
		get_tree().quit()
		return
	if OS.get_cmdline_user_args().has("gta"):
		_hour(15.0)
		var life2: CityLife = main.get_node("CityLife")
		life2.enabled = true
		life2.max_cars = 8
		life2.max_peds = 14
		var s5: CarSession = main.get("car_session")
		cam.make_current()
		cam.global_position = (s5.player as Node3D).global_position + Vector3(0, 3, 0)
		for q5 in 12:
			await _sec(1.0)
			print("GTA t=", q5, " peds=", life2.peds.size(), " cars=", life2.cars.size())
		# a group of pedestrians: the 3 closest to each other
		var pd2: Array = life2.peds
		for k in mini(3, pd2.size()):
			var pn2: Node3D = pd2[k]["node"]
			life2.enabled = false
			await _look("gta_ped_%d" % k, pn2.global_position + pn2.global_basis.z * 3.2 + pn2.global_basis.x * 1.2 + Vector3(0, 1.6, 0), pn2.global_position + Vector3(0, 1.0, 0))
			life2.enabled = true
		if pd2.size() > 3:
			var vict: Dictionary = pd2[3]
			var vn: Node3D = vict["node"]
			s5.player.teleport(vn.global_position - vn.global_basis.z * 1.2 + Vector3(0, 0.4, 0), vn.rotation.y + PI)
			await _sec(0.3)
			life2.hit_body(vict["body"], 12.0, vn.global_basis.z, true)
			await _sec(0.8)
			life2.enabled = false
			await _look("gta_knocked", vn.global_position + Vector3(3.0, 2.2, 2.5), vn.global_position + Vector3(0, 0.3, 0))
			life2.enabled = true
		if not life2.cars.is_empty():
			var tc2: Dictionary = life2.cars[0]
			s5.player.teleport((tc2["spot"] as Node3D).global_position + Vector3(0, 0.4, 0), 0.0)
			await _sec(1.0)
			life2.steal(tc2["spot"])
			await _sec(7.0)
			if s5.driving:
				VehicleInput.scripted = {"throttle": 0.6}
				await _sec(2.5)
				VehicleInput.scripted = null
				await _snap("gta_stolen_drive")
		get_tree().quit()
		return
	if OS.get_cmdline_user_args().has("life"):
		# 0.25: traffic + pedestrians on a city avenue (near the start)
		_hour(16.0)
		var life: CityLife = main.get_node("CityLife")
		life.enabled = true
		life.max_cars = 12
		life.max_peds = 10
		var s4: CarSession = main.get("car_session")
		var hp: Vector3 = (s4.player as Node3D).global_position
		await _sec(1.0)
		# watch from above the nearest avenue
		var best := Vector3.ZERO
		var bdir := Vector3.FORWARD
		var bd := INF
		for R in life._roads:
			if R["cls"] != "avenue":
				continue
			var PP: PackedVector3Array = R["p"]
			for qi in range(1, PP.size()):
				var dd := PP[qi].distance_to(hp)
				if dd < bd:
					bd = dd
					best = PP[qi]
					bdir = (PP[qi] - PP[qi - 1]).normalized()
		ow.hold = best
		ow.preload_at(best)
		var cam0 := get_viewport().get_camera_3d()
		if cam0:
			cam0.global_position = best + Vector3(18, 9, 18)
		await _sec(8.0)
		await _look("life_avenue", best - bdir * 30.0 + Vector3(0, 9, 0), best + bdir * 20.0)
		await _sec(3.0)
		await _look("life_avenue2", best + bdir * 40.0 + Vector3(0, 6, 0), best - bdir * 10.0)
		await _look("life_top", best + Vector3(0, 70, 1), best)
		for kind in ["ped", "car"]:
			var arr: Array = life.peds if kind == "ped" else life.cars
			var near: Node3D = null
			var nd := INF
			for e in arr:
				var en: Node3D = e["node"]
				var dd2 := en.global_position.distance_to(best)
				if dd2 < nd:
					nd = dd2
					near = en
			if near:
				life.enabled = false
				var fwd5 := near.global_basis.z if kind == "ped" else -near.global_basis.z
				var side5 := fwd5.cross(Vector3.UP)
				await _look("life_%s" % kind, near.global_position + fwd5 * 5.0 + side5 * 2.5 + Vector3(0, 1.8, 0), near.global_position + Vector3(0, 0.9, 0))
				life.enabled = true
		print("LIFE cars=%d peds=%d" % [life.cars.size(), life.peds.size()])
		for p5 in life.peds:
			var pn5: Node3D = p5["node"]
			var sk5: Skeleton3D = pn5.find_children("*", "Skeleton3D", true, false)[0]
			print("PED ", pn5.global_position.round(), " vis=", pn5.is_visible_in_tree(), " hips=", (sk5.global_transform * sk5.get_bone_global_pose(sk5.find_bone("Hips")).origin).round())
		get_tree().quit()
		return
	if OS.get_cmdline_user_args().has("photo"):
		# 0.25: police station + Parki Dusti (arch, fountain, pavilions)
		_hour(12.0)
		var pp: PhotoPlaces = main.get_node("PhotoPlaces")
		var only_id := ""
		for a10 in OS.get_cmdline_user_args():
			if a10.begins_with("only="):
				only_id = a10.substr(5)
		for st in pp.sites:
			if only_id != "" and String(st["id"]) != only_id:
				continue
			var xf: Transform3D = st["xf"]
			ow.hold = xf.origin
			ow.preload_at(xf.origin)
			if st["node"] == null:
				pp.build_site(st)
			await _sec(3.0)
			var id := String(st["id"])
			if id == "river_bridge":
				var a9: Vector3 = st["a"]
				var b9: Vector3 = st["b"]
				var al9 := (b9 - a9).normalized()
				var sd9 := al9.cross(Vector3.UP)
				var c9 := (a9 + b9) * 0.5
				await _look("bridge_side", c9 + sd9 * 70.0 + Vector3(0, 6, 0) - al9 * 20.0, c9 + Vector3(0, 6, 0))
				await _look("bridge_drive", a9 - al9 * 40.0 + sd9 * 3.0 + Vector3(0, 2.0, 0), c9 + Vector3(0, 6, 0))
				await _look("embankment", c9 + sd9 * 30.0 + al9 * 30.0 + Vector3(0, 2.5, 0), c9 + sd9 * 60.0 + Vector3(0, 1.5, 0))
				_hour(21.0)
				await _sec(0.5)
				await _look("bridge_night", c9 + sd9 * 70.0 + Vector3(0, 6, 0) - al9 * 20.0, c9 + Vector3(0, 6, 0))
				_hour(12.0)
				continue
			if id == "shop_street":
				await _look("shop_entry", xf * Vector3(5, 3.0, 100), xf * Vector3(0, 3.5, 60))
				await _look("shop_entry_low", xf * Vector3(12, 1.7, 104), xf * Vector3(0, 1.5, 80))
				await _look("shop_street", xf * Vector3(-3, 1.8, 70), xf * Vector3(0, 2.5, 0))
				await _look("shop_window", xf * Vector3(2.5, 1.7, 30), xf * Vector3(-7, 2.5, 26))
				await _look("shop_top", xf * Vector3(0, 70, 100), xf * Vector3(0, 0, 0))
				_hour(21.0)
				await _sec(0.5)
				await _look("shop_night", xf * Vector3(-3, 1.8, 70), xf * Vector3(0, 2.5, 0))
				_hour(12.0)
				continue
			if id == "police":
				await _look("police_front", xf * Vector3(10, 4.0, 40), xf * Vector3(0, 4.0, -2))
				await _look("police_street", xf * Vector3(18, 1.7, 44), xf * Vector3(0, 1.5, 20))
				await _look("police_sign", xf * Vector3(-3, 3.0, 14), xf * Vector3(0, 5.6, 0))
				await _look("police_fence", xf * Vector3(-14, 1.8, 30), xf * Vector3(-5, 1.5, 24))
				await _look("police_top", xf * Vector3(0, 60, 30), xf * Vector3(0, 0, 0))
			else:
				if OS.get_cmdline_user_args().has("treedbg"):
					await _sec(2.0)
					var inv := xf.affine_inverse()
					for mmi in get_tree().root.find_children("*", "MultiMeshInstance3D", true, false):
						var mm := (mmi as MultiMeshInstance3D).multimesh
						if mm == null or mm.mesh == null:
							continue
						for i in mm.instance_count:
							var wp: Vector3 = (mmi as Node3D).global_transform * mm.get_instance_transform(i).origin
							var lp := inv * wp
							if absf(lp.x) < 100 and lp.z > 58 and lp.z < 100 and mm.mesh.get_aabb().size.y > 4.0:
								print("TREE ", mmi.get_path(), " ", lp.snapped(Vector3.ONE * 0.1), " h ", mm.mesh.get_aabb().size.y)
				await _look("park_gate", xf * Vector3(0, 2.0, 84), xf * Vector3(0, 7.5, 60))
				await _look("park_street", xf * Vector3(-18, 1.7, 80), xf * Vector3(4, 4.0, 60))
				await _look("park_aerial", xf * Vector3(-70, 45, 115), xf * Vector3(0, 0, 10))
				await _look("park_alley", xf * Vector3(0, 2.0, 54), xf * Vector3(0, 3.0, 0))
				await _look("park_fountain", xf * Vector3(16, 4.0, 22), xf * Vector3(0, 3.0, 0))
				await _look("park_pond", xf * Vector3(14, 7.0, -40), xf * Vector3(46, 2.0, -46))
				await _look("park_bridge", xf * Vector3(30, 3.0, -48), xf * Vector3(38, 1.0, -38))
				await _look("park_bridge_top", xf * Vector3(10, 30, -20), xf * Vector3(42, 0, -42))
				await _look("park_carousel", xf * Vector3(-16, 3.5, -8), xf * Vector3(-30, 3.0, -14))
				await _look("park_wheel", xf * Vector3(-10, 4.0, -10), xf * Vector3(-42, 12.0, -44))
				await _look("park_play", xf * Vector3(-30, 4.0, 45), xf * Vector3(-46, 1.0, 34))
				await _look("park_top", xf * Vector3(0, 160, 40), xf * Vector3(0, 0, -5))
		get_tree().quit()
		return
	if OS.get_cmdline_user_args().has("street"):
		# 0.25: junction traffic lights, manholes, storm grates, bins
		_hour(12.5)
		var wd2 := WorldData.get_instance()
		var picks := [0, 40, 120]
		for i in picks:
			if i >= wd2.fillets.size():
				continue
			var fl: Dictionary = wd2.fillets[i]
			var C := Vector3(fl["c"][0], fl["c"][1], fl["c"][2])
			var O := Vector3(fl["o"][0], C.y, fl["o"][1])
			var dv := (C - O).normalized()
			ow.hold = C
			ow.preload_at(C)
			await _sec(2.5)
			await _look("street_junction_%d" % i, C + dv * 16.0 + Vector3(0, 4.0, 0) + Vector3(dv.z, 0, -dv.x) * 6.0, O + dv * float(fl["r"]) + Vector3(0, 2.0, 0))
			await _look("street_top_%d" % i, C + dv * 6.0 + Vector3(0, 30.0, 0) + Vector3(0.1, 0, 0), C + dv * 5.0)
		get_tree().quit()
		return
	if OS.get_cmdline_user_args().has("tune"):
		# 0.25: tuned cars (tint 90 %, gold / black rims, spoiler) + a realty board + the taxi client
		_hour(13.0)
		await _sec(4.0)
		for pair in [["e30", {"tint": 0.9, "rims": "d9a520", "spoiler": true}], ["w123", {"tint": 0.5, "rims": "1a1a1e", "spoiler": true}], ["gls", {"tint": 0.9, "rims": "1a1a1e"}]]:
			var c: VehiclePrado = main.get(pair[0])
			if c == null:
				continue
			c.set_tuning(pair[1])
			var ow2: OpenWorld = main.get("open_world")
			ow2.hold = c.global_position
			await _sec(1.5)
			var b := c.global_basis
			var p := c.global_position
			await _look("tune_%s_front" % pair[0], p + b * Vector3(3.2, 1.3, -5.2), p + Vector3(0, 0.5, 0))
			await _look("tune_%s_rear" % pair[0], p + b * Vector3(-3.0, 1.6, 5.4), p + Vector3(0, 0.6, 0))
		var re: Realty = main.get_node_or_null("Realty")
		if re and not re.props.is_empty():
			for P in [re.props[0], re.props[5], re.props[9]]:
				var pp: Vector3 = P["pos"]
				ow.hold = pp
				ow.preload_at(pp)
				await _sec(2.0)
				var fw := Vector3(sin(float(P["yaw"])), 0, cos(float(P["yaw"])))
				var sd := Vector3(fw.z, 0, -fw.x)
				await _look("realty_%s" % P["kind"], pp + fw * 6.0 + sd * 2.5 + Vector3(0, 2.4, 0), pp + Vector3(0, 2.0, 0) - fw * 4.0)
		get_tree().quit()
		return
	if OS.get_cmdline_user_args().has("pack"):
		# 0.25: the owner's car pack at the dealership: each car from front 3/4, rear 3/4, plates, lamps
		_hour(13.0)
		await _sec(4.0)
		var only := ["gls"] if OS.get_cmdline_user_args().has("glsonly") else ["gls", "w123", "e30", "e30m", "r12"]
		for key in only:
			var c: VehicleCar = main.get(key)
			if c == null:
				continue
			var ow2: OpenWorld = main.get("open_world")
			ow2.hold = c.global_position
			await _sec(1.5)
			var b := c.global_basis
			var p := c.global_position
			await _look("pack_%s_front" % key, p + b * Vector3(3.2, 1.3, -5.2), p + Vector3(0, 0.5, 0))
			await _look("pack_%s_rear" % key, p + b * Vector3(-3.0, 1.4, 5.4), p + Vector3(0, 0.5, 0))
			if c.lights:
				c.lights.beam = VehicleLights.Beam.LOW
				c.lights.force = {"brake": true}
				c.lights.turn = -1
				await _sec(0.4)
				await _look("pack_%s_lamps" % key, p + b * Vector3(-1.6, 1.0, 4.6), p + Vector3(0, 0.6, 0))
				c.lights.turn = 0
				c.lights.force = {"reverse": true}
				await _sec(0.4)
				await _look("pack_%s_reverse" % key, p + b * Vector3(-1.6, 1.0, 4.6), p + Vector3(0, 0.6, 0))
				c.lights.force = {}
				c.lights.beam = VehicleLights.Beam.OFF
				c.lights.braking = false
				c.lights.turn = 0
		get_tree().quit()
		return
	if OS.get_cmdline_user_args().has("falls"):
		_hour(17.2)
		for k in 4:
			var d := Vector3.FORWARD.rotated(Vector3.UP, k * PI * 0.5)
			await _look("falls_%d" % k, Vector3(1460, 246, -7430) + d * 60.0, Vector3(1460, 250, -7430))
		get_tree().quit()
		return
	if OS.get_cmdline_user_args().has("amid_in"):
		_hour(13.0)
		var am: AmidStores = main.get_node("AmidStores")
		var st: Dictionary = am.stores[0]
		var xf: Transform3D = st["xf"]
		var s3: CarSession = main.get("car_session")
		ow.hold = am.door_point(st)
		s3.player.teleport(am.door_point(st) + Vector3(0, 0.5, 0), 0.0)
		await _sec(2.5)
		await _look("amid_front", xf * Vector3(14, 11.0, 78), xf * Vector3(0, 6.0, 25))
		s3.player.teleport(xf * Vector3(18, 0.3, 40), 0.0)
		await _sec(2.0)
		await _look("amid_doors_closed", xf * Vector3(5, 2.6, 33), xf * Vector3(0, 1.8, 24))
		s3.player.teleport(am.door_point(st) + Vector3(0, 0.5, 0), 0.0)
		await _sec(2.0)
		await _look("amid_doors_open", xf * Vector3(5, 2.6, 33), xf * Vector3(0, 1.8, 24))
		await _look("amid_door", xf * Vector3(8, 3.0, 40), xf * Vector3(0, 3, 20))
		await _look("amid_inside", xf * Vector3(0, 2.2, 21), xf * Vector3(-8, 1.5, -10))
		await _look("amid_aisle", xf * Vector3(-9, 1.7, 8), xf * Vector3(-9, 1.2, -18))
		await _look("amid_shelf_close", xf * Vector3(-10.4, 1.4, 2.0), xf * Vector3(-11.5, 1.0, -1.0))
		await _look("amid_endcap", xf * Vector3(-12, 1.8, 10.5), xf * Vector3(-12, 1.0, 6.4))
		await _look("amid_fridges", xf * Vector3(-30, 1.8, -17), xf * Vector3(-30, 1.2, -24))
		await _look("amid_fruit", xf * Vector3(-22, 2.2, 18.5), xf * Vector3(-27, 1.0, 13.4))
		await _look("amid_tills", xf * Vector3(20, 3.0, 20), xf * Vector3(0, 1.0, 14))
		await _look("amid_baskets", xf * Vector3(9.5, 1.6, 21.0), xf * Vector3(7.5, 0.8, 22.8))
		# shopping with the hero: basket in the hand in an aisle, then the bag at the till
		_ui(true)
		Food.hand = ""
		Food.take_basket()
		Food.pick("rice")
		Food.pick("oil")
		s3.player.teleport(xf * Vector3(-15.0, 0.3, 0.0), xf.basis.get_euler().y + PI)
		await _sec(1.5)
		for c3 in s3.player.find_children("*", "Camera3D", true, false):
			(c3 as Camera3D).make_current()
		for i in 30:
			await get_tree().process_frame
		await _snap("amid_basket_hand")
		Food.pay()
		s3.player.teleport(am.till_point(st, 0), xf.basis.get_euler().y)
		await _sec(1.0)
		for i in 30:
			await get_tree().process_frame
		await _snap("amid_bag_hand")
		# first person: the aisle with the basket, then the till
		Food.hand = ""
		Food.take_basket()
		Food.pick("milk")
		CharacterCamera.first_person = true
		s3.player.teleport(xf * Vector3(-15.0, 0.3, 4.0), xf.basis.get_euler().y + PI)
		s3.player.set_camera_angles(xf.basis.get_euler().y + PI, deg_to_rad(-12.0))
		await _sec(1.5)
		await _snap("amid_fp_aisle")
		s3.player.set_camera_angles(xf.basis.get_euler().y + PI + 0.9, deg_to_rad(-30.0))
		await _sec(1.0)
		await _snap("amid_fp_shelf")
		s3.player.teleport(am.till_point(st, 0), xf.basis.get_euler().y)
		s3.player.set_camera_angles(xf.basis.get_euler().y + PI, deg_to_rad(-20.0))
		await _sec(1.5)
		await _snap("amid_fp_till")
		s3.player.teleport(xf * Vector3(0, 0.3, 19.5), xf.basis.get_euler().y + PI)
		s3.player.set_camera_angles(xf.basis.get_euler().y + PI, deg_to_rad(-3.0))
		await _sec(2.0)
		await _snap("amid_fp_exit")
		CharacterCamera.first_person = false
		get_tree().quit()
		return
	if OS.get_cmdline_user_args().has("v21"):
		_hour(16.5)
		var tl: Dictionary = wd.landmark("tas")
		var tc := Vector3(tl["x"], tl["y"], tl["z"])
		var tb := Basis(Vector3.UP, float(tl["yaw"]))
		await _look("tas_street", tc + tb * Vector3(40, 30, -170), tc + Vector3(0, 80, 0))
		await _look("tas_aerial", tc + tb * Vector3(220, 120, -260), tc + Vector3(0, 60, 0))
		var n := 0
		for b in wd.buildings:
			if b[0] == "amid_m" and n < 2:
				var bc := Vector3(b[1], b[8], b[2])
				var bb := Basis(Vector3.UP, float(b[3]))
				await _look("amid_%d" % n, bc + bb * Vector3(10, 45, -105), bc + Vector3(0, 6, 0))
				await _look("amid_%d_top" % n, bc + bb * Vector3(0, 140, -60), bc + bb * Vector3(0, 0, -50))
				await _look("amid_%d_side" % n, bc + bb * Vector3(-90, 20, -70), bc + bb * Vector3(0, 4, -40))
				n += 1
		for b in wd.buildings:
			if b[0] == "mall_m":
				var mc := Vector3(b[1], b[8], b[2])
				var mb := Basis(Vector3.UP, float(b[3]))
				await _look("mall_front", mc + mb * Vector3(-20, 18, -95), mc + Vector3(0, 6, 0))
				break
		if not wd.washes.is_empty():
			var w0: Dictionary = wd.washes[0]
			var wp := Vector3(float(w0["ox"]), wd.height_at(float(w0["ox"]), float(w0["oz"])), float(w0["oz"]))
			var wb := Basis(Vector3.UP, float(w0["yaw"]))
			var sw: CarSession = main.get("car_session")
			sw.player.teleport(wp + wb * Vector3(14, 0.5, 0), 0.0)
			await _sec(3.0)
			await _look("carwash", wp + wb * Vector3(22, 7, 14), wp + Vector3(0, 2, 0))
			await _look("carwash_top", wp + Vector3(0, 70, 25), wp)
		var svc: AutoService = main.get_node("AutoService")
		var m := 0
		for sp in svc.spots:
			if m >= 2:
				break
			var gp: Vector3 = sp["pos"]
			if gp.distance_to(tc) > 3000.0:
				continue
			var s2: CarSession = main.get("car_session")
			s2.player.teleport(gp + Vector3(0, 1, 16), 0.0)
			await _sec(2.0)
			await _look("service_%d_top" % m, gp + Vector3(0, 90, 30), gp + Vector3(0, 0, 8))
			await _look("service_%d" % m, gp + Vector3(36, 12, 30), gp)
			m += 1
		get_tree().quit()
		return
	if OS.get_cmdline_user_args().has("city20"):
		var rr := _road("rudaki")
		var pts: Array = rr["pts"]
		_hour(16.5)
		for frac in [0.35, 0.5, 0.62]:
			var k := int(pts.size() * frac)
			var a := Vector3(pts[k][0], pts[k][1], pts[k][2])
			var b := Vector3(pts[k + 25][0], pts[k + 25][1], pts[k + 25][2])
			var d := (b - a).normalized()
			var rt := d.cross(Vector3.UP)
			await _look("city_rudaki_%d" % int(frac * 100), a - d * 10.0 + rt * 6.0 + Vector3(0, 7, 0), b + Vector3(0, 6, 0))
		var lmk: Dictionary = wd.landmark("somoni")
		var c := Vector3(lmk["x"], lmk["y"], lmk["z"])
		await _look("city_aerial", c + Vector3(260, 150, 260), c + Vector3(0, 0, -150))
		var pk: Dictionary = wd.landmark("rudaki_park")
		var pc := Vector3(pk["x"], pk["y"], pk["z"])
		var pb := Basis(Vector3.UP, float(pk["yaw"]))
		await _look("park_gate", pc + pb * Vector3(8, 6, -150), pc + pb * Vector3(0, 6, -110))
		await _look("park_inside", pc + pb * Vector3(60, 45, -140), pc + pb * Vector3(-30, 8, 20))
		# filling station + auto service on a city street
		var fs: Dictionary = {}
		for f in wd.fuel:
			if Vector2(float(f["x"]), float(f["z"])).distance_to(Vector2(0, -2600)) < 2500.0:
				fs = f
				break
		if not fs.is_empty():
			var fp := Vector3(float(fs["x"]), float(fs["y"]), float(fs["z"]))
			var fyaw := float(fs["yaw"])
			var fb := Basis(Vector3.UP, fyaw)
			var fo := Vector3(float(fs.get("ox", fs["x"])), float(fs["y"]), float(fs.get("oz", fs["z"])))
			await _look("city_fuel", fo + fb * Vector3(34, 6, 16), fo + fb * Vector3(4, 2.5, 0))
			await _look("city_fuel_close", fo + fb * Vector3(14, 2.2, 7.5), fo + fb * Vector3(2, 2.5, -2))
		var svc: AutoService = main.get_node("AutoService")
		var best := {}
		for sp in svc.spots:
			if (sp["pos"] as Vector3).distance_to(c) < 2500.0:
				best = sp
				break
		if not best.is_empty():
			var gp: Vector3 = best["pos"]
			var s2: CarSession = main.get("car_session")
			s2.player.teleport(gp + Vector3(0, 1, 18), 0.0)
			await _sec(2.0)
			var syaw := float(best["yaw"])
			var sb := Basis(Vector3.UP, syaw)
			await _look("city_service", gp + sb * Vector3(30, 6, -10), gp + sb * Vector3(0, 3, -1))
			await _look("city_service_close", gp + sb * Vector3(11, 2.0, -2), gp + sb * Vector3(0, 2.5, -4))
		get_tree().quit()
		return
	if OS.get_cmdline_user_args().has("somoni"):
		var lmk: Dictionary = {}
		var flg: Dictionary = {}
		for l in wd.landmarks:
			if l["id"] == "somoni":
				lmk = l
			if l["id"] == "flag":
				flg = l
		var c := Vector3(lmk["x"], lmk["y"], lmk["z"])
		var yw := float(lmk["yaw"])
		var fwd := Vector3(0, 0, -1).rotated(Vector3.UP, yw)
		var rt := fwd.cross(Vector3.UP)
		_hour(17.0)
		await _look("somoni_front", c + fwd * 75.0 + rt * 18.0 + Vector3(0, 9, 0), c + Vector3(0, 18, 0))
		await _look("somoni_close", c + fwd * 34.0 + Vector3(0, 6, 0), c + Vector3(0, 20, 0))
		await _look("somoni_side", c - rt * 70.0 + fwd * 20.0 + Vector3(0, 12, 0), c + Vector3(0, 16, 0))
		var fc := Vector3(flg["x"], flg["y"], flg["z"])
		await _look("flag", fc + Vector3(150, 40, -220), fc + Vector3(0, 110, 0))
		get_tree().quit()
		return
	if OS.get_cmdline_user_args().has("survey"):
		# eye-level views at the kerb of random city streets, both directions + a low aerial
		_hour(13.0)
		var rng9 := RandomNumberGenerator.new()
		rng9.seed = 77
		var rds: Array = []
		for r9 in wd.roads:
			if String(r9["cls"]) in ["avenue", "street"] and not String(r9.get("id", "")).begins_with("drive"):
				rds.append(r9)
		var shots := 0
		for k9 in 40:
			if shots >= 10:
				break
			var r9: Dictionary = rds[rng9.randi() % rds.size()]
			var pts9: Array = r9["pts"]
			var i9 := rng9.randi_range(2, pts9.size() - 3)
			var p9 := Vector3(pts9[i9][0], pts9[i9][1], pts9[i9][2])
			if absf(p9.x) > 2000.0 or p9.z > -1000.0 or p9.z < -4800.0:
				continue
			var q9 := Vector3(pts9[i9 + 2][0], pts9[i9 + 2][1], pts9[i9 + 2][2])
			var d9 := (q9 - p9).normalized()
			var s9 := d9.cross(Vector3.UP)
			var hw9 := float(r9["w"]) * 0.5
			ow.hold = p9
			ow.preload_at(p9)
			await _sec(2.0)
			await _look("survey_%d_side" % shots, p9 + s9 * (hw9 + 1.6) + Vector3(0, 1.7, 0), p9 + s9 * (hw9 + 8.0) + d9 * 25.0 + Vector3(0, 1.0, 0))
			await _look("survey_%d_air" % shots, p9 - d9 * 25.0 + s9 * 20.0 + Vector3(0, 22, 0), p9)
			shots += 1
		get_tree().quit()
		return
	if OS.get_cmdline_user_args().has("home"):
		var hh: HeroHome = main.get_node("HeroHome")
		var c := hh.to_global(Vector3(10, 0, -231))
		await _look("home_overview", hh.to_global(Vector3(-55, 32, -38) + Vector3(10, 0, -231)), c)
		await _look("home_front", hh.to_global(Vector3(-10, 3.5, -235)), hh.to_global(Vector3(6, 2.5, -224)))
		var gp := hh.garage_point()
		await _look("home_garage", hh.to_global(Vector3(-12, 2.2, -241.5)), gp + Vector3(0, 0.8, 0))
		var dl: CarDealer = main.get_node("CarDealer")
		await _look("dealer_city", dl.to_global(Vector3(45, 12, 30)), dl.to_global(Vector3(6, 2, 0)))
		var gs: GunShop = main.get_node("GunShop")
		await _look("gunshop_city", gs.to_global(Vector3(20, 4, 12)), gs.global_position + Vector3(0, 2, 0))
		_ui(true)
		var s: CarSession = main.get("car_session")
		s.player.teleport(hh.spawn_point(), hh.spawn_yaw())
		for i in 120:
			await get_tree().physics_frame
		for c3 in s.player.find_children("*", "Camera3D", true, false):
			(c3 as Camera3D).make_current()
		for i in 30:
			await get_tree().process_frame
		await _snap("home_start")
		get_tree().quit()
		return
	if OS.get_cmdline_user_args().has("v18b"):
		await _look("v18_lake", Vector3(-3300, 0, -7990), Vector3(-3300, 520, -8400), 30.0)
		await _look("v18_lake2", Vector3(-3000, 0, -8150), Vector3(-3500, 520, -8350), 18.0)
		get_tree().quit()
		return
	if OS.get_cmdline_user_args().has("v18"):
		await _v18_shots()
		get_tree().quit()
		return
	if OS.get_cmdline_user_args().has("cards"):
		await _card_shots()
		get_tree().quit()
		return
	if OS.get_cmdline_user_args().has("wclose"):
		_ui(false)
		var s0: CarSession = main.get("car_session")
		var cmb: PlayerCombat = main.get_node("PlayerCombat")
		Wallet.money = 9000
		Weapons.buy("pistol")
		Weapons.buy("ak47")
		Weapons.buy("bat")
		s0.player.teleport(Vector3(-58, 2.4, -60), PI * 0.5)
		s0.player.get_camera().make_current()
		s0.player.cam_yaw = PI * 0.5
		await get_tree().create_timer(1.5).timeout
		add_child(cam)
		for wid in ["pistol", "ak47", "bat"]:
			Weapons.select(wid)
			var pp := s0.player.global_position
			cam.global_position = pp + Vector3(0.6, 1.6, 2.6)
			cam.look_at(pp + Vector3(-0.6, 1.2, 0))
			cam.make_current()
			for k in 30:
				if wid != "bat":
					PlayerInput.fire_held = true
					PlayerInput.queue_fire()
				await get_tree().physics_frame
			await _post()
			get_viewport().get_texture().get_image().save_png("%s/s9_close_%s.png" % [out, wid])
			PlayerInput.fire_held = false
		get_tree().quit()
		return
	if OS.get_cmdline_user_args().has("streets"):
		_hour(11.0)
		for k in 4:
			var r: Dictionary = wd.roads[[0, 2, 9, 12][k] % wd.roads.size()]
			var pts: Array = r["pts"]
			var a0: Array = pts[pts.size() / 3]
			var a1: Array = pts[pts.size() / 3 + 6]
			var pa := Vector3(a0[0], a0[1], a0[2])
			var pb := Vector3(a1[0], a1[1], a1[2])
			var dv := (pb - pa).normalized()
			await _look("street_%d" % k, pa - dv * 25.0 + Vector3(0, 6, 0) + dv.cross(Vector3.UP) * 4.0, pa + dv * 80.0 + Vector3(0, 3, 0))
		get_tree().quit()
		return
	if OS.get_cmdline_user_args().has("survey"):
		# eye-level views at the kerb of random city streets, both directions + a low aerial
		_hour(13.0)
		var rng9 := RandomNumberGenerator.new()
		rng9.seed = 77
		var rds: Array = []
		for r9 in wd.roads:
			if String(r9["cls"]) in ["avenue", "street"] and not String(r9.get("id", "")).begins_with("drive"):
				rds.append(r9)
		var shots := 0
		for k9 in 40:
			if shots >= 10:
				break
			var r9: Dictionary = rds[rng9.randi() % rds.size()]
			var pts9: Array = r9["pts"]
			var i9 := rng9.randi_range(2, pts9.size() - 3)
			var p9 := Vector3(pts9[i9][0], pts9[i9][1], pts9[i9][2])
			if absf(p9.x) > 2000.0 or p9.z > -1000.0 or p9.z < -4800.0:
				continue
			var q9 := Vector3(pts9[i9 + 2][0], pts9[i9 + 2][1], pts9[i9 + 2][2])
			var d9 := (q9 - p9).normalized()
			var s9 := d9.cross(Vector3.UP)
			var hw9 := float(r9["w"]) * 0.5
			ow.hold = p9
			ow.preload_at(p9)
			await _sec(2.0)
			await _look("survey_%d_side" % shots, p9 + s9 * (hw9 + 1.6) + Vector3(0, 1.7, 0), p9 + s9 * (hw9 + 8.0) + d9 * 25.0 + Vector3(0, 1.0, 0))
			await _look("survey_%d_air" % shots, p9 - d9 * 25.0 + s9 * 20.0 + Vector3(0, 22, 0), p9)
			shots += 1
		get_tree().quit()
		return
	if OS.get_cmdline_user_args().has("home"):
		_hour(16.5)
		var hh9: HeroHome = main.get_node("HeroHome")
		await _sec(3.0)
		var t9 := hh9.global_transform
		await _look("home_top", t9 * Vector3(-30, 70, -230), t9 * Vector3(10, 0, -230))
		await _look("home_garden", t9 * Vector3(-12, 3.2, -246), t9 * Vector3(14, 1.0, -282))
		await _look("home_orchard", t9 * Vector3(-12, 3.0, -160), t9 * Vector3(14, 1.5, -190))
		await _look("home_tapchan", t9 * Vector3(22, 2.5, -200), t9 * Vector3(28, 1.0, -206))
		await _look("home_front", t9 * Vector3(-28, 3.0, -228), t9 * Vector3(10, 3, -225))
		get_tree().quit()
		return
	if OS.get_cmdline_user_args().has("night"):
		var sn: CarSession = main.get("car_session")
		var hp9: Vector3 = (sn.player as Node3D).global_position
		var life9: CityLife = main.get_node("CityLife")
		life9.enabled = true
		cam.make_current()
		cam.global_position = hp9 + Vector3(0, 3, 0)
		_hour(22.0)
		await _sec(6.0)
		var best9 := Vector3.ZERO
		var dir9 := Vector3.FORWARD
		var bd9 := INF
		for R9 in life9._roads:
			if R9["cls"] != "avenue":
				continue
			var P9: PackedVector3Array = R9["p"]
			for qi in range(1, P9.size()):
				var dd9 := P9[qi].distance_to(hp9)
				if dd9 < bd9:
					bd9 = dd9
					best9 = P9[qi]
					dir9 = (P9[qi] - P9[qi - 1]).normalized()
		await _look("night_avenue", best9 - dir9 * 30.0 + dir9.cross(Vector3.UP) * 6.0 + Vector3(0, 3, 0), best9 + dir9 * 40.0 + Vector3(0, 2, 0))
		await _look("night_aerial", best9 + Vector3(-120, 90, 120), best9)
		await _look("night_street", hp9 + Vector3(10, 2, 10), hp9 + Vector3(-20, 3, -20))
		get_tree().quit()
		return
	if OS.get_cmdline_user_args().has("stops"):
		_hour(15.0)
		var bj: BusJob = main.get("bus_job")
		for si in [0, 3]:
			if si >= bj.stops.size():
				continue
			var st9: Dictionary = bj.stops[si]
			var rgt: Vector3 = st9["right"]
			var sp: Vector3 = (st9["p"] as Vector3) + rgt * 5.2
			ow.hold = sp
			ow.preload_at(sp)
			await _sec(2.0)
			var fw9 := rgt.cross(Vector3.UP)
			await _look("stop_%d" % si, sp - rgt * 9.0 + fw9 * 7.0 + Vector3(0, 2.2, 0), sp + Vector3(0, 1.4, 0))
			var xb: Transform3D = Transform3D(Basis(Vector3.UP, atan2(rgt.x, rgt.z)), sp)
			await _look("stop_%d_ad" % si, xb * Vector3(-3.1, 1.4, 3.2), xb * Vector3(-3.1, 1.2, 0.3))
			await _look("stop_%d_panel" % si, xb * Vector3(-1.2, 1.3, -2.6), xb * Vector3(-2.3, 1.2, 0.0))
		get_tree().quit()
		return
	if OS.get_cmdline_user_args().has("missions"):
		_hour(19.0)
		var mis9: Missions = main.get_node("Missions")
		await _sec(1.0)
		for id9 in mis9.markers:
			var mp: Vector3 = mis9.markers[id9]["pos"]
			ow.hold = mp
			ow.preload_at(mp)
			await _sec(2.0)
			await _look("mission_%s" % id9, mp + Vector3(7, 3.0, 7), mp + Vector3(0, 2.5, 0))
		get_tree().quit()
		return
	if OS.get_cmdline_user_args().has("parked"):
		_hour(14.0)
		var life8: CityLife = main.get_node("CityLife")
		life8.enabled = true
		life8.max_parked = 12
		life8.max_cars = 4
		var s8: CarSession = main.get("car_session")
		cam.make_current()
		cam.global_position = (s8.player as Node3D).global_position + Vector3(0, 3, 0)
		await _sec(8.0)
		var n8 := 0
		for c8 in life8.cars:
			if not c8.get("parked", false):
				continue
			var cn8: Node3D = c8["node"]
			life8.enabled = false
			await _look("parked_%d" % n8, cn8.global_position + cn8.global_basis * Vector3(4.0, 2.2, -9.0), cn8.global_position + cn8.global_basis * Vector3(0, 0.6, 3.0))
			life8.enabled = true
			n8 += 1
			if n8 >= 3:
				break
		get_tree().quit()
		return
	if OS.get_cmdline_user_args().has("flowers"):
		_hour(12.0)
		var pp9: PhotoPlaces = main.get_node("PhotoPlaces")
		for st9 in pp9.sites:
			if st9["id"] != "city_park":
				continue
			var x9: Transform3D = st9["xf"]
			ow.hold = x9.origin
			ow.preload_at(x9.origin)
			pp9.build_site(st9)
			await _sec(3.0)
			await _look("flowers_close", x9 * Vector3(4.5, 1.2, 36.0), x9 * Vector3(7.5, 0.2, 39.5))
			await _look("flowers_bed", x9 * Vector3(2.0, 2.2, 30.0), x9 * Vector3(7.5, 0.3, 40.0))
			await _look("roses", x9 * Vector3(0, 1.5, 15.5), x9 * Vector3(0, 0.3, 10.5))
		get_tree().quit()
		return
	if OS.get_cmdline_user_args().has("police"):
		_hour(18.3)
		var pol: Police = main.get_node("Police")
		var s7: CarSession = main.get("car_session")
		var life3: CityLife = main.get_node("CityLife")
		life3.enabled = true
		cam.make_current()
		cam.global_position = (s7.player as Node3D).global_position + Vector3(0, 3, 0)
		await _sec(6.0)
		pol.set_stars(3)
		for q7 in 14:
			await _sec(1.0)
		var tp7: Vector3 = (s7.player as Node3D).global_position
		var best7: Node3D = null
		for c7 in pol.cops:
			var cn: Node3D = c7["node"]
			if best7 == null or cn.global_position.distance_to(tp7) < best7.global_position.distance_to(tp7):
				best7 = cn
		if best7:
			pol.enabled = false
			await _look("police_car", best7.global_position + best7.global_basis * Vector3(3.5, 1.6, -6.0), best7.global_position + Vector3(0, 0.9, 0))
			await _look("police_arrive", tp7 + Vector3(-6, 2.5, 6), best7.global_position + Vector3(0, 1.0, 0))
		print("POLICE cops=", pol.cops.size())
		get_tree().quit()
		return
	if OS.get_cmdline_user_args().has("cabins"):
		_ui(false)
		var sc2: CarSession = main.get("car_session")
		for key in ["camry", "lexus"]:
			var cv: VehiclePrado = main.get(key)
			if sc2.driving:
				sc2.exit()
				await get_tree().create_timer(0.5).timeout
			sc2.player.teleport(cv.driver_door_point(0.7), 0.0)
			await get_tree().create_timer(0.5).timeout
			sc2._select(cv)
			sc2.enter()
			await get_tree().create_timer(1.5).timeout
			for k in 3:
				if sc2.cam.mode == 1:
					break
				sc2.cam.cycle()
				await get_tree().process_frame
			await get_tree().create_timer(1.0).timeout
			await _snap("cabin_" + key)
			sc2.cam.cycle()
			sc2.cam.cycle()
			await get_tree().create_timer(1.0).timeout
			await _snap("ext_" + key)
		get_tree().quit()
		return
	if OS.get_cmdline_user_args().has("matdebug"):
		_ui(false)
		var sc3: CarSession = main.get("car_session")
		var lx: VehiclePrado = main.get("lexus")
		var cols := [Color.RED, Color.GREEN, Color.BLUE, Color.YELLOW, Color.MAGENTA, Color.CYAN, Color.ORANGE, Color.PURPLE, Color.BROWN, Color.WHITE]
		var k2 := 0
		for mi in lx.model.find_children("*", "MeshInstance3D", true, false):
			var m := mi as MeshInstance3D
			for si in m.mesh.get_surface_count():
				var mat := m.get_active_material(si)
				print("MAT ", m.name, " s", si, " ", m.mesh.surface_get_name(si) if m.mesh is ArrayMesh else "", " -> ", cols[k2 % cols.size()], " ", mat.resource_name if mat else "")
				var sm := StandardMaterial3D.new()
				sm.albedo_color = cols[k2 % cols.size()]
				m.set_surface_override_material(si, sm)
				k2 += 1
		sc3.player.teleport(lx.driver_door_point(0.7), 0.0)
		await get_tree().create_timer(0.5).timeout
		sc3._select(lx)
		sc3.enter()
		await get_tree().create_timer(1.5).timeout
		for k in 3:
			if sc3.cam.mode == 1:
				break
			sc3.cam.cycle()
			await get_tree().process_frame
		await get_tree().create_timer(1.0).timeout
		await _snap("lexus_mats")
		get_tree().quit()
		return
	if OS.get_cmdline_user_args().has("cabin"):
		_ui(false)
		var sc: CarSession = main.get("car_session")
		var car0: VehiclePrado = main.get("car")
		sc.player.teleport(car0.driver_door_point(0.7), 0.0)
		await get_tree().create_timer(0.5).timeout
		sc._select(car0)
		sc.enter()
		await get_tree().create_timer(1.5).timeout
		while sc.cam.mode != 1:
			sc.cam.cycle()
			await get_tree().process_frame
		for st in [-1.0, 0.0, 1.0]:
			VehicleInput.scripted = {"steer": st, "brake": 1.0}
			await get_tree().create_timer(1.2).timeout
			await _snap("cabin_steer_%d" % int(st))
		VehicleInput.scripted = null
		get_tree().quit()
		return
	if OS.get_cmdline_user_args().has("weapons"):
		await _weapon_shots()
		get_tree().quit()
		return
	if OS.get_cmdline_user_args().has("hud"):
		await _hud_shots()
		get_tree().quit()
		return
	if OS.get_cmdline_user_args().has("junctions"):
		var jn := [[-54, -963], [12, -2724], [-1233, -3203], [560, -7282], [4318, -4320], [722, -9042], [-1303, -2444], [525, -7068]]
		for i in jn.size():
			var c := Vector3(jn[i][0], 0, jn[i][1])
			c.y = wd.height_at(c.x, c.z)
			await _look("junction_%d" % i, c + Vector3(26, 30, 34), c)
		get_tree().quit()
		return
	for spec in [["edge_country", "east", Vector3(3825, 26, -1985)], ["edge_city", "rudaki", Vector3(63, 28, -3172)]]:
		var e := _edge(spec[1], spec[2])
		var a: Vector3 = e[0]
		var dir: Vector3 = e[1]
		var right: Vector3 = e[2]
		var hw: float = e[3]
		var from := a + right * (hw + 13.0) - dir * 14.0
		from.y = wd.height_at(from.x, from.z) + 1.5
		await _look("%s_%s" % [spec[0], tag], from, a + right * (hw + 1.0) + dir * 16.0 + Vector3(0, -0.3, 0))
	if tag != "new":
		get_tree().quit()
		return
	# phone UI: low fuel -> the buy button; then the window
	_ui(true)
	var s: CarSession = main.get("car_session")
	var car: VehiclePrado = main.get("car")
	s.player.teleport(car.driver_door_point(0.7), 0.0)
	await get_tree().create_timer(0.3).timeout
	s._select(car)
	s.enter()
	s.controls.touch_mode = true
	car.fuel_l = 5.0
	await get_tree().create_timer(1.0).timeout
	await _snap("hud_fuel_low")
	var fs: FuelService = main.get("fuel")
	fs.open_delivery()
	await get_tree().create_timer(0.5).timeout
	await _snap("hud_fuel_window")
	fs._panel.visible = false
	car.fuel_l = 50.0
	# the map: a station picked -> marker + route along the roads, the card
	var wm: WorldMapScreen = main.get_node("WorldMap")
	var nav: RoadNav = main.get_node("RoadNav")
	while not nav.ready_graph:
		await get_tree().process_frame
	wm.toggle()
	var f: Dictionary = wd.fuel[2]
	wm.center = Vector2(f["x"], f["z"]) * 0.5 + Vector2(car.global_position.x, car.global_position.z) * 0.5
	wm.mpp = 6.0
	await get_tree().process_frame
	wm.select_at(wm.w2s(f["x"], f["z"]))
	await get_tree().create_timer(1.0).timeout
	await _snap("map_route")
	wm._btn_go.pressed.emit()
	await get_tree().create_timer(1.0).timeout
	await _snap("minimap_route")
	# the boat: its own fuel gauge
	s.exit()
	await get_tree().create_timer(0.5).timeout
	var bt: VehiclePrado = (main.get("boats") as Array)[0]
	s.player.teleport(bt.global_position + bt.global_transform.basis.x * 2.0, 0.0)
	await get_tree().create_timer(0.3).timeout
	s.enter_vehicle(bt)
	bt.fuel_l = 9.0
	await get_tree().create_timer(1.5).timeout
	await _snap("hud_boat_fuel")
	s.exit()
	_ui(false)
	# a billboard seen from its road, ~70 m before it
	var bb: Dictionary = wd.billboards[2]
	var e := _edge(str(bb["road"]), Vector3(bb["x"], bb["y"], bb["z"]))
	var ap: Vector3 = e[0]
	var dir: Vector3 = e[1]
	var right: Vector3 = e[2]
	var bp := Vector3(bb["x"], bb["y"], bb["z"])
	var side := signf((bp - ap).dot(right))
	var from := bp - dir * 70.0 - right * side * 6.0
	from.y = wd.height_at(from.x, from.z) + 1.6
	await _look("billboard_road", from, bp + Vector3(0, 12, 0))
	var from2 := bp + dir * 70.0 - right * side * 6.0
	from2.y = wd.height_at(from2.x, from2.z) + 1.6
	await _look("billboard_road2", from2, bp + Vector3(0, 12, 0))
	# a bridge over the Varzob (the water stays under the deck)
	var done := false
	for r in wd.roads:
		for br in r["bridges"]:
			var mid: Array = r["pts"][(int(br[0]) + int(br[1])) / 2]
			var m := Vector3(mid[0], mid[1], mid[2])
			var over := false
			for rv in wd.rivers:
				for q in rv["pts"]:
					if Vector2(float(q[0]) - m.x, float(q[2]) - m.z).length() < 15.0:
						over = true
			if not over:
				continue
			var a2: Array = r["pts"][int(br[0])]
			var d2 := (m - Vector3(a2[0], a2[1], a2[2])).normalized()
			var rr := d2.cross(Vector3.UP).normalized()
			await _look("bridge_river", m + rr * 40.0 + Vector3(0, 4, 0) - d2 * 12.0, m - Vector3(0, 3, 0))
			done = true
			break
		if done:
			break
	get_tree().quit()


func _snap(label: String) -> void:
	for i in 6:
		await RenderingServer.frame_post_draw
	get_viewport().get_texture().get_image().save_png("%s/s9_%s.png" % [out, label])
	print("S9 shot ", label)


func _edge(id: String, near: Vector3) -> Array:
	for r in wd.roads:
		if r["id"] != id:
			continue
		var pts: Array = r["pts"]
		var bk := 0
		var bd := INF
		for k in range(0, pts.size() - 2):
			var d := Vector2(float(pts[k][0]) - near.x, float(pts[k][2]) - near.z).length()
			if d < bd:
				bd = d
				bk = k
		var a := Vector3(pts[bk][0], pts[bk][1], pts[bk][2])
		var b := Vector3(pts[bk + 2][0], pts[bk + 2][1], pts[bk + 2][2])
		var dir := (b - a).normalized()
		return [a, dir, dir.cross(Vector3.UP).normalized(), float(r["w"]) * 0.5]
	return []


## the new HUD (mock-up style) on a phone layout: on foot, near a car, driving, the boat
func _hud_shots() -> void:
	_ui(true)
	var s: CarSession = main.get("car_session")
	var tc: Variant = s.get("walk_touch")
	if tc is CanvasLayer:
		(tc as CanvasLayer).visible = true
	if tc is Node and (tc as Node).has_method("set_shown"):
		(tc as Node).call("set_shown", true)
	s.set("_walk_touch_shown", true)
	var car: VehiclePrado = main.get("car")
	s.player.teleport(Vector3(-58, 2.4, -60), PI)
	s.player.get_camera().make_current()
	await get_tree().create_timer(2.0).timeout
	await _snap("hud_walk")
	s.player.teleport(car.driver_door_point(1.0), 0.0)
	await get_tree().create_timer(1.5).timeout
	await _snap("hud_walk_car")
	s._select(car)
	s.enter()
	s.controls.touch_mode = true
	car.fuel_l = car.tank_l * 0.72
	await get_tree().create_timer(2.0).timeout
	VehicleInput.scripted = {"throttle": 0.6}
	await get_tree().create_timer(3.0).timeout
	VehicleInput.scripted = null
	await _snap("hud_drive")
	car.fuel_l = car.tank_l * 0.08
	await get_tree().create_timer(0.6).timeout
	await _snap("hud_drive_lowfuel")


## the map's photo cards: in-game pictures of the sights -> assets/ui/cards/<id>.jpg (512 x 320)
func _card_shots() -> void:
	_hour(17.2)
	var specs := [
		["iskandar", Vector3(-3050, 0, -8000), 90.0, Vector3(-3330, 0, -8320), 0.0],
		["waterfall", Vector3(1460, 0, -7360), 25.0, Vector3(1460, 0, -7430), 18.0],
		["hisor", Vector3(-4430, 0, -2800), 30.0, Vector3(-4500, 0, -2900), 10.0],
		["romit", Vector3(4050, 0, -2050), 45.0, Vector3(4350, 0, -2600), 120.0],
	]
	for sp in specs:
		var from: Vector3 = sp[1]
		var at: Vector3 = sp[3]
		await _look("card_" + str(sp[0]), from, at, float(sp[2]), float(sp[4]))
		_save_card(str(sp[0]))
	# the embankment (peninsula): along the promenade, towards the sea
	var tp: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://data/terrain/paths.json"))
	var pr: Array = tp["promenade"]
	var q0: Array = pr[pr.size() / 3]
	var q1: Array = pr[pr.size() / 3 + 12]
	var a := Vector3(q0[0], 0, q0[1])
	var b := Vector3(q1[0], 0, q1[1])
	a.y = CityWorld.instance.terrain_height(a.x, a.z) + 6.0
	b.y = CityWorld.instance.terrain_height(b.x, b.z) + 2.0
	await _look("card_embankment", a - (b - a).normalized() * 30.0 + Vector3(0, 4, 0), b + Vector3(0, 0, 0))
	_save_card("embankment")


func _save_card(id: String) -> void:
	var img := get_viewport().get_texture().get_image()
	var w := img.get_width()
	var h := img.get_height()
	var cw := mini(w, int(h * 1.6))
	img = img.get_region(Rect2i((w - cw) / 2, 0, cw, h))
	img.resize(512, 320, Image.INTERPOLATE_LANCZOS)
	img.save_jpg(ProjectSettings.globalize_path("res://assets/ui/cards/%s.jpg" % id), 0.86)
	print("CARD ", id)


func _post() -> void:
	for i in 3:
		await RenderingServer.frame_post_draw


func _weapon_shots() -> void:
	_ui(true)
	var s: CarSession = main.get("car_session")
	var tc: Variant = s.get("walk_touch")
	if tc is Node and (tc as Node).has_method("set_shown"):
		(tc as Node).call("set_shown", true)
	var shop: GunShop = main.get_node("GunShop")
	var combat: PlayerCombat = main.get_node("PlayerCombat")
	var camry: VehiclePrado = main.get("camry")
	Wallet.money = 8000
	# the shop from the avenue
	s.player.teleport(shop.door_point() + Vector3(9, 0, 4), PI * 0.5 + 0.35)
	s.player.get_camera().make_current()
	s.player.cam_yaw = PI * 0.5 + 0.35
	await get_tree().create_timer(2.0).timeout
	await _snap("w_shop_outside")
	shop.open()
	await get_tree().create_timer(0.5).timeout
	await _snap("w_shop_panel")
	shop._buy("pistol")
	shop._buy("ak47")
	shop._buy("bat")
	shop._ammo("ak47")
	await get_tree().create_timer(0.3).timeout
	await _snap("w_shop_bought")
	shop._panel.visible = false
	# the wheel
	var top: TopHud = main.get_node("TopHudLayer/TopHud")
	top.set_wheel(true)
	await get_tree().create_timer(0.4).timeout
	await _snap("w_wheel")
	top.set_wheel(false)
	# pistol at the Camry
	var tp := camry.global_position + camry.global_transform.basis.x * 9.0
	var yaw := atan2(-(camry.global_position - tp).x, -(camry.global_position - tp).z)
	s.player.teleport(tp, yaw)
	s.player.cam_yaw = yaw
	s.player.cam_pitch = deg_to_rad(-6.0)
	Weapons.select("pistol")
	await get_tree().create_timer(1.5).timeout
	for k in 3:
		PlayerInput.queue_fire()
		await get_tree().create_timer(0.35).timeout
	PlayerInput.queue_fire()
	await get_tree().physics_frame
	await get_tree().physics_frame
	await _post()
	get_viewport().get_texture().get_image().save_png("%s/s9_w_pistol.png" % out)
	# AK burst
	Weapons.select("ak47")
	await get_tree().create_timer(0.6).timeout
	PlayerInput.fire_held = true
	await get_tree().create_timer(0.45).timeout
	await _post()
	get_viewport().get_texture().get_image().save_png("%s/s9_w_ak.png" % out)
	PlayerInput.fire_held = false
	# bat
	Weapons.select("bat")
	await get_tree().create_timer(0.8).timeout
	await _snap("w_bat")
	# smoke / fire / explosion
	camry.health = 25.0
	await get_tree().create_timer(2.5).timeout
	await _snap("w_car_smoke")
	camry.health = 8.0
	await get_tree().create_timer(2.0).timeout
	await _snap("w_car_fire")
	var vf: VehicleFire = camry.get_node("Fire")
	vf.explode()
	await get_tree().create_timer(0.25).timeout
	await _snap("w_explosion")
	await get_tree().create_timer(4.5).timeout
	await _snap("w_after")
	print("PLAYER HEALTH ", PlayerLife.health, " dead ", PlayerLife.dead)


func _v18_shots() -> void:
	var s: CarSession = main.get("car_session")
	var dealer: CarDealer = main.get_node("CarDealer")
	var dp := dealer.global_position
	await _look("v18_dealer", dp + Vector3(34, 9, 26), dp + Vector3(2, 3, 0))
	await _look("v18_dealer_inside", dp + Vector3(5.5, 2.2, 8.5), dp + Vector3(-2, 1.0, -3))
	# the city garage + one along a country road (built near the player)
	var svc: AutoService = main.get_node("AutoService")
	var sp: Dictionary = svc.spots[svc.spots.size() - 1]
	for k in [sp, svc.spots[min(8, svc.spots.size() - 1)]]:
		var gp: Vector3 = k["pos"]
		var yaw: float = k["yaw"]
		var fwd := Vector3(cos(yaw), 0, -sin(yaw))
		s.player.teleport(gp + fwd * 14.0 + Vector3(0, 1, 0), 0.0)
		ow.preload_at(gp)
		await _sec(2.5)
		await _look("v18_garage_%d" % svc.spots.find(k), gp + fwd * 24.0 + fwd.cross(Vector3.UP) * 14.0 + Vector3(0, 6, 0), gp + Vector3(0, 2, 0))
	# swimming in the lake Iskandar
	var lake := Vector3(-3300, 520.0, -8050)
	ow.preload_at(lake)
	ow.hold = lake
	await _sec(1.0)
	s.player.teleport(lake + Vector3(0, 0.5, 0), 0.0)
	await _sec(3.0)
	var pw: Variant = s.player.get("water")
	print("V18 lake: water level %.1f, mode %s, player y %.1f" % [pw.level if pw else -1.0, str(pw.mode) if pw else "-", s.player.global_position.y])
	await _look("v18_lake_swim", s.player.global_position + Vector3(5, 2.5, 6), s.player.global_position)
	ow.hold = Vector3.INF
	# the pass road on the slope (no viaduct)
	var ps := _road("pass")
	var pts: Array = ps["pts"]
	var pk: Array = pts[int(pts.size() * 0.55)]
	var pp := Vector3(pk[0], pk[1], pk[2])
	await _look("v18_mountain_road", pp + Vector3(90, 70, 60), pp)
	# the boat (bow forward)
	var boats: Array = main.get("boats")
	if not boats.is_empty():
		var b: Node3D = boats[0]
		await _look("v18_boat", b.global_position + b.global_basis.x * 9.0 + Vector3(0, 3, 0) + b.global_basis.z * -4.0, b.global_position)
	# Camry with its driver's door open
	var camry: VehiclePrado = main.get("camry")
	camry.set_door("door_lf_dummy", true)
	await _sec(1.0)
	await _look("v18_camry_door", camry.global_position + camry.global_basis.x * -6.0 + camry.global_basis.z * -4.0 + Vector3(0, 1.8, 0), camry.global_position + Vector3(0, 0.6, 0))
	var lexus: VehiclePrado = main.get("lexus")
	lexus.set_door("door_lf_dummy", true)
	await _sec(1.0)
	await _look("v18_lexus_door", lexus.global_position + lexus.global_basis.x * -6.0 + lexus.global_basis.z * -4.0 + Vector3(0, 1.8, 0), lexus.global_position + Vector3(0, 0.8, 0))


func _sec(t: float) -> void:
	for i in int(t * 60):
		await get_tree().physics_frame


func _road(id: String) -> Dictionary:
	for r in wd.roads:
		if r["id"] == id:
			return r
	return {}
