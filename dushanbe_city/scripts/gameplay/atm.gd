class_name Atm
extends Node3D
## «БАНКОМАТ» on the sidewalk (GTA rule: cash in the pocket is lost at the hospital, money in the bank
## is safe). At the machine: put all the cash in, take 500 / 2000 / everything out. Wallet.bank is saved.

static var _ui: CanvasLayer          ## one panel for every machine in the city
static var _panel: PanelContainer
static var _info: Label
static var _msg: Label


func _ready() -> void:
	add_to_group(&"interactable")
	add_to_group(&"atm")
	_build()
	if _ui == null or not is_instance_valid(_ui):
		_build_ui()


func interaction_label(_p: Node) -> String:
	return "БАНКОМАТ"


func interaction_point(_p: Node) -> Vector3:
	return to_global(Vector3(0, 0.2, 0.9))


func can_interact(_p: Node) -> bool:
	return not _panel.visible


func interact(_p: Node) -> void:
	open()


func _mat(c: Color, rough := 0.5, emit := Color.BLACK, e := 1.2) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = c
	m.roughness = rough
	m.metallic = 0.3
	if emit != Color.BLACK:
		m.emission_enabled = true
		m.emission = emit
		m.emission_energy_multiplier = e
	return m


func _box(sz: Vector3, at: Vector3, m: Material) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	var b := BoxMesh.new()
	b.size = sz
	mi.mesh = b
	mi.material_override = m
	mi.position = at
	add_child(mi)
	return mi


func _build() -> void:
	# a freestanding machine: steel body, blue lit head with the sign, screen + keypad, a small canopy
	_box(Vector3(0.85, 1.55, 0.6), Vector3(0, 0.78, 0), _mat(Color(0.62, 0.64, 0.68), 0.35))
	_box(Vector3(0.9, 0.42, 0.66), Vector3(0, 1.76, 0), _mat(Color(0.05, 0.25, 0.65), 0.4, Color(0.1, 0.4, 1.0), 0.9))
	_box(Vector3(1.05, 0.06, 0.9), Vector3(0, 2.0, 0.1), _mat(Color(0.08, 0.1, 0.14), 0.5))
	_box(Vector3(0.5, 0.36, 0.04), Vector3(0, 1.28, 0.3), _mat(Color(0.05, 0.2, 0.3), 0.2, Color(0.2, 0.75, 1.0), 1.6))
	_box(Vector3(0.6, 0.06, 0.28), Vector3(0, 1.0, 0.38), _mat(Color(0.2, 0.21, 0.24), 0.5))
	_box(Vector3(0.24, 0.03, 0.05), Vector3(0, 1.12, 0.31), _mat(Color(0.02, 0.02, 0.02), 0.6, Color(0.1, 1.0, 0.3), 1.0))
	var body := StaticBody3D.new()
	var cs := CollisionShape3D.new()
	var bs := BoxShape3D.new()
	bs.size = Vector3(0.85, 2.0, 0.6)
	cs.shape = bs
	cs.position.y = 1.0
	body.add_child(cs)
	add_child(body)
	for side in [1.0, -1.0]:
		var l := Label3D.new()
		l.text = "БАНКОМАТ"
		l.font = load("res://assets/fonts/game_font.tres")
		l.font_size = 64
		l.pixel_size = 0.0045
		l.outline_size = 8
		l.modulate = Color(1, 1, 1)
		l.position = Vector3(0, 1.76, 0.335 * side)
		l.rotation.y = 0.0 if side > 0 else PI
		add_child(l)
	var lamp := OmniLight3D.new()
	lamp.position = Vector3(0, 1.6, 0.8)
	lamp.omni_range = 3.5
	lamp.light_energy = 0.5
	lamp.light_color = Color(0.5, 0.75, 1.0)
	add_child(lamp)


static func _style(bg: Color, r := 10) -> StyleBoxFlat:
	var st := StyleBoxFlat.new()
	st.bg_color = bg
	st.set_corner_radius_all(r)
	return st


