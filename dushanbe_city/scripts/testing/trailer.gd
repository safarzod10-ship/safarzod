extends "res://scripts/testing/stage8_video.gd"
## 0.25 trailer (YouTube 16:9 and Shorts 9:16): cinematic camera flights + real driving, big titles.
## Frames are saved as JPG only while a shot runs (streaming / loading between shots is cut out),
## the game runs at a fixed 30 fps so the motion is smooth whatever the render speed:
##   xvfb-run godot --path . --fixed-fps 30 --resolution 1280x720 res://scenes/testing/trailer.tscn -- out=DIR [vertical]
##   ffmpeg -framerate 30 -i DIR/%05d.jpg ... trailer.mp4

var out := "user://trailer"
var vertical := false
var part := 0                 ## 0 all, 1 city, 2 mountains + night + end (separate runs: memory)
var _rec := false
var _n := 0
var _cam: Camera3D
var _title: Label
var _sub: Label
var _bar: ColorRect
var _layer: CanvasLayer
var _cap_t := 0
var _hidden: Array = []


func _ready() -> void:
	for a in OS.get_cmdline_user_args():
		if a.begins_with("out="):
			out = a.substr(4)
		if a == "vertical":
			vertical = true
		if a.begins_with("part="):
			part = int(a.substr(5))
	DirAccess.make_dir_recursive_absolute(out)
	Wallet.no_save = true
	Settings.set_mode("high")
	main = (load("res://scenes/main/main.tscn") as PackedScene).instantiate()
	add_child(main)
	while main.get("bus_job") == null or main.get("bus") == null:
		await get_tree().physics_frame
	await _frames(60)
	s = main.get("car_session")
	wd = WorldData.get_instance()
	ow = main.get("open_world")
	_weather(0)
	_build_titles()
	RenderingServer.frame_post_draw.connect(_grab)
	_cam = Camera3D.new()
	_cam.fov = 62.0 if not vertical else 72.0
	_cam.far = 9000.0
	add_child(_cam)
	var life: CityLife = main.get_node_or_null("CityLife")
	if life:
		life.enabled = true
		life.max_cars = 12
		life.max_peds = 10
	await _shots()
	_rec = false
	print("TRAILER frames=%d" % _n)
	get_tree().quit()


# ------------------------------------------------------------------------------------------ shots
func _shots() -> void:
	var home := (s.player as Node3D).global_position
	var av := _avenue_near(home)
	var avp: Vector3 = av[0]
	var avd: Vector3 = av[1]
	var avr := avd.cross(Vector3.UP)
	var somoni := _lm("somoni")
	var prado: VehiclePrado = main.get("car")
	if part != 2:
		await _city(home, avp, avd, avr, somoni, prado)
	if part != 1:
		await _nature_night(avp, avd, avr, somoni, prado)


