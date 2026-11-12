class_name ClothesShop
extends Node3D
## «ОДЕЖДА» on the shopping street «Сомон» (like the GTA clothes stores): a shop front with a lit
## window, mannequins and a sign; at the door «МАГАЗИН ОДЕЖДЫ» opens the outfits: the hero's own
## clothes (free) and eight outfits at 250..900 smn. The chosen outfit is saved (Wallet.outfit).

const OUTFITS := [["Свой костюм", -1, 0], ["Джинсы и худи", 0, 250], ["Спорт", 1, 300], ["Классика", 2, 450],
	["Чапан", 3, 600], ["Летний", 4, 250], ["Кожанка", 5, 700], ["Деловой", 6, 900], ["Уличный", 7, 350]]

static var instance: ClothesShop
var session: CarSession
var _ui: CanvasLayer
var _panel: PanelContainer
var _msg: Label
var _money: Label
var _btns: Array = []


func _ready() -> void:
	instance = self
	add_to_group(&"interactable")
	_build()
	_build_ui()
	apply.call_deferred()


static func outfit_texture(k: int) -> Texture2D:
	if k < 0:
		return null
	var p := "res://assets/characters/npc/npc_%d.jpg" % k
	return load(p) if ResourceLoader.exists(p) else null


## dress the hero in the saved outfit (also called after loading the game)
func apply() -> void:
	var pl := get_tree().get_nodes_in_group(&"player")
	if pl.is_empty():
		return
	var model: Node = (pl[0] as Node).get("model")
	if model == null:
		return
	var tex := outfit_texture(int(Wallet.outfit))
	for mi in (model as Node).find_children("*", "MeshInstance3D", true, false):
		var m3 := mi as MeshInstance3D
		if tex == null:
			m3.material_override = null
			continue
		var base := m3.get_active_material(0) as StandardMaterial3D
		if base == null:
			continue
		var mm := (m3.mesh.surface_get_material(0) as StandardMaterial3D).duplicate() as StandardMaterial3D if m3.mesh and m3.mesh.surface_get_material(0) is StandardMaterial3D else base.duplicate() as StandardMaterial3D
		mm.albedo_texture = tex
		m3.material_override = mm


func interaction_label(_p: Node) -> String:
	return "МАГАЗИН ОДЕЖДЫ"


func interaction_point(_p: Node) -> Vector3:
	return to_global(Vector3(0, 0.2, 1.6))


func can_interact(_p: Node) -> bool:
	return not _panel.visible


func interact(_p: Node) -> void:
	open()


func _mat(c: Color, rough := 0.6, emit := Color.BLACK) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = c
	m.roughness = rough
	if emit != Color.BLACK:
		m.emission_enabled = true
		m.emission = emit
		m.emission_energy_multiplier = 1.4
	return m


func _build() -> void:
	# a sign board over the door + two mannequins in the window (the shop unit itself is the street's)
	var sign := MeshInstance3D.new()
	var sb := BoxMesh.new()
	sb.size = Vector3(4.2, 0.8, 0.12)
	sign.mesh = sb
	sign.material_override = _mat(Color(0.08, 0.08, 0.1), 0.4)
	sign.position = Vector3(0, 4.0, 0.0)
	add_child(sign)
	var l := Label3D.new()
	l.text = "ОДЕЖДА"
	l.font = load("res://assets/fonts/game_font.tres")
	l.font_size = 96
	l.pixel_size = 0.007
	l.modulate = Color(1.0, 0.82, 0.35)
	l.position = Vector3(0, 4.0, 0.08)
	add_child(l)
	var ps: PackedScene = load("res://assets/characters/player/player.glb") if ResourceLoader.exists("res://assets/characters/player/player.glb") else null
	if ps:
		for k in 2:
			var mq: Node3D = ps.instantiate()
			mq.position = Vector3(-1.2 + k * 2.4, 0.1, -0.8)
			add_child(mq)
			var tex := outfit_texture([3, 6][k])
			for mi in mq.find_children("*", "MeshInstance3D", true, false):
				var base := (mi as MeshInstance3D).get_active_material(0) as StandardMaterial3D
				if base and tex:
					var mm := base.duplicate() as StandardMaterial3D
					mm.albedo_texture = tex
					(mi as MeshInstance3D).material_override = mm
	var lamp := OmniLight3D.new()
	lamp.position = Vector3(0, 3.0, 1.2)
	lamp.omni_range = 7.0
	lamp.light_energy = 0.8
	lamp.light_color = Color(1.0, 0.9, 0.75)
	add_child(lamp)


