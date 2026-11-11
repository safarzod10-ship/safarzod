class_name BusJob
extends Node
## City bus driver job, route №1 (a loop over the real city roads):
##   ave. Rudaki north -> ave. Shotemur (ew3200) east -> ave. Aini south -> ave. Borbad (ew1600) west
##   -> back to Rudaki. Stops every ~480 m at the right-hand kerb (shelter + sign with the stop name:
##   the nearest landmark, else the street), never inside a junction.
## 1. At the terminus stop: «СТАТЬ ВОДИТЕЛЕМ АВТОБУСА» hires the player (saved).
## 2. In the bus: the next stop is marked (beacon, minimap, map). Stop the bus at it (< 15 m,
##    < 4 km/h) for 2.5 s: passengers get off / on (random, up to 70 aboard). Pay: 3 smn per
##    passenger boarding + 5 smn per stop served; +60 smn for every complete loop.
## 3. Driving past a stop (> 40 m beyond it without stopping) misses it: no pay there.

signal stop_served(index: int, pay: int)

const STOP_EVERY := 480.0
const STOP_RADIUS := 15.0
const FARE := 3
const STOP_WAGE := 5
const LOOP_BONUS := 60
const CAPACITY := 70

var session: CarSession
var bus: VehicleCar
var wd: WorldData
var route: Array[Vector3] = []          ## the loop's centre line (4 m points)
var route_hw: Array[float] = []
var stops: Array = []                    ## [{"p": Vector3 (kerb lane), "k": route index, "name": String, "right": Vector3}]
var next_stop := 1
var passengers := 0
var shift_pay := 0
var loops := 0
var _dwell := 0.0
var _rng := RandomNumberGenerator.new()
var _ui: CanvasLayer
var _hud: Label
var _toast: Label
var _toast_t := 0.0
var _beacon: Node3D
var _office: Node
var _stop_nodes: Node3D


func _ready() -> void:
	Wallet.load_state()
	wd = WorldData.get_instance()
	_rng.seed = 1919
	_build_route()
	_build_ui()
	_build_beacon()
	_stop_nodes = Node3D.new()
	_stop_nodes.name = "BusStops"
	add_child(_stop_nodes)
	_office = BusOffice.new()
	_office.name = "BusOffice"
	_office.set("job", self)
	add_child(_office)


# ------------------------------------------------------------------------------------------ route
func _road(id: String) -> Array:
	for r in wd.roads:
		if r["id"] == id:
			return r["pts"]
	return []


func _hw(id: String) -> float:
	for r in wd.roads:
		if r["id"] == id:
			return float(r["w"]) * 0.5
	return 5.0


## index on road A nearest to road B (closest approach)
func _junction(A: Array, B: Array) -> int:
	var best := 0
	var bd := INF
	for i in range(0, A.size()):
		var pa := Vector2(A[i][0], A[i][2])
		for j in range(0, B.size(), 3):
			var d := pa.distance_to(Vector2(B[j][0], B[j][2]))
			if d < bd:
				bd = d
				best = i
	return best


func _slice(pts: Array, a: int, b: int) -> Array:
	if a <= b:
		return pts.slice(a, b + 1)
	var s := pts.slice(b, a + 1)
	s.reverse()
	return s


func _build_route() -> void:
	var legs := [["rudaki", "ew1600", "ew3200"], ["ew3200", "rudaki", "ave_e"], ["ave_e", "ew3200", "ew1600"], ["ew1600", "ave_e", "rudaki"]]
	for leg in legs:
		var pts := _road(leg[0])
		if pts.is_empty():
			return
		var a := _junction(pts, _road(leg[1]))
		var b := _junction(pts, _road(leg[2]))
		var hw := _hw(leg[0])
		for p in _slice(pts, a, b):
			var v := Vector3(p[0], p[1], p[2])
			if not route.is_empty() and route[route.size() - 1].distance_to(v) < 1.0:
				continue
			route.append(v)
			route_hw.append(hw)
	# stops: every STOP_EVERY m, at the right-hand kerb lane, not within 70 m of a corner
	var corners: Array[int] = []
	for k in range(1, route.size() - 1):
		var d1 := Vector2(route[k].x - route[k - 1].x, route[k].z - route[k - 1].z).normalized()
		var d2 := Vector2(route[k + 1].x - route[k].x, route[k + 1].z - route[k].z).normalized()
		if absf(d1.angle_to(d2)) > 0.35:
			corners.append(k)
	var acc := 0.0
	var last := -INF
	for k in range(1, route.size() - 1):
		acc += route[k].distance_to(route[k - 1])
		if acc - last < STOP_EVERY and not stops.is_empty():
			continue
		if stops.is_empty() and acc < 120.0:
			continue
		var near_corner := false
		for c in corners:
			if absf(float(c - k)) * 4.0 < 70.0:
				near_corner = true
		if near_corner:
			continue
		var dir := (route[k + 1] - route[k - 1]).normalized()
		var right := Vector3(-dir.z, 0, dir.x)
		var p := route[k] + right * maxf(route_hw[k] - 2.2, 1.6)
		stops.append({"p": p, "k": k, "right": right, "name": _stop_name(p, k)})
		last = acc


