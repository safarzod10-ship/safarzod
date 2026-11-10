class_name CarWash
extends Node
## 0.25 car wash («АВТОМОЙКА»), beside an auto service where the city would otherwise have a second
## AMID within 2 km (world.json "washes"; +X of the spot faces the road). Two covered bays with
## rotating brushes and water: drive into a bay, stop -> «ПОМЫТЬ · 30 смн»: brushes run over the car
## for a few seconds, water sprays, the car's dirt (VehiclePrado.dirt, from driving) goes to 0.
## Built only near the player (lazy, like the garages).

const PRICE := 30
const BUILD_DIST := 450.0
const WASH_TIME := 5.0
const BAY_Z := [-3.0, 3.0]          ## local Z of the two bays

var session: CarSession
var spots: Array = []                ## [{pos, yaw, node, brushes: Array, water: Array}]
var _ui: CanvasLayer
var _btn: Button
var _msg: Label
var _msg_t := 0.0
var _t := 0.0
var _washing := 0.0
var _wash_spot: Dictionary = {}
var _wash_bay := 0
var _mats := {}


func _ready() -> void:
	add_to_group(&"car_wash")
	var wd := WorldData.get_instance()
	if wd and wd.ok:
		for w in wd.washes:
			var yaw := float(w["yaw"])
			var o := Vector3(float(w["ox"]), 0.0, float(w["oz"]))
			o.y = wd.height_at(o.x, o.z)
			spots.append({"pos": o, "yaw": yaw, "node": null, "brushes": [], "water": []})
	_build_ui()


func _basis(s: Dictionary) -> Basis:
	return Basis(Vector3.UP, float(s["yaw"]))


## the stopping point in bay k (car centre)
func bay_point(s: Dictionary, k: int) -> Vector3:
	return (s["pos"] as Vector3) + _basis(s) * Vector3(-2.0, 0.0, BAY_Z[k])


func _process(delta: float) -> void:
	_t -= delta
	_msg_t -= delta
	_msg.visible = _msg_t > 0.0
	var focus := Vector3.ZERO
	if session:
		focus = session.car.global_position if session.driving and session.car else (session.player.global_position if session.player else Vector3.ZERO)
	if _t <= 0.0:
		_t = 1.0
		for s in spots:
			var d := Vector2(focus.x - (s["pos"] as Vector3).x, focus.z - (s["pos"] as Vector3).z).length()
			if d < BUILD_DIST and s["node"] == null:
				s["node"] = _build(s)
			elif d > BUILD_DIST + 80.0 and s["node"] != null:
				(s["node"] as Node).queue_free()
				s["node"] = null
	# the wash cycle: brushes travel along the car and spin, water runs
	if _washing > 0.0:
		_washing -= delta
		var ph := 1.0 - _washing / WASH_TIME
		for b in _wash_spot.get("brushes", []):
			var n := b as Node3D
			if is_instance_valid(n) and int(n.get_meta("bay")) == _wash_bay:
				n.rotate_object_local(Vector3.UP, delta * 14.0)
				var x0: float = n.get_meta("x0")
				n.position.x = x0 + sin(ph * PI * 2.0) * 2.4
		for wtr in _wash_spot.get("water", []):
			if is_instance_valid(wtr) and int((wtr as Node).get_meta("bay")) == _wash_bay:
				(wtr as CPUParticles3D).emitting = _washing > 0.0
		if _washing <= 0.0:
			var car := session.car if session else null
			if car:
				car.set_dirt(0.0)
			_say("Машина чистая!")
	var at := current_bay()
	_btn.visible = not at.is_empty() and _washing <= 0.0
	if _btn.visible:
		_btn.text = "ПОМЫТЬ · %s" % Wallet.fmt(PRICE)
		var vs := get_viewport().get_visible_rect().size
		_btn.reset_size()
		_btn.position = Vector2(vs.x * 0.5 - _btn.size.x * 0.5, vs.y * 0.6)


## {spot, bay} when the driven car stands still in a bay
func current_bay() -> Dictionary:
	if session == null or not session.driving or session.car == null:
		return {}
	var car: VehiclePrado = session.car
	if car.wrecked or car.speed_kmh > 3.0:
		return {}
	for s in spots:
		if s["node"] == null:
			continue
		for k in 2:
			if bay_point(s, k).distance_to(car.global_position) < 3.2:
				return {"spot": s, "bay": k}
	return {}


