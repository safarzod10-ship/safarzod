class_name PlayerController
extends CharacterBody3D
## Third-person player: camera-relative movement with smooth acceleration/turning, jump,
## curb step-up (<= step_height), slopes up to max_slope_deg, AnimationTree locomotion
## whose playback rate follows the real ground speed (no foot sliding), orbit camera.

signal stepped_up(height: float)

@export_group("Movement")
@export var walk_speed := 1.15         ## m/s at full stick (walk cycle ground speed 1.05 m/s, ×1.1)
@export var run_speed := 5.0           ## m/s (jog cycle ground speed, measured on the retargeted rig)
@export var acceleration := 7.0        ## m/s^2
@export var deceleration := 9.0        ## m/s^2
@export var air_control := 0.25
@export var turn_rate := 9.0           ## 1/s, exponential turn smoothing
@export var jump_height := 1.0         ## m
@export var gravity := 9.8
@export var step_height := 0.32        ## max curb/step that is climbed automatically
@export var max_slope_deg := 40.0

@export_group("Camera")
@export var camera_distance := 3.4
@export var camera_height := 1.55
@export var mouse_sensitivity := 0.0025
@export var touch_look_sensitivity := 0.0055   ## rad per 720p-pixel of swipe
@export var pitch_min_deg := -65.0
@export var pitch_max_deg := 30.0

## Cycle data of the Quaternius UAL clips retargeted to this rig (measured in-engine, see docs/PLAYER.md,
## tests/anim_diag.gd): stance-foot ground speed × cycle length = metres per cycle.
const WALK_STRIDE := 1.047 * 1.3333     # walk: 1.047 m/s × 1.333 s
const RUN_STRIDE := 5.0 * 0.9333        # jog:  5.0 m/s × 0.933 s
const IDLE_BLEND_SPEED := 0.45          # below this speed idle and walk are blended
const TAKEOFF_TIME := 0.10              # jump_start: feet leave the ground at 0.10-0.12 s
const UPPER_BODY := ["Spine", "Chest", "UpperChest", "Neck", "Head", "LeftShoulder", "LeftUpperArm",
	"LeftLowerArm", "LeftHand", "RightShoulder", "RightUpperArm", "RightLowerArm", "RightHand"]
const ANIM_LIB := "res://assets/characters/animations/player_anims.res"

@onready var model: Node3D = $Model
@onready var cam_rig: Node3D = $CameraRig
@onready var spring: SpringArm3D = $CameraRig/SpringArm3D
@onready var camera: Camera3D = $CameraRig/SpringArm3D/Camera3D

var cam_yaw := 0.0
var _view_yaw := 0.0                     # smoothed camera angles actually applied
var _view_pitch := deg_to_rad(-14.0)
var cam_pitch := deg_to_rad(-14.0)
var facing := 0.0                       ## character yaw (rad); forward = -Z rotated by facing
var ground_speed := 0.0                 ## smoothed horizontal speed used by the animation
var air_time := 0.0
var last_step_height := 0.0

var _anim_player: AnimationPlayer
var _tree: AnimationTree
var _playback: AnimationNodeStateMachinePlayback
var _visual_offset := 0.0               # model/camera vertical smoothing after steps
var _cam_target := Vector3.ZERO
var _jump_buffer := 0.0
var _coyote := 0.0
var _jumping := false
var _peak_fall_speed := 0.0
var _land_timer := -1.0
var _land_hard := false
var _takeoff_t := -1.0                  # >= 0 while the jump push-off is playing
var _punch_t := -1.0                    # time since the current punch started (-1 = none)
var _punch_len := 0.0
var _punch_queue := false
var _punch_alt := false                 # alternates jab / cross


func _ready() -> void:
	add_to_group(&"player")
	PlayerInput.ensure_actions()
	floor_max_angle = deg_to_rad(max_slope_deg + 0.5)
	floor_snap_length = step_height + 0.05
	floor_constant_speed = true
	floor_stop_on_slope = true
	floor_block_on_wall = true
	spring.spring_length = camera_distance
	spring.add_excluded_object(get_rid())
	cam_rig.top_level = true
	_anim_player = model.find_child("AnimationPlayer", true, false)
	_setup_animation_tree()
	facing = rotation.y
	cam_yaw = facing
	_cam_target = _camera_anchor()
	cam_rig.global_position = _cam_target


