extends Control
## The start menu: a picture of the city in the background, the game's name, ИГРАТЬ / МАГАЗИН /
## НАСТРОЙКИ / ВЫХОД, and the player's account (ID given automatically, money).
## МАГАЗИН: packages of game money for real money (data/shop_packages.json). Payment goes through
## the administrator for now: the player pays and gives his ID, gets a one-time code
## (tools/admin/make_code.py) and activates it here (Account.redeem).

const GAME_SCENE := "res://scenes/main/main.tscn"

var _font: Font
var _shop: PanelContainer
var _settings: PanelContainer
var _code: LineEdit
var _shop_msg: Label
var _money: Label
var _loading: Label
var _pk := {}


func _ready() -> void:
	Account.ensure()
	Wallet.load_state()
	_font = HudStyle.font()
	set_anchors_preset(Control.PRESET_FULL_RECT)
	var bg := TextureRect.new()
	bg.texture = load("res://assets/ui/menu_bg.jpg")
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	bg.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	bg.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
	add_child(bg)
	var shade := TextureRect.new()                    # dark gradient on the left, under the buttons
	var g := Gradient.new()
	g.set_color(0, Color(0, 0, 0, 0.82))
	g.set_color(1, Color(0, 0, 0, 0.0))
	var gt := GradientTexture2D.new()
	gt.gradient = g
	gt.fill_from = Vector2(0, 0.5)
	gt.fill_to = Vector2(0.75, 0.5)
	shade.texture = gt
	shade.set_anchors_preset(Control.PRESET_FULL_RECT)
	shade.stretch_mode = TextureRect.STRETCH_SCALE
	add_child(shade)
	# title
	var title := _label("DUSHANBE CITY", 76, Color.WHITE, 14)
	title.position = Vector2(70, 60)
	add_child(title)
	var sub := _label("открытый мир Таджикистана", 28, Color(1.0, 0.85, 0.4), 8)
	sub.position = Vector2(76, 160)
	add_child(sub)
	# buttons
	var v := VBoxContainer.new()
	v.position = Vector2(70, 250)
	v.add_theme_constant_override("separation", 16)
	add_child(v)
	v.add_child(_button("ИГРАТЬ", Color(0.1, 0.55, 0.25), _play, 420, 92, 40))
	v.add_child(_button("МАГАЗИН", Color(0.75, 0.45, 0.05), func() -> void: _open(_shop), 420, 76, 32))
	v.add_child(_button("НАСТРОЙКИ", Color(0.15, 0.3, 0.55), func() -> void: _open(_settings), 420, 76, 32))
	v.add_child(_button("ВЫХОД", Color(0.35, 0.1, 0.1), func() -> void: get_tree().quit(), 420, 64, 26))
	# account card (top-right)
	var card := _panel(Color(0.04, 0.05, 0.07, 0.8))
	card.set_anchors_preset(Control.PRESET_TOP_RIGHT)
	card.position = Vector2(-470, 30)
	card.custom_minimum_size = Vector2(440, 0)
	add_child(card)
	var cv := VBoxContainer.new()
	cv.add_theme_constant_override("separation", 8)
	card.add_child(cv)
	cv.add_child(_label("АККАУНТ", 22, Color(0.7, 0.8, 1.0), 4))
	cv.add_child(_label("ID: " + Account.id, 36, Color.WHITE, 6))
	_money = _label("", 30, HudStyle.MONEY, 6)
	cv.add_child(_money)
	cv.add_child(_button("СКОПИРОВАТЬ ID", Color(0.2, 0.25, 0.32), func() -> void: DisplayServer.clipboard_set(Account.id), 400, 52, 20))
	_build_shop()
	_build_settings()
	_loading = _label("Загрузка…", 44, Color.WHITE, 10)
	_loading.set_anchors_preset(Control.PRESET_CENTER)
	_loading.position = Vector2(-120, -30)
	_loading.visible = false
	add_child(_loading)
	_refresh()


func _refresh() -> void:
	_money.text = "Деньги: " + Wallet.fmt(Wallet.money)


func _play() -> void:
	_loading.visible = true
	await get_tree().process_frame
	await get_tree().process_frame
	get_tree().change_scene_to_file(GAME_SCENE)


func _open(p: Control) -> void:
	_shop.visible = p == _shop
	_settings.visible = p == _settings
	p.reset_size()
	var vs := get_viewport_rect().size
	p.position = (vs - p.size) * 0.5


