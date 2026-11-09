class_name GunShop
extends Node3D
## The gun shop «ОРУЖИЕ» beside ave. Javonon, near the start: a small building with a lit sign and a
## shop window; at its door «МАГАЗИН ОРУЖИЯ» opens the counter: weapons (bat, pistol, AK) and ammo
## for somoni (Weapons / Wallet, saved). Also on the map (WorldMapScreen.pois).

const POS := Vector3(-80.0, 0.0, -76.0)       ## building centre (peninsula city), front faces +X
const SIZE := Vector3(7.0, 4.2, 11.0)

var _ui: CanvasLayer
var _panel: PanelContainer
var _rows := {}
var _money: Label
var _msg: Label


func _ready() -> void:
	add_to_group(&"interactable")
	add_to_group(&"gun_shop")
	var wd := WorldData.get_instance()
	var lm: Dictionary = wd.landmark("gunshop") if wd and wd.ok else {}
	if lm.is_empty():
		var y := CityWorld.instance.terrain_height(POS.x, POS.z) if CityWorld.instance else 2.4
		global_position = Vector3(POS.x, y, POS.z)
	else:
		# Dushanbe, across Rudaki avenue from the hero's home (world landmark "gunshop")
		global_position = Vector3(float(lm["x"]), float(lm["y"]), float(lm["z"]))
		rotation.y = float(lm["yaw"])
	_build_house()
	_build_ui()


func door_point() -> Vector3:
	return to_global(Vector3(SIZE.x * 0.5 + 1.2, 0.2, 0))


# ------------------------------------------------------------------------------------------ interactable
func interaction_label(_player: Node) -> String:
	return "МАГАЗИН ОРУЖИЯ"


func interaction_point(_player: Node) -> Vector3:
	return door_point()


func can_interact(_player: Node) -> bool:
	return not _panel.visible


func interact(_player: Node) -> void:
	open()


# ------------------------------------------------------------------------------------------ building
func _mat(col: Color, rough := 0.8, metal := 0.0, emit := Color.BLACK) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = col
	m.roughness = rough
	m.metallic = metal
	if emit != Color.BLACK:
		m.emission_enabled = true
		m.emission = emit
	return m


func _box(size: Vector3, pos: Vector3, m: Material) -> void:
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = size
	mi.mesh = bm
	mi.material_override = m
	mi.position = pos
	add_child(mi)


func _build_house() -> void:
	var wall := _mat(Color(0.82, 0.78, 0.7))
	var dark := _mat(Color(0.12, 0.13, 0.15), 0.6)
	var glass := _mat(Color(0.1, 0.16, 0.2), 0.08, 0.4)
	_box(Vector3(SIZE.x, SIZE.y, SIZE.z), Vector3(0, SIZE.y * 0.5, 0), wall)
	_box(Vector3(SIZE.x + 0.6, 0.35, SIZE.z + 0.6), Vector3(0, SIZE.y + 0.17, 0), dark)          # roof edge
	_box(Vector3(0.12, 2.3, 4.2), Vector3(SIZE.x * 0.5 + 0.04, 1.45, -2.8), glass)               # shop window
	_box(Vector3(0.12, 2.5, 1.6), Vector3(SIZE.x * 0.5 + 0.04, 1.25, 2.2), dark)                 # door
	_box(Vector3(0.14, 0.12, 4.4), Vector3(SIZE.x * 0.5 + 0.06, 2.65, -2.8), dark)
	_box(Vector3(1.8, 0.18, SIZE.z * 0.8), Vector3(SIZE.x * 0.5 + 0.9, 3.1, 0), dark)          # canopy
	# sign: dark board, red lit letters
	_box(Vector3(0.2, 0.9, 6.5), Vector3(SIZE.x * 0.5 + 0.15, 3.75, 0), dark)
	var lb := Label3D.new()
	lb.text = "ОРУЖИЕ · GUN SHOP"
	lb.font = HudStyle.font()
	lb.font_size = 64
	lb.pixel_size = 0.009
	lb.modulate = Color(1.0, 0.25, 0.2)
	lb.outline_size = 0
	lb.position = Vector3(SIZE.x * 0.5 + 0.27, 3.75, 0)
	lb.rotation.y = PI * 0.5
	add_child(lb)
	var l := OmniLight3D.new()
	l.light_color = Color(1.0, 0.4, 0.3)
	l.light_energy = 1.2
	l.omni_range = 7.0
	l.position = Vector3(SIZE.x * 0.5 + 1.5, 3.0, 0)
	add_child(l)
	# weapons on display behind the window
	for k in 2:
		var ps: PackedScene = load("res://assets/weapons/%s.glb" % ["ak47", "pistol"][k])
		var m := ps.instantiate() as Node3D
		m.position = Vector3(SIZE.x * 0.5 - 0.25, 1.4 + k * 0.6, -2.8)
		m.rotation = Vector3(0, PI * 0.5 + PI, 0)
		m.scale = Vector3.ONE * (1.0 if k == 0 else 1.6)
		add_child(m)
	var body := StaticBody3D.new()
	var cs := CollisionShape3D.new()
	var sh := BoxShape3D.new()
	sh.size = SIZE
	cs.shape = sh
	cs.position = Vector3(0, SIZE.y * 0.5, 0)
	body.add_child(cs)
	add_child(body)


