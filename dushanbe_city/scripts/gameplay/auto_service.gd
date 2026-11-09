class_name AutoService
extends Node
## Car repair only at a garage («АВТОСЕРВИС»): generated along the roads (world.json "services",
## three times as many as filling stations; older data: one beside every second filling station along the
## roads (half as many as the stations) + one in the city near the start. Drive onto the service
## pad, stop (< 3 km/h) -> «ПОЧИНИТЬ · N смн» (4 smn per % of damage) restores the condition and
## removes the dents. Garages are built only near the player (lazy, like the sectors).

const PRICE_PER_PCT := 4
const PAINT_PRICE := 500
const COLORS := [["Белый", Color(0.85, 0.86, 0.87)], ["Чёрный", Color(0.02, 0.022, 0.026)], ["Серебро", Color(0.55, 0.57, 0.6)],
	["Красный", Color(0.45, 0.02, 0.03)], ["Синий", Color(0.03, 0.07, 0.2)], ["Зелёный", Color(0.03, 0.18, 0.08)],
	["Жёлтый", Color(0.75, 0.55, 0.02)], ["Вишня", Color(0.22, 0.02, 0.06)]]
const PAD_RADIUS := 9.0
const BUILD_DIST := 450.0

var session: CarSession
var spots: Array = []             ## [{pos: Vector3, yaw: float, node: Node3D}]
var _ui: CanvasLayer
var _btn: Button
var _paint_btn: Button
var _paint_panel: PanelContainer
var _msg: Label
var _msg_t := 0.0
var _t := 0.0


func _ready() -> void:
	add_to_group(&"auto_service")
	var wd := WorldData.get_instance()
	if wd.ok and not wd.services.is_empty():
		# generated along the roads (3x the filling stations), the garage front (+X) to the road
		for sv in wd.services:
			var yaw := float(sv["yaw"])
			var o := Vector3(float(sv["ox"]), float(sv["y"]), float(sv["oz"])) + Vector3(cos(yaw), 0, -sin(yaw)) * 6.0
			o.y = wd.height_at(o.x, o.z)
			spots.append({"pos": o, "yaw": yaw, "node": null})
	elif wd.ok:
		for i in range(0, wd.fuel.size(), 2):
			var f: Dictionary = wd.fuel[i]
			var yaw := float(f["yaw"])
			var o := Vector3(float(f.get("ox", f["x"])), float(f["y"]), float(f.get("oz", f["z"])))
			var along := Vector3(sin(yaw), 0, cos(yaw))
			for side: float in [1.0, -1.0]:
				var p := o + along * 40.0 * side
				if not _free(wd, p):
					continue
				p.y = wd.height_at(p.x, p.z)
				spots.append({"pos": p, "yaw": yaw, "node": null})
				break
	if CityWorld.instance:
		var cp := Vector3(-80.0, 0.0, -104.0)
		cp.y = CityWorld.instance.terrain_height(cp.x, cp.z)
		spots.append({"pos": cp, "yaw": 0.0, "node": null})
	_build_ui()
	# the saved garage colours, once every vehicle has spawned
	get_tree().create_timer(4.0, false).timeout.connect(func() -> void:
		for v in get_tree().get_nodes_in_group(&"vehicle"):
			if v is VehiclePrado and Wallet.paints.has(String(v.name)):
				(v as VehiclePrado).set_paint(Color.html(String(Wallet.paints[String(v.name)]))))


static func _free(wd: WorldData, p: Vector3) -> bool:
	var e := wd.road_edge_dist(p.x, p.z)
	if e < 6.0 or e > 30.0:
		return false
	for b in wd.buildings:
		if absf(float(b[1]) - p.x) < 22.0 and absf(float(b[2]) - p.z) < 22.0:
			return false
	return absf(wd.height_at(p.x + 8, p.z) - wd.height_at(p.x - 8, p.z)) < 3.0 and absf(wd.height_at(p.x, p.z + 8) - wd.height_at(p.x, p.z - 8)) < 3.0


