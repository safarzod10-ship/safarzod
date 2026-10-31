extends Node
## InputManager — device-independent input for keyboard/gamepad now and the
## touch controls planned for Android (virtual joystick on the left half of
## the screen, camera drag on the right half, action buttons in the UI).
##
## Gameplay code reads `get_move_vector()` / `consume_look_delta()` and the
## action names in ACTIONS; it never touches raw events.

signal action_pressed(action: StringName)
signal input_mode_changed(touch: bool)

const ACTIONS := {
	&"move_forward": [KEY_W, KEY_UP],
	&"move_back": [KEY_S, KEY_DOWN],
	&"move_left": [KEY_A, KEY_LEFT],
	&"move_right": [KEY_D, KEY_RIGHT],
	&"sprint": [KEY_SHIFT],
	&"jump": [KEY_SPACE],
	&"interact": [KEY_E],      # enter / exit vehicle (stage 3+)
	&"pause": [KEY_ESCAPE],
	&"toggle_diagnostics": [KEY_F3],
}
const LOOK_SENSITIVITY := 0.25  # degrees per pixel of touch drag

var touch_mode: bool = false
## Set by the on-screen joystick widget (future stage); -1..1 per axis.
var virtual_stick := Vector2.ZERO

var _look_delta := Vector2.ZERO
var _look_finger := -1


func _ready() -> void:
	_register_actions()
	touch_mode = DisplayServer.is_touchscreen_available()


func _register_actions() -> void:
	for action: StringName in ACTIONS:
		if not InputMap.has_action(action):
			InputMap.add_action(action)
		for key: int in ACTIONS[action]:
			var ev := InputEventKey.new()
			ev.physical_keycode = key
			InputMap.action_add_event(action, ev)
	_add_joy_axis(&"move_left", JOY_AXIS_LEFT_X, -1.0)
	_add_joy_axis(&"move_right", JOY_AXIS_LEFT_X, 1.0)
	_add_joy_axis(&"move_forward", JOY_AXIS_LEFT_Y, -1.0)
	_add_joy_axis(&"move_back", JOY_AXIS_LEFT_Y, 1.0)


func _add_joy_axis(action: StringName, axis: JoyAxis, value: float) -> void:
	var ev := InputEventJoypadMotion.new()
	ev.axis = axis
	ev.axis_value = value
	InputMap.action_add_event(action, ev)


func get_move_vector() -> Vector2:
	var v := Input.get_vector(&"move_left", &"move_right", &"move_forward", &"move_back")
	if virtual_stick.length_squared() > v.length_squared():
		v = virtual_stick
	return v.limit_length(1.0)


## Accumulated camera rotation (degrees) since last call.
func consume_look_delta() -> Vector2:
	var d := _look_delta
	_look_delta = Vector2.ZERO
	return d


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventScreenTouch:
		_set_touch_mode(true)
		var t := event as InputEventScreenTouch
		var right_half := t.position.x > get_viewport().get_visible_rect().size.x * 0.5
		if t.pressed and right_half and _look_finger == -1:
			_look_finger = t.index
		elif not t.pressed and t.index == _look_finger:
			_look_finger = -1
	elif event is InputEventScreenDrag:
		var d := event as InputEventScreenDrag
		if d.index == _look_finger:
			_look_delta += d.relative * LOOK_SENSITIVITY
	elif event is InputEventKey or event is InputEventJoypadButton:
		_set_touch_mode(false)
	for action: StringName in ACTIONS:
		if event.is_action_pressed(action):
			action_pressed.emit(action)


func _set_touch_mode(value: bool) -> void:
	if value != touch_mode:
		touch_mode = value
		input_mode_changed.emit(value)