func _stop_name(p: Vector3, k: int) -> String:
	var best := ""
	var bd := 320.0
	for l in wd.landmarks:
		var d := Vector2(float(l["x"]) - p.x, float(l["z"]) - p.z).length()
		if d < bd:
			bd = d
			best = String(l["name"])
	if best != "":
		return best
	for r in wd.roads:
		if String(r["name"]) == "":
			continue
		for q in r["pts"]:
			if Vector2(float(q[0]) - p.x, float(q[2]) - p.z).length() < 3.0:
				return String(r["name"])
	return "остановка %d" % (stops.size() + 1)


## the bus at the terminus (stop 0), facing along the route, in the kerb lane
func bus_spawn() -> Transform3D:
	var s: Dictionary = stops[0]
	var k: int = s["k"]
	var dir := (route[k + 2] - route[k - 1]).normalized()
	return Transform3D(Basis(Vector3.UP, atan2(-dir.x, -dir.z)), s["p"] - dir * 4.0)


func office_point() -> Vector3:
	var s: Dictionary = stops[0] if not stops.is_empty() else {"p": Vector3.ZERO, "right": Vector3.RIGHT}
	return (s["p"] as Vector3) + (s["right"] as Vector3) * 5.5


## shelters + signs at every stop (built once the open world sectors exist around them)
func build_stops(props_mesh: Mesh) -> void:
	for i in stops.size():
		var s: Dictionary = stops[i]
		var right: Vector3 = s["right"]
		var p: Vector3 = (s["p"] as Vector3) + right * 5.2
		p.y = (s["p"] as Vector3).y + 0.15
		var yaw := atan2(right.x, right.z)
		var root := Node3D.new()
		root.name = "Stop%d" % i
		root.position = p
		root.rotation.y = yaw
		_stop_nodes.add_child(root)
		if props_mesh:
			var mi := MeshInstance3D.new()
			mi.mesh = props_mesh
			mi.rotation.y = PI
			mi.visibility_range_end = 250.0
			root.add_child(mi)
		_stop_dressing.call_deferred(root, s, i)


