extends Control
## The start menu, drawn by the owner (assets/ui/menu_main.png, menu_shop.png): on phones (wider than
## 16:9) the picture fills the whole screen (width fitted, a little sky / pavement cropped, centred on
## the buttons); buttons that would fall into the cropped strip (gear, ✕, Бозгашт) are cut out of the
## picture and pinned to their screen corner. Taller screens (tablets) fit it whole. Every button
## drawn in them is a real button placed exactly over it (rects in the pictures' 1672 x 941 pixels):
##   main: Бозӣ кардан (play) · Магазин · Об игре · Баромадан (exit) · settings (gear)
##   shop: four «Харидорӣ» packages · promo code field + ✓ · Бозгашт (back) · ✕
## The account ID is given automatically (Account); packages are paid through the administrator
## (one-time codes, tools/admin/make_code.py); promo code TAJDUSH gives 20 000 смн once.

const GAME_SCENE := "res://scenes/main/main.tscn"
const IMG := Vector2(1672, 941)
const MAIN_BTNS := {"play": Rect2(65, 462, 450, 86), "shop": Rect2(55, 563, 440, 82), "about": Rect2(50, 663, 425, 82),
	"exit": Rect2(50, 763, 420, 82), "settings": Rect2(1563, 28, 87, 62)}
const SHOP_BTNS := {"close": Rect2(1570, 25, 75, 70), "buy0": Rect2(276, 578, 260, 64), "buy1": Rect2(617, 578, 240, 64),
	"buy2": Rect2(942, 578, 244, 64), "buy3": Rect2(1275, 578, 257, 64), "promo": Rect2(1178, 724, 317, 62),
	"ok": Rect2(1512, 722, 85, 66), "back": Rect2(32, 838, 373, 74)}
## vertical centre of the visible part of each picture (image px), corner-pinned buttons
const FOCUS := {"main": 470.0, "shop": 503.0}
const PINS := {"settings": "tr", "close": "tr", "back": "bl"}
const LINKS := {
	"YouTube": "https://youtube.com/@dushanbe-x?si=6Kg6TmjxlxOiQ-g2",
	"TikTok": "https://www.tiktok.com/@dushanbe_x?_r=1&_t=ZS-9BGBeNNHSGw",
	"Telegram": "https://t.me/DushanbeXgame",
	"Instagram": "https://www.instagram.com/dushanbe.x?dlrf=MXc5b2hkNzJ5OHUydQ%3D%3D&utm_source=qr",
}
const SUPPORT := "https://t.me/DushanbeX_Support"

var _font: Font
var _main_tex: Texture2D
var _shop_tex: Texture2D
var _blur := {}                  ## blurred copies for the side bars
var _screen := "main"
var _bg: Control                 ## draws the current picture (fit + blurred fill)
var _main_btns := {}
var _shop_btns := {}
var _code: LineEdit
var _info: Label                 ## account line (bottom right)
var _toast: Label
var _toast_t := 0.0
var _dialog: PanelContainer
var _dialog_text: Label
var _dialog_box: VBoxContainer
var _loading: Label
var _pk := {}


func _ready() -> void:
	Account.ensure()
	Wallet.load_state()
	_font = HudStyle.font()
	set_anchors_preset(Control.PRESET_FULL_RECT)
	_main_tex = load("res://assets/ui/menu_main.png")
	_shop_tex = load("res://assets/ui/menu_shop.png")
	_blur = {"main": load("res://assets/ui/menu_main_blur.jpg"), "shop": load("res://assets/ui/menu_shop_blur.jpg")}
	var cfg: Variant = JSON.parse_string(FileAccess.get_file_as_string("res://data/shop_packages.json")) if FileAccess.file_exists("res://data/shop_packages.json") else null
	_pk = cfg if cfg is Dictionary else {"packages": [], "currency_real": "TJS", "contact": ""}
	_bg = Control.new()
	_bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	_bg.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_bg.draw.connect(_draw_bg)
	add_child(_bg)
	for k in MAIN_BTNS:
		_main_btns[k] = _hit_button(k, _on_main)
	for k in SHOP_BTNS:
		if k == "promo":
			continue
		_shop_btns[k] = _hit_button(k, _on_shop)
	_code = LineEdit.new()
	_code.placeholder_text = "Кодро ворид кунед..."
	_code.add_theme_font_override("font", _font)
	_code.add_theme_color_override("font_color", Color.WHITE)
	_code.add_theme_color_override("font_placeholder_color", Color(0.65, 0.65, 0.68))
	var lsb := StyleBoxFlat.new()
	lsb.bg_color = Color(0.07, 0.07, 0.08)
	lsb.set_corner_radius_all(10)
	lsb.border_color = Color(0.85, 0.65, 0.2, 0.9)
	lsb.set_border_width_all(2)
	lsb.content_margin_left = 14
	for st in ["normal", "focus", "read_only"]:
		_code.add_theme_stylebox_override(st, lsb)
	_code.text_submitted.connect(func(_t: String) -> void: _redeem())
	add_child(_code)
	_info = _text_label(20, Color(1, 1, 1, 0.95))
	_info.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	add_child(_info)
	_build_dialog()
	_toast = _text_label(30, Color(1.0, 0.86, 0.4))
	_toast.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_toast.visible = false
	add_child(_toast)
	_loading = _text_label(48, Color.WHITE)
	_loading.text = "Загрузка…"
	_loading.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_loading.visible = false
	add_child(_loading)
	get_viewport().size_changed.connect(_layout)
	show_screen("main")


