class_name VehicleCamera
extends Camera3D
## Car cameras (button «КАМЕРА» / key C cycles): CHASE -> CABIN -> ORBIT -> CHASE.
## CHASE: follows the car's heading with a lag (yaw blends towards the velocity direction, so the
##   camera swings out in turns and slides), low-passed target (suspension bounce is not transmitted ->
##   no shake), pulls back with speed and under acceleration (comes closer when braking), wider FOV
##   with speed; never inside buildings: sphere cast from the car to the wanted spot, pulled in on hits.
## CABIN: the driver's eye point (seated character, head hidden), rigid with the body, looking along
##   the car: steering wheel (turns with the front wheels), dashboard, windscreen and the road. Drag to
##   look around (eases back after 2 s). Cabin sound is muffled (VehicleAudio.interior).
## ORBIT: free look around the car; stays where the player leaves it, rotates slowly when idle.
## Every switch blends position / rotation / FOV over 0.45 s (no jump cut).

enum Mode { CHASE, CABIN, ORBIT }
const NAMES := ["3-Е ЛИЦО", "САЛОН", "ОБЗОР"]   ## shown on the «ВИД» button
const BLEND_T := 0.45

var car: VehiclePrado
var mode := Mode.CHASE
var orbit_mode: bool:
	get: return mode == Mode.ORBIT
	set(v): set_mode(Mode.ORBIT if v else Mode.CHASE)
var _yaw := 0.0
var _pitch := deg_to_rad(-12.0)
var _orbit_yaw := 0.0
var _orbit_pitch := 0.0
var _idle := 10.0
var _target := Vector3.ZERO
var _dist := 6.5
var _acc_pull := 0.0
var _prev_speed := 0.0
var _blend := 1.0
var _from := Transform3D.IDENTITY
var _from_fov := 62.0
var _sphere := SphereShape3D.new()


func _ready() -> void:
	top_level = true
	fov = 62.0
	far = 9500.0
	_sphere.radius = 0.28


func cycle() -> void:
	set_mode(((mode + 1) % 3) as Mode)


func set_mode(m: Mode) -> void:
	if m == mode:
		return
	_from = car.global_transform.affine_inverse() * global_transform if car else global_transform   # relative to the car: no lag at speed
	_from_fov = fov
	_blend = 0.0
	mode = m
	_orbit_yaw = 0.0
	_orbit_pitch = 0.0
	if car:
		car.set_cabin_view(mode == Mode.CABIN)
		var a := car.get_node_or_null("Audio")
		if a:
			a.set("interior", mode == Mode.CABIN)
	near = 0.04 if mode == Mode.CABIN else 0.05


func snap() -> void:
	if car == null:
		return
	_yaw = car.global_rotation.y
	_target = car.global_position + Vector3.UP * 1.5
	_orbit_yaw = 0.0
	_orbit_pitch = 0.0
	_blend = 1.0
	set_mode(Mode.CHASE)
	_place(1.0)


func _process(delta: float) -> void:
	if car == null:
		return
	var look := VehicleInput.consume_look()
	if look != Vector2.ZERO:
		_orbit_yaw -= look.x * 0.006
		_orbit_pitch = clampf(_orbit_pitch - look.y * 0.004, -0.5, 0.9)
		_idle = 0.0
	_idle += delta
	if mode == Mode.ORBIT:
		if _idle > 3.0:
			_orbit_yaw += delta * 0.25               # slow showcase rotation
	elif _idle > (2.0 if mode == Mode.CABIN else 2.5):
		_orbit_yaw = lerp_angle(_orbit_yaw, 0.0, 1.0 - exp(-2.0 * delta))
		_orbit_pitch = lerpf(_orbit_pitch, 0.0, 1.0 - exp(-2.0 * delta))
	var want_fov := 62.0
	if mode == Mode.CABIN:
		want_fov = 72.0
		_cabin()
	else:
		# heading: car yaw, blended towards the velocity direction when moving (shows slides)
		var v := car.linear_velocity
		var hv := Vector2(v.x, v.z)
		var heading := car.global_rotation.y
		if hv.length() > 3.0 and car.forward_speed > 0.0:
			heading = lerp_angle(heading, atan2(-v.x, -v.z), 0.35)
		_yaw = lerp_angle(_yaw, heading, 1.0 - exp(-3.2 * delta))
		var tgt := car.global_position + Vector3.UP * 1.5
		_target = _target.lerp(tgt, 1.0 - exp(-14.0 * delta))
		_target.y = lerpf(_target.y, tgt.y, 1.0 - exp(-5.0 * delta))
		var sp := clampf(car.speed_kmh / 160.0, 0.0, 1.0)
		# longitudinal acceleration: pull back when accelerating, come closer when braking
		var acc := (car.forward_speed - _prev_speed) / maxf(delta, 1e-3)
		_prev_speed = car.forward_speed
		_acc_pull = lerpf(_acc_pull, clampf(acc * 0.09, -0.5, 0.7), 1.0 - exp(-1.5 * delta))
		_dist = lerpf(_dist, (8.0 if mode == Mode.ORBIT else 6.4) + sp * 2.4 + _acc_pull, 1.0 - exp(-2.0 * delta))
		want_fov = 62.0 + sp * 8.0
		_place(delta)
	# blend from the previous camera after a mode switch
	if _blend < 1.0:
		_blend = minf(1.0, _blend + delta / BLEND_T)
		var k := smoothstep(0.0, 1.0, _blend)
		var to := global_transform
		var fr := car.global_transform * _from
		global_transform = Transform3D(fr.basis.orthonormalized().slerp(to.basis.orthonormalized(), k), fr.origin.lerp(to.origin, k))
		fov = lerpf(_from_fov, want_fov, k)
	else:
		fov = lerpf(fov, want_fov, 1.0 - exp(-(6.0 if mode == Mode.CABIN else 2.0) * delta))


func _cabin() -> void:
	var b := car.global_transform.basis.orthonormalized()
	var look := Basis(b.y, _orbit_yaw * 1.4) * b
	look = look * Basis(Vector3.RIGHT, deg_to_rad(-7.0) + _orbit_pitch * 0.8)
	global_transform = Transform3D(look, car.driver_eye())


func _place(_delta: float) -> void:
	var yaw := _yaw + _orbit_yaw
	var pitch := clampf(_pitch - _orbit_pitch * 0.6, -1.2, 0.15)
	var dir := Vector3(sin(yaw) * cos(pitch), -sin(pitch), cos(yaw) * cos(pitch))
	var want := _target + dir * _dist
	# keep out of walls / buildings: sphere cast (the near plane never touches a facade)
	var space := get_world_3d().direct_space_state
	var q := PhysicsShapeQueryParameters3D.new()
	q.shape = _sphere
	q.transform = Transform3D(Basis.IDENTITY, _target)
	q.motion = want - _target
	q.exclude = [car.get_rid()]
	q.collision_mask = 1
	var r := space.cast_motion(q)
	if r.size() == 2 and r[0] < 1.0:
		want = _target + (want - _target) * maxf(r[0] - 0.02, 0.05)
	global_position = want
	look_at(_target, Vector3.UP)
