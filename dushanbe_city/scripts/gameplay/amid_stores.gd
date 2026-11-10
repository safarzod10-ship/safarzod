class_name AmidStores
extends Node
## The AMID supermarkets can be entered: every "amid_m" building of the world (WorldData.buildings)
## gets, while the player is near, its interior - walls with the entrance (the sector collision of
## these buildings is hollow), a tiled floor and a lit ceiling, 13 aisles of shelves full of goods,
## fridges along the back wall, fruit stands, signs and four tills. At a till «КАССА · ПРОДУКТЫ»
## opens the food list (Food): buy for somoni, eat right away or later from the HUD button «ЕДА»;
## food restores health. Interior layout in the building's frame: front (entrance) = local +Z,
## hall 84 x 50 m, the shop under a 4.2 m ceiling.

const BUILD_DIST := 230.0
const HX := 41.4                    ## inner half length
const HZ := 24.4                    ## inner half depth
const CEIL := 4.2                   ## under the model's inner floor plane at 4.5 m
const DOOR := 4.5                   ## half width of the entrance gap
## the building model is re-centred on its whole footprint (hall + the car park in front): the hall's
## centre lies 14.25 m behind the model origin (local -Z)
const HALL_Z := -14.25

var session: CarSession
var stores: Array = []              ## [{xf: Transform3D, node: Node3D}]
var _t := 0.0
var _ui: CanvasLayer
var _panel: PanelContainer
var _rows := {}
var _money: Label
var _msg: Label
var _eat_btn: Button
var _toast: Label
var _toast_t := 0.0
static var _mats := {}


func _ready() -> void:
	add_to_group(&"amid_stores")
	var wd := WorldData.get_instance()
	if wd and wd.ok:
		for b in wd.buildings:
			if String(b[0]) == "amid_m":
				# the same frame as the building model (WorldSectorBuilder: yaw + PI, sunk 0.3 m)
				var xf := Transform3D(Basis(Vector3.UP, float(b[3]) + PI), Vector3(float(b[1]), float(b[8]) - 0.3, float(b[2])))
				xf = xf * Transform3D(Basis.IDENTITY, Vector3(0, 0, HALL_Z))
				stores.append({"xf": xf, "node": null})
	_build_ui()


## the store entrance (outside, in front of the doors) and the till point, world space
func door_point(st: Dictionary) -> Vector3:
	return (st["xf"] as Transform3D) * Vector3(0, 0.3, HZ + 2.0)


func till_point(st: Dictionary, k := 0) -> Vector3:
	return (st["xf"] as Transform3D) * Vector3([-14.0, -7.0, 7.0, 14.0][k] + 1.6, 0.3, 15.0)


func _process(delta: float) -> void:
	_t -= delta
	_toast_t -= delta
	_toast.visible = _toast_t > 0.0
	var focus := Vector3.ZERO
	if session and session.player:
		focus = session.car.global_position if session.driving and session.car else session.player.global_position
	if _t <= 0.0:
		_t = 0.8
		for st in stores:
			var d := (st["xf"] as Transform3D).origin.distance_to(focus)
			if d < BUILD_DIST and st["node"] == null:
				st["node"] = _interior(st)
			elif d > BUILD_DIST + 60.0 and st["node"] != null:
				(st["node"] as Node).queue_free()
				st["node"] = null
	var n := Food.count()
	_eat_btn.visible = n > 0 and not _panel.visible and not PlayerLife.dead
	if _eat_btn.visible:
		_eat_btn.text = "ЕДА · %d" % n
		var vs := get_viewport().get_visible_rect().size
		_eat_btn.position = Vector2(vs.x - _eat_btn.size.x - 24.0, 128.0)


# ------------------------------------------------------------------------------------------ the till
class Till:
	extends Node
	var stores: AmidStores
	var store: Dictionary
	var k := 0

	func _ready() -> void:
		add_to_group(&"interactable")

	func interaction_label(_p: Node) -> String:
		return "КАССА · ПРОДУКТЫ"

	func interaction_point(_p: Node) -> Vector3:
		return stores.till_point(store, k)

	func can_interact(_p: Node) -> bool:
		return not stores.is_open() and not (stores.session and stores.session.driving)

	func interact(_p: Node) -> void:
		stores.open()


