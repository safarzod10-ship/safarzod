class_name AutoService
extends Node
## Car repair only at a garage («АВТОСЕРВИС»): one beside every second filling station along the
## roads (half as many as the stations) + one in the city near the start. Drive onto the service
## pad, stop (< 3 km/h) -> «ПОЧИНИТЬ · N смн» (4 smn per % of damage) restores the condition and
## removes the dents. Garages are built only near the player (lazy, like the sectors).

const PRICE_PER_PCT := 4
const PAD_RADIUS := 9.0
const BUILD_DIST := 450.0

var session: CarSession
var spots: Array = []             ## [{pos: Vector3, yaw: float, node: Node3D}]
var _ui: CanvasLayer
var _btn: Button
var _msg: Label
var _msg_t := 0.0
var _t := 0.0


func _ready() -> void:
	add_to_group(&"auto_service")
	var wd := WorldData.get_instance()
	if wd.ok:
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
	_btn.visible = show
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
	TouchBlock.tap(event, [_btn])


# ------------------------------------------------------------------------------------------ garage
func _mat(col: Color, rough := 0.8, metal := 0.0) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = col
	m.roughness = rough
	m.metallic = metal
	return m


func _garage(s: Dictionary) -> Node3D:
	var root := Node3D.new()
	root.name = "AutoService"
	get_tree().current_scene.add_child(root)
	root.global_transform = Transform3D(Basis(Vector3.UP, float(s["yaw"])), s["pos"])
	var wall := _mat(Color(0.86, 0.86, 0.84))
	var blue := _mat(Color(0.12, 0.3, 0.62), 0.5)
	var dark := _mat(Color(0.1, 0.11, 0.12), 0.6)
	var conc := _mat(Color(0.55, 0.55, 0.53), 0.95)
	var parts := [
		[Vector3(12, 0.5, 20), Vector3(4, -0.15, 0), conc],           # concrete apron + pad (sunk into the slope)
		[Vector3(9, 5.0, 16), Vector3(-2, 2.5, 0), wall],              # the garage
		[Vector3(9.4, 0.5, 16.4), Vector3(-2, 5.2, 0), blue],          # roof band
		[Vector3(0.15, 3.6, 5.5), Vector3(2.55, 1.8, -3.6), dark],     # bay door 1 (open: dark)
		[Vector3(0.15, 3.6, 5.5), Vector3(2.55, 1.8, 3.6), dark],      # bay door 2
		[Vector3(0.25, 1.1, 10.0), Vector3(2.65, 4.3, 0), blue],        # sign board
	]
	for p in parts:
		var mi := MeshInstance3D.new()
		var bm := BoxMesh.new()
		bm.size = p[0]
		mi.mesh = bm
		mi.material_override = p[2]
		mi.position = p[1]
		root.add_child(mi)
	var lb := Label3D.new()
	lb.text = "АВТОСЕРВИС"
	lb.font = HudStyle.font()
	lb.font_size = 72
	lb.pixel_size = 0.012
	lb.modulate = Color(1, 1, 1)
	lb.position = Vector3(2.8, 4.3, 0)
	lb.rotation.y = PI * 0.5
	root.add_child(lb)
	var ic := Sprite3D.new()
	ic.texture = HudStyle.icon("wrench")
	ic.pixel_size = 0.004
	ic.position = Vector3(2.8, 4.3, -4.2)
	ic.rotation.y = PI * 0.5
	root.add_child(ic)
	# the pad mark
	var pad := MeshInstance3D.new()
	var pm := PlaneMesh.new()
	pm.size = Vector2(6, 9)
	pad.mesh = pm
	pad.material_override = _mat(Color(0.95, 0.75, 0.1), 0.7)
	pad.position = Vector3(8.0, 0.12, 0)
	root.add_child(pad)
	var body := StaticBody3D.new()
	root.add_child(body)
	var cs := CollisionShape3D.new()
	var sh := BoxShape3D.new()
	sh.size = Vector3(9, 5, 16)
	cs.shape = sh
	cs.position = Vector3(-2, 2.5, 0)
	body.add_child(cs)
	var cs2 := CollisionShape3D.new()
	var sh2 := BoxShape3D.new()
	sh2.size = Vector3(12, 0.5, 20)
	cs2.shape = sh2
	cs2.position = Vector3(4, -0.15, 0)
	body.add_child(cs2)
	return root