# ------------------------------------------------------------------------------------------ shop
func _build_shop() -> void:
	_shop = _panel(Color(0.04, 0.05, 0.08, 0.96))
	add_child(_shop)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 12)
	_shop.add_child(v)
	v.add_child(_label("МАГАЗИН · игровые деньги", 34, Color(1.0, 0.8, 0.3), 6))
	var cfg: Variant = JSON.parse_string(FileAccess.get_file_as_string("res://data/shop_packages.json")) if FileAccess.file_exists("res://data/shop_packages.json") else null
	_pk = cfg if cfg is Dictionary else {"packages": [], "currency_real": "TJS", "contact": ""}
	var grid := HBoxContainer.new()
	grid.add_theme_constant_override("separation", 14)
	v.add_child(grid)
	for p in _pk["packages"]:
		var c := _panel(Color(0.1, 0.12, 0.16, 1.0))
		c.custom_minimum_size = Vector2(230, 0)
		grid.add_child(c)
		var cv := VBoxContainer.new()
		cv.alignment = BoxContainer.ALIGNMENT_CENTER
		c.add_child(cv)
		var a := _label(Wallet.fmt(int(p["game"])), 30, HudStyle.MONEY, 6)
		a.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		cv.add_child(a)
		var r := _label("%d %s" % [int(p["real"]), String(_pk["currency_real"])], 26, Color.WHITE, 4)
		r.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		cv.add_child(r)
		var pg := int(p["game"])
		var pr := str(int(p["real"]))
		cv.add_child(_button("КУПИТЬ", Color(0.1, 0.5, 0.25), func() -> void:
			_shop_msg.text = "Оплата %s %s через администратора.\nСообщите ему ваш ID %s — он пришлёт код на %s, введите его ниже." % [pr, String(_pk["currency_real"]), Account.id, Wallet.fmt(pg)], 200, 56, 22))
	var how := _label("Как пополнить: оплатите выбранный пакет администратору и укажите свой ID: %s.\nВы получите код пополнения — введите его здесь.\n%s" % [Account.id, String(_pk.get("contact", ""))], 20, Color(0.85, 0.9, 1.0), 3)
	how.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	how.custom_minimum_size = Vector2(980, 0)
	v.add_child(how)
	var h := HBoxContainer.new()
	h.add_theme_constant_override("separation", 12)
	v.add_child(h)
	_code = LineEdit.new()
	_code.placeholder_text = "Код пополнения, например DX-5000-1A2B3C-…"
	_code.custom_minimum_size = Vector2(640, 64)
	_code.add_theme_font_size_override("font_size", 24)
	h.add_child(_code)
	h.add_child(_button("АКТИВИРОВАТЬ", Color(0.15, 0.35, 0.7), _redeem, 300, 64, 24))
	_shop_msg = _label("", 22, Color(1.0, 0.85, 0.45), 4)
	_shop_msg.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_shop_msg.custom_minimum_size = Vector2(980, 0)
	v.add_child(_shop_msg)
	v.add_child(_button("ЗАКРЫТЬ", Color(0.35, 0.1, 0.1), func() -> void: _shop.visible = false, 980, 56, 22))
	_shop.visible = false


func _redeem() -> void:
	var r: Variant = Account.redeem(_code.text)
	if r is int:
		_shop_msg.text = "Зачислено: +%s" % Wallet.fmt(int(r))
		_code.text = ""
	else:
		_shop_msg.text = String(r)
	_refresh()


# ------------------------------------------------------------------------------------------ settings
func _build_settings() -> void:
	_settings = _panel(Color(0.04, 0.05, 0.08, 0.96))
	add_child(_settings)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 12)
	_settings.add_child(v)
	v.add_child(_label("НАСТРОЙКИ · графика", 32, Color.WHITE, 6))
	var h := HBoxContainer.new()
	h.add_theme_constant_override("separation", 10)
	v.add_child(h)
	var st := _label("", 22, Color(0.8, 0.9, 1.0), 3)
	for m in ["auto", "low", "medium", "high", "ultra"]:
		var nm: String = {"auto": "Авто", "low": "Низкая", "medium": "Средняя", "high": "Высокая", "ultra": "Ультра"}[m]
		h.add_child(_button(nm, Color(0.2, 0.25, 0.32), func() -> void:
			Settings.set_mode(m)
			st.text = "Выбрано: " + nm, 170, 60, 22))
	st.text = "Сейчас: " + String(Settings.mode)
	v.add_child(st)
	v.add_child(_button("ЗАКРЫТЬ", Color(0.35, 0.1, 0.1), func() -> void: _settings.visible = false, 890, 56, 22))
	_settings.visible = false


# ------------------------------------------------------------------------------------------ helpers
func _label(t: String, fs: int, col: Color, outline: int) -> Label:
	var l := Label.new()
	l.text = t
	l.add_theme_font_override("font", _font)
	l.add_theme_font_size_override("font_size", fs)
	l.add_theme_color_override("font_color", col)
	l.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.9))
	l.add_theme_constant_override("outline_size", outline)
	return l


func _panel(col: Color) -> PanelContainer:
	var p := PanelContainer.new()
	var sb := StyleBoxFlat.new()
	sb.bg_color = col
	sb.set_corner_radius_all(16)
	sb.border_color = Color(1, 1, 1, 0.18)
	sb.set_border_width_all(2)
	sb.content_margin_left = 22
	sb.content_margin_right = 22
	sb.content_margin_top = 18
	sb.content_margin_bottom = 18
	p.add_theme_stylebox_override("panel", sb)
	return p


func _button(t: String, col: Color, cb: Callable, w: float, h: float, fs: int) -> Button:
	var b := Button.new()
	b.text = t
	b.focus_mode = Control.FOCUS_NONE
	b.custom_minimum_size = Vector2(w, h)
	b.add_theme_font_override("font", _font)
	b.add_theme_font_size_override("font_size", fs)
	for state in ["normal", "hover", "pressed", "disabled"]:
		var sb := StyleBoxFlat.new()
		sb.bg_color = col.lightened(0.15) if state == "pressed" else (col.lightened(0.06) if state == "hover" else col)
		sb.set_corner_radius_all(14)
		sb.border_color = Color(1, 1, 1, 0.35)
		sb.set_border_width_all(2)
		b.add_theme_stylebox_override(state, sb)
	b.pressed.connect(cb)
	return b
