class_name SeatedDriver
extends Node3D
## The player character seated at the wheel of the Prado (shown while driving; the walking body is
## hidden and removed from physics). The pose is built from the skeleton's rest pose by AIMING each
## limb bone along a target direction in the character's body frame (forward = +Z, up = +Y, left = +X):
## thighs forward, shins down, back leaning on the seat, arms reaching to the wheel (hands at ~9 and 3).
## The upper body and arms follow the steering a little. No physics, no collision.

const MODEL := "res://assets/characters/player/player.glb"
var skel: Skeleton3D
var model: Node3D
var _base := {}            ## bone -> global target basis (straight wheel)

## body-frame directions per bone (bone -> child), tuned on real screenshots of the cabin
const AIM := {
	"Spine": Vector3(0, 1, -0.22), "Chest": Vector3(0, 1, -0.2), "UpperChest": Vector3(0, 1, -0.15),
	"Neck": Vector3(0, 1, 0.12), "Head": Vector3(0, 1, 0.05),
	"LeftUpperLeg": Vector3(0.10, -0.12, 1), "RightUpperLeg": Vector3(-0.10, -0.12, 1),
	"LeftLowerLeg": Vector3(0.02, -1, 0.32), "RightLowerLeg": Vector3(-0.02, -1, 0.32),
	"LeftFoot": Vector3(0, -0.35, 1), "RightFoot": Vector3(0, -0.35, 1),
	"LeftUpperArm": Vector3(0.30, -0.55, 0.62), "RightUpperArm": Vector3(-0.30, -0.55, 0.62),
	"LeftLowerArm": Vector3(-0.30, 0.38, 1), "RightLowerArm": Vector3(0.30, 0.38, 1),
	"LeftHand": Vector3(-0.2, 0.25, 1), "RightHand": Vector3(0.2, 0.25, 1),
}
const CHILD := {
	"Spine": "Chest", "Chest": "UpperChest", "UpperChest": "Neck", "Neck": "Head", "Head": "",
	"LeftUpperLeg": "LeftLowerLeg", "RightUpperLeg": "RightLowerLeg", "LeftLowerLeg": "LeftFoot", "RightLowerLeg": "RightFoot",
	"LeftFoot": "LeftToes", "RightFoot": "RightToes", "LeftUpperArm": "LeftLowerArm", "RightUpperArm": "RightLowerArm",
	"LeftLowerArm": "LeftHand", "RightLowerArm": "RightHand", "LeftHand": "", "RightHand": "",
}
const ORDER := ["Spine", "Chest", "UpperChest", "Neck", "Head", "LeftUpperLeg", "RightUpperLeg", "LeftLowerLeg",
	"RightLowerLeg", "LeftFoot", "RightFoot", "LeftUpperArm", "RightUpperArm", "LeftLowerArm", "RightLowerArm", "LeftHand", "RightHand"]


func _ready() -> void:
	model = (load(MODEL) as PackedScene).instantiate()
	add_child(model)
	model.rotation.y = PI                      # the character model faces +Z in its skeleton, the car faces -Z
	skel = model.find_children("*", "Skeleton3D", true, false)[0]
	for ap in model.find_children("*", "AnimationPlayer", true, false):
		(ap as AnimationPlayer).stop()
	for mi in model.find_children("*", "MeshInstance3D", true, false):
		(mi as MeshInstance3D).cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	pose(0.0)


func pose(steer: float) -> void:
	## aim bones from the rest pose; steer (-1..1) twists the chest a little and moves the hands
	skel.reset_bone_poses()
	for b in ORDER:
		var bi := skel.find_bone(b)
		if bi < 0:
			continue
		var dir: Vector3 = AIM[b]
		if b.ends_with("Arm") or b.ends_with("Hand"):
			dir = dir.rotated(Vector3.FORWARD, steer * 0.35)       # hands travel with the wheel rim
		if b == "UpperChest":
			dir = dir.rotated(Vector3.UP, -steer * 0.12)
		_aim(bi, String(CHILD[b]), dir.normalized())


func _aim(bi: int, child: String, want: Vector3) -> void:
	var parent := skel.get_bone_parent(bi)
	var gp := skel.get_bone_global_pose(parent) if parent >= 0 else Transform3D.IDENTITY
	var cur := skel.get_bone_global_pose(bi)
	var from: Vector3
	if child != "" and skel.find_bone(child) >= 0:
		from = (skel.get_bone_global_pose(skel.find_bone(child)).origin - cur.origin).normalized()
	else:
		from = cur.basis.y.normalized()                     # end bones: their own Y axis
	if from.length() < 0.5:
		return
	var rot := Quaternion(from, want) if from.dot(want) > -0.999 else Quaternion(Vector3.UP, PI)
	var new_g := Basis(rot) * cur.basis
	var local := (gp.basis.orthonormalized().inverse() * new_g).orthonormalized()
	skel.set_bone_pose_rotation(bi, Quaternion(local))


## place the hips at the seat point (car-local), facing the car's forward
func seat_at(car_model: Node3D, seat_local: Vector3) -> void:
	var hips := skel.find_bone("Hips")
	var hp := skel.get_bone_global_pose(hips).origin           # hips in skeleton space
	var to_world := model.transform * skel.transform
	position = seat_local - (to_world * hp)