# ------------------------------------------------------------------------------------------ interior
static func _m(key: String) -> StandardMaterial3D:
	if _mats.has(key):
		return _mats[key]
	var m := StandardMaterial3D.new()
	match key:
		"floor":
			m.albedo_color = Color(0.86, 0.85, 0.82)
			m.roughness = 0.25
			m.metallic_specular = 0.6
		"wall":
			m.albedo_color = Color(0.95, 0.95, 0.93)
			m.roughness = 0.8
		"ceil":
			# acoustic ceiling tiles: a little self-lit (under the roof the sun's shadow covers it)
			# unshaded: under the building's roof the sun's shadow map gives it acne stripes
			m.albedo_color = Color(0.8, 0.8, 0.78)
			m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		"lamp":
			m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
			m.albedo_color = Color(1, 1, 1)
			m.emission_enabled = true
			m.emission = Color(1.0, 0.98, 0.92)
			m.emission_energy_multiplier = 2.5
		"shelf":
			m.albedo_color = Color(0.82, 0.83, 0.86)
			m.metallic = 0.6
			m.roughness = 0.35
		"green":
			m.albedo_color = Color(0.1, 0.75, 0.25)
			m.emission_enabled = true
			m.emission = Color(0.05, 0.6, 0.2)
			m.emission_energy_multiplier = 0.6
		"fridge":
			m.albedo_color = Color(0.7, 0.85, 0.95)
			m.metallic = 0.3
			m.roughness = 0.08
			m.emission_enabled = true
			m.emission = Color(0.6, 0.85, 1.0)
			m.emission_energy_multiplier = 0.7
		"counter":
			m.albedo_color = Color(0.2, 0.22, 0.25)
			m.roughness = 0.4
		"belt":
			m.albedo_color = Color(0.05, 0.05, 0.06)
			m.roughness = 0.6
		"screen":
			m.albedo_color = Color(0.1, 0.3, 0.5)
			m.emission_enabled = true
			m.emission = Color(0.2, 0.6, 1.0)
		"wood":
			m.albedo_color = Color(0.55, 0.38, 0.22)
			m.roughness = 0.7
		"goods":
			m.vertex_color_use_as_albedo = true
			m.roughness = 0.5
	_mats[key] = m
	return m


