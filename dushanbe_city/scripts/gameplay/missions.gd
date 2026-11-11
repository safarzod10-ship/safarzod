class_name Missions
extends Node
## GTA-style missions: yellow «M» markers in the city; walk into one (on foot) -> the mission starts.
##  «Гонка по Душанбе»  : get in any car, 8 checkpoints along the avenues in 120 s       -> 1500 smn
##  «Срочная доставка»  : drive to the address across the city in 90 s, no big damage    -> 800 smn
##  «Угон на заказ»     : steal a black GLS from the traffic / the street, bring it to the garage marker -> 3000 smn
## Checkpoints / the target: a beacon + the navigator target; a timer on screen; fail: time out or
## the car wrecked. Completed missions are saved (Wallet.missions) and their marker goes grey.

signal mission_done(id: String, ok: bool)

const DEFS := {
	"race": {"title": "Гонка по Душанбе", "pay": 1500, "time": 120.0},
	"delivery": {"title": "Срочная доставка", "pay": 800, "time": 90.0},
	"steal": {"title": "Угон на заказ", "pay": 3000, "time": 300.0},
}

var session: CarSession
var laklak: LakLakJob
var wd: WorldData
var markers := {}              ## id -> {pos, node}
var active := ""
var cps: PackedVector3Array = PackedVector3Array()
var cp_i := 0
var t_left := 0.0
var _beacon: Node3D
var _beam: StandardMaterial3D
var _ui: CanvasLayer
var _hud: Label
var _msg: Label
var _msg_t := 0.0
var _rearm := ""               ## a marker you must walk away from (6 m) before it can start again


func _ready() -> void:
	wd = WorldData.get_instance()
	_build_ui()
	_beacon = _make_beacon(Color(1.0, 0.85, 0.1, 0.4), 6.0)
	_beacon.visible = false
	add_child(_beacon)
	if wd == null or not wd.ok:
		return
	await get_tree().process_frame
	# markers at the kerbs of three avenues near the centre
	var spots := {"race": Vector3(-60, 0, -2300), "delivery": Vector3(300, 0, -2650), "steal": Vector3(-150, 0, -3100)}
	for id in spots:
		var k := laklak._kerb_near(spots[id]) if laklak else Vector3.INF
		if k == Vector3.INF:
			continue
		# from the carriageway edge onto the sidewalk (towards the block)
		var into: Vector3 = k - _road_centre(k)
		into.y = 0.0
		if into.length() > 0.5:
			k += into.normalized() * 4.2
			k.y = maxf(k.y, wd.height_at(k.x, k.z)) + 0.15
		var n := _make_marker(id)
		add_child(n)
		n.global_position = k
		markers[id] = {"pos": k, "node": n}


func _road_centre(p: Vector3) -> Vector3:
	var best := INF
	var out := p
	for r in wd.roads:
		if not String(r["cls"]) in ["avenue", "highway", "street"]:
			continue
		for q in r["pts"]:
			var d := Vector2(float(q[0]) - p.x, float(q[2]) - p.z).length()
			if d < best:
				best = d
				out = Vector3(float(q[0]), float(q[1]), float(q[2]))
	return out


func _make_beacon(col: Color, r: float) -> Node3D:
	var b := Node3D.new()
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	m.albedo_color = col
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	var cyl := MeshInstance3D.new()
	var cm := CylinderMesh.new()
	cm.top_radius = r * 0.7
	cm.bottom_radius = r
	cm.height = 40.0
	cm.cap_top = false
	cm.cap_bottom = false
	cyl.mesh = cm
	cyl.material_override = m
	cyl.position.y = 20.0
	cyl.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	b.add_child(cyl)
	_beam = m
	return b


func _make_marker(id: String) -> Node3D:
	var n := Node3D.new()
	n.name = "Mission_" + id
	var done := Wallet.missions.has(id)
	var col := Color(0.6, 0.6, 0.6, 0.35) if done else Color(1.0, 0.8, 0.1, 0.45)
	n.add_child(_make_beacon(Color(col.r, col.g, col.b, 0.22), 0.8))
	var l := Label3D.new()
	l.text = "M"
	l.font = load("res://assets/fonts/DejaVuSans-Bold.ttf")
	l.font_size = 160
	l.pixel_size = 0.01
	l.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	l.modulate = Color(0.7, 0.7, 0.7) if done else Color(1.0, 0.85, 0.2)
	l.outline_size = 16
	l.no_depth_test = true
	l.position.y = 3.2
	n.add_child(l)
	var t := l.duplicate() as Label3D
	t.text = String(DEFS[id]["title"]) + ("  ✓" if done else "  · " + Wallet.fmt(int(DEFS[id]["pay"])))
	t.font_size = 48
	t.pixel_size = 0.008
	t.position.y = 2.1
	n.add_child(t)
	return n


func start(id: String) -> void:
	if active != "" or not DEFS.has(id):
		return
	active = id
	t_left = float(DEFS[id]["time"])
	cp_i = 0
	cps = PackedVector3Array()
	var from: Vector3 = markers[id]["pos"] if markers.has(id) else (session.player as Node3D).global_position
	match id:
		"race":
			var p := from
			for k in 8:
				var q := _kerb_away(p, 250.0, 450.0)
				if q == Vector3.INF:
					q = _kerb_away(p, 150.0, 900.0)
				if q == Vector3.INF:
					break
				cps.append(q)
				p = q
			_say("ГОНКА: садись в машину и проедь %d точек за %d с" % [cps.size(), int(t_left)])
		"delivery":
			var q2 := _kerb_away(from, 1200.0, 2000.0)
			if q2 != Vector3.INF:
				cps.append(q2)
			_say("ДОСТАВКА: груз в машину и на адрес за %d с" % int(t_left))
		"steal":
			cps.append(from)                         # bring the GLS back here
			_say("УГОН: найди чёрный Mercedes GLS на улицах, угони и пригони сюда")
	if cps.is_empty():
		active = ""