func _build_ui() -> void:
	_ui = CanvasLayer.new()
	_ui.layer = 30
	get_tree().root.add_child.call_deferred(_ui)
	_panel = PanelContainer.new()
	var st := _style(Color(0.04, 0.07, 0.12, 0.95), 16)
	st.border_color = Color(0.3, 0.6, 1.0)
	st.set_border_width_all(2)
	st.content_margin_left = 24
	st.content_margin_right = 24
	st.content_margin_top = 16
	st.content_margin_bottom = 16
	_panel.add_theme_stylebox_override("panel", st)
	_panel.add_to_group(TouchBlock.GROUP)
	_ui.add_child(_panel)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 10)
	_panel.add_child(v)
	var t := Label.new()
	t.text = "БАНКОМАТ"
	t.add_theme_font_override("font", HudStyle.font())
	t.add_theme_font_size_override("font_size", 32)
	t.add_theme_color_override("font_color", Color(0.55, 0.8, 1.0))
	t.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(t)
	_info = Label.new()
	_info.add_theme_font_size_override("font_size", 22)
	_info.add_theme_color_override("font_color", HudStyle.MONEY)
	_info.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(_info)
	var hint := Label.new()
	hint.text = "Деньги в банке не пропадают, если вас ранят и увезут в больницу"
	hint.add_theme_font_size_override("font_size", 15)
	hint.add_theme_color_override("font_color", Color(0.75, 0.8, 0.88))
	hint.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(hint)
	var grid := GridContainer.new()
	grid.columns = 2
	grid.add_theme_constant_override("h_separation", 10)
	grid.add_theme_constant_override("v_separation", 10)
	v.add_child(grid)
	for spec in [["ПОЛОЖИТЬ ВСЁ", "dep"], ["СНЯТЬ 500", "500"], ["СНЯТЬ 2 000", "2000"], ["СНЯТЬ ВСЁ", "all"]]:
		var b := Button.new()
		b.text = spec[0]
		b.focus_mode = Control.FOCUS_NONE
		b.custom_minimum_size = Vector2(240, 60)
		b.add_theme_font_size_override("font_size", 20)
		var sb := _style(Color(0.1, 0.3, 0.6) if spec[1] == "dep" else Color(0.16, 0.2, 0.28))
		for k in ["normal", "hover", "pressed"]:
			b.add_theme_stylebox_override(k, sb)
		var op: String = spec[1]
		b.pressed.connect(func() -> void:
			if op == "dep":
				deposit(Wallet.money)
			elif op == "all":
				withdraw(Wallet.bank)
			else:
				withdraw(int(op)))
		grid.add_child(b)
	_msg = Label.new()
	_msg.add_theme_font_size_override("font_size", 18)
	_msg.add_theme_color_override("font_color", Color(1, 0.85, 0.4))
	_msg.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(_msg)
	var close := Button.new()
	close.text = "ЗАКРЫТЬ"
	close.focus_mode = Control.FOCUS_NONE
	close.custom_minimum_size = Vector2(200, 52)
	close.pressed.connect(func() -> void: _panel.visible = false)
	v.add_child(close)
	_panel.visible = false


func open() -> void:
	_msg.text = ""
	_refresh()
	_panel.visible = true
	_panel.reset_size()
	_panel.position = (get_viewport().get_visible_rect().size - _panel.size) * 0.5


static func _refresh() -> void:
	if _info:
		_info.text = "Наличные: %s     На счёте: %s" % [Wallet.fmt(Wallet.money), Wallet.fmt(Wallet.bank)]


## put n smn of the cash into the bank; returns the amount moved
static func deposit(n: int) -> int:
	n = clampi(n, 0, Wallet.money)
	Wallet.money -= n
	Wallet.bank += n
	Wallet.save_state()
	if _msg:
		_msg.text = "Внесено: %s" % Wallet.fmt(n) if n > 0 else "Нет наличных"
	_refresh()
	return n


## take n smn out of the bank; returns the amount moved
static func withdraw(n: int) -> int:
	n = clampi(n, 0, Wallet.bank)
	Wallet.bank -= n
	Wallet.money += n
	Wallet.save_state()
	if _msg:
		_msg.text = "Выдано: %s" % Wallet.fmt(n) if n > 0 else "На счёте пусто"
	_refresh()
	return n
