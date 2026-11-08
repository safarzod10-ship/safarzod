extends Node
## Open-world screenshots (real renderer, the game's own streaming): landmarks of Dushanbe, the
## Varzob gorge (road, river, bridge), switchbacks, a tunnel portal, the pass, the lake, Gissar,
## a village, night, rain, the map screen. Positions come from data/world/world.json.
##   xvfb-run godot --path . res://scenes/testing/world_views.tscn -- out=<dir>
var main: Node
var out := "/tmp"
var cam: Camera3D
var wd: WorldData
var ow: OpenWorld


func _ready() -> void:
	for a in OS.get_cmdline_user_args():
		if a.begins_with("out="):
			out = a.substr(4)
	Settings.set_mode("high")
	main = (load("res://scenes/main/main.tscn") as PackedScene).instantiate()
	add_child(main)
	while main.get("car_session") == null:
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
	var lm := {}
	for l in wd.landmarks:
		lm[l["id"]] = l
	# ---- Dushanbe
	await _look("somoni", _lm(lm, "somoni") + Vector3(10, 6, -85), _lm(lm, "somoni") + Vector3(0, 22, 8))
	await _look("rudaki_avenue", Vector3(-28, 0, -2200), Vector3(-40, 0, -2600), 6.0, 6.0)
	await _look("palace_flag", _lm(lm, "palace") + Vector3(-120, 30, 160), _lm(lm, "flag") + Vector3(0, 40, 0))
	await _look("navruz_opera", _lm(lm, "navruz") + Vector3(120, 25, 140), _lm(lm, "navruz") + Vector3(0, 12, 0))
	await _look("library_museum", Vector3(0, 0, -3240), Vector3(0, 0, -3380), 12.0, 10.0)
	await _look("city_aerial", Vector3(900, 0, -1300), Vector3(0, 0, -2900), 260.0, 20.0)
	# ---- Varzob gorge: M34 bridge, river
	var m34 := _road("m34")
	var br: Array = m34["bridges"][0] if not (m34["bridges"] as Array).is_empty() else [600, 620]
	var bp := _pt(m34, int((br[0] + br[1]) / 2))
	await _look("varzob_bridge", bp + Vector3(45, 18, 35), bp)
	await _look("varzob_gorge", _pt(m34, 1500) + Vector3(0, 60, 120), _pt(m34, 1900))
	# ---- switchbacks (lake descent) from above, tunnel portal, pass, lake
	var ld := _road("lake_down")
	await _look("serpentine", _pt(ld, 900) + Vector3(150, 160, 120), _pt(ld, 900))
	var ps := _road("pass")
	if not (ps["tunnels"] as Array).is_empty():
		var tu: Array = ps["tunnels"][0]
		var a := _pt(ps, int(tu[0]) - 10)
		var b := _pt(ps, int(tu[0]))
		await _look("tunnel_portal", a + (a - b).normalized() * 25.0 + Vector3(0, 6, 0), b + Vector3(0, 3, 0))
	await _look("pass_view", Vector3(-1500, 0, -7700), Vector3(-3300, 0, -8300), 40.0, 0.0)
	await _look("lake", Vector3(-2700, 0, -8000), Vector3(-3400, 0, -8400), 40.0, -20.0)
	# ---- Gissar
	await _look("gissar_fortress", _lm(lm, "hisor_fort") + Vector3(40, 18, -150), _lm(lm, "hisor_fort") + Vector3(0, 10, 0))
	await _look("village", Vector3(4120, 0, -2200), Vector3(4250, 0, -2350), 25.0, 0.0)
	var wf: Dictionary = wd.waterfalls[0]
	var wfp := Vector3(wf["x"], float(wf["bottom"]) + 10.0, wf["z"])
	await _look("waterfall", wfp + Vector3(-55, 6, 35), wfp)
	# ---- night city, rain in the mountains
	_hour(21.5)
	await _look("night_city", Vector3(-28, 0, -2150), Vector3(-40, 0, -2600), 8.0, 8.0)
	_hour(13.0)
	for w in get_tree().get_nodes_in_group(&"weather"):
		w.call("set_state", 2, true)
	await _look("rain_mountains", _pt(m34, 1400) + Vector3(-10, 4, 20), _pt(m34, 1500))
	for w in get_tree().get_nodes_in_group(&"weather"):
		w.call("set_state", 0, true)
	# ---- the map screen (UI)
	_ui(true)
	var wm := main.get_node_or_null("WorldMap")
	if wm:
		wm.call("toggle")
		wm.set("center", Vector2(-500, -5200))
		wm.set("mpp", 9.0)
		for i in 6:
			await RenderingServer.frame_post_draw
		get_viewport().get_texture().get_image().save_png("%s/w_map.png" % out)
		print("W shot map")
	get_tree().quit()


func _road(id: String) -> Dictionary:
	for r in wd.roads:
		if r["id"] == id:
			return r
	return {}


func _pt(r: Dictionary, k: int) -> Vector3:
	var pts: Array = r["pts"]
	var p: Array = pts[clampi(k, 0, pts.size() - 1)]
	return Vector3(p[0], p[1], p[2])


func _lm(lm: Dictionary, id: String) -> Vector3:
	var d: Dictionary = lm[id]
	return Vector3(d["x"], d["y"], d["z"])


func _ground(p: Vector3) -> float:
	return wd.height_at(p.x, p.z) if wd.contains(p.x, p.z) else CityWorld.instance.terrain_height(p.x, p.z)


## camera at `from` (or at its xz + h above the ground) looking at `at` (or its ground + th)
func _look(label: String, from: Vector3, at: Vector3, h := -1.0, th := NAN) -> void:
	if h >= 0.0:
		from.y = _ground(from) + h
	if not is_nan(th):
		at.y = _ground(at) + th
	cam.global_position = from
	cam.look_at(at, Vector3.UP)
	cam.make_current()
	ow.preload_at(from)
	for i in 600:
		await get_tree().process_frame
		if ow._jobs.is_empty() and ow._results.is_empty() and i > 90:
			break
	for i in 6:
		await RenderingServer.frame_post_draw
	get_viewport().get_texture().get_image().save_png("%s/w_%s.png" % [out, label])
	print("W shot ", label)


func _hour(h: float) -> void:
	for t in get_tree().get_nodes_in_group(&"time_of_day"):
		t.call("set_hour", h)


func _ui(on: bool) -> void:
	for n in get_tree().root.find_children("*", "CanvasLayer", true, false):
		if n.has_method("set_shown"):
			n.call("set_shown", false)
		elif n.name != "Touch":
			(n as CanvasLayer).visible = on and n.name == "WorldMap"