func _build_ui() -> void:
	_ui = CanvasLayer.new()
	_ui.layer = 30
	add_child(_ui)
	_panel = PanelContainer.new()
	var st := StyleBoxFlat.new()
	st.bg_color = Color(0.05, 0.06, 0.08, 0.94)
	st.set_corner_radius_all(16)
	st.border_color = Color(1.0, 0.8, 0.3)
	st.set_border_width_all(2)
	st.content_margin_left = 22
	st.content_margin_right = 22
	st.content_margin_top = 16
	st.content_margin_bottom = 16
	_panel.add_theme_stylebox_override("panel", st)
	_panel.add_to_group(TouchBlock.GROUP)
	_ui.add_child(_panel)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 8)
	_panel.add_child(v)
	var t := Label.new()
	t.text = "МАГАЗИН ОДЕЖДЫ"
	t.add_theme_font_override("font", HudStyle.font())
	t.add_theme_font_size_override("font_size", 30)
	t.add_theme_color_override("font_color", Color(1.0, 0.82, 0.35))
	t.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(t)
	_money = Label.new()
	_money.add_theme_font_size_override("font_size", 20)
	_money.add_theme_color_override("font_color", HudStyle.MONEY)
	_money.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(_money)
	var grid := GridContainer.new()
	grid.columns = 3
	grid.add_theme_constant_override("h_separation", 8)
	grid.add_theme_constant_override("v_separation", 8)
	v.add_child(grid)
	for k in OUTFITS.size():
		var b := Button.new()
		b.focus_mode = Control.FOCUS_NONE
		b.custom_minimum_size = Vector2(230, 64)
		b.add_theme_font_size_override("font_size", 18)
		var sbb := StyleBoxFlat.new()
		sbb.bg_color = Color(0.16, 0.2, 0.28)
		sbb.set_corner_radius_all(10)
		b.add_theme_stylebox_override("normal", sbb)
		b.add_theme_stylebox_override("hover", sbb)
		b.add_theme_stylebox_override("pressed", sbb)
		b.pressed.connect(func() -> void: buy(k))
		grid.add_child(b)
		_btns.append(b)
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


func _refresh() -> void:
	_money.text = "У вас: " + Wallet.fmt(Wallet.money)
	for k in OUTFITS.size():
		var o: Array = OUTFITS[k]
		var on := int(Wallet.outfit) == int(o[1])
		var owned: bool = int(o[2]) == 0 or Wallet.outfits_owned.has(int(o[1]))
		(_btns[k] as Button).text = "%s\n%s" % [o[0], "НАДЕТО" if on else ("НАДЕТЬ" if owned else Wallet.fmt(int(o[2])))]


## buy (if not owned yet) and put on outfit k; "" or the reason it failed
func buy(k: int) -> String:
	var o: Array = OUTFITS[k]
	var id := int(o[1])
	var owned: bool = int(o[2]) == 0 or Wallet.outfits_owned.has(id)
	if not owned:
		if Wallet.money < int(o[2]):
			_msg.text = "Недостаточно денег"
			_refresh()
			return "money"
		Wallet.money -= int(o[2])
		Wallet.outfits_owned.append(id)
	Wallet.outfit = id
	Wallet.save_state()
	apply()
	_msg.text = "Надето: %s" % String(o[0])
	_refresh()
	return ""
