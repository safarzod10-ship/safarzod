extends Control
## Multitouch surface: dynamic virtual joystick (left zone), RUN toggle, JUMP and PUNCH buttons
## (bottom right) and swipe-to-look on the right half. Pure Control drawing, no textures.

const DEAD_ZONE := 0.12
const FONT_PATH := "res://assets/fonts/DejaVuSans-Bold.ttf"

var _font: Font
var _u := 80.0                           # layout unit (px), from the short screen side
var _joy_finger := -1
var _joy_origin := Vector2.ZERO
var _joy_vec := Vector2.ZERO             # raw, length <= 1
var _look_finger := -1
var _jump_finger := -1
var _punch_finger := -1
var _last_run := false


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	_font = load(FONT_PATH) if ResourceLoader.exists(FONT_PATH) else ThemeDB.fallback_font
	resized.connect(queue_redraw)


func _process(_delta: float) -> void:
	if PlayerInput.run_toggle != _last_run:      # RUN may also be toggled from the keyboard
		_last_run = PlayerInput.run_toggle
		queue_redraw()


# ---------------------------------------------------------------- layout (works for 16:9 .. 21:9)
func _unit() -> float:
	return minf(size.x, size.y) / 10.0


func _joy_radius() -> float:
	return 1.25 * _unit()


func _joy_home() -> Vector2:
	var u := _unit()
	return Vector2(2.4 * u, size.y - 2.5 * u)


func _jump_rect() -> Array:                # [center, radius]
	var u := _unit()
	return [Vector2(size.x - 1.9 * u, size.y - 2.0 * u), 1.0 * u]


func _punch_rect() -> Array:             # above-left of JUMP, on the thumb's natural arc
	var u := _unit()
	return [Vector2(size.x - 2.5 * u, size.y - 4.35 * u), 0.95 * u]


func _run_rect() -> Array:
	var u := _unit()
	return [Vector2(size.x - 4.3 * u, size.y - 1.5 * u), 0.8 * u]


func _in_circle(p: Vector2, c: Array) -> bool:
	return p.distance_to(c[0]) <= c[1] * 1.15


func _in_joy_zone(p: Vector2) -> bool:
	return p.x < size.x * 0.45 and p.y > size.y * 0.3


# ---------------------------------------------------------------- input
func _input(event: InputEvent) -> void:
	if event is InputEventScreenTouch:
		var p: Vector2 = event.position
		if event.pressed:
			if _in_circle(p, _jump_rect()):
				_jump_finger = event.index
				PlayerInput.queue_jump()
			elif _in_circle(p, _run_rect()):
				PlayerInput.run_toggle = not PlayerInput.run_toggle
			elif _joy_finger < 0 and _in_joy_zone(p):
				_joy_finger = event.index
				# dynamic origin: where the thumb lands (kept inside the screen)
				var r := _joy_radius()
				_joy_origin = Vector2(clampf(p.x, r, size.x * 0.45 - r * 0.5), clampf(p.y, size.y * 0.3 + r * 0.5, size.y - r))
				_joy_vec = Vector2.ZERO
			elif _look_finger < 0 and p.x >= size.x * 0.5:
				_look_finger = event.index
			else:
				return
			get_viewport().set_input_as_handled()
		else:
			if event.index == _joy_finger:
				_joy_finger = -1
				_joy_vec = Vector2.ZERO
				PlayerInput.touch_move = Vector2.ZERO
			elif event.index == _look_finger:
				_look_finger = -1
			elif event.index == _jump_finger:
				_jump_finger = -1
		queue_redraw()
	elif event is InputEventScreenDrag:
		if event.index == _joy_finger:
			var v: Vector2 = (event.position - _joy_origin) / _joy_radius()
			_joy_vec = v.limit_length(1.0)
			var l := _joy_vec.length()
			# dead zone, then rescale so the output starts from 0 at the edge of the dead zone
			PlayerInput.touch_move = Vector2.ZERO if l < DEAD_ZONE else _joy_vec / l * ((l - DEAD_ZONE) / (1.0 - DEAD_ZONE))
			get_viewport().set_input_as_handled()
			queue_redraw()
		elif event.index == _look_finger:
			PlayerInput.look_delta += event.relative
			get_viewport().set_input_as_handled()


