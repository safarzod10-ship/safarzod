class_name CardView
extends Control
## Одна карта. Рисуется кодом: кремовая «бумага», масть вектором.
## card = -1 — рубашка. flip_t (0..1) — анимация переворота.

signal pressed(view: CardView)
signal drag_started(view: CardView)
signal dragged(view: CardView, pos: Vector2)
signal dropped(view: CardView, pos: Vector2)

var card := -1:
	set(v):
		card = v
		queue_redraw()
var face_up := true:
	set(v):
		face_up = v
		queue_redraw()
var selected := false:
	set(v):
		selected = v
		queue_redraw()
var glow := false:
	set(v):
		glow = v
		queue_redraw()
var stamp := "":
	set(v):
		stamp = v
		queue_redraw()
var flip := 1.0:
	set(v):
		flip = v
		queue_redraw()
var trump := -1
var interactive := false
var home_pos := Vector2.ZERO
var home_rot := 0.0
var leaving := false
var tween: Tween

var _press_pos := Vector2.ZERO
var _pressing := false
var _dragging := false
var _touch_index := -1


func _init() -> void:
	size = Vector2(CardArt.W, CardArt.H)
	pivot_offset = size / 2.0
	mouse_filter = Control.MOUSE_FILTER_IGNORE


func set_interactive(v: bool) -> void:
	interactive = v
	mouse_filter = Control.MOUSE_FILTER_STOP if v else Control.MOUSE_FILTER_IGNORE


## Переворот: сжать по X, сменить сторону, развернуть.
func flip_to(up: bool, delay: float = 0.0, dur: float = 0.34) -> void:
	if up == face_up:
		return
	var t := create_tween()
	t.tween_interval(delay)
	t.tween_property(self, "flip", 0.0, dur / 2.0).set_trans(Tween.TRANS_SINE)
	t.tween_callback(func() -> void: face_up = up)
	t.tween_property(self, "flip", 1.0, dur / 2.0).set_trans(Tween.TRANS_SINE)


func _gui_input(e: InputEvent) -> void:
	if not interactive:
		return
	if e is InputEventMouseButton and e.button_index == MOUSE_BUTTON_LEFT:
		if e.pressed:
			_pressing = true
			_dragging = false
			_press_pos = get_global_mouse_position()
			accept_event()
		elif _pressing:
			_pressing = false
			accept_event()
			if _dragging:
				_dragging = false
				dropped.emit(self, get_global_mouse_position())
			else:
				pressed.emit(self)
	elif e is InputEventMouseMotion and _pressing:
		var gp := get_global_mouse_position()
		if not _dragging and gp.distance_to(_press_pos) > 18.0:
			_dragging = true
			drag_started.emit(self)
		if _dragging:
			dragged.emit(self, gp)
		accept_event()


var _base := Transform2D.IDENTITY


func _xf(t: Transform2D = Transform2D.IDENTITY) -> void:
	draw_set_transform_matrix(_base * t)


func _draw() -> void:
	var r := Rect2(Vector2.ZERO, size)
	var k := size.x / CardArt.W
	_base = Transform2D(0.0, Vector2(maxf(flip, 0.001), 1.0), 0.0, Vector2(size.x / 2.0 * (1.0 - flip), 0.0))
	_xf()
	var sh := UI.box(Color(0, 0, 0, 0), int(12 * k))
	sh.shadow_color = Color(0.08, 0.07, 0.05, 0.22)
	sh.shadow_size = int(14 * k)
	sh.shadow_offset = Vector2(0, 5 * k)
	draw_style_box(sh, r)
	if face_up and card >= 0:
		_draw_face(r, k)
	else:
		_draw_back(r, k)
	if selected or glow:
		var ring := UI.box(Color(0, 0, 0, 0), int(14 * k), UI.ACCENT if selected else UI.TEXT, int(4 * k))
		draw_style_box(ring, r.grow(5 * k))
	if stamp != "":
		_draw_stamp(k)


func _draw_face(r: Rect2, k: float) -> void:
	draw_style_box(UI.box(UI.PAPER, int(12 * k)), r)
	var s := Cards.suit(card)
	var rk := Cards.rank(card)
	var col := CardArt.suit_color(s)
	var f := UI.font(true, 600)
	var lbl := Cards.label(card)
	var fs := int((30 if lbl.length() == 1 else 26) * k)
	var small := CardArt.suit_tex(s, 64)
	# Углы.
	for corner in 2:
		if corner == 1:
			_xf(Transform2D(PI, size))
		draw_string(f, Vector2(10 * k, 36 * k), lbl, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, col)
		draw_texture_rect(small, Rect2(Vector2(11 * k, 44 * k), Vector2(22, 22) * k), false, col)
		_xf()
	# Центр: картинка — буква, иначе крупная масть.
	var c := size / 2.0
	if rk >= 11:
		var big := int(62 * k)
		var tw := f.get_string_size(lbl, HORIZONTAL_ALIGNMENT_LEFT, -1, big).x
		draw_string(f, Vector2(c.x - tw / 2.0, c.y + 14 * k), lbl, HORIZONTAL_ALIGNMENT_LEFT, -1, big, col)
		draw_texture_rect(CardArt.suit_tex(s, 64), Rect2(c + Vector2(-11, 26) * k, Vector2(22, 22) * k), false, col)
	else:
		var sz := 58.0 * k
		draw_texture_rect(CardArt.suit_tex(s, 128), Rect2(c - Vector2(sz, sz) / 2.0, Vector2(sz, sz)), false, col)
	if trump >= 0 and s == trump:
		draw_circle(Vector2(size.x - 14 * k, 14 * k), 4.0 * k, UI.GOLD, true, -1.0, true)


func _draw_back(r: Rect2, k: float) -> void:
	draw_style_box(UI.box(UI.BACK, int(12 * k)), r)
	var inner := r.grow(-9 * k)
	draw_style_box(UI.box(Color(0, 0, 0, 0), int(7 * k), Color(UI.PAPER, 0.55), maxi(1, int(2 * k))), inner)
	var step := 13.0 * k
	var dot := Color(UI.PAPER, 0.16)
	var y := inner.position.y + step
	var row := 0
	while y < inner.end.y - step * 0.5:
		var x := inner.position.x + step * (1.0 if row % 2 == 0 else 1.5)
		while x < inner.end.x - step * 0.5:
			draw_circle(Vector2(x, y), 1.6 * k, dot, true, -1.0, true)
			x += step
		y += step
		row += 1
	var c := size / 2.0
	var d := 15.0 * k
	draw_colored_polygon(PackedVector2Array([c + Vector2(0, -d), c + Vector2(d * 0.7, 0), c + Vector2(0, d), c + Vector2(-d * 0.7, 0)]), Color(UI.PAPER, 0.85))


func _draw_stamp(k: float) -> void:
	var c := size / 2.0
	_xf(Transform2D(-0.32, c))
	var f := UI.font(true, 800)
	var fs := int(24 * k)
	var tw := f.get_string_size(stamp, HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x
	var rect := Rect2(Vector2(-tw / 2.0 - 10 * k, -22 * k), Vector2(tw + 20 * k, 40 * k))
	draw_style_box(UI.box(UI.ACCENT, int(6 * k)), rect)
	draw_string(f, Vector2(-tw / 2.0, 9 * k), stamp, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, UI.PAPER)
	_xf()