func wash() -> bool:
	var at := current_bay()
	if at.is_empty() or _washing > 0.0:
		return false
	var car: VehiclePrado = session.car
	if car.dirt < 0.02:
		_say("Машина и так чистая")
		return false
	if Wallet.money < PRICE:
		_say("Не хватает денег: мойка стоит %s" % Wallet.fmt(PRICE))
		return false
	Wallet.money -= PRICE
	Wallet.save_state()
	_wash_spot = at["spot"]
	_wash_bay = at["bay"]
	_washing = WASH_TIME
	_say("Мойка...")
	return true


func _say(t: String) -> void:
	_msg.text = t
	_msg_t = 2.5


func _build_ui() -> void:
	_ui = CanvasLayer.new()
	_ui.layer = 18
	add_child(_ui)
	_btn = Button.new()
	_btn.focus_mode = Control.FOCUS_NONE
	_btn.add_theme_font_override("font", HudStyle.font())
	_btn.add_theme_font_size_override("font_size", 30)
	_btn.custom_minimum_size = Vector2(0, 84)
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0.05, 0.45, 0.8)
	sb.set_corner_radius_all(14)
	sb.content_margin_left = 22
	sb.content_margin_right = 22
	for st in ["normal", "hover", "pressed"]:
		_btn.add_theme_stylebox_override(st, sb)
	_btn.add_to_group(TouchBlock.GROUP)
	_btn.visible = false
	_btn.pressed.connect(func() -> void: wash())
	_ui.add_child(_btn)
	_msg = Label.new()
	_msg.add_theme_font_override("font", HudStyle.font())
	_msg.add_theme_font_size_override("font_size", 28)
	_msg.add_theme_color_override("font_outline_color", Color.BLACK)
	_msg.add_theme_constant_override("outline_size", 8)
	_msg.set_anchors_preset(Control.PRESET_CENTER_TOP)
	_msg.position.y = 150
	_msg.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_msg.visible = false
	_ui.add_child(_msg)


func _input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo and event.keycode == KEY_G and _btn.visible:
		wash()


# ------------------------------------------------------------------------------------------ building
func _m(key: String) -> StandardMaterial3D:
	if _mats.has(key):
		return _mats[key]
	var m := StandardMaterial3D.new()
	m.albedo_color = {"white": Color(0.9, 0.91, 0.92), "blue": Color(0.05, 0.35, 0.75), "steel": Color(0.7, 0.72, 0.75),
		"concrete": Color(0.62, 0.62, 0.6), "brush": Color(0.1, 0.45, 0.9), "brush2": Color(0.9, 0.2, 0.25),
		"dark": Color(0.12, 0.13, 0.15), "grate": Color(0.2, 0.2, 0.22), "glass": Color(0.5, 0.7, 0.85, 0.5),
		"water": Color(0.8, 0.9, 1.0, 0.5), "yellow": Color(0.95, 0.75, 0.05)}[key]
	m.roughness = {"steel": 0.3, "glass": 0.05, "water": 0.1}.get(key, 0.7)
	m.metallic = 0.7 if key == "steel" else 0.0
	if key in ["glass", "water"]:
		m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	if key == "blue":
		m.emission_enabled = true
		m.emission = Color(0.02, 0.2, 0.5)
	_mats[key] = m
	return m


func _box(p: Node3D, size: Vector3, pos: Vector3, mat: String, solid := false) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = size
	mi.mesh = bm
	mi.material_override = _m(mat)
	mi.position = pos
	p.add_child(mi)
	if solid:
		var body := StaticBody3D.new()
		var cs := CollisionShape3D.new()
		var sh := BoxShape3D.new()
		sh.size = size
		cs.shape = sh
		body.add_child(cs)
		mi.add_child(body)
	return mi