## the stop's sign (pole, blue plate «ОСТАНОВКА», route №, stop name), a lit advertising lightbox
## (the owner's banners), a bin, two small flower beds; built once per stop
func _stop_dressing(root: Node3D, s: Dictionary, i: int) -> void:
	var font: Font = load("res://assets/fonts/game_font.tres")
	var grey := StandardMaterial3D.new()
	grey.albedo_color = Color(0.3, 0.32, 0.35)
	grey.metallic = 0.6
	grey.roughness = 0.4
	var post := MeshInstance3D.new()
	var cm := CylinderMesh.new()
	cm.top_radius = 0.045
	cm.bottom_radius = 0.045
	cm.height = 3.0
	post.mesh = cm
	post.material_override = grey
	post.position = Vector3(3.4, 1.5, 1.2)
	root.add_child(post)
	var blue := StandardMaterial3D.new()
	blue.albedo_color = Color(0.05, 0.3, 0.7)
	var plate := MeshInstance3D.new()
	var pm := BoxMesh.new()
	pm.size = Vector3(0.7, 0.7, 0.04)
	plate.mesh = pm
	plate.material_override = blue
	plate.position = Vector3(3.4, 2.75, 1.2)
	root.add_child(plate)
	for face: float in [1.0, -1.0]:
		var bus := Label3D.new()
		bus.font = font
		bus.text = "🚌\nОСТАНОВКА"
		bus.font_size = 40
		bus.pixel_size = 0.0045
		bus.outline_size = 0
		bus.modulate = Color(1, 1, 1)
		bus.position = Vector3(3.4, 2.78, 1.2 + face * 0.025)
		bus.rotation.y = 0.0 if face > 0 else PI
		bus.visibility_range_end = 90.0
		root.add_child(bus)
		var rt := Label3D.new()
		rt.font = font
		rt.text = "А1 · %s" % String(s["name"])
		rt.font_size = 36
		rt.pixel_size = 0.0045
		rt.outline_size = 0
		rt.modulate = Color(0.1, 0.12, 0.15)
		rt.position = Vector3(3.4, 2.24, 1.2 + face * 0.025)
		rt.rotation.y = 0.0 if face > 0 else PI
		rt.visibility_range_end = 60.0
		root.add_child(rt)
	var white := StandardMaterial3D.new()
	white.albedo_color = Color(0.95, 0.95, 0.95)
	var rtb := MeshInstance3D.new()
	var rb := BoxMesh.new()
	rb.size = Vector3(1.3, 0.24, 0.035)
	rtb.mesh = rb
	rtb.material_override = white
	rtb.position = Vector3(3.4, 2.24, 1.2)
	root.add_child(rtb)
	# lit advertising lightbox at the end of the shelter
	var ads := ["ad_laklak", "ad_dcnext", "ad_eskhata", "ad_orienbank"]
	var tex_path := "res://assets/textures/ads/%s.png" % ads[i % ads.size()]
	var frame := MeshInstance3D.new()
	var fm := BoxMesh.new()
	fm.size = Vector3(0.18, 2.1, 1.3)
	frame.mesh = fm
	frame.material_override = grey
	frame.position = Vector3(-3.1, 1.15, 0.3)
	root.add_child(frame)
	if ResourceLoader.exists(tex_path):
		var am := StandardMaterial3D.new()
		am.albedo_texture = load(tex_path)
		am.emission_enabled = true
		am.emission_texture = am.albedo_texture
		am.emission_energy_multiplier = 0.7
		for face2: float in [1.0, -1.0]:
			var q := MeshInstance3D.new()
			var qm := QuadMesh.new()
			qm.size = Vector2(1.15, 1.9)
			q.mesh = qm
			q.material_override = am
			q.position = Vector3(-3.1 + face2 * 0.095, 1.15, 0.3)
			q.rotation.y = face2 * PI * 0.5
			q.visibility_range_end = 150.0
			root.add_child(q)
	# a bin and two flower beds beside the stop (the vegetation catalogue may still be loading)
	for w in 600:
		if OpenWorld.instance and not OpenWorld.instance._veg.is_empty():
			break
		await get_tree().process_frame
	if OpenWorld.instance:
		var g := root.global_transform
		var props := {"bin_modern_steel": [g * Transform3D(Basis.IDENTITY, Vector3(2.6, 0.0, 1.0))]}
		var trees := {"flowers_petunia": [], "flowers_salvia": [], "flowers_marigold": []}
		var stone := StandardMaterial3D.new()
		stone.albedo_color = Color(0.82, 0.8, 0.76)
		for bx in [-5.2, 5.6]:
			var bed := MeshInstance3D.new()
			var bm := BoxMesh.new()
			bm.size = Vector3(1.8, 0.3, 1.0)
			bed.mesh = bm
			bed.material_override = stone
			bed.position = Vector3(bx, 0.15, 0.6)
			root.add_child(bed)
			for fi in 10:
				var kind: String = ["flowers_petunia", "flowers_salvia", "flowers_marigold"][(fi / 2 + i) % 3]
				trees[kind].append(g * Transform3D(Basis.IDENTITY.scaled(Vector3.ONE * 1.2), Vector3(bx - 0.7 + (fi % 5) * 0.35, 0.3, 0.4 + (fi / 5) * 0.4)))
		var holder := Node3D.new()
		holder.name = "StopProps"
		holder.top_level = true
		root.add_child(holder)
		holder.global_transform = Transform3D.IDENTITY
		OpenWorld.instance._place_props(holder, props)
		OpenWorld.instance._trees(holder, trees, 0)


# ------------------------------------------------------------------------------------------ shift
func hire() -> void:
	if Wallet.bus_hired:
		_say("Вы уже водитель маршрута №1. Садитесь в автобус.")
		return
	Wallet.bus_hired = true
	Wallet.save_state()
	_say("Вы приняты водителем автобуса №1!\nСадитесь в автобус и везите пассажиров.")


func _in_bus() -> bool:
	return session != null and session.driving and session.car == bus and bus != null


