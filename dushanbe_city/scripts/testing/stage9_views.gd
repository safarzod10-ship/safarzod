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
	if OS.get_cmdline_user_args().has("cards"):
		await _card_shots()
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
