class_name PradoRig
extends Node3D
## Toyota LC Prado J150 v3 model rig: named pivots for game systems (no driving logic yet).
## Pivots come from the GLB (tools/blender/prado_v3_build.py): every movable part's ORIGIN is
## its hinge / rotation centre, so animation is a plain rotation of the node:
##   Door_FL/FR/RL/RR  vertical hinge at the front edge      -> rotate Y (open outwards)
##   Hood              hinge at the cowl                     -> rotate X (open upwards)
##   Tailgate          side hinge (right, LHD market)        -> rotate Y
##   Wheel_*           hub centre                            -> spin X, steer Y (front)
##   SteeringWheel_Pivot  wheel centre, local Y (Blender Z) = column axis -> rotate about local Y
## The cabin (Interior) is hidden beyond INTERIOR_RANGE_M: through 20 % VLT glass it is not
## visible at that distance and it is ~45 % of the triangles.

const INTERIOR_RANGE_M := 30.0
const DOOR_MAX_DEG := 68.0
const HOOD_MAX_DEG := 55.0
const TAILGATE_MAX_DEG := 80.0
const STEER_RATIO := 16.0   # steering wheel deg per road-wheel deg (typical for the J150, approx.)

var _rest := {}


func _ready() -> void:
	for n in ["Door_FL", "Door_FR", "Door_RL", "Door_RR", "Hood", "Tailgate", "Wheel_FL", "Wheel_FR",
			"Wheel_RL", "Wheel_RR", "SteeringWheel_Pivot"]:
		var node := part(n)
		if node:
			_rest[n] = node.transform
	var cab := find_child("Interior", true, false) as Node3D
	if cab:
		for mi: MeshInstance3D in cab.find_children("*", "MeshInstance3D", true, false):
			mi.visibility_range_end = INTERIOR_RANGE_M
	for n in ["Door_FL_Card", "Door_FR_Card", "Door_RL_Card", "Door_RR_Card"]:
		var mi := find_child(n, true, false) as MeshInstance3D
		if mi:
			mi.visibility_range_end = INTERIOR_RANGE_M


func part(n: String) -> Node3D:
	return find_child(n, true, false) as Node3D


## 0 = closed, 1 = fully open
func set_door(n: String, amount: float) -> void:
	var node := part(n)
	if node == null or not _rest.has(n):
		return
	# car front = +Z (glTF), door extends backwards (-Z) from its hinge: a NEGATIVE yaw swings a
	# left (+X) door outwards
	var sign_ := -1.0 if n.ends_with("L") else 1.0
	node.transform = _rest[n] * Transform3D(Basis(Vector3.UP, deg_to_rad(sign_ * DOOR_MAX_DEG * clampf(amount, 0, 1))), Vector3.ZERO)


func set_hood(amount: float) -> void:
	if _rest.has("Hood"):
		part("Hood").transform = _rest["Hood"] * Transform3D(Basis(Vector3.RIGHT, deg_to_rad(-HOOD_MAX_DEG * clampf(amount, 0, 1))), Vector3.ZERO)


func set_tailgate(amount: float) -> void:
	if _rest.has("Tailgate"):
		part("Tailgate").transform = _rest["Tailgate"] * Transform3D(Basis(Vector3.UP, deg_to_rad(TAILGATE_MAX_DEG * clampf(amount, 0, 1))), Vector3.ZERO)


## road-wheel steering angle (deg, + = left) and wheel spin (rad)
func set_wheels(steer_deg: float, spin_rad: float) -> void:
	for n in ["Wheel_FL", "Wheel_FR", "Wheel_RL", "Wheel_RR"]:
		if not _rest.has(n):
			continue
		var b := Basis(Vector3.RIGHT, spin_rad)
		if n.begins_with("Wheel_F"):
			b = Basis(Vector3.UP, deg_to_rad(steer_deg)) * b
		part(n).transform = _rest[n] * Transform3D(b, Vector3.ZERO)
	if _rest.has("SteeringWheel_Pivot"):
		part("SteeringWheel_Pivot").transform = _rest["SteeringWheel_Pivot"] * Transform3D(
			Basis(Vector3.UP, deg_to_rad(steer_deg * STEER_RATIO)), Vector3.ZERO)   # Blender local Z -> Godot local Y
