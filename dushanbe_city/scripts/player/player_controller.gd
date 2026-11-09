class_name PlayerController
extends CharacterBody3D
## CharacterController of the walking hero (stage 4). Owns the physics state and wires the
## components; every concern lives in its own script:
##   CharacterConfig       all tunables (speeds, accelerations, jump, steps, camera) .......... character_config.gd
##   CharacterMovement     step-up, step-down snap (slopes: CharacterBody3D floor settings) ..... character_movement.gd
##   CharacterAnimation    AnimationTree: idle / 8-way walk / run / stops / jump / swim / seat ... character_animation.gd
##   CharacterCamera       third-person orbit camera, smoothed collision, run / swim framing ...... character_camera.gd
##   CharacterInteraction  generic "interactable" objects (car door, ...) ......................... character_interaction.gd
##   PlayerWater           wading / swimming state, splashes, wake (CharacterWaterController) ..... player_water.gd
##   CharacterAudio        footsteps by surface on real foot contact ............................. character_audio.gd
##   FootIK                ground-adapted feet + pelvis (SkeletonModifier3D) ....................... foot_ik.gd
##   PlayerInput / touch   MobileInputController: joystick, buttons, swipe-look (multitouch) ...... player_input.gd, ui/touch_surface.gd
##
## Locomotion model
##  * WALK (default): the body faces the camera's forward direction and moves in 8 directions with
##    the matching clip (forward 1.0 m/s, back 0.55, sideways 0.6, diagonals blended). If the needed
##    facing is far (> 70 deg) while (nearly) standing, the character first turns on the spot with
##    stepping feet. (walk_strafe = false gives the classic "turn towards the stick".)
##  * RUN: the body turns towards the travel direction (4.5 m/s); sharp reversals brake while turning,
##    from (near) standstill the body pivots on the spot first.
##  * START: acceleration ramps (walk 2.6 m/s^2, run 5.5); clip rates follow the real speed.
##  * STOP: releasing the stick plays the captured stop (walk / run) from the phase whose speed
##    matches, and the body decelerates along the same captured speed curve -> planted feet.
##  * JUMP: push-off clip -> take-off at the right frame -> air (tuck -> touchdown pose while falling)
##    -> landing (soft / hard); a standing jump stops, a running jump keeps the momentum.
##  * Animation always follows the REAL velocity (get_real_velocity): against a wall the legs stop.

signal stepped_up(height: float)

const CONFIG_PATH := "res://assets/characters/player/character_config.tres"

@export var config: CharacterConfig
@export var walk_strafe := true            ## 8-way walk facing the camera (false: turn to the stick)

@onready var model: Node3D = $Model
@onready var cam_rig: Node3D = $CameraRig
@onready var spring: SpringArm3D = $CameraRig/SpringArm3D
@onready var camera: Camera3D = $CameraRig/SpringArm3D/Camera3D

var cfg: CharacterConfig
var movement: CharacterMovement
var anim: CharacterAnimation
var cam_ctl: CharacterCamera
var interaction: CharacterInteraction
var water: PlayerWater
var audio: CharacterAudio
var foot_ik: FootIK

var facing := 0.0                          ## body yaw (rad); forward = -Z rotated by facing
var ground_speed := 0.0                    ## smoothed real horizontal speed (animation, tests)
var air_time := 0.0
var last_step_height := 0.0
var locomotion := "idle"                   ## idle / walk / run / stop / turn / air / swim / seq (tests, debug)
var seq_active := false                    ## scripted sequence (vehicle enter / exit, walk_to)