# ------------------------------------------------------------------------------------------ layout
## the picture fitted in the screen (no crop): its rect on screen
func _pic_rect() -> Rect2:
	var vs := get_viewport_rect().size
	if vs.x / vs.y >= IMG.x / IMG.y - 0.001:
		# cover: full width, crop top / bottom around the buttons
		var sc := vs.x / IMG.x
		var h := IMG.y * sc
		var y := clampf(vs.y * 0.5 - float(FOCUS.get(_screen, 470.0)) * sc, vs.y - h, 0.0)
		return Rect2(Vector2(0, y), Vector2(vs.x, h))
	var s := minf(vs.x / IMG.x, vs.y / IMG.y)
	var sz := IMG * s
	return Rect2((vs - sz) * 0.5, sz)


func _covering() -> bool:
	var vs := get_viewport_rect().size
	return vs.x / vs.y >= IMG.x / IMG.y - 0.001 and absf(vs.x / vs.y - IMG.x / IMG.y) > 0.01


## a button's rect on screen; corner-pinned ones keep their distance to that screen corner
func _map(r: Rect2, key := "") -> Rect2:
	var pr := _pic_rect()
	var s := pr.size.x / IMG.x
	if key != "" and PINS.has(key) and _covering():
		var vs := get_viewport_rect().size
		match String(PINS[key]):
			"tr":
				return Rect2(Vector2(vs.x - (IMG.x - r.position.x) * s, r.position.y * s), r.size * s)
			"bl":
				return Rect2(Vector2(r.position.x * s, vs.y - (r.size.y * 0.85 + 4.0) * s), r.size * s * 0.85)
	return Rect2(pr.position + r.position * s, r.size * s)


func _layout() -> void:
	var vs := get_viewport_rect().size
	for k in _main_btns:
		var b: Button = _main_btns[k]
		var r := _map(MAIN_BTNS[k], k)
		b.position = r.position
		b.size = r.size
		b.visible = _screen == "main"
	for k in _shop_btns:
		var b: Button = _shop_btns[k]
		var r := _map(SHOP_BTNS[k], k)
		b.position = r.position
		b.size = r.size
		b.visible = _screen == "shop"
	var pr := _map(SHOP_BTNS["promo"])
	_code.position = pr.position
	_code.size = pr.size
	_code.add_theme_font_size_override("font_size", int(pr.size.y * 0.38))
	_code.visible = _screen == "shop"
	var pic := _pic_rect()
	_info.size = Vector2(700, 40)
	_info.position = Vector2(minf(pic.end.x, vs.x) - 720, minf(pic.end.y, vs.y) - 52)
	_info.text = "ID: %s   ·   %s" % [Account.id, Wallet.fmt(Wallet.money)]
	_toast.size = Vector2(vs.x, 60)
	_toast.position = Vector2(0, maxf(pic.position.y, 0.0) + vs.y * 0.05)
	_loading.size = Vector2(vs.x, 80)
	_loading.position = Vector2(0, vs.y * 0.45)
	if _dialog.visible:
		_dialog.reset_size()
		_dialog.position = (vs - _dialog.size) * 0.5
	_bg.queue_redraw()


func show_screen(s: String) -> void:
	_screen = s
	_dialog.visible = false
	_layout()


