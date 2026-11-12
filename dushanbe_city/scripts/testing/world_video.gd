extends Node
## Open-world driving video (Movie Maker, real renderer + game sound): the Prado driven by the
## journey test's autopilot along the real route; several fragments of the same journey (edited
## together: each fragment starts with the car placed on the route at that point).
##   godot --path . --write-movie out.avi --fixed-fps 30 --resolution 960x540 \
##         res://scenes/testing/world_video.tscn
var main: Node
var car: VehiclePrado
var s: CarSession
var R: Node                     ## the journey test (route builder)
var _cap: Label


func _ready() -> void:
	Settings.set_mode("medium")
	main = (load("res://scenes/main/main.tscn") as PackedScene).instantiate()
	add_child(main)
	while main.get("car_session") == null:
		await get_tree().physics_frame
	s = main.get("car_session")
	car = s.car
	for w in get_tree().get_nodes_in_group(&"weather"):
		w.call("set_state", 0, true)
		w.set("auto_cycle", false)
	R = (load("res://tests/world_drive_test.gd") as GDScript).new()
	R.set("main", main)
	R.set("wd", WorldData.get_instance())
	R.call("_build_route")
	s.player.teleport(car.driver_door_point(1.0), 0.0)
	s.enter()
	var legs: Array = R.get("legs")
	var clips := [
		["Душанбе: проспект Рудаки (материк)", _leg(legs, "Проспект Рудаки на север"), 0.45, 14.0, 11.0],
		["М34: ущелье Варзоба, река", _leg(legs, "М34"), 0.55, 14.0, 12.5],
		["Перевальная дорога: серпантин и тоннель", _leg(legs, "Перевальная"), 0.2, 16.0, 14.0],
		["Горное озеро", _leg(legs, "Озёрная"), 0.3, 12.0, 15.5],
		["Спуск в Гиссар", _leg(legs, "Спуск"), 0.5, 12.0, 17.0],
		["Гиссар: сельская дорога", _leg(legs, "Гиссар —"), 0.6, 12.0, 18.5],
		["Ночной Душанбе", _leg(legs, "Проспект Рудаки на юг"), 0.3, 12.0, 21.5],
	]
	for c in clips:
		var leg: Array = c[1]
		var k := int(lerpf(float(leg[1]), float(leg[2]), c[2]))
		_hour(c[4])
		await _drive_from(k, c[3], c[0])
	get_tree().quit()


func _leg(legs: Array, prefix: String) -> Array:
	for l in legs:
		if String(l[0]).begins_with(prefix):
			return l
	return legs[0]


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
		_cap.position = Vector2(300, 470)
		cl.add_child(_cap)
	_cap.text = t


func _drive_from(k: int, secs: float, title: String) -> void:
	var route: Array = R.get("route")
	var hw: Array = R.get("hw")
	var p: Vector3 = route[k]
	var q: Vector3 = route[mini(k + 3, route.size() - 1)]
	var ow: OpenWorld = main.get("open_world")
	ow.preload_at(p)
	for i in 600:
		await get_tree().process_frame
		if ow._jobs.is_empty() and ow._results.is_empty() and i > 60:
			break
	car.place(p + Vector3.UP * 2.0, atan2(-(q.x - p.x), -(q.z - p.z)))
	car.linear_velocity = -car.global_transform.basis.z * 12.0
	s.cam.snap()
	_caption(title)
	var idx := k
	var integral := 0.0
	var t := 0.0
	while t < secs:
		await get_tree().physics_frame
		t += 1.0 / Engine.physics_ticks_per_second
		var pos := car.global_position
		var bd := INF
		for j in range(idx, mini(idx + 60, route.size())):
			var d := Vector2((route[j] as Vector3).x - pos.x, (route[j] as Vector3).z - pos.z).length()
			if d < bd:
				bd = d
				idx = j
		var v := car.linear_velocity.length()
		var look := (9.0 + v * 0.9) if float(hw[idx]) > 5.0 else (5.0 + v * 0.55)
		var tgt := idx
		var acc := 0.0
		while tgt < route.size() - 1 and acc < look:
			acc += (route[tgt] as Vector3).distance_to(route[tgt + 1])
			tgt += 1
		var to: Vector3 = (route[tgt] as Vector3) - pos
		var ang := atan2(to.dot(car.global_transform.basis.x), to.dot(-car.global_transform.basis.z))
		var turn := 0.0
		var k2 := idx
		var acc2 := 0.0
		while k2 < route.size() - 2 and acc2 < 45.0:
			var d1: Vector3 = (route[k2 + 1] as Vector3) - (route[k2] as Vector3)
			var d2: Vector3 = (route[k2 + 2] as Vector3) - (route[k2 + 1] as Vector3)
			turn += absf(Vector2(d1.x, d1.z).angle_to(Vector2(d2.x, d2.z)))
			acc2 += d1.length()
			k2 += 1
		var vmax := 65.0 if float(hw[idx]) > 6.0 else 45.0
		var vt := clampf(vmax - turn * 38.0, 14.0, vmax)
		var err := vt - car.speed_kmh
		integral = clampf(integral + err / 60.0, -20.0, 20.0)
		VehicleInput.scripted = {"throttle": clampf(err * 0.08 + integral * 0.02, 0.0, 1.0),
			"brake": clampf(-err * 0.06, 0.0, 1.0) if err < -4.0 else 0.0, "steer": clampf(ang * 2.2, -1.0, 1.0)}
	VehicleInput.scripted = null
