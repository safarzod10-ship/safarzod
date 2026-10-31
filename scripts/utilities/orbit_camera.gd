class_name OrbitCamera
extends Camera3D
## Test-scene camera: slow auto-orbit around `target`; touch drag (right half
## of the screen, via InputManager) or mouse emulation rotates it manually.

@export var target := Vector3.ZERO
@export var distance := 12.0
@export var height := 4.0
@export var auto_speed_deg := 6.0
@export var yaw_deg := 30.0
@export var pitch_deg := 15.0


func _process(delta: float) -> void:
	var look := InputManager.consume_look_delta()
	if look != Vector2.ZERO:
		yaw_deg -= look.x
		pitch_deg = clampf(pitch_deg + look.y, -10.0, 70.0)
	else:
		yaw_deg += auto_speed_deg * delta
	var rot := Basis.from_euler(Vector3(deg_to_rad(-pitch_deg), deg_to_rad(yaw_deg), 0.0))
	global_position = target + Vector3(0, height, 0) + rot * Vector3(0, 0, distance)
	look_at(target + Vector3(0, height * 0.5, 0))
