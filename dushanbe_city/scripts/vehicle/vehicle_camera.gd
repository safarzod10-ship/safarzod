class_name VehicleCamera
extends Camera3D
## Third-person car camera.
## * follows the car's heading with a lag (yaw follows the velocity direction when moving, so the camera
##   swings out in turns and in slides), smoothed position (no shake from suspension: follows a
##   low-passed target), pulls back and widens FOV slightly with speed
## * never goes through buildings: ray from the target to the desired position, pulled in on hits
## * drag on the screen (or mouse) orbits around the car; it eases back behind the car after 2.5 s
## * "look around" mode (ОБЗОР): free orbit, stays where the player leaves it, auto-rotates slowly

var car: VehiclePrado
var orbit_mode := false
var _yaw := 0.0
var _pitch := deg_to_rad(-12.0)
var _orbit_yaw := 0.0
var _orbit_pitch := 0.0
var _idle := 10.0
var _target := Vector3.ZERO
var _dist := 6.5


func _ready() -> void:
	top_level = true
	fov = 62.0
	far = 9500.0


func snap() -> void:
	if car == null:
		return
	_yaw = car.global_rotation.y
	_target = car.global_position + Vector3.UP * 1.5
	_orbit_yaw = 0.0
	_orbit_pitch = 0.0
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
	if orbit_mode:
		if _idle > 3.0:
			_orbit_yaw += delta * 0.25               # slow showcase rotation
	elif _idle > 2.5:
		_orbit_yaw = lerp_angle(_orbit_yaw, 0.0, 1.0 - exp(-2.0 * delta))
		_orbit_pitch = lerpf(_orbit_pitch, 0.0, 1.0 - exp(-2.0 * delta))
	# heading: car yaw, blended towards the velocity direction when moving (shows slides)
	var v := car.linear_velocity
	var hv := Vector2(v.x, v.z)
	var heading := car.global_rotation.y
	if hv.length() > 3.0 and car.forward_speed > 0.0:
		var vel_yaw := atan2(-v.x, -v.z)
		heading = lerp_angle(heading, vel_yaw, 0.35)
	elif car.forward_speed < -1.0:
		heading = car.global_rotation.y            # reversing: stay behind the car
	_yaw = lerp_angle(_yaw, heading, 1.0 - exp(-3.2 * delta))
	# target: low-passed car position (suspension bounce not transmitted)
	var tgt := car.global_position + Vector3.UP * 1.5
	_target = _target.lerp(tgt, 1.0 - exp(-14.0 * delta))
	_target.y = lerpf(_target.y, tgt.y, 1.0 - exp(-5.0 * delta))
	var sp := clampf(car.speed_kmh / 160.0, 0.0, 1.0)
	_dist = lerpf(_dist, (8.0 if orbit_mode else 6.4) + sp * 2.4, 1.0 - exp(-2.0 * delta))
	fov = lerpf(fov, 62.0 + sp * 8.0, 1.0 - exp(-2.0 * delta))
	_place(delta)


func _place(_delta: float) -> void:
	var yaw := _yaw + _orbit_yaw
	var pitch := clampf(_pitch - _orbit_pitch * 0.6, -1.2, 0.15)
	var dir := Vector3(sin(yaw) * cos(pitch), -sin(pitch), cos(yaw) * cos(pitch))
	var want := _target + dir * _dist
	# keep out of walls / buildings
	var space := get_world_3d().direct_space_state
	var q := PhysicsRayQueryParameters3D.create(_target, want, 1, [car.get_rid()])
	var hit := space.intersect_ray(q)
	if not hit.is_empty():
		want = (hit.position as Vector3) - dir * 0.35
	global_position = want
	look_at(_target, Vector3.UP)
