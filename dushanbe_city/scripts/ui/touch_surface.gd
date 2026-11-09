extends Control
## MobileInputController - multitouch surface in the HUD style of the owner's mock-ups (HudStyle):
## * left: analog joystick (round pad with ▲▼◄► marks; dead zone 12 %, rescaled -> smooth start);
## * right: big FIST (punch), JUMP, and a contextual button that appears only when something is
##   usable: a car door icon for getting in, a hand + its label («УСТРОИТЬСЯ», ...) otherwise;
## * left column under the minimap: RUN (toggle), PAUSE (the game menu);
## * swipe anywhere else on the right half rotates the camera (sensitivity from the settings);
## every finger is tracked separately: walk + look + jump / run at the same time.
## Sizes scale with PlayerInput.ui_scale; everything stays inside the display safe area (notches,
## gesture bars) with an extra margin from the screen edges.

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
var _action_finger := -1
var _last_run := false
var _action_label := ""
var _safe := Rect2()


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	_font = load(FONT_PATH) if ResourceLoader.exists(FONT_PATH) else ThemeDB.fallback_font
	resized.connect(queue_redraw)


func _process(_delta: float) -> void:
	if PlayerInput.run_toggle != _last_run:      # RUN may also be toggled from the keyboard
		_last_run = PlayerInput.run_toggle
		queue_redraw()
	var lbl := ""
	for pl in get_tree().get_nodes_in_group(&"player"):
		var it: Variant = pl.get("interaction")
		if it and (pl as Node).process_mode != Node.PROCESS_MODE_DISABLED:
			lbl = (it as CharacterInteraction).label()
	if lbl != _action_label:
		_action_label = lbl
		queue_redraw()
	var sa := _safe_rect()
	if sa != _safe:
		_safe = sa
		queue_redraw()


func _safe_rect() -> Rect2:
	## display safe area (notch / rounded corners / gesture bar) in this control's coordinates
	var r := Rect2(Vector2.ZERO, size)
	if DisplayServer.get_name() != "headless":
		var sa := DisplayServer.get_display_safe_area()
		var ws := DisplayServer.window_get_size()
		if sa.size.x > 0 and ws.x > 0:
			var k := size / Vector2(ws)
			r = Rect2(Vector2(sa.position) * k, Vector2(sa.size) * k).intersection(r)
	return r


# ---------------------------------------------------------------- layout (works for 16:9 .. 21:9)
func _unit() -> float:
	return minf(size.x, size.y) / 10.0 * PlayerInput.ui_scale


func _right() -> float:
	var sa := _safe if _safe.size.x > 0 else Rect2(Vector2.ZERO, size)
	return sa.end.x - 0.25 * _unit()            # keep clear of the edge gesture zone


func _bottom() -> float:
	var sa := _safe if _safe.size.y > 0 else Rect2(Vector2.ZERO, size)
	return sa.end.y - 0.2 * _unit()


func _joy_radius() -> float:
	return 1.15 * _unit()


func _joy_home() -> Vector2:
	var u := _unit()
	var x0 := (_safe.position.x if _safe.size.x > 0 else 0.0) + 0.25 * u
	return Vector2(x0 + 1.6 * u, _bottom() - 1.55 * u)


## right edge, as in the mock-up: FIST above, RUN under it; JUMP (small) left of RUN
func _jump_rect() -> Array:                # [center, radius]
	var u := _unit()
	return [Vector2(_right() - 2.75 * u, _bottom() - 1.0 * u), 0.55 * u]


func _punch_rect() -> Array:
	var u := _unit()
	return [Vector2(_right() - 0.95 * u, _bottom() - 3.05 * u), 0.8 * u]


func _column_top() -> float:
	return 16.0 + clampf(minf(size.x, size.y) * 0.22, 150.0, 320.0)


func _run_rect() -> Array:
	var u := _unit()
	return [Vector2(_right() - 0.95 * u, _bottom() - 1.05 * u), 0.8 * u]


func _menu_rect() -> Array:               # small pause button under the minimap
	var u := minf(size.x, size.y) / 10.0
	return [Vector2(0.8 * u, _column_top() + 0.65 * u), 0.45 * u]


