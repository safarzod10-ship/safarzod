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
	# the map: a station picked, the card
	var wm: WorldMapScreen = main.get_node("WorldMap")
	wm.toggle()
	var f: Dictionary = wd.fuel[2]
	wm.center = Vector2(f["x"], f["z"]) + Vector2(60, 40)
	wm.mpp = 5.0
	await get_tree().process_frame
	wm.select_at(wm.w2s(f["x"], f["z"]))
	await get_tree().create_timer(0.5).timeout
	await _snap("map_card")
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
