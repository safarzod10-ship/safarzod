class_name Player
extends Combatant
## Third-person shooter controller: over-the-shoulder camera, the body always
## faces where the camera looks, bullets go to the point under the crosshair.

const MOUSE_SENS := 0.12   # degrees per pixel
const KEYS := {
	&"fire": [], &"aim": [], &"reload": [KEY_R], &"grenade": [KEY_G], &"next_grenade": [KEY_Q],
	&"crouch": [KEY_C, KEY_CTRL],
}

var camera: Camera3D
var cam_yaw := 0.0
var cam_pitch := 0.0
var input_enabled := true
var auto_fire := false       ## scripted demos
var script_move := Vector2.ZERO   ## scripted demos: x = strafe, y = forward(-)/back(+)
var script_sprint := false
var _pivot: Node3D
var _shake := 0.0
var _kick := Vector2.ZERO
var _regen_wait := 0.0
var _aim_blend := 0.0


func _ready() -> void:
	team = 1
	super()
	add_to_group(&"player")
	for action: StringName in KEYS:
		if not InputMap.has_action(action):
			InputMap.add_action(action)
			for key: int in KEYS[action]:
				var ev := InputEventKey.new()
				ev.physical_keycode = key
				InputMap.action_add_event(action, ev)
	_add_mouse(&"fire", MOUSE_BUTTON_LEFT)
	_add_mouse(&"aim", MOUSE_BUTTON_RIGHT)
	_pivot = Node3D.new()
	_pivot.top_level = true
	add_child(_pivot)
	camera = Camera3D.new()
	camera.fov = 68.0
	camera.near = 0.08
	camera.far = 900.0
	_pivot.add_child(camera)
	camera.make_current()
	cam_yaw = rotation.y
	fired.connect(_on_fired)
	damaged.connect(_on_damaged)
	if not InputManager.touch_mode and DisplayServer.get_name() != "headless":
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED


func _add_mouse(action: StringName, button: MouseButton) -> void:
	var ev := InputEventMouseButton.new()
	ev.button_index = button
	InputMap.action_add_event(action, ev)


func _unhandled_input(event: InputEvent) -> void:
	if not input_enabled or dead:
		return
	if event is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		var m := event as InputEventMouseMotion
		_look(m.relative * MOUSE_SENS)
	elif event is InputEventMouseButton and (event as InputEventMouseButton).pressed and not InputManager.touch_mode \
			and Input.mouse_mode != Input.MOUSE_MODE_CAPTURED and DisplayServer.get_name() != "headless":
		Input.mouse_mode = Input.MOUSE_MODE_CAPTURED


func _look(deg: Vector2) -> void:
	var k := 0.6 if aiming else 1.0
	cam_yaw -= deg_to_rad(deg.x) * k
	cam_pitch = clampf(cam_pitch - deg_to_rad(deg.y) * k, deg_to_rad(-70.0), deg_to_rad(65.0))


func shake(amount: float) -> void:
	_shake = maxf(_shake, amount)


func _on_fired() -> void:
	var rc: float = _wdef["recoil"]
	_kick += Vector2(randf_range(-0.25, 0.25), randf_range(0.5, 0.8)) * rc * (0.6 if aiming else 1.0)
	_shake = maxf(_shake, 0.08)


func _on_damaged(amount: float, _zone: String, _attacker: Node) -> void:
	_regen_wait = 6.0
	_shake = maxf(_shake, clampf(amount / 60.0, 0.1, 0.6))


## World point under the crosshair.
func aim_point() -> Vector3:
	var from := camera.global_position
	var dir := -camera.global_transform.basis.z
	var start := from + dir * maxf(0.0, (chest_position() - from).dot(dir))
	var q := PhysicsRayQueryParameters3D.create(start, from + dir * 400.0, HIT_MASK, [get_rid()])
	var hit := get_world_3d().direct_space_state.intersect_ray(q)
	return hit["position"] if not hit.is_empty() else from + dir * 400.0