# ------------------------------------------------------------------------------- public API
func get_camera() -> Camera3D:
	return camera


## Places the player on the ground below/above pos (raycast from pos.y + 50) facing yaw_rad.
func teleport(pos: Vector3, yaw_rad: float) -> void:
	var space := get_world_3d().direct_space_state
	var q := PhysicsRayQueryParameters3D.create(pos + Vector3.UP * 50.0, pos + Vector3.DOWN * 200.0,
			collision_mask, [get_rid()])
	var hit := space.intersect_ray(q)
	global_position = (hit.position as Vector3) + Vector3.UP * 0.01 if not hit.is_empty() else pos
	velocity = Vector3.ZERO
	ground_speed = 0.0
	facing = yaw_rad
	rotation = Vector3(0.0, facing, 0.0)
	cam_yaw = yaw_rad
	_view_yaw = yaw_rad
	_view_pitch = cam_pitch
	_visual_offset = 0.0
	model.position.y = 0.0
	_cam_target = _camera_anchor()
	if is_node_ready():
		cam_rig.global_position = _cam_target
		cam_rig.rotation = Vector3(0.0, cam_yaw, 0.0)
		spring.rotation.x = cam_pitch
		if _playback:
			_playback.start(&"ground")
	reset_physics_interpolation()


func set_camera_angles(yaw_rad: float, pitch_rad: float) -> void:
	cam_yaw = yaw_rad
	cam_pitch = clampf(pitch_rad, deg_to_rad(pitch_min_deg), deg_to_rad(pitch_max_deg))


# ------------------------------------------------------------------------------- input / camera
func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.pressed and not PlayerInput.touch_active:
		if Input.mouse_mode != Input.MOUSE_MODE_CAPTURED:
			Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
	elif event.is_action_pressed(&"ui_cancel"):
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	elif event is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		_rotate_camera(event.relative * mouse_sensitivity)
	elif event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		PlayerInput.queue_punch()
	elif event.is_action_pressed(&"run_toggle"):
		PlayerInput.run_toggle = not PlayerInput.run_toggle


func _rotate_camera(d: Vector2) -> void:
	cam_yaw = wrapf(cam_yaw - d.x, -PI, PI)
	cam_pitch = clampf(cam_pitch - d.y, deg_to_rad(pitch_min_deg), deg_to_rad(pitch_max_deg))


func _camera_anchor() -> Vector3:
	return global_position + Vector3(0.0, camera_height + _visual_offset, 0.0)


func _process(delta: float) -> void:
	_rotate_camera(PlayerInput.consume_look() * touch_look_sensitivity)
	# follow: fast horizontally, softer vertically (hides step/curb pops)
	var target := _camera_anchor()
	var kh := 1.0 - exp(-25.0 * delta)
	var kv := 1.0 - exp(-10.0 * delta)
	_cam_target.x = lerpf(_cam_target.x, target.x, kh)
	_cam_target.z = lerpf(_cam_target.z, target.z, kh)
	_cam_target.y = lerpf(_cam_target.y, target.y, kv)
	cam_rig.global_position = _cam_target
	var ks := 1.0 - exp(-32.0 * delta)
	_view_yaw = lerp_angle(_view_yaw, cam_yaw, ks)
	_view_pitch = lerpf(_view_pitch, cam_pitch, ks)
	cam_rig.rotation = Vector3(0.0, _view_yaw, 0.0)
	spring.rotation.x = _view_pitch