var _visual_offset := 0.0                  # model/camera vertical smoothing after steps
var _visual_h := Vector3.ZERO              # horizontal model smoothing after a step-up nudge
var _jump_buffer := 0.0
var _coyote := 0.0
var _jumping := false
var _peak_fall_speed := 0.0
var _land_timer := -1.0
var _land_hard := false
var _snapped := false
var _takeoff_t := -1.0
var _water_landed := false
var _stop_kind := ""
var _stop_t := 0.0
var _stop_t0 := 0.0
var _stop_len := 0.0
var _stop_dir := Vector3.ZERO
var _turning := 0.0                        # +1 / -1 while turning on the spot
var _run_mode := 0.0                       # smoothed 0 walk .. 1 run
var _punch_queue := false                  # tests: a single queued flag (CharacterAnimation)
var _seq_goal: Variant = null
var _seq_face: Variant = null
var _seq_done := false
var _swim_prev_target := -1e9


# =============================================================================== setup
func _ready() -> void:
	add_to_group(&"player")
	PlayerInput.ensure_actions()
	cfg = config if config else (load(CONFIG_PATH) as CharacterConfig if ResourceLoader.exists(CONFIG_PATH) else CharacterConfig.new())
	floor_max_angle = deg_to_rad(cfg.max_slope_deg + 0.5)
	floor_snap_length = cfg.step_height + 0.05
	floor_constant_speed = true
	floor_stop_on_slope = true
	floor_block_on_wall = true
	movement = CharacterMovement.new(self, cfg)
	anim = CharacterAnimation.new()
	anim.name = "Animation"
	add_child(anim)
	anim.setup(model, cfg.jump_height, cfg.gravity)
	cam_ctl = CharacterCamera.new()
	cam_ctl.name = "Camera"
	add_child(cam_ctl)
	cam_ctl.setup(self, cfg, cam_rig, spring, camera, model)
	interaction = CharacterInteraction.new()
	interaction.name = "Interaction"
	interaction.player = self
	add_child(interaction)
	water = PlayerWater.new()
	water.name = "Water"
	add_child(water)
	var sk: Skeleton3D = model.find_children("*", "Skeleton3D", true, false)[0]
	audio = CharacterAudio.new()
	audio.name = "Audio"
	add_child(audio)
	var city := {}
	if FileAccess.file_exists("res://data/city/city.json"):
		var c: Variant = JSON.parse_string(FileAccess.get_file_as_string("res://data/city/city.json"))
		if c is Dictionary:
			city = c
	audio.setup(self, sk, city)
	foot_ik = FootIK.new()
	foot_ik.name = "FootIK"
	foot_ik.body = self
	foot_ik.max_adjust = cfg.foot_ik_max_adjust
	foot_ik.enabled_ik = cfg.foot_ik
	sk.add_child(foot_ik)
	facing = rotation.y
	cam_ctl.set_angles(facing, deg_to_rad(-14.0))
	cam_ctl.snap()


# =============================================================================== public API
var cam_yaw: float:
	get: return cam_ctl.yaw if cam_ctl else facing
	set(v): if cam_ctl: cam_ctl.yaw = v
var cam_pitch: float:
	get: return cam_ctl.pitch if cam_ctl else deg_to_rad(-14.0)
	set(v): if cam_ctl: cam_ctl.pitch = v
var walk_speed: float:
	get: return cfg.walk_speed
	set(v): cfg.walk_speed = v
var run_speed: float:
	get: return cfg.run_speed
	set(v): cfg.run_speed = v
var step_height: float:
	get: return cfg.step_height
	set(v): cfg.step_height = v
var max_slope_deg: float:
	get: return cfg.max_slope_deg
var jump_height: float:
	get: return cfg.jump_height
var gravity: float:
	get: return cfg.gravity
var _playback: AnimationNodeStateMachinePlayback:
	get: return anim.playback if anim else null
var _tree: AnimationTree:
	get: return anim.tree if anim else null
var _punch_alt: bool:
	get: return anim._punch_alt if anim else false


func get_camera() -> Camera3D:
	return camera


func is_swimming() -> bool:
	return water != null and water.mode == PlayerWater.Mode.SWIM


func is_punching() -> bool:
	return anim.is_punching()