func _physics_process(delta: float) -> void:
	super(delta)
	if dead:
		_update_camera(delta)
		return
	var t: Dictionary = CombatState.touch
	var wish := Vector3.ZERO
	var jump := false
	var sprint := false
	var fire := auto_fire
	if input_enabled:
		_look(InputManager.consume_look_delta())
		var mv := InputManager.get_move_vector()
		var yaw_basis := Basis(Vector3.UP, cam_yaw)
		wish = (yaw_basis * Vector3(mv.x, 0, mv.y)).limit_length(1.0)
		jump = Input.is_action_just_pressed(&"jump") or CombatState.take("jump")
		sprint = Input.is_action_pressed(&"sprint") or t["sprint"] or mv.length() > 0.97 and InputManager.touch_mode
		aiming = Input.is_action_pressed(&"aim") or t["aim"]
		fire = fire or Input.is_action_pressed(&"fire") or t["fire"]
		if Input.is_action_just_pressed(&"crouch") or CombatState.take("crouch"):
			set_crouch(not crouching)
		if Input.is_action_just_pressed(&"reload") or CombatState.take("reload"):
			start_reload()
		if Input.is_action_just_pressed(&"next_grenade") or CombatState.take("next_grenade"):
			next_grenade()
		if Input.is_action_just_pressed(&"grenade") or CombatState.take("grenade"):
			throw_selected()
	else:
		wish = (Basis(Vector3.UP, cam_yaw) * Vector3(script_move.x, 0, script_move.y)).limit_length(1.0)
		sprint = script_sprint
	rotation.y = lerp_angle(rotation.y, cam_yaw, clampf(delta * 16.0, 0.0, 1.0))
	aim_pitch = cam_pitch
	step_movement(delta, wish, sprint and not fire, jump)
	_update_camera(delta)
	if fire:
		try_fire(aim_point())
	# slow regeneration when out of trouble
	_regen_wait -= delta
	if _regen_wait <= 0.0 and health < max_health and burn_left <= 0.0:
		health = minf(health + 9.0 * delta, max_health)


func throw_selected() -> Grenade:
	var dir := -camera.global_transform.basis.z
	return throw_grenade(dir, 15.5)


func _update_camera(delta: float) -> void:
	_aim_blend = move_toward(_aim_blend, 1.0 if aiming else 0.0, delta * 7.0)
	_kick = _kick.lerp(Vector2.ZERO, clampf(delta * 9.0, 0.0, 1.0))
	_shake = move_toward(_shake, 0.0, delta * 1.8)
	var focus := global_position + Vector3.UP * (eye_height() - 0.02)
	if dead and ragdoll.is_running():
		focus = ragdoll.hips_position() + Vector3.UP * 0.6
	_pivot.global_position = _pivot.global_position.lerp(focus, clampf(delta * 22.0, 0.0, 1.0)) if _pivot.global_position.distance_to(focus) < 3.0 else focus
	var sh := Vector3(randf_range(-1, 1), randf_range(-1, 1), randf_range(-1, 1)) * _shake * 0.035
	_pivot.rotation = Vector3(cam_pitch + deg_to_rad(_kick.y) + sh.x, cam_yaw + deg_to_rad(_kick.x) + sh.y, sh.z)
	var offset := Vector3(0.48, 0.12, 2.5).lerp(Vector3(0.42, 0.06, 1.15), _aim_blend)
	if dead:
		offset = Vector3(0.0, 0.6, 3.4)
	# keep the camera out of walls
	var from := _pivot.global_position
	var to := _pivot.global_transform * offset
	var q := PhysicsRayQueryParameters3D.create(from, to, LAYER_WORLD)
	var hit := get_world_3d().direct_space_state.intersect_ray(q)
	if not hit.is_empty():
		var d := maxf(from.distance_to(hit["position"]) - 0.18, 0.25)
		offset = offset.normalized() * d
	camera.position = offset
	camera.fov = lerpf(68.0, 48.0, _aim_blend)