# ------------------------------------------------------------------------------- movement
func _physics_process(delta: float) -> void:
	var inp := PlayerInput.get_move()
	var running := PlayerInput.is_running()
	var on_floor := is_on_floor()

	# camera-relative wish direction
	var fwd := Vector3(-sin(cam_yaw), 0.0, -cos(cam_yaw))
	var right := Vector3(cos(cam_yaw), 0.0, -sin(cam_yaw))
	var wish := right * inp.x - fwd * inp.y
	var mag := clampf(inp.length(), 0.0, 1.0)
	var target_speed := mag * (run_speed if running else walk_speed)
	var hv := Vector3(velocity.x, 0.0, velocity.z)
	var target := wish.normalized() * target_speed if mag > 0.01 else Vector3.ZERO
	var rate := acceleration if target.length() >= hv.length() else deceleration
	if not on_floor:
		rate *= air_control
	hv = hv.move_toward(target, rate * delta)

	# smooth turn towards the movement direction
	if mag > 0.05 and (on_floor or hv.length() > 0.5):
		var want := atan2(-wish.x, -wish.z)
		facing = lerp_angle(facing, want, 1.0 - exp(-turn_rate * delta))
		rotation.y = facing

	# jump (buffered, with coyote time)
	if PlayerInput.consume_jump():
		_jump_buffer = 0.15
	_jump_buffer -= delta
	_coyote = 0.12 if on_floor else _coyote - delta
	var vy := velocity.y
	if _jump_buffer > 0.0 and _coyote > 0.0 and not _jumping and _takeoff_t < 0.0:
		_jump_buffer = 0.0
		_takeoff_t = 0.0                    # push-off phase: animation crouches/extends first
		_travel(&"jump_start")
	if _takeoff_t >= 0.0:
		_takeoff_t += delta
		if _takeoff_t >= TAKEOFF_TIME:      # feet leave the ground exactly with the animation
			vy = sqrt(2.0 * gravity * jump_height)
			_takeoff_t = -1.0
			_coyote = 0.0
			_jumping = true
		elif not on_floor:
			vy -= gravity * delta
		else:
			vy = minf(vy, 0.0)
	elif not on_floor:
		vy -= gravity * delta
	else:
		vy = minf(vy, 0.0)

	# punch (upper-body layer, alternating jab / cross, one queued press max)
	if PlayerInput.consume_punch():
		if _punch_t < 0.0:
			_start_punch()
		elif _punch_t > _punch_len * 0.45:
			_punch_queue = true

	if on_floor and vy <= 0.0 and hv.length() > 0.05:
		_try_step_up(hv * delta)

	velocity = Vector3(hv.x, vy, hv.z)
	var y_before := global_position.y
	move_and_slide()
	var now_floor := is_on_floor()

	# step-down off a curb: keep the model/camera smooth
	if on_floor and now_floor and y_before - global_position.y > 0.05 and get_floor_normal().y > 0.95:
		_visual_offset += y_before - global_position.y
	_visual_offset = clampf(_visual_offset, -0.4, 0.4)
	_visual_offset = move_toward(_visual_offset * exp(-12.0 * delta), 0.0, 0.2 * delta)
	model.position.y = _visual_offset

	# air / landing bookkeeping
	if now_floor:
		if air_time > 0.0:
			_on_landed()
		air_time = 0.0
		_jumping = false if velocity.y <= 0.0 else _jumping
	else:
		air_time += delta
		_peak_fall_speed = maxf(_peak_fall_speed, -velocity.y)
	_update_animation(delta)


## Climb curbs/steps: if a near-vertical obstacle is ahead and its top is <= step_height,
## lift the body onto it (the flat-bottomed collider then lands on the top face).
func _try_step_up(motion: Vector3) -> void:
	var dir := motion.normalized()
	var probe := dir * maxf(motion.length(), 0.08)
	var xf := global_transform
	var col := KinematicCollision3D.new()
	if not test_move(xf, probe, col):
		return
	if col.get_normal().y > cos(floor_max_angle):
		return                                          # walkable slope, not a step
	var contact := col.get_position()
	var from := Vector3(contact.x, xf.origin.y + step_height + 0.05, contact.z) + dir * 0.06
	var to := Vector3(from.x, xf.origin.y - 0.02, from.z)
	var hit := get_world_3d().direct_space_state.intersect_ray(
			PhysicsRayQueryParameters3D.create(from, to, collision_mask, [get_rid()]))
	if hit.is_empty() or (hit.normal as Vector3).y < cos(floor_max_angle):
		return
	var h: float = (hit.position as Vector3).y - xf.origin.y
	if h < 0.01 or h > step_height:
		return
	var up := Vector3.UP * (h + 0.01)
	if test_move(xf, up):
		return                                          # no head room
	if test_move(xf.translated(up), probe):
		return                                          # still blocked: it is a wall
	global_position += up
	_visual_offset -= up.y
	last_step_height = h
	stepped_up.emit(h)