func _city(home: Vector3, avp: Vector3, avd: Vector3, avr: Vector3, somoni: Vector3, prado: VehiclePrado) -> void:
	# 1. title: over the Somoni square at golden hour
	_hour(17.6)
	await _line(somoni + Vector3(-170, 115, 170), somoni + Vector3(-80, 62, 100), somoni + Vector3(0, 10, 0), somoni + Vector3(0, 15, 0), 5.0,
		"DUSHANBE CITY", "Открытый мир · Таджикистан")
	# 2. living avenue: traffic and pedestrians
	_hour(15.5)
	await _line(avp - avd * 40.0 + avr * 9.0 + Vector3(0, 2.2, 0), avp - avd * 10.0 + avr * 9.0 + Vector3(0, 3.0, 0),
		avp + avd * 30.0 + Vector3(0, 1.0, 0), avp + avd * 40.0 + Vector3(0, 1.0, 0), 4.0, "Живой город", "трафик · прохожие · светофоры")
	# 3. the Prado, with the game's HUD
	_show_hud(true)
	await _drive(prado, avp, 5.0, 75.0, "Toyota Land Cruiser Prado", "реальная физика · звук дизеля")
	_show_hud(false)
	# 4. GLS black
	var gls: VehiclePrado = main.get("gls")
	if gls:
		await _drive(gls, avp + avd * 300.0, 4.0, 80.0, "Mercedes GLS · BMW E30", "таджикские номера · свой гараж")
	# 5. showroom
	var mb: Node3D = main.get_node_or_null("CarDealer_mb")
	if mb:
		var t2 := mb.global_transform
		await _orbit(t2 * Vector3(6, 0, 0), 44.0, 17.0, 1.2, 2.0, t2.basis, 3.5, "Автосалоны", "Mercedes-Benz · BMW · Toyota")
	# 6. tuning
	var e30: VehiclePrado = main.get("e30")
	if e30:
		e30.set_tuning({"tint": 0.9, "rims": "d9a520", "spoiler": true})
		await _orbit(e30.global_position, 7.5, 2.2, -1.2, 0.6, e30.global_basis, 3.5, "Тюнинг", "диски · тонировка · спойлер · покраска")
	# 7-8. AMID
	var am: AmidStores = main.get_node_or_null("AmidStores")
	if am and not am.stores.is_empty():
		var st: Dictionary = am.stores[0]
		var xf: Transform3D = st["xf"]
		ow.hold = am.door_point(st)
		s.player.teleport(am.door_point(st) + Vector3(0, 0.5, 0), 0.0)
		await _line(xf * Vector3(30, 30, 120), xf * Vector3(0, 13, 78), xf * Vector3(0, 6, 25), xf * Vector3(0, 5, 22), 3.5,
			"Супермаркет AMID", "покупки · еда · готовим плов дома")
		await _line(xf * Vector3(-3, 2.2, 22), xf * Vector3(-8, 1.9, 6), xf * Vector3(-9, 1.4, -10), xf * Vector3(-10, 1.3, -20), 3.0, "", "")
		s.player.teleport(home, 0.0)
	# 9-10. Parki Dusti
	var pp: PhotoPlaces = main.get_node_or_null("PhotoPlaces")
	if pp:
		for site in pp.sites:
			if site["node"] == null:
				pp.build_site(site)
		for site in pp.sites:
			var x2: Transform3D = site["xf"]
			if site["id"] == "city_park":
				await _line(x2 * Vector3(0, 4.0, 72), x2 * Vector3(0, 4.5, 30), x2 * Vector3(0, 6.5, 40), x2 * Vector3(0, 3.0, 0), 4.0,
					"Парк Дусти", "арка · фонтан · беседки")
				await _orbit(x2.origin, 17.0, 5.0, 0.6, 1.8, x2.basis, 3.0, "", "")
		for site in pp.sites:
			var x3: Transform3D = site["xf"]
			if site["id"] == "police":
				await _line(x3 * Vector3(22, 6, 46), x3 * Vector3(6, 4, 34), x3 * Vector3(0, 4.5, -2), x3 * Vector3(0, 5, -2), 3.0, "Полиция", "")
	# 11. taxi client
	var taxi: TaxiJob = main.get_node_or_null("TaxiJob")
	if taxi:
		var kp := taxi.laklak._kerb_near(avp + avr * 30.0) if taxi.laklak else Vector3.INF
		if kp != Vector3.INF:
			taxi._spawn_client(kp, kp + Vector3(6, 0, 3))
			kp.y = maxf(kp.y, wd.height_at(kp.x, kp.z))
			var cf := Vector3(6, 0, 3).normalized()
			var cs := cf.cross(Vector3.UP)
			await _line(kp + cf * 7.0 + cs * 2.0 + Vector3(0, 2.0, 0), kp + cf * 4.0 + cs * 1.0 + Vector3(0, 1.7, 0), kp + Vector3(0, 1.2, 0), kp + Vector3(0, 1.3, 0), 3.0,
				"Работа", "такси · курьер LakLak · автобус")
			taxi._remove_client()
	# 12. realty
	var re: Realty = main.get_node_or_null("Realty")
	if re and re.props.size() > 1:
		var P: Dictionary = re.props.filter(func(q: Dictionary) -> bool: return q["kind"] == "house")[0]
		var pp2: Vector3 = P["pos"]
		var fw := Vector3(sin(float(P["yaw"])), 0, cos(float(P["yaw"])))
		var sd := fw.cross(Vector3.UP)
		await _line(pp2 + fw * 8.0 + sd * 5.0 + Vector3(0, 4.5, 0), pp2 + fw * 4.5 + sd * 2.0 + Vector3(0, 3.0, 0),
			pp2 + Vector3(0, 2.0, 0) - fw * 4.0, pp2 + Vector3(0, 2.0, 0) - fw * 4.0, 2.5, "Недвижимость", "дом · квартира · гараж")
	# 13. flag park
	var flag := _lm("flag")
	await _orbit(flag, 150.0, 75.0, 0.0, 0.7, Basis.IDENTITY, 3.5, "Площадь флага", "")