func _process(delta: float) -> void:
	_toast_t -= delta
	_toast.visible = _toast_t > 0.0
	var on := _in_bus() and Wallet.bus_hired and not stops.is_empty()
	_beacon.visible = on
	_hud.visible = on or (_in_bus() and not Wallet.bus_hired)
	if _in_bus() and not Wallet.bus_hired:
		_hud.text = "Автобус №1 · устройтесь водителем на конечной остановке"
	if not on:
		if Minimap.target_owner == self:
			Minimap.target = Vector3.INF
			Minimap.target_owner = null
		return
	var s: Dictionary = stops[next_stop]
	var sp: Vector3 = s["p"]
	_beacon.global_position = sp
	Minimap.target = sp
	Minimap.target_owner = self
	var d := Vector2(bus.global_position.x - sp.x, bus.global_position.z - sp.z).length()
	_hud.text = "Автобус №1 · след. остановка %d/%d: %s · %.0f м · пассажиров %d · смена %s" % [next_stop + 1, stops.size(), s["name"], d, passengers, Wallet.fmt(shift_pay)]
	if d < STOP_RADIUS and bus.speed_kmh < 4.0:
		_dwell += delta
		if _dwell > 0.5 and _dwell - delta <= 0.5:
			_say("Двери открыты: посадка / высадка…", 2.0)
		if _dwell >= 2.5:
			serve_stop()
	else:
		_dwell = 0.0
		# missed: the bus is > 40 m beyond the stop along the route (closer to the next one)
		var n2: Dictionary = stops[(next_stop + 1) % stops.size()]
		var d2 := Vector2(bus.global_position.x - (n2["p"] as Vector3).x, bus.global_position.z - (n2["p"] as Vector3).z).length()
		var seg := (n2["p"] as Vector3).distance_to(sp)
		if d > 40.0 and d2 < seg - 40.0 and _ahead_of(sp):
			_say("Остановка «%s» пропущена!" % s["name"], 3.0)
			_advance()


## is the bus past point p along its heading?
func _ahead_of(p: Vector3) -> bool:
	var fwd := -bus.global_transform.basis.z
	return (bus.global_position - p).dot(fwd) > 0.0


func serve_stop() -> void:
	var s: Dictionary = stops[next_stop]
	var off := _rng.randi_range(mini(passengers, 1), int(passengers * 0.5) + (2 if passengers > 2 else 0))
	off = clampi(off, 0, passengers)
	passengers -= off
	var on := mini(_rng.randi_range(2, 11), CAPACITY - passengers)
	passengers += on
	var pay := on * FARE + STOP_WAGE
	shift_pay += pay
	Wallet.earn(pay)
	_say("«%s»: вышли %d, вошли %d · +%s" % [s["name"], off, on, Wallet.fmt(pay)], 3.5)
	stop_served.emit(next_stop, pay)
	_dwell = 0.0
	_advance()


func _advance() -> void:
	next_stop += 1
	if next_stop >= stops.size():
		next_stop = 0
	if next_stop == 1:
		loops += 1
		shift_pay += LOOP_BONUS
		Wallet.earn(LOOP_BONUS)
		_say("Круг маршрута пройден! Премия +%s" % Wallet.fmt(LOOP_BONUS), 4.0)


# ------------------------------------------------------------------------------------------ UI
func _say(t: String, secs := 4.0) -> void:
	_toast.text = t
	_toast_t = secs


func _build_ui() -> void:
	_ui = CanvasLayer.new()
	_ui.layer = 16
	add_child(_ui)
	var font: Font = load("res://assets/fonts/game_font.tres")
	_hud = Label.new()
	_hud.add_theme_font_override("font", font)
	_hud.add_theme_font_size_override("font_size", 17)
	_hud.add_theme_color_override("font_color", Color(0.7, 1.0, 0.75))
	_hud.add_theme_color_override("font_outline_color", Color.BLACK)
	_hud.add_theme_constant_override("outline_size", 6)
	_hud.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_ui.add_child(_hud)
	_toast = Label.new()
	_toast.add_theme_font_override("font", font)
	_toast.add_theme_font_size_override("font_size", 30)
	_toast.add_theme_color_override("font_color", Color(0.8, 1.0, 0.8))
	_toast.add_theme_color_override("font_outline_color", Color(0.0, 0.15, 0.05))
	_toast.add_theme_constant_override("outline_size", 10)
	_toast.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_toast.visible = false
	_ui.add_child(_toast)
	get_viewport().size_changed.connect(_layout)
	_layout()


func _layout() -> void:
	var vs := get_viewport().get_visible_rect().size
	var d := clampf(minf(vs.x, vs.y) * 0.22, 150.0, 320.0)
	_hud.position = Vector2(16 + d + 24, minf(vs.x, vs.y) * 0.175 + 34)
	_hud.size = Vector2(minf(vs.x * 0.45, 620.0), 60)
	_toast.position = Vector2(vs.x * 0.5 - 500, vs.y * 0.3)
	_toast.size = Vector2(1000, 100)


func _build_beacon() -> void:
	_beacon = Node3D.new()
	_beacon.name = "BusStopBeacon"
	add_child(_beacon)
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	m.albedo_color = Color(0.2, 0.9, 0.4, 0.3)
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	var col := MeshInstance3D.new()
	var cm := CylinderMesh.new()
	cm.top_radius = 1.4
	cm.bottom_radius = 2.0
	cm.height = 50.0
	cm.cap_top = false
	cm.cap_bottom = false
	col.mesh = cm
	col.material_override = m
	col.position.y = 25.0
	col.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_beacon.add_child(col)
	_beacon.visible = false