func _action_rect() -> Array:            # contextual: left of the fist (only when something is usable)
	var u := _unit()
	return [Vector2(_right() - 2.85 * u, _bottom() - 3.05 * u), 0.7 * u]


func _in_circle(p: Vector2, c: Array) -> bool:
	return p.distance_to(c[0]) <= c[1] * 1.15


func _in_joy_zone(p: Vector2) -> bool:
	return p.x < size.x * 0.45 and p.y > size.y * 0.3


# ---------------------------------------------------------------- input
func _input(event: InputEvent) -> void:
	if event is InputEventScreenTouch:
		var p: Vector2 = event.position
		if event.pressed:
			if TouchBlock.hit(get_tree(), p):
				return
			if _in_circle(p, _jump_rect()):
				_jump_finger = event.index
				PlayerInput.queue_jump()
			elif _in_circle(p, _punch_rect()):
				_punch_finger = event.index
				PlayerInput.queue_punch()
			elif _action_label != "" and _in_circle(p, _action_rect()):
				_action_finger = event.index
				PlayerInput.queue_action()
			elif _in_circle(p, _run_rect()):
				PlayerInput.run_toggle = not PlayerInput.run_toggle
			elif _in_circle(p, _menu_rect()):
				HudStyle.toggle_menu(get_tree())
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
			elif event.index == _punch_finger:
				_punch_finger = -1
			elif event.index == _action_finger:
				_action_finger = -1
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
	if size.x < 50.0 or size.y < 50.0:
		return
	# joystick: dark round pad, white rim, ▲▼◄► marks, light knob
	var r := _joy_radius()
	var o := _joy_origin if _joy_finger >= 0 else _joy_home()
	var active := _joy_finger >= 0
	draw_circle(o + Vector2(0, r * 0.04), r * 1.02, Color(0, 0, 0, 0.3))
	draw_circle(o, r, Color(0.45, 0.46, 0.5, 0.5 if active else 0.4))
	draw_arc(o, r - 2.0, 0, TAU, 72, HudStyle.RIM, maxf(2.5, r * 0.04), true)
	for k in 4:
		var d := Vector2.from_angle(k * PI * 0.5)
		var n := Vector2(-d.y, d.x)
		var t := o + d * r * 0.8
		draw_colored_polygon(PackedVector2Array([t + d * r * 0.1, t - d * r * 0.06 + n * r * 0.1, t - d * r * 0.06 - n * r * 0.1]), Color(1, 1, 1, 0.9))
	var knob := o + _joy_vec * r * 0.62
	draw_circle(knob, 0.4 * r, Color(0.86, 0.87, 0.89, 0.92 if active else 0.8))
	draw_arc(knob, 0.4 * r, 0, TAU, 48, Color(1, 1, 1, 0.9), 2.0, true)
	# RUN toggle, PAUSE (left column)
	var run := _run_rect()
	HudStyle.light_button(self, run[0], run[1], "run", false, Color(0.95, 0.55, 0.1, 0.85) if PlayerInput.run_toggle else Color(0, 0, 0, 0))
	var mn := _menu_rect()
	HudStyle.round_button(self, mn[0], mn[1], "pause")
	# FIST, JUMP
	var pr := _punch_rect()
	HudStyle.light_button(self, pr[0], pr[1], "fist", _punch_finger >= 0, Color(0.75, 0.15, 0.12, 0.8) if _punch_finger >= 0 else Color(0, 0, 0, 0))
	var jp := _jump_rect()
	HudStyle.light_button(self, jp[0], jp[1], "jump", _jump_finger >= 0)
	# contextual button: a car door to get in, a hand + the label for anything else
	if _action_label != "":
		var ar := _action_rect()
		var car_like := _action_label.contains("СЕСТЬ") or _action_label.contains("ЛОДК") or _action_label.contains("МАШИН")
		HudStyle.round_button(self, ar[0], ar[1], "door" if car_like else "hand", _action_finger >= 0, Color(0.12, 0.42, 0.85, 0.85))
		HudStyle.label(self, _action_label, ar[0] + Vector2(0, ar[1] * 1.35), int(ar[1] * 0.36))
