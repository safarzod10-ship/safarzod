class_name UI
extends RefCounted
## Палитра, шрифты и фабрика элементов интерфейса. Минимализм в цветах
## референса: серо-бежевый фон, тёмно-синий и малиновый.

const BG := Color("c2c0b1")
const SURFACE := Color("d2d0c2")
const LINE := Color("a5a395")
const TEXT := Color("24253a")
const MUTED := Color("6b6a63")
const ACCENT := Color("9b0030")
const GOLD := Color("8a5f0c")
const PAPER := Color("f8f6ef")
const INK := Color("24253a")
const CARD_RED := Color("9b0030")
const BACK := Color("9b0030")

static var _fonts := {}


static func font(display: bool = false, weight: int = 600) -> Font:
	var key := "%s%d" % [display, weight]
	if _fonts.has(key):
		return _fonts[key]
	var base: FontFile = load("res://assets/fonts/Unbounded.ttf" if display else "res://assets/fonts/Manrope.ttf")
	var fv := FontVariation.new()
	fv.base_font = base
	fv.variation_opentype = {TextServerManager.get_primary_interface().name_to_tag("wght"): weight}
	_fonts[key] = fv
	return fv


static func label(text: String, size: int = 28, color: Color = TEXT, display: bool = false, weight: int = 600) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_override("font", font(display, weight))
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	return l


static func box(color: Color, radius: int = 999, border: Color = Color(0, 0, 0, 0), bw: int = 0) -> StyleBoxFlat:
	var sb := StyleBoxFlat.new()
	sb.bg_color = color
	sb.set_corner_radius_all(radius)
	sb.corner_detail = 12
	sb.anti_aliasing = true
	if bw > 0:
		sb.border_color = border
		sb.set_border_width_all(bw)
	return sb


## Кнопка-«таблетка». kind: "primary" (кремовая), "ghost" (контур), "danger".
static func button(text: String, kind: String = "primary", size: int = 30) -> Button:
	var b := Button.new()
	b.text = text
	b.focus_mode = Control.FOCUS_NONE
	b.custom_minimum_size = Vector2(0, 96)
	b.add_theme_font_override("font", font(true, 600))
	b.add_theme_font_size_override("font_size", size)
	var bg := TEXT
	var fg := PAPER
	var border := Color(0, 0, 0, 0)
	match kind:
		"ghost":
			bg = Color(0, 0, 0, 0)
			fg = TEXT
			border = LINE
		"danger":
			bg = ACCENT
			fg = PAPER
		"dark":
			bg = SURFACE
			fg = TEXT
	var n := box(bg, 999, border, 2 if kind == "ghost" else 0)
	n.content_margin_left = 36
	n.content_margin_right = 36
	var h := n.duplicate() as StyleBoxFlat
	h.bg_color = bg.lightened(0.08) if kind != "ghost" else Color(1, 1, 1, 0.04)
	var p := n.duplicate() as StyleBoxFlat
	p.bg_color = bg.darkened(0.12) if kind != "ghost" else Color(1, 1, 1, 0.08)
	var d := n.duplicate() as StyleBoxFlat
	d.bg_color = Color(bg, 0.35) if kind != "ghost" else Color(0, 0, 0, 0)
	b.add_theme_stylebox_override("normal", n)
	b.add_theme_stylebox_override("hover", h)
	b.add_theme_stylebox_override("pressed", p)
	b.add_theme_stylebox_override("disabled", d)
	b.add_theme_stylebox_override("focus", StyleBoxEmpty.new())
	for st in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color"]:
		b.add_theme_color_override(st, fg)
	b.add_theme_color_override("font_disabled_color", Color(fg, 0.4))
	b.pivot_offset = Vector2(0, 0)
	b.button_down.connect(func() -> void: Sfx.tick())
	return b


## Сегментированный выбор. Возвращает HBox; on_change(index).
static func segmented(options: Array, current: int, on_change: Callable) -> HBoxContainer:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 10)
	var buttons: Array[Button] = []
	for i in options.size():
		var b := Button.new()
		b.text = str(options[i])
		b.toggle_mode = true
		b.focus_mode = Control.FOCUS_NONE
		b.size_flags_horizontal = Control.SIZE_EXPAND_FILL
		b.custom_minimum_size = Vector2(0, 80)
		b.add_theme_font_override("font", font(false, 700))
		b.add_theme_font_size_override("font_size", 26)
		var off := box(Color(0, 0, 0, 0), 999, LINE, 2)
		var on := box(TEXT, 999)
		b.add_theme_stylebox_override("normal", off)
		b.add_theme_stylebox_override("hover", off)
		b.add_theme_stylebox_override("pressed", on)
		b.add_theme_stylebox_override("hover_pressed", on)
		b.add_theme_stylebox_override("focus", StyleBoxEmpty.new())
		b.add_theme_color_override("font_color", TEXT)
		b.add_theme_color_override("font_hover_color", TEXT)
		b.add_theme_color_override("font_pressed_color", PAPER)
		b.add_theme_color_override("font_hover_pressed_color", PAPER)
		b.button_pressed = i == current
		buttons.append(b)
		row.add_child(b)
	for i in buttons.size():
		buttons[i].pressed.connect(func() -> void:
			Sfx.tick()
			for j in buttons.size():
				buttons[j].set_pressed_no_signal(j == i)
			on_change.call(i))
	return row


static func caption(text: String) -> Label:
	var l := label(text.to_upper(), 20, MUTED, false, 700)
	return l


static func spacer(h: float) -> Control:
	var c := Control.new()
	c.custom_minimum_size = Vector2(0, h)
	return c


static func hline() -> ColorRect:
	var r := ColorRect.new()
	r.color = LINE
	r.custom_minimum_size = Vector2(0, 2)
	return r


## Безопасные поля экрана (вырезы, жесты).
static func safe_margins(root: Control) -> Vector4:
	var top := 48.0
	var bottom := 32.0
	var safe := DisplayServer.get_display_safe_area()
	var screen := DisplayServer.screen_get_size()
	if OS.has_feature("mobile") and screen.y > 0:
		var k := root.get_viewport_rect().size.y / float(screen.y)
		top = maxf(top, safe.position.y * k + 12.0)
		bottom = maxf(bottom, (screen.y - safe.end.y) * k + 12.0)
	return Vector4(32, top, 32, bottom)