func _draw_bg() -> void:
	var tex := _main_tex if _screen != "shop" else _shop_tex
	if tex == null:
		return
	var vs := get_viewport_rect().size
	# side fill: the same picture covering the screen, darkened (looks like a blur behind the bars)
	var s := maxf(vs.x / IMG.x, vs.y / IMG.y) * 1.08
	var cover := IMG * s
	var bt: Texture2D = _blur["shop" if _screen == "shop" else "main"]
	_bg.draw_texture_rect(bt if bt else tex, Rect2((vs - cover) * 0.5, cover), false)
	_bg.draw_texture_rect(tex, _pic_rect(), false)
	if _covering():
		if _screen == "shop":       # hide the original (cropped) back button under plain pavement
			_bg.draw_texture_rect_region(tex, _map(Rect2(20, 826, 400, 115)), Rect2(470, 826, 400, 115))
		var btns: Dictionary = SHOP_BTNS if _screen == "shop" else MAIN_BTNS
		for k in btns:
			if PINS.has(k):
				var src: Rect2 = btns[k]
				src = src.grow(6.0)
				var dst := _map(src, k)
				_bg.draw_texture_rect_region(tex, dst, src)


func _process(delta: float) -> void:
	_toast_t -= delta
	_toast.visible = _toast_t > 0.0


func toast(t: String, secs := 3.0) -> void:
	_toast.text = t
	_toast_t = secs


# ------------------------------------------------------------------------------------------ actions
func _on_main(k: String) -> void:
	match k:
		"play":
			_loading.visible = true
			for b in _main_btns.values():
				(b as Button).disabled = true
			await get_tree().process_frame
			await get_tree().process_frame
			get_tree().change_scene_to_file(GAME_SCENE)
		"shop":
			show_screen("shop")
		"about":
			_open_about()
		"exit":
			get_tree().quit()
		"settings":
			_open_settings()


func _on_shop(k: String) -> void:
	match k:
		"close", "back":
			show_screen("main")
		"ok":
			_redeem()
		_:
			if k.begins_with("buy"):
				var i := int(k.substr(3))
				var pks: Array = _pk.get("packages", [])
				if i < pks.size():
					_open_buy(pks[i])


func _redeem() -> void:
	var r: Variant = Account.redeem(_code.text)
	if r is int:
		toast("Зачислено: +%s" % Wallet.fmt(int(r)), 4.0)
		_code.text = ""
	else:
		toast(String(r), 3.5)
	_layout()


# ------------------------------------------------------------------------------------------ dialogs
func _build_dialog() -> void:
	_dialog = PanelContainer.new()
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0.05, 0.05, 0.07, 0.96)
	sb.set_corner_radius_all(18)
	sb.border_color = Color(0.9, 0.7, 0.25)
	sb.set_border_width_all(3)
	sb.content_margin_left = 30
	sb.content_margin_right = 30
	sb.content_margin_top = 22
	sb.content_margin_bottom = 22
	_dialog.add_theme_stylebox_override("panel", sb)
	_dialog_box = VBoxContainer.new()
	_dialog_box.add_theme_constant_override("separation", 14)
	_dialog.add_child(_dialog_box)
	_dialog_text = _text_label(24, Color.WHITE)
	_dialog_text.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_dialog_text.custom_minimum_size = Vector2(900, 0)
	_dialog.visible = false
	add_child(_dialog)


func _open_dialog(text: String, buttons: Array) -> void:
	for c in _dialog_box.get_children():
		_dialog_box.remove_child(c)
		if c != _dialog_text:
			c.queue_free()
	_dialog_box.add_child(_dialog_text)
	_dialog_text.text = text
	for b in buttons:
		_dialog_box.add_child(b)
	_dialog_box.add_child(_button("ЗАКРЫТЬ", Color(0.4, 0.12, 0.1), func() -> void: _dialog.visible = false))
	_dialog.visible = true
	_layout()