func _on_landed() -> void:
	var hard := air_time > 0.45 or _peak_fall_speed > 3.5
	_peak_fall_speed = 0.0
	if air_time < 0.2 and not _jumping:
		return                                  # stepping off a curb: no landing animation
	_travel(&"jump_land")
	_land_timer = 0.0
	_land_hard = hard


# ------------------------------------------------------------------------------- animation
func _anim_node(name: String) -> AnimationNodeAnimation:
	var a := AnimationNodeAnimation.new()
	a.animation = StringName("p/" + name)
	return a


func _setup_animation_tree() -> void:
	if ResourceLoader.exists(ANIM_LIB) and not _anim_player.has_animation_library(&"p"):
		_anim_player.add_animation_library(&"p", load(ANIM_LIB))
	var sm := AnimationNodeStateMachine.new()

	# ---- ground: idle <-> (walk <-> jog phase-synced on a normalised timeline)
	var bt := AnimationNodeBlendTree.new()
	var loco := AnimationNodeBlendSpace1D.new()
	loco.min_space = 0.0
	loco.max_space = 1.0
	loco.sync = true
	for pair in [["walk", 0.0], ["jog", 1.0]]:
		var a := _anim_node(pair[0])
		a.use_custom_timeline = true
		a.timeline_length = 1.0
		a.stretch_time_scale = true
		a.loop_mode = Animation.LOOP_LINEAR
		loco.add_blend_point(a, pair[1], -1, pair[0])
	var ts := AnimationNodeTimeScale.new()
	var mix := AnimationNodeBlend2.new()
	mix.sync = false
	bt.add_node(&"idle", _anim_node("idle"), Vector2(0, 0))
	bt.add_node(&"loco", loco, Vector2(0, 200))
	bt.add_node(&"ts", ts, Vector2(200, 200))
	bt.add_node(&"mix", mix, Vector2(400, 100))
	bt.connect_node(&"ts", 0, &"loco")
	bt.connect_node(&"mix", 0, &"idle")
	bt.connect_node(&"mix", 1, &"ts")
	bt.connect_node(&"output", 0, &"mix")
	sm.add_node(&"ground", bt, Vector2(0, 0))

	# ---- jump phases: push-off/rise (jump_start) -> air (tuck) blending into the landing-ready
	# pose while falling -> landing (jump_land) -> back to ground locomotion
	var air := AnimationNodeBlendTree.new()
	var land_pose := _anim_node("jump_land")                 # frame 0 = legs extended for touchdown
	var hold := AnimationNodeTimeSeek.new()
	var air_mix := AnimationNodeBlend2.new()
	air.add_node(&"air", _anim_node("jump_air"), Vector2(0, 0))
	air.add_node(&"landpose", land_pose, Vector2(0, 200))
	air.add_node(&"hold", hold, Vector2(200, 200))
	air.add_node(&"fallmix", air_mix, Vector2(400, 100))
	air.connect_node(&"hold", 0, &"landpose")
	air.connect_node(&"fallmix", 0, &"air")
	air.connect_node(&"fallmix", 1, &"hold")
	air.connect_node(&"output", 0, &"fallmix")
	sm.add_node(&"jump_start", _anim_node("jump_start"), Vector2(300, -150))
	sm.add_node(&"air", air, Vector2(600, -150))
	sm.add_node(&"jump_land", _anim_node("jump_land"), Vector2(600, 150))

	var start := AnimationNodeStateMachineTransition.new()
	start.advance_mode = AnimationNodeStateMachineTransition.ADVANCE_MODE_AUTO
	sm.add_transition(&"Start", &"ground", start)
	for l in [[&"ground", &"jump_start", 0.08], [&"ground", &"air", 0.25], [&"jump_start", &"air", 0.3],
			[&"jump_start", &"jump_land", 0.1], [&"air", &"jump_land", 0.08], [&"jump_land", &"ground", 0.3],
			[&"jump_land", &"jump_start", 0.1], [&"jump_start", &"ground", 0.2], [&"air", &"ground", 0.2]]:
		var t := AnimationNodeStateMachineTransition.new()
		t.xfade_time = l[2]
		t.switch_mode = AnimationNodeStateMachineTransition.SWITCH_MODE_IMMEDIATE
		sm.add_transition(l[0], l[1], t)

	# ---- root: state machine + upper-body punch layer (OneShot filtered to spine/arms)
	var root := AnimationNodeBlendTree.new()
	var punch := AnimationNodeOneShot.new()
	punch.fadein_time = 0.08
	punch.fadeout_time = 0.18
	punch.filter_enabled = true
	for b in UPPER_BODY:
		punch.set_filter_path(NodePath("%GeneralSkeleton:" + b), true)
	var which := AnimationNodeBlend2.new()                  # 0 = jab, 1 = cross
	root.add_node(&"sm", sm, Vector2(0, 0))
	root.add_node(&"jab", _anim_node("punch_jab"), Vector2(0, 200))
	root.add_node(&"cross", _anim_node("punch_cross"), Vector2(0, 300))
	root.add_node(&"which", which, Vector2(200, 250))
	root.add_node(&"punch", punch, Vector2(400, 100))
	root.connect_node(&"which", 0, &"jab")
	root.connect_node(&"which", 1, &"cross")
	root.connect_node(&"punch", 0, &"sm")
	root.connect_node(&"punch", 1, &"which")
	root.connect_node(&"output", 0, &"punch")

	_tree = AnimationTree.new()
	_tree.name = "AnimationTree"
	_tree.tree_root = root
	model.add_child(_tree)
	_tree.anim_player = _tree.get_path_to(_anim_player)
	_tree.callback_mode_process = AnimationMixer.ANIMATION_CALLBACK_MODE_PROCESS_PHYSICS   # in step with movement
	_tree.active = true
	_playback = _tree.get(&"parameters/sm/playback")
	_playback.start(&"ground")
	_tree.set(&"parameters/sm/air/hold/seek_request", 0.0)


