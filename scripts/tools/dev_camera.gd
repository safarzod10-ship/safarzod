class_name DevCamera
extends Camera3D
## Development fly camera for inspecting the environment (NOT the player camera).
## Keyboard: WASD move, Q/E down/up, Shift fast, RMB-drag look.
## Touch: left half = virtual stick (move), right half = look (InputManager),
## on-screen Up/Down buttons (EnvironmentPanel). Never goes below terrain + 0.6 m.

@export var speed := 12.0
@export var fast_mult := 5.0
@export var look_sens := 0.18

var yaw_deg := 0.0
var pitch_deg := -10.0
var vertical_input := 0.0      # set by on-screen buttons (-1..1)
var speed_mult := 1.0

var _stick_finger := -1
var _stick_origin := Vector2.ZERO


func _ready() -> void:
	add_to_group(&"dev_camera")
	current = true
	far = 16000.0
	near = 0.08


func set_pose(pos: Vector3, yaw: float, pitch: float) -> void:
	global_position = pos
	yaw_deg = yaw
	pitch_deg = pitch
	_update_rotation()


func go_bookmark(name: String) -> void:
	var b := WorldConfig.bookmark(name)
	if b.size() >= 5:
		set_pose(Vector3(b[0], b[1] + WorldConfig.height_at(b[0], b[2]), b[2]), b[3], b[4])


func _update_rotation() -> void:
	rotation = Vector3(deg_to_rad(pitch_deg), deg_to_rad(yaw_deg), 0.0)


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseMotion and Input.is_mouse_button_pressed(MOUSE_BUTTON_RIGHT):
		var mm := event as InputEventMouseMotion
		yaw_deg -= mm.relative.x * look_sens
		pitch_deg = clampf(pitch_deg - mm.relative.y * look_sens, -89.0, 89.0)
	elif event is InputEventScreenTouch:
		var t := event as InputEventScreenTouch
		if t.pressed and t.position.x < get_viewport().get_visible_rect().size.x * 0.5 and _stick_finger == -1:
			_stick_finger = t.index
			_stick_origin = t.position
		elif not t.pressed and t.index == _stick_finger:
			_stick_finger = -1
			InputManager.virtual_stick = Vector2.ZERO
	elif event is InputEventScreenDrag and (event as InputEventScreenDrag).index == _stick_finger:
		var d := (event as InputEventScreenDrag).position - _stick_origin
		InputManager.virtual_stick = (d / 120.0).limit_length(1.0)


func _process(delta: float) -> void:
	var look := InputManager.consume_look_delta()
	yaw_deg -= look.x
	pitch_deg = clampf(pitch_deg - look.y, -89.0, 89.0)
	_update_rotation()
	var mv := InputManager.get_move_vector()
	var up := vertical_input
	if Input.is_physical_key_pressed(KEY_E):
		up += 1.0
	if Input.is_physical_key_pressed(KEY_Q):
		up -= 1.0
	var v := speed * speed_mult * (fast_mult if Input.is_action_pressed(&"sprint") else 1.0)
	var dir := (global_transform.basis * Vector3(mv.x, 0.0, mv.y)) + Vector3.UP * up
	global_position += dir * v * delta
	var floor_y := WorldConfig.height_at(global_position.x, global_position.z) + 0.6
	global_position.y = maxf(global_position.y, floor_y)