func _open_buy(p: Dictionary) -> void:
	var cur := String(_pk.get("currency_real", "TJS"))
	var t := "Пакет: %s за %d %s\n\nОплата пока через администратора:\n1) напишите в поддержку @DushanbeX_Support и укажите ваш ID: %s\n2) оплатите %d %s\n3) получите код пополнения и введите его в поле «Промоко» → ✓" % [
		Wallet.fmt(int(p["game"])), int(p["real"]), cur, Account.id, int(p["real"]), cur]
	_open_dialog(t, [
		_button("НАПИСАТЬ В ПОДДЕРЖКУ", Color(0.15, 0.45, 0.8), func() -> void: OS.shell_open(SUPPORT)),
		_button("СКОПИРОВАТЬ МОЙ ID", Color(0.25, 0.28, 0.34), func() -> void:
			DisplayServer.clipboard_set(Account.id)
			toast("ID скопирован: " + Account.id)),
	])


func _open_about() -> void:
	var t := "DUSHANBE-X\n\nЭту игру мы делали от души — для Таджикистана и для всех, кто любит Душанбе. Мы хотим, чтобы вы нас поддержали: подписывайтесь, делитесь игрой с друзьями.\n\nКомпаниям по вопросам рекламы в игре (билборды, вывески, машины) пишите: @DushanbeX_Support\n\nОфициальные соцсети:"
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 12)
	var cols := {"YouTube": Color(0.8, 0.1, 0.1), "TikTok": Color(0.12, 0.12, 0.14), "Telegram": Color(0.15, 0.55, 0.85), "Instagram": Color(0.75, 0.2, 0.55)}
	for n in LINKS:
		var url: String = LINKS[n]
		var b := _button(n, cols[n], func() -> void: OS.shell_open(url))
		b.custom_minimum_size = Vector2(210, 64)
		row.add_child(b)
	_open_dialog(t, [row, _button("ПОДДЕРЖКА / РЕКЛАМА: @DushanbeX_Support", Color(0.15, 0.45, 0.8), func() -> void: OS.shell_open(SUPPORT)),
		_text_label(20, Color(0.75, 0.8, 0.9))])
	(_dialog_box.get_child(_dialog_box.get_child_count() - 2) as Label).text = "Ваш ID: " + Account.id


func _open_settings() -> void:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 10)
	var st := _text_label(22, Color(0.8, 0.9, 1.0))
	st.text = "Сейчас: " + String(Settings.mode)
	for m in ["auto", "low", "medium", "high", "ultra"]:
		var nm: String = {"auto": "Авто", "low": "Низкая", "medium": "Средняя", "high": "Высокая", "ultra": "Ультра"}[m]
		var b := _button(nm, Color(0.2, 0.25, 0.32), func() -> void:
			Settings.set_mode(m)
			st.text = "Выбрано: " + nm)
		b.custom_minimum_size = Vector2(170, 60)
		row.add_child(b)
	_open_dialog("НАСТРОЙКИ · качество графики", [row, st])


# ------------------------------------------------------------------------------------------ helpers
## an invisible button over a button drawn in the picture: a soft glow when pressed / hovered
func _hit_button(key: String, cb: Callable) -> Button:
	var b := Button.new()
	b.focus_mode = Control.FOCUS_NONE
	b.flat = true
	var empty := StyleBoxEmpty.new()
	var glow := StyleBoxFlat.new()
	glow.bg_color = Color(1, 1, 1, 0.12)
	glow.set_corner_radius_all(12)
	b.add_theme_stylebox_override("normal", empty)
	b.add_theme_stylebox_override("hover", glow)
	b.add_theme_stylebox_override("pressed", glow)
	b.add_theme_stylebox_override("focus", empty)
	b.pressed.connect(func() -> void: cb.call(key))
	b.name = "Btn_" + key
	add_child(b)
	return b


func _text_label(fs: int, col: Color) -> Label:
	var l := Label.new()
	l.add_theme_font_override("font", _font)
	l.add_theme_font_size_override("font_size", fs)
	l.add_theme_color_override("font_color", col)
	l.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.9))
	l.add_theme_constant_override("outline_size", 6)
	return l


func _button(t: String, col: Color, cb: Callable) -> Button:
	var b := Button.new()
	b.text = t
	b.focus_mode = Control.FOCUS_NONE
	b.custom_minimum_size = Vector2(900, 62)
	b.add_theme_font_override("font", _font)
	b.add_theme_font_size_override("font_size", 22)
	for state in ["normal", "hover", "pressed"]:
		var sb := StyleBoxFlat.new()
		sb.bg_color = col.lightened(0.15) if state == "pressed" else (col.lightened(0.06) if state == "hover" else col)
		sb.set_corner_radius_all(12)
		b.add_theme_stylebox_override(state, sb)
	b.pressed.connect(cb)
	return b