## Places the player on the ground below/above pos (raycast from pos.y + 50) facing yaw_rad.
func teleport(pos: Vector3, yaw_rad: float) -> void:
	var space := get_world_3d().direct_space_state
	var q := PhysicsRayQueryParameters3D.create(pos + Vector3.UP * 50.0, pos + Vector3.DOWN * 200.0, collision_mask, [get_rid()])
	var hit := space.intersect_ray(q)
	global_position = (hit.position as Vector3) + Vector3.UP * 0.01 if not hit.is_empty() else pos
	velocity = Vector3.ZERO
	ground_speed = 0.0
	facing = yaw_rad
	rotation = Vector3(0.0, facing, 0.0)
	_visual_offset = 0.0
	_visual_h = Vector3.ZERO
	_stop_kind = ""
	_turning = 0.0
	if is_node_ready():
		model.position = Vector3.ZERO
		model.rotation = Vector3(0, PI, 0)
		cam_ctl.set_angles(yaw_rad, cam_ctl.pitch)
		cam_ctl.vertical_offset = 0.0
		cam_ctl.snap()
		if anim.playback:
			anim.playback.start(&"ground")
	reset_physics_interpolation()


func set_camera_angles(yaw_rad: float, pitch_rad: float) -> void:
	cam_ctl.set_angles(yaw_rad, pitch_rad)


## Scripted walk to a point (vehicle door, interaction spot), then turn to face_yaw (null = keep).
## Returns true if reached within `timeout` s. The normal locomotion code moves the body (no teleport).
func walk_to(goal: Vector3, face_yaw: Variant = null, timeout := 3.0) -> bool:
	seq_active = true
	_seq_goal = goal
	_seq_face = face_yaw
	_seq_done = false
	var t := 0.0
	while not _seq_done and t < timeout:
		await get_tree().physics_frame
		t += 1.0 / Engine.physics_ticks_per_second
	var ok := _seq_done
	_seq_goal = null
	if face_yaw != null:
		for i in 20:                               # settle the heading
			await get_tree().physics_frame
	return ok


## Full-body action clip (interact / sit_enter / sit_exit / pickup); returns after `hold` s (default: clip length).
func play_action(clip_name: String, hold := -1.0) -> void:
	seq_active = true
	anim.travel(StringName(clip_name))
	var L := anim.clip_length(clip_name) if hold < 0.0 else hold
	var t := 0.0
	while t < L:
		await get_tree().physics_frame
		t += 1.0 / Engine.physics_ticks_per_second


func end_sequence() -> void:
	seq_active = false
	_seq_goal = null
	_seq_face = null
	anim.travel(&"ground")


# =============================================================================== input / camera
func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.pressed and not PlayerInput.touch_active:
		if Input.mouse_mode != Input.MOUSE_MODE_CAPTURED:
			Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
	elif event.is_action_pressed(&"ui_cancel"):
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	elif event is InputEventMouseMotion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		cam_ctl.rotate_by(event.relative * cfg.mouse_sensitivity)
	elif event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		PlayerInput.queue_fire()
	elif event.is_action_pressed(&"run_toggle"):
		PlayerInput.run_toggle = not PlayerInput.run_toggle


func _process(delta: float) -> void:
	cam_ctl.vertical_offset = _visual_offset
	cam_ctl.swimming = is_swimming()
	cam_ctl.airborne = not is_on_floor() and not is_swimming()
	cam_ctl.run_amount = clampf((ground_speed - 1.5) / maxf(cfg.run_speed - 1.5, 0.1), 0.0, 1.0)
	cam_ctl.sensitivity_scale = PlayerInput.look_scale
	cam_ctl.update(delta)
	interaction.update(delta)
	if PlayerInput.consume_action() and not seq_active:
		interaction.trigger()