func _interior(st: Dictionary) -> Node3D:
	var root := Node3D.new()
	root.name = "AmidInterior"
	get_tree().current_scene.add_child(root)
	root.global_transform = st["xf"]
	var body := StaticBody3D.new()
	root.add_child(body)
	var bx := func(size: Vector3, pos: Vector3, mat: String, solid := true) -> void:
		var mi := MeshInstance3D.new()
		var bm := BoxMesh.new()
		bm.size = size
		mi.mesh = bm
		mi.material_override = _m(mat)
		mi.position = pos
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		root.add_child(mi)
		if solid:
			var cs := CollisionShape3D.new()
			var sh := BoxShape3D.new()
			sh.size = size
			cs.shape = sh
			cs.position = pos
			body.add_child(cs)
	# floor, ceiling with light strips, the outer walls (from outside the model's walls are seen;
	# these give the inside faces and the collision), the entrance gap in the front wall
	bx.call(Vector3(HX * 2, 0.3, HZ * 2), Vector3(0, 0.15, 0), "floor")
	bx.call(Vector3(HX * 2, 0.2, HZ * 2), Vector3(0, CEIL + 0.1, 0), "ceil", false)
	for i in 7:
		bx.call(Vector3(HX * 1.7, 0.06, 0.4), Vector3(0, CEIL - 0.03, -HZ + 4.0 + i * 6.6), "lamp", false)
	bx.call(Vector3(0.4, 14.0, HZ * 2), Vector3(-HX, 7.0, 0), "wall")
	bx.call(Vector3(0.4, 14.0, HZ * 2), Vector3(HX, 7.0, 0), "wall")
	bx.call(Vector3(HX * 2, 14.0, 0.4), Vector3(0, 7.0, -HZ), "wall")
	for sx: float in [-1.0, 1.0]:
		var w := HX - DOOR
		bx.call(Vector3(w, 14.0, 0.4), Vector3(sx * (DOOR + w * 0.5), 7.0, HZ), "wall")
	bx.call(Vector3(DOOR * 2, 14.0 - 3.4, 0.4), Vector3(0, 3.4 + (14.0 - 3.4) * 0.5, HZ), "wall", false)
	# the green AMID band inside over the entrance + section signs
	bx.call(Vector3(14.0, 0.7, 0.2), Vector3(0, 3.75, HZ - 0.35), "green", false)
	_label(root, "АМИД · ДОБРО ПОЖАЛОВАТЬ", Vector3(0, 3.75, HZ - 0.5), PI, 56, Color(1, 1, 1))
	# aisles: 13 double shelves (x -36..36), 2 m high, 4 levels, goods in bright packs
	var goods := MultiMesh.new()
	goods.transform_format = MultiMesh.TRANSFORM_3D
	goods.use_colors = true
	var gm := BoxMesh.new()
	gm.size = Vector3(0.32, 0.34, 0.26)
	gm.material = _m("goods")
	goods.mesh = gm
	var xfs: Array[Transform3D] = []
	var cols: Array[Color] = []
	var rng := RandomNumberGenerator.new()
	rng.seed = int(absf((st["xf"] as Transform3D).origin.x * 13.0 + (st["xf"] as Transform3D).origin.z * 7.0))
	var palette := [Color(0.9, 0.15, 0.12), Color(0.15, 0.45, 0.9), Color(0.95, 0.8, 0.1), Color(0.2, 0.75, 0.3),
		Color(0.95, 0.5, 0.1), Color(0.95, 0.95, 0.95), Color(0.6, 0.25, 0.7), Color(0.3, 0.2, 0.12)]
	for i in 13:
		var x := -36.0 + i * 6.0
		bx.call(Vector3(1.1, 2.1, 22.0), Vector3(x, 1.2, -5.0), "shelf")
		for lvl in 4:
			var y := 0.55 + lvl * 0.48
			var c: Color = palette[rng.randi() % palette.size()]
			for side: float in [-1.0, 1.0]:
				for j in 60:
					if rng.randf() < 0.08:
						continue
					if j % 6 == 0:
						c = palette[rng.randi() % palette.size()]
					var z := -15.6 + j * 0.355
					xfs.append(Transform3D(Basis.IDENTITY.scaled(Vector3.ONE * rng.randf_range(0.8, 1.1)), Vector3(x + side * 0.42, y, z)))
					cols.append(c.lightened(rng.randf_range(-0.1, 0.15)))
		# hanging section signs
		if i % 3 == 0:
			var nm: String = ["НОН И ВЫПЕЧКА", "МОЛОКО", "КОНСЕРВЫ", "СЛАДОСТИ", "БЫТОВАЯ ХИМИЯ"][(i / 3) % 5]
			bx.call(Vector3(0.1, 0.6, 4.0), Vector3(x, 3.5, -5.0), "green", false)
			for side2: float in [-1.0, 1.0]:
				_label(root, nm, Vector3(x + side2 * 0.08, 3.5, -5.0), PI * 0.5 * side2, 40, Color(1, 1, 1))
	# fridges along the back wall: lit glass doors, bottles inside
	bx.call(Vector3(HX * 1.8, 2.4, 1.2), Vector3(0, 1.35, -HZ + 0.9), "fridge")
	for j in 140:
		var x2 := -HX * 0.88 + j * (HX * 1.76 / 140.0)
		for lvl in 3:
			xfs.append(Transform3D(Basis.IDENTITY.scaled(Vector3(0.35, 1.1, 0.35)), Vector3(x2, 0.7 + lvl * 0.7, -HZ + 1.0)))
			cols.append([Color(0.2, 0.6, 1.0), Color(0.9, 0.2, 0.15), Color(0.3, 0.85, 0.35), Color(1.0, 0.75, 0.2)][(j + lvl) % 4])
	_label(root, "НАПИТКИ · МОЛОЧНЫЕ ПРОДУКТЫ", Vector3(0, 3.2, -HZ + 0.5), 0.0, 64, Color(0.1, 0.5, 0.2))
	# fruit and vegetable stands on the left of the entrance
	for k in 4:
		var fx := -34.0 + k * 5.0
		bx.call(Vector3(3.6, 0.9, 2.2), Vector3(fx, 0.75, 14.0), "wood")
		var fc: Color = [Color(0.9, 0.15, 0.1), Color(1.0, 0.6, 0.1), Color(0.95, 0.85, 0.2), Color(0.35, 0.75, 0.2)][k]
		for a in 40:
			xfs.append(Transform3D(Basis.IDENTITY.scaled(Vector3(0.5, 0.5, 0.6)), Vector3(fx - 1.5 + (a % 10) * 0.33, 1.32, 13.2 + (a / 10) * 0.5)))
			cols.append(fc.darkened(rng.randf_range(0.0, 0.2)))
	_label(root, "ФРУКТЫ И ОВОЩИ", Vector3(-26.5, 3.0, 15.4), 0.0, 56, Color(0.1, 0.5, 0.2))
	goods.instance_count = xfs.size()
	for i in xfs.size():
		goods.set_instance_transform(i, xfs[i])
		goods.set_instance_color(i, cols[i])
	var gmi := MultiMeshInstance3D.new()
	gmi.multimesh = goods
	gmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	root.add_child(gmi)
	# four tills by the exit: counter, belt, screen, a light over each; the interaction at the till
	for k in 4:
		var tx: float = [-14.0, -7.0, 7.0, 14.0][k]
		bx.call(Vector3(1.0, 0.95, 4.0), Vector3(tx, 0.62, 15.0), "counter")
		bx.call(Vector3(0.7, 0.04, 3.4), Vector3(tx, 1.12, 15.0), "belt", false)
		bx.call(Vector3(0.05, 0.35, 0.5), Vector3(tx - 0.2, 1.4, 16.2), "screen", false)
		bx.call(Vector3(0.6, 0.6, 0.6), Vector3(tx, 3.5, 15.0), "green", false)
		_label(root, "КАССА %d" % (k + 1), Vector3(tx, 3.5, 15.31), 0.0, 40, Color(1, 1, 1))
		var t := Till.new()
		t.stores = self
		t.store = st
		t.k = k
		root.add_child(t)
	# lights (no shadows): the hall is lit like a shop
	for lx in [-26.0, 0.0, 26.0]:
		for lz in [-12.0, 8.0]:
			var ol := OmniLight3D.new()
			ol.position = Vector3(lx, CEIL - 0.6, lz)
			ol.omni_range = 26.0
			ol.light_energy = 1.4
			ol.light_color = Color(1.0, 0.97, 0.9)
			root.add_child(ol)
	return root