## the repair pad in front of the garage doors (towards the road, the +X of the garage)
func pad_point(s: Dictionary) -> Vector3:
	var yaw: float = s["yaw"]
	return (s["pos"] as Vector3) + Vector3(cos(yaw), 0, -sin(yaw)) * 8.0


func nearest(p: Vector3) -> Dictionary:
	var best := {}
	var bd := INF
	for s in spots:
		var d := Vector2(p.x - (s["pos"] as Vector3).x, p.z - (s["pos"] as Vector3).z).length()
		if d < bd:
			bd = d
			best = s
	return best


func _process(delta: float) -> void:
	_t -= delta
	_msg_t -= delta
	_msg.visible = _msg_t > 0.0
	var focus := session.car.global_position if session and session.driving else (session.player.global_position if session and session.player else Vector3.ZERO)
	if _t <= 0.0:
		_t = 1.0
		for s in spots:
			var d := Vector2(focus.x - (s["pos"] as Vector3).x, focus.z - (s["pos"] as Vector3).z).length()
			if d < BUILD_DIST and s["node"] == null:
				s["node"] = _garage(s)
			elif d > BUILD_DIST + 80.0 and s["node"] != null:
				(s["node"] as Node).queue_free()
				s["node"] = null
	var car := session.car if session and session.driving else null
	var show := false
	if car and not car.wrecked and car.health < 99.5 and car.speed_kmh < 3.0:
		for s in spots:
			if s["node"] != null and pad_point(s).distance_to(car.global_position) < PAD_RADIUS:
				show = true
				break
	var at_pad := false
	if car and not car.wrecked and car.speed_kmh < 3.0:
		for s2 in spots:
			if s2["node"] != null and pad_point(s2).distance_to(car.global_position) < PAD_RADIUS:
				at_pad = true
	_paint_btn.visible = at_pad and not _paint_panel.visible
	if not at_pad:
		_paint_panel.visible = false
	_btn.visible = show
	if _paint_btn.visible:
		var vs2 := get_viewport().get_visible_rect().size
		_paint_btn.reset_size()
		_paint_btn.position = Vector2(vs2.x * 0.5 - _paint_btn.size.x * 0.5, vs2.y * 0.6 + (96.0 if show else 0.0))
	if show:
		_btn.text = "ПОЧИНИТЬ · %s" % Wallet.fmt(price(car))
		var vs := get_viewport().get_visible_rect().size
		_btn.reset_size()
		_btn.position = Vector2(vs.x * 0.5 - _btn.size.x * 0.5, vs.y * 0.6)


func price(car: VehiclePrado) -> int:
	return int(ceil((100.0 - car.health) * PRICE_PER_PCT))


func repair() -> bool:
	var car := session.car if session and session.driving else null
	if car == null:
		return false
	var cost := price(car)
	if Wallet.money < cost:
		_say("Недостаточно денег: ремонт стоит %s" % Wallet.fmt(cost))
		return false
	Wallet.money -= cost
	Wallet.save_state()
	car.repair()
	_say("Машина отремонтирована · −%s" % Wallet.fmt(cost))
	return true