# =============================================================================== physics
func _physics_process(delta: float) -> void:
	var inp := PlayerInput.get_move()
	var running := PlayerInput.is_running()
	if seq_active:
		inp = _seq_input()
		running = false
	var on_floor := is_on_floor() or _snapped
	# ---- sea: classify (floor under the body by a ray from above the surface)
	var fhit := get_world_3d().direct_space_state.intersect_ray(PhysicsRayQueryParameters3D.create(
			global_position + Vector3.UP * 1.0, global_position + Vector3.DOWN * 6.0, collision_mask, [get_rid()]))
	var floor_y: float = (fhit.position as Vector3).y if not fhit.is_empty() else NAN
	var was_swim := is_swimming()
	water.update_mode(global_position, floor_y)
	if is_swimming():
		_swim_physics(delta, inp, running, was_swim)
		return
	if was_swim:
		model.rotation = Vector3(0, PI, 0)
	if not water.can_run():
		running = false

	# ---- wish direction (camera relative)
	var yaw := cam_ctl.yaw
	var fwd := Vector3(-sin(yaw), 0.0, -cos(yaw))
	var right := Vector3(cos(yaw), 0.0, -sin(yaw))
	var wish := right * inp.x - fwd * inp.y
	var mag := clampf(inp.length(), 0.0, 1.0)
	var hv := Vector3(velocity.x, 0.0, velocity.z)
	var run_now := running and mag > 0.05
	_run_mode = move_toward(_run_mode, 1.0 if run_now else 0.0, delta * 3.0)
	var strafe := walk_strafe and not run_now and not seq_active
	var target := Vector3.ZERO
	var want_face := facing
	var turning_now := 0.0
	if mag > 0.01:
		var wdir := wish.normalized()
		if strafe:
			want_face = atan2(-fwd.x, -fwd.z)                      # face the camera direction
			var bfwd := Vector3(-sin(facing), 0, -cos(facing))
			var bright := Vector3(cos(facing), 0, -sin(facing))
			var lf := wdir.dot(bfwd)
			var ls := wdir.dot(bright)
			var vf := cfg.walk_speed if lf >= 0.0 else cfg.back_speed
			var sp := 1.0 / sqrt(pow(lf / vf, 2.0) + pow(ls / cfg.strafe_speed, 2.0) + 1e-6)   # speed ellipse
			target = wdir * sp * mag * water.speed_factor()
		else:
			want_face = atan2(-wdir.x, -wdir.z)
			target = wdir * mag * (cfg.run_speed if run_now else cfg.walk_speed) * water.speed_factor()
		var diff := wrapf(want_face - facing, -PI, PI)
		if (absf(diff) > deg_to_rad(70.0) or _turning != 0.0) and absf(diff) > deg_to_rad(8.0) and hv.length() < (0.6 if not run_now else 1.4) and on_floor:
			turning_now = signf(diff)                             # turn on the spot first (stepping)
			target = Vector3.ZERO
	_turning = turning_now

	# ---- stops (captured deceleration: planted feet)
	if mag <= 0.01 and on_floor and _stop_kind == "" and not seq_active and _takeoff_t < 0.0:
		var s := hv.length()
		var forwardish := s > 0.01 and hv.normalized().dot(Vector3(-sin(facing), 0, -cos(facing))) > 0.7
		if forwardish and s > 2.2:
			_begin_stop("stop_run", s, hv)
		elif forwardish and s > 0.7 and s < 1.4:
			_begin_stop("stop_walk", s, hv)
	if _stop_kind != "":
		if mag > 0.01 or not on_floor:
			_stop_kind = ""                                       # input again: back to locomotion
			anim.travel(&"ground")
		else:
			_stop_t += delta
			var sp2 := minf(anim.stop_speed(_stop_kind, _stop_t0 + _stop_t), hv.length() + 0.05)
			hv = _stop_dir * sp2
			if _stop_t >= _stop_len or sp2 < 0.05:
				_stop_kind = ""
				hv = Vector3.ZERO
				anim.travel(&"ground")
	if _stop_kind == "":
		var accel := cfg.run_accel if run_now else cfg.walk_accel
		var decel := cfg.run_decel if hv.length() > 1.6 else cfg.walk_decel
		var rate := accel if target.length() >= hv.length() else decel
		if not on_floor:
			rate *= cfg.air_control
		if run_now and hv.length() > 1.0 and target.length() > 0.1:
			var cosang := hv.normalized().dot(target.normalized())
			if cosang < 0.3:                                      # sharp turn while running: brake
				target *= clampf(cosang + 0.4, 0.15, 1.0)
				rate = cfg.run_decel
		hv = hv.move_toward(target, rate * delta)

	# ---- heading
	if _turning != 0.0:
		facing = wrapf(facing + _turning * cfg.turn_in_place_rate * delta, -PI, PI)
		rotation.y = facing
	elif mag > 0.05 and (on_floor or hv.length() > 0.5):
		facing = lerp_angle(facing, want_face, 1.0 - exp(-(6.0 if strafe else cfg.turn_rate) * delta))
		rotation.y = facing

	# ---- jump (buffered, coyote time, push-off before take-off; no double jump)
	if PlayerInput.consume_jump() and not seq_active:
		_jump_buffer = cfg.jump_buffer
	_jump_buffer -= delta
	_coyote = cfg.coyote_time if on_floor else _coyote - delta
	var vy := velocity.y
	if _jump_buffer > 0.0 and _coyote > 0.0 and not _jumping and _takeoff_t < 0.0:
		_jump_buffer = 0.0
		_takeoff_t = 0.0
		_stop_kind = ""
		_turning = 0.0
		anim.travel(&"jump_start")
	if _takeoff_t >= 0.0:
		_takeoff_t += delta
		if _takeoff_t >= cfg.takeoff_time:      # feet leave the ground exactly with the animation
			vy = sqrt(2.0 * cfg.gravity * cfg.jump_height)
			_takeoff_t = -1.0
			_coyote = 0.0
			_jumping = true
		elif not on_floor:
			vy -= cfg.gravity * delta
		else:
			vy = minf(vy, 0.0)
	elif not on_floor:
		vy -= cfg.gravity * delta
	else:
		vy = minf(vy, 0.0)

	# ---- punch (upper-body layer)
	if PlayerInput.consume_punch() and not seq_active:
		anim.request_punch()
	_punch_queue = anim._punch_queue

	if on_floor and vy <= 0.0 and hv.length() > 0.05:
		var st := movement.try_step_up(hv * delta)
		if not st.is_empty():
			_visual_offset -= (st[0] as Vector3).y
			_visual_h -= st[1]
			last_step_height = movement.last_step_height
			stepped_up.emit(last_step_height)

	velocity = Vector3(hv.x, vy, hv.z)
	var y_before := global_position.y
	move_and_slide()
	var now_floor := is_on_floor()
	_snapped = false
	if on_floor and not now_floor and not _jumping and _takeoff_t < 0.0 and velocity.y <= 0.0:
		now_floor = movement.snap_down()
		_snapped = now_floor
	# step-down off a curb / down stairs: keep the model/camera smooth
	if on_floor and now_floor and y_before - global_position.y > 0.05 and (_snapped or get_floor_normal().y > 0.95):
		_visual_offset += y_before - global_position.y
	_visual_offset = clampf(_visual_offset, -0.4, 0.4)
	var vo := move_toward(_visual_offset * exp(-20.0 * delta), 0.0, 0.2 * delta)
	_visual_offset = move_toward(_visual_offset, vo, 3.0 * delta)
	_visual_h = _visual_h * exp(-14.0 * delta)
	model.position = global_transform.basis.inverse() * _visual_h + Vector3(0.0, _visual_offset, 0.0)

	# ---- air / landing bookkeeping
	_water_landed = false
	if now_floor:
		if air_time > 0.0:
			_water_landed = air_time > 0.2
			_on_landed()
		air_time = 0.0
		_jumping = false if velocity.y <= 0.0 else _jumping
	else:
		air_time += delta
		_peak_fall_speed = maxf(_peak_fall_speed, -velocity.y)
	_update_animation(delta, now_floor)
	var sp3 := Vector2(velocity.x, velocity.z).length()
	water.effects(delta, global_position, sp3, lerpf(float(anim.stride["walk"]), float(anim.stride["run"]), clampf((sp3 - cfg.walk_speed) / (cfg.run_speed - cfg.walk_speed), 0.0, 1.0)), _water_landed)
	var floor_col: Object = fhit.get("collider") if not fhit.is_empty() else null
	audio.update(now_floor, ground_speed, floor_col, water.mode != PlayerWater.Mode.DRY)
	foot_ik.ground_ok = now_floor and not seq_active and air_time <= 0.0 and _takeoff_t < 0.0
	locomotion = "seq" if seq_active else ("stop" if _stop_kind != "" else ("turn" if _turning != 0.0 else ("air" if not now_floor else ("idle" if sp3 < 0.1 else ("run" if sp3 > 2.0 else "walk")))))