func _kerb_away(p: Vector3, rmin: float, rmax: float) -> Vector3:
	var rng := RandomNumberGenerator.new()
	rng.randomize()
	for attempt in 600:
		var b: Array = wd.buildings[rng.randi() % wd.buildings.size()]
		var bp := Vector3(float(b[1]), float(b[8]), float(b[2]))
		var d := Vector2(bp.x - p.x, bp.z - p.z).length()
		if d < rmin or d > rmax or absf(bp.x) > 2100.0 or bp.z > -900.0 or bp.z < -4900.0:
			continue
		var k := laklak._kerb_near(bp) if laklak else Vector3.INF
		if k != Vector3.INF:
			return k
	return Vector3.INF


func _process(delta: float) -> void:
	_msg_t -= delta
	_msg.visible = _msg_t > 0.0
	if session == null or session.player == null:
		return
	var me: Node3D = session.car if session.driving else session.player as Node3D
	if active == "":
		_hud.visible = false
		_beacon.visible = false
		if not session.driving:
			for id in markers:
				if Wallet.missions.has(id):
					continue
				var dm: float = (session.player as Node3D).global_position.distance_to(markers[id]["pos"])
				if id == _rearm:
					if dm > 6.0:
						_rearm = ""
					continue
				if dm < 2.5:
					start(id)
		return
	t_left -= delta
	var target := cps[cp_i]
	_beacon.visible = true
	_beacon.global_position = target
	Minimap.target = target
	Minimap.target_owner = self
	var d := Vector2(me.global_position.x - target.x, me.global_position.z - target.z).length()
	_hud.visible = true
	_hud.text = "%s · %d/%d · %d с · %.0f м" % [DEFS[active]["title"], cp_i + 1, cps.size(), int(maxf(t_left, 0.0)), d]
	var in_car := session.driving and session.car != null
	if active == "steal":
		in_car = in_car and session.car is VehicleCar and (session.car as VehicleCar).preset == "gls" and String(session.car.name).begins_with("Stolen")
	if in_car and session.car.wrecked:
		_finish(false, "Машина разбита")
		return
	if t_left <= 0.0:
		_finish(false, "Время вышло")
		return
	if in_car and d < (12.0 if active == "race" else 9.0):
		cp_i += 1
		if cp_i >= cps.size():
			_finish(true, "")
		else:
			_say("Точка %d/%d" % [cp_i, cps.size()])


func _finish(ok: bool, why: String) -> void:
	var id := active
	active = ""
	_rearm = id
	_beacon.visible = false
	if Minimap.target_owner == self:
		Minimap.target = Vector3.INF
		Minimap.target_owner = null
	if ok:
		var pay := int(DEFS[id]["pay"])
		Wallet.earn(pay)
		if not Wallet.missions.has(id):
			Wallet.missions.append(id)
		Wallet.save_state()
		_say("ЗАДАНИЕ ВЫПОЛНЕНО!\n+%s" % Wallet.fmt(pay))
		if markers.has(id):
			(markers[id]["node"] as Node).queue_free()
			var n := _make_marker(id)
			add_child(n)
			n.global_position = markers[id]["pos"]
			markers[id]["node"] = n
	else:
		_say("ЗАДАНИЕ ПРОВАЛЕНО\n" + why)
	mission_done.emit(id, ok)


func _say(t: String) -> void:
	_msg.text = t
	_msg_t = 3.5


func _build_ui() -> void:
	_ui = CanvasLayer.new()
	_ui.layer = 18
	add_child(_ui)
	var font: Font = load("res://assets/fonts/DejaVuSans-Bold.ttf")
	_hud = Label.new()
	_hud.add_theme_font_override("font", font)
	_hud.add_theme_font_size_override("font_size", 24)
	_hud.add_theme_color_override("font_color", Color(1.0, 0.85, 0.25))
	_hud.add_theme_color_override("font_outline_color", Color.BLACK)
	_hud.add_theme_constant_override("outline_size", 8)
	_hud.set_anchors_preset(Control.PRESET_CENTER_BOTTOM)
	_hud.position = Vector2(-350, -170)
	_hud.size = Vector2(700, 40)
	_hud.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_hud.visible = false
	_ui.add_child(_hud)
	_msg = Label.new()
	_msg.add_theme_font_override("font", font)
	_msg.add_theme_font_size_override("font_size", 40)
	_msg.add_theme_color_override("font_color", Color(1.0, 0.9, 0.4))
	_msg.add_theme_color_override("font_outline_color", Color.BLACK)
	_msg.add_theme_constant_override("outline_size", 10)
	_msg.set_anchors_preset(Control.PRESET_CENTER)
	_msg.offset_left = -550
	_msg.offset_right = 550
	_msg.offset_top = -160
	_msg.offset_bottom = -40
	_msg.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_msg.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_msg.visible = false
	_ui.add_child(_msg)