func _build(s: Dictionary) -> Node3D:
	var root := Node3D.new()
	root.name = "CarWash"
	get_tree().current_scene.add_child(root)
	root.global_transform = Transform3D(_basis(s), s["pos"])
	# concrete apron (drivable) and the bays' floor with drain grates
	_box(root, Vector3(16.0, 0.3, 14.0), Vector3(-1.0, 0.0, 0.0), "concrete", true)
	for k in 2:
		_box(root, Vector3(9.0, 0.02, 0.4), Vector3(-2.0, 0.16, BAY_Z[k]), "grate")
		_box(root, Vector3(0.12, 0.02, 4.6), Vector3(3.0, 0.16, BAY_Z[k]), "yellow")
	# frame: columns, back wall, partition, roof, the blue fascia with the sign
	for z in [-5.8, 0.0, 5.8]:
		for x in [-7.0, 3.0]:
			_box(root, Vector3(0.3, 4.2, 0.3), Vector3(x, 2.25, z), "steel", true)
	_box(root, Vector3(0.3, 4.2, 11.9), Vector3(-7.2, 2.25, 0.0), "white", true)
	_box(root, Vector3(10.0, 2.6, 0.12), Vector3(-2.0, 1.45, 0.0), "glass", true)
	for z in [-5.95, 5.95]:
		_box(root, Vector3(10.0, 4.2, 0.12), Vector3(-2.0, 2.25, z), "white", true)
	_box(root, Vector3(10.8, 0.35, 12.4), Vector3(-2.0, 4.5, 0.0), "white")
	_box(root, Vector3(0.25, 1.1, 12.4), Vector3(3.3, 4.1, 0.0), "blue")
	var lb := Label3D.new()
	lb.text = "АВТОМОЙКА"
	lb.font = HudStyle.font()
	lb.font_size = 96
	lb.pixel_size = 0.01
	lb.modulate = Color(1, 1, 1)
	lb.outline_size = 0
	lb.position = Vector3(3.45, 4.1, 0.0)
	lb.rotation.y = PI * 0.5
	lb.double_sided = false
	root.add_child(lb)
	# brushes (two vertical + one overhead per bay) and the water bars, foam guns
	var brushes: Array = []
	var water: Array = []
	for k in 2:
		var z: float = BAY_Z[k]
		for side in [-1.0, 1.0]:
			var b := MeshInstance3D.new()
			var cm := CylinderMesh.new()
			cm.top_radius = 0.42
			cm.bottom_radius = 0.42
			cm.height = 2.4
			cm.radial_segments = 16
			b.mesh = cm
			b.material_override = _m("brush" if side < 0 else "brush2")
			b.position = Vector3(-2.0, 1.45, z + side * 1.95)
			b.set_meta("bay", k)
			b.set_meta("x0", -2.0)
			root.add_child(b)
			brushes.append(b)
		var top := Node3D.new()
		top.position = Vector3(-2.0, 2.6, z)
		top.set_meta("bay", k)
		top.set_meta("x0", -2.0)
		root.add_child(top)
		var tb := MeshInstance3D.new()
		var tcm := CylinderMesh.new()
		tcm.top_radius = 0.35
		tcm.bottom_radius = 0.35
		tcm.height = 3.6
		tb.mesh = tcm
		tb.material_override = _m("brush")
		tb.rotation.x = PI * 0.5
		top.add_child(tb)
		brushes.append(top)
		_box(root, Vector3(0.15, 0.15, 4.8), Vector3(-0.5, 3.9, z), "steel")
		var sp := CPUParticles3D.new()
		sp.amount = 90
		sp.lifetime = 0.8
		sp.emitting = false
		sp.position = Vector3(-2.0, 3.8, z)
		sp.emission_shape = CPUParticles3D.EMISSION_SHAPE_BOX
		sp.emission_box_extents = Vector3(3.0, 0.1, 1.8)
		sp.direction = Vector3.DOWN
		sp.initial_velocity_min = 2.0
		sp.initial_velocity_max = 3.5
		sp.gravity = Vector3(0, -9.8, 0)
		var qm := QuadMesh.new()
		qm.size = Vector2(0.08, 0.2)
		qm.material = _m("water")
		sp.mesh = qm
		sp.set_meta("bay", k)
		root.add_child(sp)
		water.append(sp)
	# operator booth with a price board
	_box(root, Vector3(2.0, 2.6, 2.4), Vector3(4.6, 1.45, 6.6), "white", true)
	_box(root, Vector3(0.05, 1.0, 1.6), Vector3(5.62, 1.6, 6.6), "glass")
	var pr := Label3D.new()
	pr.text = "МОЙКА %s" % Wallet.fmt(PRICE)
	pr.font = HudStyle.font()
	pr.font_size = 40
	pr.pixel_size = 0.01
	pr.modulate = Color(0.05, 0.35, 0.75)
	pr.outline_size = 0
	pr.position = Vector3(5.63, 2.5, 6.6)
	pr.rotation.y = PI * 0.5
	root.add_child(pr)
	s["brushes"] = brushes
	s["water"] = water
	return root