func _begin_stop(kind: String, speed: float, hv: Vector3) -> void:
	var L := anim.play_stop(kind, speed)
	if L <= 0.0:
		return
	_stop_kind = kind
	_stop_t = 0.0
	_stop_len = L
	_stop_dir = hv.normalized()
	_stop_t0 = 0.0
	for e in anim.stop_curves[kind]:
		if float(e[1]) <= speed:
			_stop_t0 = float(e[0])
			break


func _update_animation(delta: float, on_floor: bool) -> void:
	var hv := get_real_velocity()
	hv.y = 0.0
	ground_speed = lerpf(ground_speed, hv.length(), 1.0 - exp(-12.0 * delta))
	# body-frame velocity (x = right, y = forward) from the REAL motion (blocked -> legs stop)
	var bfwd := Vector3(-sin(facing), 0, -cos(facing))
	var bright := Vector3(cos(facing), 0, -sin(facing))
	var lv := Vector2(hv.dot(bright), hv.dot(bfwd))
	if lv.length() > 0.01:
		lv = lv.normalized() * ground_speed
	anim.set_ground(lv, _run_mode if lv.y > -0.2 else 0.0, _turning)
	anim.set_fall(clampf(-velocity.y / 5.0, 0.0, 1.0) if not on_floor else 0.0)
	anim.tick(delta)
	if seq_active:
		return
	var cur := anim.current()
	if cur == &"swim":
		anim.travel(&"ground")                      # out of the deep water: wading again
	if cur == &"jump_start" and _jumping:
		anim.travel(&"air")
	if not on_floor and air_time > 0.25 and (cur == &"ground" or cur == &"stop_walk" or cur == &"stop_run") and _takeoff_t < 0.0:
		_stop_kind = ""
		anim.travel(&"air")                         # walked off a ledge: fall
	if cur == &"jump_land":
		_land_timer += delta
		var moving := ground_speed > 0.6
		var leave_at := (0.22 if moving else 0.55) if not _land_hard else (0.32 if moving else 0.75)
		if _land_timer > leave_at:
			anim.travel(&"ground")