func _nature_night(avp: Vector3, avd: Vector3, avr: Vector3, somoni: Vector3, prado: VehiclePrado) -> void:
	# 14. mountains: the Anzob pass serpentine
	_hour(14.0)
	_show_hud(false)
	await _drive_road_shot(prado, "pass", Vector3(-1500, 0, -7750), 6.0, 55.0, "Горы Варзоба", "серпантины · перевал Анзоб")
	# 16. night rain on the avenue
	_hour(21.5)
	_weather(2)
	await _line(avp + avr * 12.0 + Vector3(0, 6, 0) - avd * 30.0, avp + avr * 8.0 + Vector3(0, 4, 0) + avd * 10.0,
		avp + avd * 60.0, avp + avd * 80.0, 4.0, "День и ночь", "дождь · снег · огни ночного города")
	# 18. end card
	_weather(0)
	_hour(17.6)
	await _line(somoni + Vector3(140, 75, -140), somoni + Vector3(80, 45, -80), somoni + Vector3(0, 12, 0), somoni + Vector3(0, 15, 0), 4.5,
		"DUSHANBE CITY", "Скоро на Android · v0.25")


# ------------------------------------------------------------------------------------------ helpers
func _lm(id: String) -> Vector3:
	var l: Dictionary = wd.landmark(id)
	return Vector3(float(l["x"]), float(l["y"]), float(l["z"])) if not l.is_empty() else Vector3(0, 10, -2600)


func _avenue_near(p: Vector3) -> Array:
	var best := Vector3.ZERO
	var bdir := Vector3.FORWARD
	var bd := INF
	for r in wd.roads:
		if String(r["cls"]) != "avenue":
			continue
		var pts: Array = r["pts"]
		for i in range(2, pts.size() - 2):
			var q := Vector3(pts[i][0], pts[i][1], pts[i][2])
			var d := q.distance_to(p)
			if d < bd:
				bd = d
				best = q
				var q2 := Vector3(pts[i + 2][0], pts[i + 2][1], pts[i + 2][2])
				bdir = (q2 - q).normalized()
	return [best, bdir]


func _weather(st: int) -> void:
	for w in get_tree().get_nodes_in_group(&"weather"):
		w.set("auto_cycle", false)
		w.call("set_state", st, true)


func _grab() -> void:
	if not _rec:
		return
	var img := get_viewport().get_texture().get_image()
	img.save_jpg("%s/%05d.jpg" % [out, _n], 0.92)
	_n += 1


func _show_hud(on: bool) -> void:
	if not on:
		_hidden.clear()
		for cl in get_tree().root.find_children("*", "CanvasLayer", true, false):
			if cl != _layer and (cl as CanvasLayer).visible:
				(cl as CanvasLayer).visible = false
				_hidden.append(cl)
	else:
		for cl in _hidden:
			if is_instance_valid(cl):
				(cl as CanvasLayer).visible = true
		_hidden.clear()


func _set_titles(t: String, sub: String) -> void:
	_title.text = t
	_sub.text = sub
	_bar.visible = t != ""
	_cap_t = 0


func _tick_titles() -> void:
	_cap_t += 1
	var a := clampf(_cap_t / 9.0, 0.0, 1.0)
	_title.modulate.a = a
	_sub.modulate.a = clampf((_cap_t - 6) / 9.0, 0.0, 1.0)
	_bar.modulate.a = a
	_bar.scale.x = a


## camera flight from p0 -> p1 looking from l0 -> l1 over secs (smooth in / out)
func _line(p0: Vector3, p1: Vector3, l0: Vector3, l1: Vector3, secs: float, t: String, sub: String) -> void:
	_show_hud(false)
	ow.hold = (l0 + l1) * 0.5
	await _wait((p0 + l0) * 0.5)
	_cam.make_current()
	_set_titles(t, sub)
	var n := int(secs * 30.0)
	for i in n:
		var k := smoothstep(0.0, 1.0, float(i) / float(n - 1))
		var p := p0.lerp(p1, k)
		var l := l0.lerp(l1, k)
		_cam.global_position = p
		if p.distance_to(l) > 0.01:
			_cam.look_at(l, Vector3.UP)
		_tick_titles()
		_rec = true
		await get_tree().process_frame
	_rec = false