static func _label(root: Node3D, t: String, p: Vector3, yaw: float, size: int, col: Color) -> void:
	var lb := Label3D.new()
	lb.double_sided = false
	lb.text = t
	lb.font = HudStyle.font()
	lb.font_size = size
	lb.pixel_size = 0.01
	lb.modulate = col
	lb.outline_size = 0
	lb.position = p
	lb.rotation.y = yaw
	root.add_child(lb)


# ------------------------------------------------------------------------------------------ UI
func _btn(t: String, col: Color, w := 150.0) -> Button:
	var b := Button.new()
	b.text = t
	b.custom_minimum_size = Vector2(w, 56)
	b.add_theme_font_override("font", HudStyle.font())
	b.add_theme_font_size_override("font_size", 20)
	for stl in ["normal", "hover", "pressed", "disabled", "focus"]:
		var sb := StyleBoxFlat.new()
		sb.bg_color = col.darkened(0.25 if stl == "pressed" else (0.55 if stl == "disabled" else 0.0))
		sb.set_corner_radius_all(12)
		sb.content_margin_left = 10
		sb.content_margin_right = 10
		b.add_theme_stylebox_override(stl, sb)
	return b


func _build_ui() -> void:
	_ui = CanvasLayer.new()
	_ui.layer = 30
	add_child(_ui)
	_panel = PanelContainer.new()
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0.04, 0.07, 0.05, 0.95)
	sb.set_corner_radius_all(16)
	sb.border_color = Color(0.15, 0.9, 0.3)
	sb.set_border_width_all(2)
	sb.content_margin_left = 22
	sb.content_margin_right = 22
	sb.content_margin_top = 14
	sb.content_margin_bottom = 14
	_panel.add_theme_stylebox_override("panel", sb)
	_panel.add_to_group(TouchBlock.GROUP)
	_panel.visible = false
	_ui.add_child(_panel)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 6)
	_panel.add_child(v)
	var t := Label.new()
	t.text = "АМИД · СУПЕРМАРКЕТ"
	t.add_theme_font_override("font", HudStyle.font())
	t.add_theme_font_size_override("font_size", 28)
	t.add_theme_color_override("font_color", Color(0.2, 1.0, 0.35))
	t.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(t)
	_money = Label.new()
	_money.add_theme_font_size_override("font_size", 20)
	_money.add_theme_color_override("font_color", HudStyle.MONEY)
	_money.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(_money)
	var grid := GridContainer.new()
	grid.columns = 2
	grid.add_theme_constant_override("h_separation", 18)
	grid.add_theme_constant_override("v_separation", 6)
	v.add_child(grid)
	for id in Food.ORDER:
		var h := HBoxContainer.new()
		h.add_theme_constant_override("separation", 8)
		grid.add_child(h)
		var sw := ColorRect.new()
		sw.color = Food.ITEMS[id]["color"]
		sw.custom_minimum_size = Vector2(14, 44)
		h.add_child(sw)
		var lab := Label.new()
		lab.custom_minimum_size = Vector2(240, 0)
		lab.add_theme_font_size_override("font_size", 18)
		h.add_child(lab)
		var buy := _btn("", Color(0.12, 0.55, 0.22), 120)
		buy.pressed.connect(func() -> void: _buy(id))
		h.add_child(buy)
		var eat := _btn("СЪЕСТЬ", Color(0.75, 0.45, 0.1), 110)
		eat.pressed.connect(func() -> void: _eat(id))
		h.add_child(eat)
		_rows[id] = [lab, buy, eat]
	_msg = Label.new()
	_msg.add_theme_font_size_override("font_size", 19)
	_msg.add_theme_color_override("font_color", Color(1, 0.9, 0.4))
	_msg.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(_msg)
	var close := _btn("ЗАКРЫТЬ", Color(0.4, 0.12, 0.1), 200)
	close.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	close.pressed.connect(func() -> void: _panel.visible = false)
	v.add_child(close)
	# the HUD button: eat from the bag (the item that fits the missing health best)
	_eat_btn = _btn("ЕДА", Color(0.75, 0.45, 0.1), 190)
	_eat_btn.add_to_group(TouchBlock.GROUP)
	_eat_btn.visible = false
	_eat_btn.pressed.connect(func() -> void:
		var got := Food.eat()
		_say("Вкусно! +%d здоровья" % int(got) if got > 0.0 else "Вы и так сыты"))
	_ui.add_child(_eat_btn)
	_toast = Label.new()
	_toast.add_theme_font_override("font", HudStyle.font())
	_toast.add_theme_font_size_override("font_size", 28)
	_toast.add_theme_color_override("font_color", Color(0.4, 1.0, 0.5))
	_toast.add_theme_constant_override("outline_size", 6)
	_toast.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.85))
	_toast.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_toast.set_anchors_preset(Control.PRESET_TOP_WIDE)
	_toast.position.y = 190
	_toast.visible = false
	_ui.add_child(_toast)