func _start_punch() -> void:
	_punch_alt = not _punch_alt
	var cross := not _punch_alt
	_tree.set(&"parameters/which/blend_amount", 1.0 if cross else 0.0)
	_punch_len = _anim_player.get_animation(&"p/punch_cross" if cross else &"p/punch_jab").length * 0.85
	_tree.set(&"parameters/punch/request", AnimationNodeOneShot.ONE_SHOT_REQUEST_FIRE)
	_punch_t = 0.0
	_punch_queue = false


func is_punching() -> bool:
	return _punch_t >= 0.0


func _travel(state: StringName) -> void:
	if _playback and _playback.get_current_node() != state:
		_playback.travel(state)


func _update_animation(delta: float) -> void:
	var hv := get_real_velocity()
	hv.y = 0.0
	ground_speed = lerpf(ground_speed, hv.length(), 1.0 - exp(-12.0 * delta))
	var s := ground_speed
	var run_blend := clampf((s - walk_speed) / (run_speed - walk_speed), 0.0, 1.0)
	var stride := lerpf(WALK_STRIDE, RUN_STRIDE, run_blend)
	_tree.set(&"parameters/sm/ground/loco/blend_position", run_blend)
	_tree.set(&"parameters/sm/ground/ts/scale", maxf(s, 0.35) / stride)   # cycles per second
	_tree.set(&"parameters/sm/ground/mix/blend_amount", clampf(s / IDLE_BLEND_SPEED, 0.0, 1.0))
	# falling: blend the air pose towards the legs-extended touchdown pose as speed builds up
	var fall := clampf(-velocity.y / 5.0, 0.0, 1.0) if not is_on_floor() else 0.0
	_tree.set(&"parameters/sm/air/fallmix/blend_amount", fall)

	var cur := _playback.get_current_node()
	if cur == &"jump_start" and _jumping and _playback.get_current_play_position() > 0.45:
		_travel(&"air")
	if not is_on_floor() and air_time > 0.25 and cur == &"ground" and _takeoff_t < 0.0:
		_travel(&"air")                         # walked off a ledge
	if cur == &"jump_land":
		_land_timer += delta
		var moving := s > 0.6
		# soft landings recover faster; moving players blend straight into the run/walk cycle
		var leave_at := (0.22 if moving else 0.55) if not _land_hard else (0.32 if moving else 0.75)
		if _land_timer > leave_at:
			_travel(&"ground")
	# punch bookkeeping: one queued follow-up, no stacking
	if _punch_t >= 0.0:
		_punch_t += delta
		if _punch_t >= _punch_len:
			_punch_t = -1.0
			if _punch_queue:
				_start_punch()
