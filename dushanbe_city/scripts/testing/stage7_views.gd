extends Node
## Stage 7 screenshots (real renderer, the game's own streaming): the LakLak van, the LakLak depot,
## a motorboat on the sea (floating, driving), a DushanbeCity billboard, guardrails on a mountain
## road, the national flag, skyscrapers, villas, a rounded junction with zebra crossings, the new
## grass (open world + peninsula lawn), the city from above (curved streets, rounded ring road).
##   xvfb-run godot --path . res://scenes/testing/stage7_views.tscn -- out=<dir>
var main: Node
var out := "/tmp"
var cam: Camera3D
var wd: WorldData
var ow: OpenWorld


func _ready() -> void:
	for a in OS.get_cmdline_user_args():
		if a.begins_with("out="):
			out = a.substr(4)
	Wallet.no_save = true
	Settings.set_mode("high")
	main = (load("res://scenes/main/main.tscn") as PackedScene).instantiate()
	add_child(main)
	while main.get("car_session") == null or main.get("laklak") == null:
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
	var van: VehicleVan = main.get("van")
	var boats: Array = main.get("boats")
	var lm := {}
	for l in wd.landmarks:
		lm[l["id"]] = l
	# ---- LakLak van and depot
	if van:
		var vp := van.global_position
		var b := van.global_transform.basis
		await _look("van_side", vp + b.x * 7.0 + Vector3(0, 1.2, 0) - b.z * 1.0, vp + Vector3(0, 0.8, 0), -1.0, NAN, true)
		await _look("van_rear", vp + b.z * 8.0 - b.x * 3.0 + Vector3(0, 2.0, 0), vp + Vector3(0, 1.0, 0), -1.0, NAN, true)
		await _look("van_front", vp - b.z * 7.5 + b.x * 3.5 + Vector3(0, 1.6, 0), vp + Vector3(0, 0.9, 0), -1.0, NAN, true)
	var dep: Dictionary = lm.get("laklak", {})
	if not dep.is_empty():
		var dp := Vector3(dep["x"], dep["y"], dep["z"])
		await _look("laklak_depot", dp + Vector3(-70, 22, -48), dp + Vector3(5, 4, 0))
	# ---- boat on the sea / lake
	if not boats.is_empty():
		var bt: VehicleBoat = boats[0]
		var bp := bt.global_position
		await _look("boat_sea", bp + Vector3(9, 3.5, 7), bp, -1.0, NAN, true)
	# ---- billboard, guardrail, flag
	if not wd.billboards.is_empty():
		var bb: Dictionary = wd.billboards[3 % wd.billboards.size()]
		var p := Vector3(bb["x"], bb["y"], bb["z"])
		var yaw := float(bb["yaw"])
		var front := Vector3(cos(yaw), 0, -sin(yaw))        # model +X (poster) in world
		await _look("billboard", p + front * 30.0 + Vector3(0, 9, 0), p + Vector3(0, 9.0, 0))
	if not wd.guardrails.is_empty():
		var best: Dictionary = wd.guardrails[0]
		for g in wd.guardrails:
			if (g["p"] as Array).size() > (best["p"] as Array).size():
				best = g
		var gp: Array = best["p"]
		var q: Array = gp[gp.size() / 2]
		var q2: Array = gp[mini(gp.size() / 2 + 6, gp.size() - 1)]
		var gq := Vector3(q[0], q[1], q[2])
		var gd := (Vector3(q2[0], q2[1], q2[2]) - gq).normalized()
		await _look("guardrail", gq - gd * 14.0 + Vector3(0, 3.0, 0) + Vector3(-gd.z, 0, gd.x) * -3.0, gq + gd * 10.0)
	var fl: Dictionary = lm.get("flag", {})
	if not fl.is_empty():
		var fp := Vector3(fl["x"], fl["y"], fl["z"])
		await _look("flag", fp + Vector3(-160, 30, 190), fp + Vector3(0, 95, 0))
	# ---- skyscrapers, villas
	var sky := Vector3.INF
	var villa := []
	for b2 in wd.buildings:
		if b2[0] == "sky" and sky == Vector3.INF:
			sky = Vector3(b2[1], b2[8], b2[2])
		elif String(b2[0]).begins_with("villa") and villa.is_empty() and absf(float(b2[1])) < 2600.0:
			villa = b2
	if sky != Vector3.INF:
		await _look("skyscrapers", sky + Vector3(260, 70, 260), sky + Vector3(0, 55, 0))
	if not villa.is_empty():
		var v3 := Vector3(villa[1], villa[8], villa[2])
		await _look("villa", v3 + Vector3(30, 14, 34), v3 + Vector3(0, 4, 0))
	# ---- rounded junction + zebra crossings (from above and at street level)
	if not wd.fillets.is_empty():
		var f0: Dictionary = wd.fillets[40 % wd.fillets.size()]
		var c := Vector3(f0["c"][0], f0["c"][1], f0["c"][2])
		var o := Vector3(f0["o"][0], f0["c"][1], f0["o"][1])
		var jx := c + (c - o).normalized() * 12.0
		await _look("junction_top", jx + Vector3(0.1, 60, 0), jx)
		await _look("junction_street", jx + (o - c).normalized() * 30.0 + Vector3(0, 2.0, 0), jx + Vector3(0, 0.5, 0))
	# ---- grass: open-world lawn (city) and the peninsula lawn
	var gpt := _grass_point(Vector3(300, 0, -2000))
	if gpt != Vector3.INF:
		await _look("grass_world", gpt + Vector3(4.5, 1.4, 4.5), gpt + Vector3(-3, 0.0, -3), -1.0, NAN, false, true)
	var lawns: Array = (main.get("world") as CityWorld).city.get("lawns", [])
	var lb := []
	for l in lawns:
		var rr: Array = l[1]
		if lb.is_empty() or (rr[2] - rr[0]) * (rr[3] - rr[1]) > (lb[2] - lb[0]) * (lb[3] - lb[1]):
			lb = rr
	if not lb.is_empty():
		var lc := Vector3((lb[0] + lb[2]) * 0.5, 0.0, (lb[1] + lb[3]) * 0.5)
		lc.y = CityWorld.city_relief(lc.x, lc.z) + 0.15
		await _look("grass_peninsula", lc + Vector3(3.0, 1.3, 3.0), lc + Vector3(-4, 0.0, -4), -1.0, NAN, false, true)
	# ---- city plan from above (curved streets, rounded ring road)
	await _look("city_from_above", Vector3(-600, 650, -1500), Vector3(0, 0, -2700))
	await _look("city_street_curve", Vector3(-40, 0, -3300), Vector3(-60, 0, -3700), 9.0, 4.0)
	get_tree().quit()