func _say(t: String) -> void:
	_msg.text = t
	_msg_t = 3.5


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
	sb.bg_color = Color(0.15, 0.35, 0.7)
	sb.set_corner_radius_all(14)
	sb.content_margin_left = 22
	sb.content_margin_right = 22
	_btn.add_theme_stylebox_override("normal", sb)
	_btn.add_theme_stylebox_override("hover", sb)
	_btn.add_theme_stylebox_override("pressed", sb)
	_btn.add_to_group(TouchBlock.GROUP)
	_btn.visible = false
	_btn.pressed.connect(func() -> void: repair())
	_ui.add_child(_btn)
	_paint_btn = Button.new()
	_paint_btn.focus_mode = Control.FOCUS_NONE
	_paint_btn.add_theme_font_override("font", HudStyle.font())
	_paint_btn.add_theme_font_size_override("font_size", 28)
	_paint_btn.custom_minimum_size = Vector2(0, 76)
	var sb2 := sb.duplicate() as StyleBoxFlat
	sb2.bg_color = Color(0.5, 0.15, 0.45)
	_paint_btn.add_theme_stylebox_override("normal", sb2)
	_paint_btn.add_theme_stylebox_override("hover", sb2)
	_paint_btn.add_theme_stylebox_override("pressed", sb2)
	_paint_btn.text = "ПОКРАСИТЬ · %s" % Wallet.fmt(PAINT_PRICE)
	_paint_btn.add_to_group(TouchBlock.GROUP)
	_paint_btn.visible = false
	_paint_btn.pressed.connect(_open_paint)
	_ui.add_child(_paint_btn)
	_paint_panel = PanelContainer.new()
	var ps := StyleBoxFlat.new()
	ps.bg_color = Color(0.05, 0.06, 0.08, 0.94)
	ps.set_corner_radius_all(14)
	ps.content_margin_left = 18
	ps.content_margin_right = 18
	ps.content_margin_top = 14
	ps.content_margin_bottom = 14
	_paint_panel.add_theme_stylebox_override("panel", ps)
	_paint_panel.add_to_group(TouchBlock.GROUP)
	var grid := GridContainer.new()
	grid.columns = 4
	grid.add_theme_constant_override("h_separation", 12)
	grid.add_theme_constant_override("v_separation", 12)
	_paint_panel.add_child(grid)
	for cc in COLORS:
		var cb := Button.new()
		cb.text = cc[0]
		cb.focus_mode = Control.FOCUS_NONE
		cb.custom_minimum_size = Vector2(150, 72)
		cb.add_theme_font_size_override("font_size", 20)
		var csb := StyleBoxFlat.new()
		csb.bg_color = (cc[1] as Color).lightened(0.12)
		csb.set_corner_radius_all(10)
		csb.border_color = Color(1, 1, 1, 0.6)
		csb.set_border_width_all(2)
		cb.add_theme_stylebox_override("normal", csb)
		cb.add_theme_stylebox_override("hover", csb)
		cb.add_theme_stylebox_override("pressed", csb)
		cb.add_theme_color_override("font_color", Color.BLACK if (cc[1] as Color).get_luminance() > 0.4 else Color.WHITE)
		var colr: Color = cc[1]
		cb.pressed.connect(func() -> void: paint(colr))
		grid.add_child(cb)
	_paint_panel.visible = false
	_ui.add_child(_paint_panel)
	_msg = Label.new()
	_msg.add_theme_font_override("font", HudStyle.font())
	_msg.add_theme_font_size_override("font_size", 26)
	_msg.add_theme_color_override("font_color", Color(1, 0.92, 0.6))
	_msg.add_theme_color_override("font_outline_color", Color.BLACK)
	_msg.add_theme_constant_override("outline_size", 8)
	_msg.set_anchors_preset(Control.PRESET_CENTER_TOP)
	_msg.position = Vector2(-400, 150)
	_msg.size = Vector2(800, 40)
	_msg.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_ui.add_child(_msg)


func _input(event: InputEvent) -> void:
	var b: Array = [_btn, _paint_btn]
	if _paint_panel.visible:
		b.append_array(_paint_panel.find_children("*", "Button", true, false))
	TouchBlock.tap(event, b)


func _open_paint() -> void:
	_paint_panel.visible = true
	_paint_panel.reset_size()
	var vs := get_viewport().get_visible_rect().size
	_paint_panel.position = (vs - _paint_panel.size) * 0.5


