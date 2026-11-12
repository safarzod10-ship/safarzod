class_name CharacterCamera
extends Node
## Third-person camera of the walking character (stage 4).
## Rig: CameraRig (top_level, yaw) -> SpringArm3D (pitch; its own collision is NOT used) -> Camera3D.
## * Orbit: mouse / gamepad / touch swipe (PlayerInput.look_delta), sensitivity from the config and
##   the settings slider, pitch limits; smoothed angles.
## * Follow: fast horizontally, softer vertically (steps, stairs, jumps never jerk the view; in the
##   air the vertical follow is slower still).
## * Collision: a sphere (r 0.22) is cast from the head anchor towards the camera; the distance
##   moves IN quickly when something comes between and back OUT slowly when it clears (no snapping).
##   When the camera ends up closer than 0.55 m the character model is hidden (no view inside it).
## * Running: up to +0.55 m distance and +5 deg FOV (smoothed); swimming: anchor and camera kept above
##   the water surface, pitch limited so the camera never dips under it.

var player: CharacterBody3D
var cfg: CharacterConfig
var rig: Node3D
var spring: SpringArm3D
var camera: Camera3D
var model: Node3D

var yaw := 0.0
var pitch := deg_to_rad(-14.0)
var view_yaw := 0.0
var view_pitch := deg_to_rad(-14.0)
var dist := 3.6                     ## current (smoothed, collision-limited) distance
var target := Vector3.ZERO          ## smoothed follow point
var run_amount := 0.0               ## 0..1, set by the controller
var swimming := false
var airborne := false
var vertical_offset := 0.0          ## visual step smoothing of the model (controller)
var sensitivity_scale := 1.0        ## settings slider
var _shape := SphereShape3D.new()
var _fov := 68.0
var _near := 0.05
var _sk: Skeleton3D
var _head := -1

## first-person view on foot (the eyes of the hero; his body and hands stay visible below)
static var first_person := false


func setup(p: CharacterBody3D, c: CharacterConfig, r: Node3D, s: SpringArm3D, cam: Camera3D, m: Node3D) -> void:
	player = p
	cfg = c
	rig = r
	spring = s
	camera = cam
	model = m
	rig.top_level = true
	spring.spring_length = 0.0
	spring.set_physics_process_internal(false)   # collision handled here (smoothed)
	spring.set_process_internal(false)
	_shape.radius = 0.22
	dist = cfg.camera_distance
	_fov = cfg.camera_fov
	camera.fov = _fov
	_near = camera.near
	for ch in model.find_children("*", "Skeleton3D", true, false):
		_sk = ch
		_head = _sk.find_bone("Head")
		break
	target = anchor()
	rig.global_position = target


func anchor() -> Vector3:
	var a := player.global_position + Vector3(0.0, cfg.camera_height + vertical_offset, 0.0)
	if swimming:
		var wl: Variant = player.get("water")
		a.y = maxf(a.y, (wl.level if wl else PlayerWater.SEA_LEVEL) + cfg.swim_camera_height)
	return a


func set_angles(yaw_rad: float, pitch_rad: float) -> void:
	yaw = yaw_rad
	pitch = clampf(pitch_rad, deg_to_rad(cfg.pitch_min_deg), deg_to_rad(cfg.pitch_max_deg))


func snap() -> void:
	view_yaw = yaw
	view_pitch = pitch
	target = anchor()
	dist = cfg.camera_distance
	_apply()


func rotate_by(d: Vector2) -> void:
	yaw = wrapf(yaw - d.x, -PI, PI)
	var lo := deg_to_rad(-80.0 if first_person else cfg.pitch_min_deg)
	var hi := deg_to_rad(70.0 if first_person else cfg.pitch_max_deg)
	if swimming:
		hi = minf(hi, deg_to_rad(8.0))          # do not look up from under the camera's water line
	pitch = clampf(pitch - d.y, lo, hi)


func update(delta: float) -> void:
	rotate_by(PlayerInput.consume_look() * cfg.touch_look_sensitivity * sensitivity_scale)
	if first_person and not swimming:
		_first_person(delta)
		return
	camera.near = _near
	var a := anchor()
	var kh := 1.0 - exp(-25.0 * delta)
	var kv := 1.0 - exp(-(4.0 if airborne else 10.0) * delta)
	target.x = lerpf(target.x, a.x, kh)
	target.z = lerpf(target.z, a.z, kh)
	target.y = lerpf(target.y, a.y, kv)
	var ks := 1.0 - exp(-32.0 * delta)
	view_yaw = lerp_angle(view_yaw, yaw, ks)
	view_pitch = lerpf(view_pitch, pitch, ks)
	# desired distance (running pulls back a little) and the collision-limited one
	var want := cfg.camera_distance + cfg.run_extra_distance * run_amount
	var limit := _collision_limit(want)
	var speed := cfg.collision_in_speed if limit < dist else cfg.collision_out_speed
	dist = move_toward(dist, minf(want, limit), speed * delta * maxf(1.0, absf(dist - limit)))
	dist = minf(dist, limit)                   # never through the wall, even for one frame
	_fov = lerpf(_fov, cfg.camera_fov + cfg.run_fov_add * run_amount, 1.0 - exp(-3.0 * delta))
	camera.fov = _fov
	_apply()
	if swimming:
		# keep the lens above the water surface
		var cy := camera.global_position.y
		var floor_y := PlayerWater.SEA_LEVEL + 0.35
		if cy < floor_y:
			rig.global_position.y += floor_y - cy
	model.visible = dist > 0.55


## eyes: just in front of the head bone, looking where the camera yaw / pitch point
func eye() -> Vector3:
	var fwd := Vector3(-sin(view_yaw), 0.0, -cos(view_yaw))
	if _sk and _head >= 0:
		var h := (_sk.global_transform * _sk.get_bone_global_pose(_head)).origin
		return h + Vector3(0.0, 0.09, 0.0) + fwd * 0.17
	return player.global_position + Vector3(0.0, 1.62, 0.0) + fwd * 0.17


func _first_person(delta: float) -> void:
	var ks := 1.0 - exp(-40.0 * delta)
	view_yaw = lerp_angle(view_yaw, yaw, ks)
	view_pitch = lerpf(view_pitch, pitch, ks)
	target = eye()
	dist = 0.0
	camera.near = 0.03
	_fov = lerpf(_fov, cfg.camera_fov + 6.0, 1.0 - exp(-6.0 * delta))
	camera.fov = _fov
	_apply()
	model.visible = true


func _apply() -> void:
	rig.global_position = target
	rig.rotation = Vector3(0.0, view_yaw, 0.0)
	spring.rotation = Vector3(view_pitch, 0.0, 0.0)
	camera.position = Vector3(0.0, 0.0, dist)


func _collision_limit(want: float) -> float:
	var space := player.get_world_3d().direct_space_state
	var basis := Basis(Vector3.UP, view_yaw) * Basis(Vector3.RIGHT, view_pitch)
	var back := basis * Vector3(0, 0, 1)
	var q := PhysicsShapeQueryParameters3D.new()
	q.shape = _shape
	q.transform = Transform3D(Basis.IDENTITY, target)
	q.motion = back * want
	q.collision_mask = 1
	q.exclude = [player.get_rid()]
	var r := space.cast_motion(q)
	if r.is_empty() or r[0] >= 1.0:
		return want
	return maxf(want * float(r[0]) - 0.05, 0.3)


func camera_distance() -> float:
	return dist