func _say(t: String) -> void:
	_toast.text = t
	_toast_t = 2.5


func open() -> void:
	_msg.text = "Здоровье: %d / 100" % int(PlayerLife.health)
	_refresh()
	_panel.visible = true
	_panel.reset_size()
	var vs := get_viewport().get_visible_rect().size
	_panel.position = (vs - _panel.size) * 0.5


func is_open() -> bool:
	return _panel.visible


func _refresh() -> void:
	_money.text = "У вас: %s   ·   в сумке: %d" % [Wallet.fmt(Wallet.money), Food.count()]
	for id in _rows:
		var r: Array = _rows[id]
		var d: Dictionary = Food.ITEMS[id]
		var have := int(Food.bag.get(id, 0))
		(r[0] as Label).text = "%s  +%d ❤\n%s%s" % [String(d["name"]), int(d["heal"]), Wallet.fmt(int(d["price"])), ("   ·   есть %d" % have) if have > 0 else ""]
		(r[1] as Button).text = "КУПИТЬ"
		(r[1] as Button).disabled = Wallet.money < int(d["price"])
		(r[2] as Button).disabled = have <= 0


func _buy(id: String) -> void:
	_msg.text = ("Куплено: %s" % String(Food.ITEMS[id]["name"])) if Food.buy(id) else "Недостаточно денег"
	_refresh()


func _eat(id: String) -> void:
	var got := Food.eat(id)
	_msg.text = ("Вкусно! +%d здоровья (%d / 100)" % [int(got), int(PlayerLife.health)]) if got > 0.0 else "Здоровье уже полное"
	_refresh()
