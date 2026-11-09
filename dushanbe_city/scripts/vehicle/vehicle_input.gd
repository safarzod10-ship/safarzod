class_name VehicleInput
extends RefCounted
## Shared input for the car (keyboard / gamepad / touch pedals write here, the vehicle reads).
## Touch: each control is held by its own finger, so gas + steer + handbrake work simultaneously.

static var touch_gas := false
static var touch_brake := false
static var touch_left := false
static var touch_right := false
static var touch_handbrake := false
static var look_delta := Vector2.ZERO          ## camera orbit drag (pixels)
## scripted input for tests: {"throttle": f, "brake": f, "steer": f, "handbrake": b}
static var scripted = null
## which vehicle the scripted input drives: the one being driven, else the group "primary_vehicle"
## (the Prado); parked vans / boats never react to it
static var _ready := false


static func ensure_actions() -> void:
	if _ready:
		return
	_ready = true
	var keys := {&"car_gas": [KEY_W, KEY_UP], &"car_brake": [KEY_S, KEY_DOWN], &"car_left": [KEY_A, KEY_LEFT],
		&"car_right": [KEY_D, KEY_RIGHT], &"car_handbrake": [KEY_SPACE], &"car_enter": [KEY_E],
		&"car_repair": [KEY_R], &"car_camera": [KEY_C],
		&"car_lights": [KEY_L], &"car_turn_left": [KEY_Q], &"car_turn_right": [KEY_Z], &"car_hazard": [KEY_H]}
	for a in keys:
		if InputMap.has_action(a):
			continue
		InputMap.add_action(a, 0.1)
		for k in keys[a]:
			var ev := InputEventKey.new()
			ev.physical_keycode = k
			InputMap.action_add_event(a, ev)
	for pair in [[&"car_gas", JOY_AXIS_TRIGGER_RIGHT], [&"car_brake", JOY_AXIS_TRIGGER_LEFT]]:
		var jm := InputEventJoypadMotion.new()
		jm.axis = pair[1]
		jm.axis_value = 1.0
		InputMap.action_add_event(pair[0], jm)
	for pair in [[&"car_left", -1.0], [&"car_right", 1.0]]:
		var jm := InputEventJoypadMotion.new()
		jm.axis = JOY_AXIS_LEFT_X
		jm.axis_value = pair[1]
		InputMap.action_add_event(pair[0], jm)
	var jb := InputEventJoypadButton.new()
	jb.button_index = JOY_BUTTON_A
	InputMap.action_add_event(&"car_handbrake", jb)


static func throttle() -> float:
	if scripted != null:
		return float(scripted.get("throttle", 0.0))
	return maxf(Input.get_action_strength(&"car_gas"), 1.0 if touch_gas else 0.0)


static func brake() -> float:
	if scripted != null:
		return float(scripted.get("brake", 0.0))
	return maxf(Input.get_action_strength(&"car_brake"), 1.0 if touch_brake else 0.0)


static func steer() -> float:
	## -1 = left, +1 = right
	if scripted != null:
		return float(scripted.get("steer", 0.0))
	var s := Input.get_action_strength(&"car_right") - Input.get_action_strength(&"car_left")
	s += (1.0 if touch_right else 0.0) - (1.0 if touch_left else 0.0)
	return clampf(s, -1.0, 1.0)


static func handbrake() -> bool:
	if scripted != null:
		return bool(scripted.get("handbrake", false))
	return touch_handbrake or Input.is_action_pressed(&"car_handbrake")


static func consume_look() -> Vector2:
	var d := look_delta
	look_delta = Vector2.ZERO
	return d


static func release_all() -> void:
	touch_gas = false
	touch_brake = false
	touch_left = false
	touch_right = false
	touch_handbrake = false
