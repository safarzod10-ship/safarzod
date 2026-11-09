class_name WeaponAim
extends SkeletonModifier3D
## Raises the arms to aim a gun (after the animation pose, like FootIK): analytic two-bone IK of the
## right arm so the hand is in front of the shoulder along the aim direction (camera forward); with
## the AK the left hand also goes to the handguard. Blends in / out smoothly.

var combat: PlayerCombat
var _w := 0.0
var _r := []
var _l := []


func _ready() -> void:
	var s := get_skeleton()
	for n in ["RightUpperArm", "RightLowerArm", "RightHand"]:
		_r.append(s.find_bone(n))
	for n in ["LeftUpperArm", "LeftLowerArm", "LeftHand"]:
		_l.append(s.find_bone(n))


func _process_modification_with_delta(delta: float) -> void:
	var s := get_skeleton()
	if combat == null or s == null or _r.has(-1):
		return
	var want := 1.0 if combat.aim_t > 0.0 and combat.gun() and combat.player.is_visible_in_tree() else 0.0
	_w = move_toward(_w, want, delta * 6.0)
	if _w <= 0.001:
		combat.place_weapon()            # the weapon follows the final (animated) hand pose
		return
	var aim_dir := -combat.player.get_camera().global_transform.basis.z
	var xf := s.global_transform
	var sh := xf * s.get_bone_global_pose(_r[0]).origin
	var hand_now := xf * s.get_bone_global_pose(_r[2]).origin
	var ak := Weapons.current == "ak47"
	var right := aim_dir.cross(Vector3.UP).normalized()
	var tgt := sh + aim_dir * (0.42 if ak else 0.56) + Vector3.DOWN * (0.12 if ak else 0.04) - right * (0.0 if ak else 0.08)
	_solve(s, _r, hand_now.lerp(tgt, _w))
	if ak and not _l.has(-1):
		var lh_now := xf * s.get_bone_global_pose(_l[2]).origin
		var support := tgt + aim_dir * 0.32 + Vector3.UP * 0.02
		_solve(s, _l, lh_now.lerp(support, _w))
	combat.place_weapon()


func _solve(s: Skeleton3D, ids: Array, target_g: Vector3) -> void:
	var inv := s.global_transform.affine_inverse()
	var T := inv * target_g
	var A := s.get_bone_global_pose(ids[0]).origin
	var B := s.get_bone_global_pose(ids[1]).origin
	var C := s.get_bone_global_pose(ids[2]).origin
	var l1 := A.distance_to(B)
	var l2 := B.distance_to(C)
	var d := clampf(A.distance_to(T), absf(l1 - l2) + 0.001, l1 + l2 - 0.001)
	var cur := (A - B).angle_to(C - B)
	var want := acos(clampf((l1 * l1 + l2 * l2 - d * d) / (2.0 * l1 * l2), -1.0, 1.0))
	var axis := (C - A).cross(B - A)
	if axis.length() < 1e-5:
		axis = Vector3.UP
	_rot(s, ids[1], axis.normalized(), cur - want)
	C = s.get_bone_global_pose(ids[2]).origin
	var f := (C - A).normalized()
	var t := (T - A).normalized()
	var ax := f.cross(t)
	if ax.length() > 1e-6:
		_rot(s, ids[0], ax.normalized(), f.angle_to(t))


func _rot(s: Skeleton3D, bone: int, axis: Vector3, ang: float) -> void:
	if absf(ang) < 1e-5:
		return
	var g := s.get_bone_global_pose(bone)
	var par := s.get_bone_parent(bone)
	var pg := s.get_bone_global_pose(par) if par >= 0 else Transform3D.IDENTITY
	var nb := Basis(axis, ang) * g.basis
	s.set_bone_pose_rotation(bone, (pg.basis.inverse() * nb).get_rotation_quaternion())