func paint(c: Color) -> bool:
	var car := session.car if session and session.driving else null
	_paint_panel.visible = false
	if car == null:
		return false
	if Wallet.money < PAINT_PRICE:
		_say("Недостаточно денег: покраска стоит %s" % Wallet.fmt(PAINT_PRICE))
		return false
	Wallet.money -= PAINT_PRICE
	car.set_paint(c)
	Wallet.paints[String(car.name)] = c.to_html()
	Wallet.save_state()
	_say("Машина перекрашена · −%s" % Wallet.fmt(PAINT_PRICE))
	return true


# ------------------------------------------------------------------------------------------ garage
func _mat(col: Color, rough := 0.8, metal := 0.0) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = col
	m.roughness = rough
	m.metallic = metal
	return m


func _garage(s: Dictionary) -> Node3D:
	## a detailed roadside garage (local +X faces the road): two open bays (a two-post lift in the
	## first, a half-open roller shutter in the second), an office with windows, lit ceiling, tool
	## cabinet, tyre stacks, oil drums, cones, a pylon sign and the banner over the bays
	var root := Node3D.new()
	root.name = "AutoService"
	get_tree().current_scene.add_child(root)
	root.global_transform = Transform3D(Basis(Vector3.UP, float(s["yaw"])), s["pos"])
	var wall := _mat(Color(0.88, 0.88, 0.86))
	var plinth := _mat(Color(0.42, 0.43, 0.46), 0.8)
	var blue := _mat(Color(0.1, 0.32, 0.68), 0.45)
	var dark := _mat(Color(0.12, 0.12, 0.13), 0.7)
	var floor_m := _mat(Color(0.32, 0.33, 0.34), 0.6)
	var conc := _mat(Color(0.56, 0.56, 0.54), 0.95)
	var steel := _mat(Color(0.62, 0.64, 0.66), 0.35, 0.8)
	var red := _mat(Color(0.75, 0.1, 0.08), 0.5)
	var yellow := _mat(Color(0.95, 0.75, 0.1), 0.6)
	var rubber := _mat(Color(0.06, 0.06, 0.065), 0.9)
	var glass := _mat(Color(0.25, 0.4, 0.5), 0.1, 0.2)
	glass.emission_enabled = true
	glass.emission = Color(0.35, 0.45, 0.5)
	glass.emission_energy_multiplier = 0.25
	var lamp := _mat(Color(1, 1, 0.95), 0.4)
	lamp.emission_enabled = true
	lamp.emission = Color(1.0, 0.98, 0.9)
	lamp.emission_energy_multiplier = 2.0
	var bx := func(size: Vector3, pos: Vector3, m: Material) -> MeshInstance3D:
		var mi := MeshInstance3D.new()
		var bm := BoxMesh.new()
		bm.size = size
		mi.mesh = bm
		mi.material_override = m
		mi.position = pos
		root.add_child(mi)
		return mi
	var cyl := func(r: float, h: float, pos: Vector3, m: Material) -> MeshInstance3D:
		var mi := MeshInstance3D.new()
		var cm := CylinderMesh.new()
		cm.top_radius = r
		cm.bottom_radius = r
		cm.height = h
		cm.radial_segments = 16
		mi.mesh = cm
		mi.material_override = m
		mi.position = pos
		root.add_child(mi)
		return mi
	# ground: apron + yellow repair pad + painted bay lines
	bx.call(Vector3(14, 0.5, 22), Vector3(4, -0.15, 0), conc)
	bx.call(Vector3(8.5, 0.32, 15.6), Vector3(-2.1, 0.0, -0.2), floor_m)          # workshop floor
	var pad := MeshInstance3D.new()
	var pm := PlaneMesh.new()
	pm.size = Vector2(6, 9)
	pad.mesh = pm
	pad.material_override = yellow
	pad.position = Vector3(8.0, 0.12, 0)
	root.add_child(pad)
	bx.call(Vector3(5.6, 0.02, 0.14), Vector3(8.0, 0.14, -4.4), _mat(Color(1, 1, 1), 0.6))
	bx.call(Vector3(5.6, 0.02, 0.14), Vector3(8.0, 0.14, 4.4), _mat(Color(1, 1, 1), 0.6))
	# shell: back + side walls, partitions, lintel over the bays, office front with windows, roof
	bx.call(Vector3(0.3, 5.0, 16.0), Vector3(-6.35, 2.5, 0), wall)
	for z: float in [-7.85, 7.85]:
		bx.call(Vector3(9.0, 5.0, 0.3), Vector3(-2.0, 2.5, z), wall)
	for z: float in [-1.75, 4.25]:
		bx.call(Vector3(8.6, 5.0, 0.2), Vector3(-2.0, 2.5, z), wall)
	bx.call(Vector3(0.3, 1.2, 12.0), Vector3(2.35, 4.4, -1.75), wall)              # lintel
	bx.call(Vector3(0.32, 0.6, 16.2), Vector3(2.36, 0.3, 0), plinth)               # plinth strip
	bx.call(Vector3(0.3, 3.8, 0.5), Vector3(2.35, 1.9, -1.75), wall)               # pier between the bays
	bx.call(Vector3(0.3, 5.0, 3.6), Vector3(2.35, 2.5, 6.05), wall)                # office front
	bx.call(Vector3(0.08, 1.4, 2.6), Vector3(2.52, 2.4, 6.05), glass)              # office window
	bx.call(Vector3(0.08, 2.1, 0.9), Vector3(2.52, 1.05, 7.3), glass)              # office door
	bx.call(Vector3(9.6, 0.35, 16.6), Vector3(-2.0, 5.15, 0), blue)                # roof band
	bx.call(Vector3(9.0, 0.2, 16.0), Vector3(-2.0, 5.0, 0), _mat(Color(0.5, 0.5, 0.5), 0.9))
	for k in 3:                                                                    # roof units
		bx.call(Vector3(1.4, 0.8, 1.2), Vector3(-4.0 + k * 2.2, 5.7, 5.5), steel)
	# ceiling lights in both bays
	for z: float in [-4.6, 1.2]:
		bx.call(Vector3(3.0, 0.08, 0.3), Vector3(-1.5, 4.85, z), lamp)
	# bay 1: two-post lift with arms
	for z: float in [-7.0, -2.6]:
		bx.call(Vector3(0.35, 3.6, 0.35), Vector3(-1.0, 1.8, z), blue)
		bx.call(Vector3(2.4, 0.12, 0.18), Vector3(-1.4, 0.55, z + (0.5 if z < -4.0 else -0.5)), steel)
	bx.call(Vector3(0.3, 0.25, 4.7), Vector3(-1.0, 3.7, -4.8), blue)               # top beam
	# bay 2: roller shutter half up (slats)
	for k in 6:
		bx.call(Vector3(0.1, 0.18, 5.5), Vector3(2.3, 2.6 + k * 0.2, 1.25), steel)
	# tool cabinet + workbench + compressor at the back wall
	bx.call(Vector3(0.6, 1.1, 1.8), Vector3(-5.8, 0.55, -6.6), red)
	for k in 5:
		bx.call(Vector3(0.62, 0.02, 1.7), Vector3(-5.78, 0.25 + k * 0.2, -6.6), dark)
	bx.call(Vector3(0.8, 0.9, 2.6), Vector3(-5.7, 0.45, 2.2), steel)
	bx.call(Vector3(0.9, 0.06, 2.8), Vector3(-5.7, 0.92, 2.2), _mat(Color(0.45, 0.32, 0.2), 0.7))
	cyl.call(0.3, 1.0, Vector3(-5.6, 0.5, 0.0), red)
	# tyre stacks by the office, oil drums, cones
	for st in [Vector3(3.6, 0, 9.4), Vector3(4.6, 0, 9.6)]:
		for k in 4:
			var t := MeshInstance3D.new()
			var tm := TorusMesh.new()
			tm.inner_radius = 0.22
			tm.outer_radius = 0.36
			t.mesh = tm
			t.material_override = rubber
			t.position = st + Vector3(0, 0.12 + k * 0.24, 0)
			t.scale = Vector3(1, 1.3, 1)
			root.add_child(t)
	for k in 3:
		cyl.call(0.3, 0.9, Vector3(-4.5 + k * 0.7, 0.45, 8.6), [blue, red, blue][k])
	for z: float in [-9.5, 9.0]:
		var cone := MeshInstance3D.new()
		var cm := CylinderMesh.new()
		cm.top_radius = 0.03
		cm.bottom_radius = 0.2
		cm.height = 0.6
		cone.mesh = cm
		cone.material_override = _mat(Color(1.0, 0.45, 0.05), 0.6)
		cone.position = Vector3(10.6, 0.4, z * 0.5)
		root.add_child(cone)
	# banner over the bays + pylon sign by the road
	var lb := Label3D.new()
	lb.text = "АВТОСЕРВИС"
	lb.font = HudStyle.font()
	lb.font_size = 72
	lb.pixel_size = 0.012
	lb.outline_size = 10
	lb.position = Vector3(2.55, 4.4, -1.0)
	lb.rotation.y = PI * 0.5
	root.add_child(lb)
	var lb2 := Label3D.new()
	lb2.text = "РЕМОНТ · ПОКРАСКА · ШИНОМОНТАЖ"
	lb2.font = HudStyle.font()
	lb2.font_size = 40
	lb2.pixel_size = 0.008
	lb2.modulate = Color(1.0, 0.85, 0.3)
	lb2.position = Vector3(2.55, 3.95, -1.0)
	lb2.rotation.y = PI * 0.5
	root.add_child(lb2)
	bx.call(Vector3(0.3, 6.5, 0.3), Vector3(10.5, 3.25, -10.0), steel)
	var panel := bx.call(Vector3(0.4, 2.0, 2.6), Vector3(10.5, 6.6, -10.0), blue) as MeshInstance3D
	for side: float in [1.0, -1.0]:
		var ic := Sprite3D.new()
		ic.texture = HudStyle.icon("wrench")
		ic.pixel_size = 0.006
		ic.position = Vector3(10.5 + 0.22 * side, 6.95, -10.0)
		ic.rotation.y = PI * 0.5 if side > 0 else -PI * 0.5
		root.add_child(ic)
		var pl := Label3D.new()
		pl.text = "СЕРВИС"
		pl.font = HudStyle.font()
		pl.font_size = 64
		pl.pixel_size = 0.009
		pl.position = Vector3(10.5 + 0.22 * side, 6.0, -10.0)
		pl.rotation.y = PI * 0.5 if side > 0 else -PI * 0.5
		root.add_child(pl)
	panel.name = "Pylon"
	# collision: walls only (the bays are open, the player can walk in)
	var body := StaticBody3D.new()
	root.add_child(body)
	for c in [[Vector3(0.3, 5, 16), Vector3(-6.35, 2.5, 0)], [Vector3(9, 5, 0.3), Vector3(-2, 2.5, -7.85)], [Vector3(9, 5, 0.3), Vector3(-2, 2.5, 7.85)],
			[Vector3(8.6, 5, 0.2), Vector3(-2, 2.5, -1.75)], [Vector3(8.6, 5, 3.8), Vector3(-2, 2.5, 6.05)], [Vector3(14, 0.5, 22), Vector3(4, -0.15, 0)],
			[Vector3(9, 0.3, 16), Vector3(-2, 5.1, 0)], [Vector3(0.3, 6.5, 0.3), Vector3(10.5, 3.25, -10.0)]]:
		var cs := CollisionShape3D.new()
		var sh := BoxShape3D.new()
		sh.size = c[0]
		cs.shape = sh
		cs.position = c[1]
		body.add_child(cs)
	return root