# ------------------------------------------------------------------------------------------ counter UI
func _build_ui() -> void:
	_ui = CanvasLayer.new()
	_ui.layer = 30
	add_child(_ui)
	_panel = PanelContainer.new()
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0.05, 0.06, 0.08, 0.94)
	sb.set_corner_radius_all(16)
	sb.border_color = Color(0.85, 0.2, 0.15)
	sb.set_border_width_all(2)
	sb.content_margin_left = 24
	sb.content_margin_right = 24
	sb.content_margin_top = 18
	sb.content_margin_bottom = 18
	_panel.add_theme_stylebox_override("panel", sb)
	_panel.add_to_group(TouchBlock.GROUP)
	_ui.add_child(_panel)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 10)
	_panel.add_child(v)
	var t := Label.new()
	t.text = "ОРУЖЕЙНЫЙ МАГАЗИН"
	t.add_theme_font_override("font", HudStyle.font())
	t.add_theme_font_size_override("font_size", 30)
	t.add_theme_color_override("font_color", Color(1, 0.35, 0.3))
	t.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(t)
	_money = Label.new()
	_money.add_theme_font_size_override("font_size", 22)
	_money.add_theme_color_override("font_color", HudStyle.MONEY)
	_money.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(_money)
	for id in ["bat", "pistol", "ak47"]:
		var h := HBoxContainer.new()
		h.add_theme_constant_override("separation", 14)
		v.add_child(h)
		var ic := TextureRect.new()
		ic.texture = HudStyle.icon(Weapons.icon_of(id))
		ic.custom_minimum_size = Vector2(64, 64)
		ic.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		ic.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
		h.add_child(ic)
		var nm := Label.new()
		nm.custom_minimum_size = Vector2(250, 0)
		nm.add_theme_font_size_override("font_size", 22)
		h.add_child(nm)
		var buy := _btn("", Color(0.15, 0.5, 0.25))
		buy.pressed.connect(func() -> void: _buy(id))
		h.add_child(buy)
		var am := _btn("", Color(0.2, 0.35, 0.65))
		am.pressed.connect(func() -> void: _ammo(id))
		am.visible = Weapons.uses_ammo(id)
		h.add_child(am)
		_rows[id] = [nm, buy, am]
	_msg = Label.new()
	_msg.add_theme_font_size_override("font_size", 20)
	_msg.add_theme_color_override("font_color", Color(1, 0.85, 0.4))
	_msg.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(_msg)
	var close := _btn("ЗАКРЫТЬ", Color(0.4, 0.12, 0.1))
	close.pressed.connect(func() -> void: _panel.visible = false)
	v.add_child(close)
	_panel.visible = false


func _btn(t: String, col: Color) -> Button:
	var b := Button.new()
	b.text = t
	b.focus_mode = Control.FOCUS_NONE
	b.custom_minimum_size = Vector2(200, 56)
	b.add_theme_font_size_override("font_size", 20)
	var sb := StyleBoxFlat.new()
	sb.bg_color = col
	sb.set_corner_radius_all(10)
	b.add_theme_stylebox_override("normal", sb)
	var sh := sb.duplicate() as StyleBoxFlat
	sh.bg_color = col.lightened(0.2)
	b.add_theme_stylebox_override("hover", sh)
	b.add_theme_stylebox_override("pressed", sh)
	return b


func open() -> void:
	_msg.text = ""
	_refresh()
	_panel.visible = true
	_panel.reset_size()
	var vs := get_viewport().get_visible_rect().size
	_panel.position = (vs - _panel.size) * 0.5


func is_open() -> bool:
	return _panel.visible


func _refresh() -> void:
	_money.text = "У вас: " + Wallet.fmt(Wallet.money)
	for id in _rows:
		var r: Array = _rows[id]
		var d: Dictionary = Weapons.DATA[id]
		(r[0] as Label).text = String(d["name"]) + ("\nпатроны: %d" % Weapons.ammo_of(id) if Weapons.uses_ammo(id) else "")
		var buy := r[1] as Button
		buy.text = "КУПЛЕНО" if Weapons.has(id) else "КУПИТЬ · %s" % Wallet.fmt(int(d["price"]))
		buy.disabled = Weapons.has(id)
		var am := r[2] as Button
		if Weapons.uses_ammo(id):
			am.text = "+%d ПАТР. · %s" % [int(d["ammo_pack"]), Wallet.fmt(int(d["ammo_price"]))]
			am.disabled = not Weapons.has(id)


func _buy(id: String) -> void:
	if Weapons.buy(id):
		Weapons.select(id)
		_msg.text = "Куплено: %s. Оружие выбрано." % String(Weapons.DATA[id]["name"])
	else:
		_msg.text = "Недостаточно денег"
	_refresh()


func _ammo(id: String) -> void:
	_msg.text = "Патроны куплены" if Weapons.buy_ammo(id) else "Недостаточно денег"
	_refresh()