## orbit round c (radius r, height h) from angle a0 to a1 (radians, in basis b)
func _orbit(c: Vector3, r: float, h: float, a0: float, a1: float, b: Basis, secs: float, t: String, sub: String) -> void:
	_show_hud(false)
	ow.hold = c
	await _wait(c)
	_cam.make_current()
	_set_titles(t, sub)
	var n := int(secs * 30.0)
	for i in n:
		var k := float(i) / float(n - 1)
		var a := lerpf(a0, a1, k)
		_cam.global_position = c + b * Vector3(sin(a) * r, h, cos(a) * r)
		_cam.look_at(c + Vector3(0, h * 0.25, 0), Vector3.UP)
		_tick_titles()
		_rec = true
		await get_tree().process_frame
	_rec = false


## a car drives (autopilot) on the road nearest to p; the game's chase camera; recorded
func _drive(v: VehiclePrado, p: Vector3, secs: float, vmax: float, t: String, sub: String) -> void:
	ow.hold = Vector3.INF
	var route := _nearest_road(p)
	await _drive_rec(v, route, p, secs, vmax, -60.0, t, sub)


func _drive_road_shot(v: VehiclePrado, id: String, near: Vector3, secs: float, vmax: float, t: String, sub: String) -> void:
	ow.hold = Vector3.INF
	await _drive_rec(v, _road_pts(id), near, secs, vmax, -120.0, t, sub)


func _drive_rec(v: VehiclePrado, route: Array, near: Vector3, secs: float, vmax: float, back: float, t: String, sub: String) -> void:
	# run up unrecorded for 2 s (the car settles, the camera catches up), then record
	await _drive_pts(v, route, near, 2.0, vmax, back)
	_set_titles(t, sub)
	var rec := func() -> void:
		for i in int(secs * 30.0):
			_tick_titles()
			_rec = true
			await get_tree().process_frame
		_rec = false
	rec.call()
	await _drive_pts(v, route, v.global_position, secs, vmax, 0.0, Vector3.INF, false)
	_rec = false
	VehicleInput.scripted = {"brake": 1.0}
	await _frames(2)
	VehicleInput.scripted = null
	if s.driving:
		s.exit()
		await _frames(3)


func _build_titles() -> void:
	_layer = CanvasLayer.new()
	_layer.layer = 100
	add_child(_layer)
	var vs := get_viewport().get_visible_rect().size
	var font: Font = load("res://assets/fonts/game_font.tres")
	var unit := minf(vs.x, vs.y)
	_title = Label.new()
	_title.add_theme_font_override("font", font)
	_title.add_theme_font_size_override("font_size", int(unit * (0.085 if not vertical else 0.082)))
	_title.add_theme_color_override("font_color", Color(1, 1, 1))
	_title.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.85))
	_title.add_theme_constant_override("outline_size", int(unit * 0.012))
	_title.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.5))
	_title.add_theme_constant_override("shadow_offset_y", int(unit * 0.006))
	_sub = Label.new()
	_sub.add_theme_font_override("font", font)
	_sub.add_theme_font_size_override("font_size", int(unit * (0.042 if not vertical else 0.046)))
	_sub.add_theme_color_override("font_color", Color(1.0, 0.82, 0.3))
	_sub.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.85))
	_sub.add_theme_constant_override("outline_size", int(unit * 0.008))
	_bar = ColorRect.new()
	_bar.color = Color(1.0, 0.75, 0.15)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", int(unit * 0.01))
	_layer.add_child(box)
	box.add_child(_title)
	box.add_child(_sub)
	_layer.add_child(_bar)
	for l in [_title, _sub]:
		(l as Label).autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		(l as Label).custom_minimum_size.x = vs.x * (0.9 if vertical else 0.85)
		if vertical:
			(l as Label).horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	if vertical:
		box.position = Vector2(vs.x * 0.05, vs.y * 0.62)
		_bar.size = Vector2(vs.x * 0.3, unit * 0.012)
		_bar.position = Vector2(vs.x * 0.35, vs.y * 0.62 - unit * 0.03)
	else:
		box.position = Vector2(vs.x * 0.06, vs.y * 0.66)
		_bar.size = Vector2(vs.x * 0.12, unit * 0.012)
		_bar.position = Vector2(vs.x * 0.06, vs.y * 0.66 - unit * 0.02)
	_bar.pivot_offset = Vector2.ZERO
	_set_titles("", "")