func _on_landed() -> void:
	var hard := air_time > 0.45 or _peak_fall_speed > 3.5
	var fall_speed := _peak_fall_speed
	_peak_fall_speed = 0.0
	if air_time < 0.2 and not _jumping:
		return                                  # stepping off a curb: no landing animation
	anim.travel(&"jump_land")
	_land_timer = 0.0
	_land_hard = hard
	audio.land(clampf(fall_speed / 6.0, 0.0, 1.0), get_last_slide_collision().get_collider() if get_slide_collision_count() > 0 else null)


func _seq_input() -> Vector2:
	## scripted walk towards _seq_goal through the normal walk code (no teleport), then face _seq_face
	if _seq_goal == null:
		if _seq_face != null:
			facing = lerp_angle(facing, float(_seq_face), 0.2)
			rotation.y = facing
		return Vector2.ZERO
	var to: Vector3 = (_seq_goal as Vector3) - global_position
	to.y = 0.0
	if to.length() < 0.15:
		_seq_done = true
		_seq_goal = null
		return Vector2.ZERO
	var yaw := cam_ctl.yaw
	var fwd := Vector3(-sin(yaw), 0.0, -cos(yaw))
	var right := Vector3(cos(yaw), 0.0, -sin(yaw))
	var d := to.normalized()
	facing = lerp_angle(facing, atan2(-d.x, -d.z), 0.25)
	rotation.y = facing
	var m := clampf(to.length() / 0.5, 0.35, 1.0)
	return Vector2(d.dot(right), -d.dot(fwd)) * m


