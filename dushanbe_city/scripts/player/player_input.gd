class_name PlayerInput
extends RefCounted
## Shared input source for the player: keyboard/gamepad and the touch UI write into the same
## move vector / run / jump / look state, the controller only reads from here.

## Move vector from the touch joystick (x = right, y = back; length <= 1).
static var touch_move := Vector2.ZERO
## RUN toggle (touch button or Caps Lock).
static var run_toggle := false
## Accumulated camera look delta in pixels (touch swipe), consumed by the camera each frame.
static var look_delta := Vector2.ZERO
## Scripted input for tests / demos (overrides everything when non-null).
static var scripted_move = null
static var scripted_run := false
## True while the touch UI is shown (the controller then never captures the mouse).
static var touch_active := false

static var _jump_queued := false
static var _punch_queued := false
static var _actions_ready := false


## Creates the input actions at runtime if the project does not define them.
static func ensure_actions() -> void:
	if _actions_ready:
		return
	_actions_ready = true
	var keys := {
		&"move_forward": [KEY_W, KEY_UP], &"move_back": [KEY_S, KEY_DOWN],
		&"move_left": [KEY_A, KEY_LEFT], &"move_right": [KEY_D, KEY_RIGHT],
		&"run": [KEY_SHIFT], &"jump": [KEY_SPACE], &"run_toggle": [KEY_CAPSLOCK], &"punch": [KEY_F],
	}
	for action in keys:
		if InputMap.has_action(action):
			continue
		InputMap.add_action(action, 0.15)
		for k in keys[action]:
			var ev := InputEventKey.new()
			ev.physical_keycode = k
			InputMap.action_add_event(action, ev)
	# gamepad: left stick + A (jump) + left stick press / B (run)
	var axes := {&"move_left": [JOY_AXIS_LEFT_X, -1.0], &"move_right": [JOY_AXIS_LEFT_X, 1.0],
		&"move_forward": [JOY_AXIS_LEFT_Y, -1.0], &"move_back": [JOY_AXIS_LEFT_Y, 1.0]}
	for action in axes:
		var jm := InputEventJoypadMotion.new()
		jm.axis = axes[action][0]
		jm.axis_value = axes[action][1]
		InputMap.action_add_event(action, jm)
	for pair in [[&"jump", JOY_BUTTON_A], [&"run", JOY_BUTTON_B], [&"run", JOY_BUTTON_LEFT_STICK], [&"punch", JOY_BUTTON_X]]:
		var jb := InputEventJoypadButton.new()
		jb.button_index = pair[1]
		InputMap.action_add_event(pair[0], jb)


## Combined move vector, length <= 1 (analog magnitude = walk speed fraction).
static func get_move() -> Vector2:
	if scripted_move != null:
		return (scripted_move as Vector2).limit_length(1.0)
	var v := Input.get_vector(&"move_left", &"move_right", &"move_forward", &"move_back")
	if touch_move.length() > v.length():
		v = touch_move
	return v.limit_length(1.0)


static func is_running() -> bool:
	if scripted_move != null:
		return scripted_run
	return run_toggle or Input.is_action_pressed(&"run")


static func queue_jump() -> void:
	_jump_queued = true


static func queue_punch() -> void:
	_punch_queued = true


## Returns true once per punch press (F, gamepad X, left mouse when captured, touch button).
static func consume_punch() -> bool:
	var p := _punch_queued or Input.is_action_just_pressed(&"punch")
	_punch_queued = false
	return p


## Returns true once per jump press (keyboard, gamepad or touch).
static func consume_jump() -> bool:
	var j := _jump_queued or Input.is_action_just_pressed(&"jump")
	_jump_queued = false
	return j


static func consume_look() -> Vector2:
	var d := look_delta
	look_delta = Vector2.ZERO
	return d


static func reset() -> void:
	touch_move = Vector2.ZERO
	run_toggle = false
	look_delta = Vector2.ZERO
	scripted_move = null
	scripted_run = false
	_jump_queued = false
	_punch_queued = false
