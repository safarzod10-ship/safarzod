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
			await _look("city_fuel", fp + Vector3(40, 18, 40), fp)
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
			await _look("city_service", gp + Vector3(30, 14, 26), gp)
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