## Swimming: the body floats at the surface following the swell (same Gerstner waves as the sea
## shader) and tilts a little with the wave slope; horizontal movement with water drag; no gravity,
## no jumping, no walking on the sea bed. Leaving: the floor comes up under the feet (wading).
func _swim_physics(delta: float, inp: Vector2, running: bool, was_swim: bool) -> void:
	PlayerInput.consume_jump()
	_jumping = false
	_takeoff_t = -1.0
	_stop_kind = ""
	_turning = 0.0
	air_time = 0.0
	var yaw := cam_ctl.yaw
	var fwd := Vector3(-sin(yaw), 0.0, -cos(yaw))
	var right := Vector3(cos(yaw), 0.0, -sin(yaw))
	var wish := right * inp.x - fwd * inp.y
	var mag := clampf(inp.length(), 0.0, 1.0)
	var target := wish.normalized() * mag * (cfg.swim_fast_speed if running else cfg.swim_speed) if mag > 0.01 else Vector3.ZERO
	var hv := Vector3(velocity.x, 0.0, velocity.z)
	hv = hv.move_toward(target, (2.2 if target.length() >= hv.length() else 1.6) * delta)
	if mag > 0.05:
		facing = lerp_angle(facing, atan2(-wish.x, -wish.z), 1.0 - exp(-4.0 * delta))
		rotation.y = facing
	var wave := PlayerWater.wave_at(global_position.x, global_position.z, water.floor_depth)
	var target_y := PlayerWater.SEA_LEVEL - PlayerWater.SWIM_BODY + wave.y * 0.85
	# follow the swell: feed-forward of the surface's vertical speed + a spring on the error
	var ff := (target_y - _swim_prev_target) / delta if was_swim and _swim_prev_target > -1e8 else 0.0
	_swim_prev_target = target_y
	var vy := clampf(ff + (target_y - global_position.y) * (6.0 if was_swim else 1.5), -2.5, 1.5)
	velocity = Vector3(hv.x, vy, hv.z)
	move_and_slide()
	_visual_offset = move_toward(_visual_offset, 0.0, 2.0 * delta)
	var bf := Vector2(-sin(facing), -cos(facing))
	var br := Vector2(cos(facing), -sin(facing))
	var slope := Vector2(wave.x, wave.z)
	var pitch := clampf(-slope.dot(bf) * 0.6, -0.2, 0.2)
	var roll := clampf(slope.dot(br) * 0.6, -0.2, 0.2)
	model.rotation = model.rotation.lerp(Vector3(pitch, PI, roll), 1.0 - exp(-4.0 * delta))
	model.position = Vector3(0.0, _visual_offset, 0.0)
	anim.travel(&"swim")
	var s := hv.length()
	ground_speed = lerpf(ground_speed, s, 1.0 - exp(-8.0 * delta))
	anim.set_swim(ground_speed, cfg.swim_speed)
	anim.tick(delta)
	water.effects(delta, global_position, s, 1.0, false)
	foot_ik.ground_ok = false
	locomotion = "swim"
