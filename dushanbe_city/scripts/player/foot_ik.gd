class_name FootIK
extends SkeletonModifier3D
## Ground-adapted feet (stage 4), runs after the AnimationTree pose each frame:
## * one ray per foot (2 per frame) from above the animated ankle down to the ground;
## * the PELVIS is lowered by the larger "missing" height (foot over a lower surface: step down,
##   slope, uneven ground) so the lower foot can reach;
## * each leg is solved with an analytic TWO-BONE IK (thigh/shin, knee bends in its animated plane)
##   so the ankle lands at ground + its animated height above the floor, only while that foot is in
##   (or close to) contact - swing feet keep the clip's motion;
## * the foot is tilted towards the surface normal (max 25 deg).
## Cheap: 2 rays + a few vector ops; disabled when far from the camera, in the air or swimming.

var body: CharacterBody3D
var max_adjust := 0.22
var enabled_ik := true
var ground_ok := true               ## set by the controller (on floor, not swimming / seated)
var pelvis_drop := 0.0              ## smoothed (tests / debug)
var last_error := 0.0               ## max |ankle - target| after the solve (tests)

const LEGS := [["LeftUpperLeg", "LeftLowerLeg", "LeftFoot"], ["RightUpperLeg", "RightLowerLeg", "RightFoot"]]
var _ids := []
var _hips := -1
var _rest_ankle := 0.08
var _blend := [0.0, 0.0]


func _ready() -> void:
	var sk := get_skeleton()
	if sk == null:
		return
	_hips = sk.find_bone("Hips")
	for l in LEGS:
		_ids.append([sk.find_bone(l[0]), sk.find_bone(l[1]), sk.find_bone(l[2])])
	sk.reset_bone_poses()
	_rest_ankle = (sk.global_transform * sk.get_bone_global_pose(_ids[0][2]).origin).y - sk.global_position.y


func _process_modification_with_delta(delta: float) -> void:
	var sk := get_skeleton()
	if sk == null or body == null or _ids.is_empty() or _hips < 0:
		return
	if not enabled_ik or not ground_ok:
		pelvis_drop = move_toward(pelvis_drop, 0.0, delta * 1.5)
		_blend = [move_toward(_blend[0], 0.0, delta * 6.0), move_toward(_blend[1], 0.0, delta * 6.0)]
		if pelvis_drop <= 0.0001:
			return
	var space := body.get_world_3d().direct_space_state
	var xf := sk.global_transform
	var base_y := body.global_position.y
	var targets := []
	var need := 0.0
	for li in 2:
		var ids: Array = _ids[li]
		var ankle := xf * sk.get_bone_global_pose(ids[2]).origin
		var h := ankle.y - base_y                                  # animated ankle height over the floor plane
		var contact := 1.0 - smoothstep(_rest_ankle + 0.04, _rest_ankle + 0.14, h)   # planted -> 1, swing -> 0
		var q := PhysicsRayQueryParameters3D.create(Vector3(ankle.x, base_y + 0.6, ankle.z), Vector3(ankle.x, base_y - 0.6, ankle.z), body.collision_mask, [body.get_rid()])
		var hit := space.intersect_ray(q)
		if hit.is_empty() or not enabled_ik or not ground_ok:
			targets.append(null)
			_blend[li] = move_toward(_blend[li], 0.0, delta * 6.0)
			continue
		var gy: float = (hit.position as Vector3).y
		var dy := clampf(gy - base_y, -max_adjust, max_adjust)    # ground under this foot vs the floor plane
		_blend[li] = move_toward(_blend[li], contact, delta * 8.0)
		targets.append([ankle, dy, hit.normal, h])
		need = minf(need, dy * _blend[li])
	pelvis_drop = lerpf(pelvis_drop, -need, 1.0 - exp(-12.0 * delta))
	# pelvis down
	var hp := sk.get_bone_pose_position(_hips)
	var par := sk.get_bone_parent(_hips)
	var pb := sk.get_bone_global_pose(par).basis if par >= 0 else Basis.IDENTITY
	# world down-vector -> skeleton space -> hips' parent space (handles the import scale / 180 deg model turn)
	sk.set_bone_pose_position(_hips, hp + pb.inverse() * (xf.basis.inverse() * Vector3(0, -pelvis_drop, 0)))
	last_error = 0.0
	for li in 2:
		var t: Variant = targets[li]
		if t == null or _blend[li] < 0.01:
			continue
		var ids: Array = _ids[li]
		var ankle0: Vector3 = t[0]
		var dy: float = t[1]
		# target ankle (global): animated ankle, shifted by the ground offset under this foot (blended)
		var tgt := Vector3(ankle0.x, ankle0.y + dy * _blend[li], ankle0.z)
		_solve(sk, ids, tgt)
		var nrm: Vector3 = t[2]
		_tilt_foot(sk, ids[2], nrm, _blend[li])
		var a2 := xf * sk.get_bone_global_pose(ids[2]).origin
		last_error = maxf(last_error, a2.distance_to(tgt))


func _solve(sk: Skeleton3D, ids: Array, target_g: Vector3) -> void:
	## analytic two-bone IK in skeleton space: bend the knee to the needed angle (in the current
	## leg plane), then swing the thigh so the ankle points at the target
	var inv := sk.global_transform.affine_inverse()
	var T := inv * target_g
	var a := sk.get_bone_global_pose(ids[0])
	var b := sk.get_bone_global_pose(ids[1])
	var c := sk.get_bone_global_pose(ids[2])
	var A := a.origin
	var B := b.origin
	var C := c.origin
	var l1 := A.distance_to(B)
	var l2 := B.distance_to(C)
	var d := clampf(A.distance_to(T), absf(l1 - l2) + 0.001, l1 + l2 - 0.001)
	# 1. knee angle
	var cur_k := (A - B).angle_to(C - B)
	var want_k := acos(clampf((l1 * l1 + l2 * l2 - d * d) / (2.0 * l1 * l2), -1.0, 1.0))
	var axis := (C - A).cross(B - A)
	if axis.length() < 1e-5:
		axis = a.basis.x
	axis = axis.normalized()
	var dk := cur_k - want_k
	if absf(dk) > 1e-4:
		_rotate_global(sk, ids[1], axis, dk)
	# 2. thigh swing: ankle direction -> target direction
	c = sk.get_bone_global_pose(ids[2])
	var from := (c.origin - A).normalized()
	var to := (T - A).normalized()
	var ax2 := from.cross(to)
	if ax2.length() > 1e-6:
		_rotate_global(sk, ids[0], ax2.normalized(), from.angle_to(to))


func _rotate_global(sk: Skeleton3D, bone: int, axis_sk: Vector3, angle: float) -> void:
	## rotate a bone by `angle` about an axis given in skeleton space (children follow)
	var g := sk.get_bone_global_pose(bone)
	var parent := sk.get_bone_parent(bone)
	var pg := sk.get_bone_global_pose(parent) if parent >= 0 else Transform3D.IDENTITY
	var rot := Basis(axis_sk, angle)
	var new_g := Basis(rot * g.basis)
	var local := pg.basis.inverse() * new_g
	sk.set_bone_pose_rotation(bone, local.get_rotation_quaternion())


func _tilt_foot(sk: Skeleton3D, bone: int, n_world: Vector3, w: float) -> void:
	var n := (sk.global_transform.basis.inverse() * n_world).normalized()
	var up := Vector3.UP
	var ang := minf(up.angle_to(n), deg_to_rad(25.0)) * w
	var ax := up.cross(n)
	if ax.length() < 1e-5 or ang < 0.002:
		return
	_rotate_global(sk, bone, ax.normalized(), ang)