# ---------------------------------------------------------------- drawing
func _draw() -> void:
	var u := _unit()
	# joystick
	var r := _joy_radius()
	var o := _joy_origin if _joy_finger >= 0 else _joy_home()
	var active := _joy_finger >= 0
	draw_circle(o, r, Color(1, 1, 1, 0.10 if active else 0.06))
	draw_arc(o, r, 0, TAU, 64, Color(1, 1, 1, 0.45 if active else 0.25), 0.04 * u, true)
	var knob := o + _joy_vec * r
	draw_circle(knob, 0.48 * r, Color(1, 1, 1, 0.45 if active else 0.28))
	draw_arc(knob, 0.48 * r, 0, TAU, 48, Color(1, 1, 1, 0.6), 0.025 * u, true)
	# RUN toggle
	var run := _run_rect()
	var on := PlayerInput.run_toggle
	draw_circle(run[0], run[1], Color(1.0, 0.58, 0.15, 0.55) if on else Color(0, 0, 0, 0.32))
	draw_arc(run[0], run[1], 0, TAU, 48, Color(1.0, 0.75, 0.35, 0.95) if on else Color(1, 1, 1, 0.5), 0.04 * u, true)
	_draw_chevrons(run[0] + Vector2(0, -0.22 * run[1]), 0.32 * run[1], Color(1, 1, 1, 0.95 if on else 0.75))
	_label(run[0] + Vector2(0, 0.42 * run[1]), "БЕГ", int(0.28 * u), Color(1, 1, 1, 0.95 if on else 0.8))
	# JUMP
	var jp := _jump_rect()
	var pressed := _jump_finger >= 0
	draw_circle(jp[0], jp[1], Color(1, 1, 1, 0.28) if pressed else Color(0, 0, 0, 0.32))
	draw_arc(jp[0], jp[1], 0, TAU, 48, Color(1, 1, 1, 0.6), 0.04 * u, true)
	var a: Vector2 = jp[0] + Vector2(0, -0.25 * jp[1])
	var s: float = 0.28 * jp[1]
	draw_colored_polygon(PackedVector2Array([a + Vector2(0, -s), a + Vector2(s, s * 0.6), a + Vector2(-s, s * 0.6)]),
			Color(1, 1, 1, 0.85))
	_label(jp[0] + Vector2(0, 0.42 * jp[1]), "ПРЫЖОК", int(0.24 * u), Color(1, 1, 1, 0.85))
	# PUNCH
	var pr := _punch_rect()
	var pp := _punch_finger >= 0
	draw_circle(pr[0], pr[1], Color(0.9, 0.25, 0.2, 0.5) if pp else Color(0, 0, 0, 0.32))
	draw_arc(pr[0], pr[1], 0, TAU, 48, Color(1, 0.6, 0.55, 0.9) if pp else Color(1, 1, 1, 0.6), 0.04 * u, true)
	_draw_fist(pr[0] + Vector2(0, -0.2 * pr[1]), 0.36 * pr[1], Color(1, 1, 1, 0.9))
	_label(pr[0] + Vector2(0, 0.55 * pr[1]), "УДАР", int(0.24 * u), Color(1, 1, 1, 0.85))


func _draw_fist(c: Vector2, s: float, col: Color) -> void:
	## Simple, readable fist icon: four knuckles, palm block, thumb across the front.
	var palm := Rect2(c + Vector2(-0.62 * s, -0.25 * s), Vector2(1.24 * s, 0.95 * s))
	draw_rect(palm, col, true)
	for i in 4:
		var k := c + Vector2(-0.47 * s + i * 0.31 * s, -0.32 * s)
		draw_circle(k, 0.2 * s, col)
	draw_line(c + Vector2(-0.6 * s, 0.22 * s), c + Vector2(0.25 * s, 0.22 * s), Color(0, 0, 0, 0.55), 0.09 * s, true)
	draw_circle(c + Vector2(0.38 * s, 0.22 * s), 0.17 * s, col)
	for i in 3:
		var x := -0.31 * s + i * 0.31 * s
		draw_line(c + Vector2(x, -0.45 * s), c + Vector2(x, 0.05 * s), Color(0, 0, 0, 0.45), 0.05 * s, true)
	draw_rect(Rect2(c + Vector2(-0.45 * s, 0.7 * s), Vector2(0.9 * s, 0.25 * s)), col, true)   # wrist


func _draw_chevrons(c: Vector2, s: float, col: Color) -> void:
	for dx in [-0.45 * s, 0.35 * s]:
		var p := c + Vector2(dx, 0)
		draw_polyline(PackedVector2Array([p + Vector2(-0.35 * s, -0.6 * s), p + Vector2(0.35 * s, 0), p + Vector2(-0.35 * s, 0.6 * s)]),
				col, 0.18 * s, true)


func _label(center: Vector2, text: String, fs: int, col: Color) -> void:
	var w := _font.get_string_size(text, HORIZONTAL_ALIGNMENT_CENTER, -1, fs).x
	var asc := _font.get_ascent(fs)
	draw_string(_font, center + Vector2(-w * 0.5, asc * 0.35), text, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, col)
