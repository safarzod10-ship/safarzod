class_name AimModifier
extends SkeletonModifier3D
## Procedural upper-body layer applied after animation: bends the spine so the
## weapon follows the aim pitch, adds recoil kick and hit flinch.

var rig: CharacterRig
var weight := 0.0          ## 0 = animation only, 1 = full aim
var pitch := 0.0           ## radians, + = up
var yaw_fix := 0.0         ## constant correction so the barrel points forward
var pitch_fix := 0.0
var recoil := 0.0          ## radians, decays in owner
var flinch := Vector2.ZERO ## x = pitch, y = yaw (radians), always applied
var lean := 0.0

var weapon: Node3D            ## weapon node under the right-hand socket
var support_local := Vector3.ZERO  ## handguard point in weapon space
var ik_weight := 1.0          ## left hand on the handguard

var _spine: PackedInt32Array = []
var _l_arm := -1
var _l_fore := -1
var _l_hand := -1
var _l_mid := -1
var _r_hand := -1
var _to_skel := Basis.IDENTITY


func setup(p_rig: CharacterRig) -> void:
	rig = p_rig
	for n: String in ["Spine", "Spine1", "Spine2"]:
		if rig.bone(n) >= 0:
			_spine.append(rig.bone(n))
	_to_skel = AnimRetarget.rel_xform(rig.skeleton, rig).basis.orthonormalized().inverse()
	_l_arm = rig.bone("LeftArm")
	_l_fore = rig.bone("LeftForeArm")
	_l_hand = rig.bone("LeftHand")
	_l_mid = rig.bone("LeftHandMiddle1")
	_r_hand = rig.bone("RightHand")


func _process_modification() -> void:
	var skel := get_skeleton()
	if skel == null or _spine.is_empty():
		return
	var p := (pitch + pitch_fix + recoil) * weight + flinch.x
	var y := yaw_fix * weight + flinch.y
	if absf(p) > 0.0005 or absf(y) > 0.0005 or absf(lean) > 0.0005:
		var n := float(_spine.size())
		var rot_rig := Basis(Vector3.UP, y / n) * Basis(Vector3.RIGHT, p / n) * Basis(Vector3.FORWARD, lean / n)
		var rot := _to_skel * rot_rig * _to_skel.inverse()
		for b in _spine:
			var g := skel.get_bone_global_pose(b)
			var s := g.basis.get_scale()
			g.basis = (rot * g.basis.orthonormalized()).scaled_local(s)
			skel.set_bone_global_pose(b, g)
	_left_hand_ik(skel)


## Two-bone IK: puts the left palm on the weapon's handguard.
func _left_hand_ik(skel: Skeleton3D) -> void:
	var w := ik_weight * weight
	if w < 0.01 or weapon == null or _l_arm < 0 or _l_fore < 0 or _l_hand < 0 or _r_hand < 0:
		return
	var ga := skel.get_bone_global_pose(_l_arm)
	var gb := skel.get_bone_global_pose(_l_fore)
	var gc := skel.get_bone_global_pose(_l_hand)
	var pa := ga.origin
	var pb := gb.origin
	var pc := gc.origin
	var palm := pc
	if _l_mid >= 0:
		palm = pc.lerp(skel.get_bone_global_pose(_l_mid).origin, 0.8)
	var support: Vector3 = skel.get_bone_global_pose(_r_hand) * (weapon.transform * support_local)
	var target := pc.lerp(support + (pc - palm), w)
	var l1 := pa.distance_to(pb)
	var l2 := pb.distance_to(pc)
	var to_t := target - pa
	var d := clampf(to_t.length(), absf(l1 - l2) + 0.001 * l1, (l1 + l2) * 0.999)
	var ab := (pb - pa).normalized()
	var ac := (pc - pa).normalized()
	var ba := (pa - pb).normalized()
	var bc := (pc - pb).normalized()
	var axis := ac.cross(ab)
	if axis.length_squared() < 0.000001:
		axis = (_to_skel * Vector3.DOWN).cross(ac)
	axis = axis.normalized()
	var ac0 := acos(clampf(ab.dot(ac), -1.0, 1.0))
	var ba0 := acos(clampf(ba.dot(bc), -1.0, 1.0))
	var ac1 := acos(clampf((l1 * l1 + d * d - l2 * l2) / (2.0 * l1 * d), -1.0, 1.0))
	var ba1 := acos(clampf((l1 * l1 + l2 * l2 - d * d) / (2.0 * l1 * l2), -1.0, 1.0))
	var r0 := Basis(axis, ac1 - ac0)
	var r2 := Basis(_arc(ac, to_t.normalized()))
	var hand_basis := gc.basis
	ga.basis = r2 * r0 * ga.basis
	skel.set_bone_global_pose(_l_arm, ga)
	gb = skel.get_bone_global_pose(_l_fore)
	gb.basis = Basis(r2 * axis, ba1 - ba0) * gb.basis
	skel.set_bone_global_pose(_l_fore, gb)
	gc = skel.get_bone_global_pose(_l_hand)
	gc.basis = hand_basis
	skel.set_bone_global_pose(_l_hand, gc)


static func _arc(a: Vector3, b: Vector3) -> Quaternion:
	var d := a.dot(b)
	if d > 0.99999:
		return Quaternion.IDENTITY
	var ax := a.cross(b)
	if ax.length_squared() < 0.0000001:
		return Quaternion.IDENTITY
	return Quaternion(ax.normalized(), acos(clampf(d, -1.0, 1.0)))