func _grass_point(near: Vector3) -> Vector3:
	for r in range(0, 900, 15):
		for k in 24:
			var a := TAU * k / 24.0
			var p := near + Vector3(cos(a), 0, sin(a)) * r
			if wd.grass_ok(p.x, p.z) and wd.road_edge_dist(p.x, p.z) > 14.0:
				p.y = wd.height_at(p.x, p.z)
				return p
	return Vector3.INF


func _ground(p: Vector3) -> float:
	return wd.height_at(p.x, p.z) if wd.contains(p.x, p.z) else CityWorld.instance.terrain_height(p.x, p.z)


## camera at `from` (or at its xz + h above the ground) looking at `at` (or its ground + th)
func _look(label: String, from: Vector3, at: Vector3, h := -1.0, th := NAN, settle := false, grass := false) -> void:
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
		if ow._jobs.is_empty() and ow._results.is_empty() and i > (150 if settle else 90):
			break
	if grass:
		var gf: Node = main.get_node_or_null("Grass")
		if gf:
			gf.set("override_camera", cam)
			gf.call("rebuild", from)
		for i in 10:
			await get_tree().process_frame
	for i in 6:
		await RenderingServer.frame_post_draw
	get_viewport().get_texture().get_image().save_png("%s/s7_%s.png" % [out, label])
	print("S7 shot ", label)


func _hour(h: float) -> void:
	for t in get_tree().get_nodes_in_group(&"time_of_day"):
		t.call("set_hour", h)


func _ui(on: bool) -> void:
	for n in get_tree().root.find_children("*", "CanvasLayer", true, false):
		if n.has_method("set_shown"):
			n.call("set_shown", false)
		elif n.name != "Touch":
			(n as CanvasLayer).visible = on
