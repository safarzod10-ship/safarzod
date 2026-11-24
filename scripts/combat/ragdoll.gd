class_name Ragdoll
extends SkeletonModifier3D
## Physics ragdoll built from plain RigidBody3D capsules + cone-twist joints in
## world space (so the model's node scale does not matter); this modifier copies
## the simulated bodies back onto the skeleton every frame.

## [bone, direction child, radius, mass, parent segment index, swing deg, twist deg]
const SEGMENTS := [
	["Hips", "Spine1", 0.13, 14.0, -1, 0.0, 0.0],
	["Spine1", "Neck", 0.15, 20.0, 0, 22.0, 15.0],
	["Head", "HeadTop_End", 0.105, 5.0, 1, 35.0, 30.0],
	["LeftArm", "LeftForeArm", 0.05, 2.5, 1, 80.0, 40.0],
	["LeftForeArm", "LeftHand", 0.042, 1.8, 3, 65.0, 30.0],
	["RightArm", "RightForeArm", 0.05, 2.5, 1, 80.0, 40.0],
	["RightForeArm", "RightHand", 0.042, 1.8, 5, 65.0, 30.0],
	["LeftUpLeg", "LeftLeg", 0.075, 8.0, 0, 55.0, 15.0],
	["LeftLeg", "LeftFoot", 0.055, 4.5, 7, 50.0, 8.0],
	["RightUpLeg", "RightLeg", 0.075, 8.0, 0, 55.0, 15.0],
	["RightLeg", "RightFoot", 0.055, 4.5, 9, 50.0, 8.0],
]
const LAYER := 4  # physics layer 3

var rig: CharacterRig
var bodies: Array[RigidBody3D] = []
var _bone_idx: PackedInt32Array = []
var _offsets: Array[Transform3D] = []
var _holder: Node3D
var _settle := 0.0


func setup(p_rig: CharacterRig) -> void:
	rig = p_rig
	active = false


func is_running() -> bool:
	return not bodies.is_empty()


## Switches the character to physics. `velocity` is inherited by every body;
## `impulse` (world) is applied at `impulse_pos`.
func start(velocity: Vector3, impulse: Vector3, impulse_pos: Vector3) -> void:
	if is_running():
		return
	var skel := rig.skeleton
	var sg := skel.global_transform
	_holder = Node3D.new()
	_holder.name = "RagdollBodies"
	_holder.top_level = true
	rig.add_child(_holder)
	_holder.global_transform = Transform3D.IDENTITY
	var seg_body: Array[RigidBody3D] = []
	var best: RigidBody3D = null
	var best_d := INF
	for seg: Array in SEGMENTS:
		var bi := rig.bone(seg[0])
		var ci := rig.bone(seg[1])
		if bi < 0:
			seg_body.append(null)
			continue
		var bone_w := sg * skel.get_bone_global_pose(bi)
		var a := bone_w.origin
		var b: Vector3
		if ci >= 0:
			b = (sg * skel.get_bone_global_pose(ci)).origin
		else:
			b = a + bone_w.basis.y.normalized() * 0.18
		var dir := b - a
		var length := maxf(dir.length(), 0.05)
		dir = dir.normalized()
		var side := dir.cross(Vector3.UP)
		if side.length_squared() < 0.001:
			side = dir.cross(Vector3.RIGHT)
		side = side.normalized()
		var basis := Basis(side, dir, side.cross(dir).normalized())
		var body := RigidBody3D.new()
		body.name = "RB_" + String(seg[0])
		body.mass = seg[3]
		body.collision_layer = LAYER
		body.collision_mask = 1
		body.linear_damp = 0.15
		body.angular_damp = 2.5
		body.continuous_cd = true
		body.set_meta(&"ragdoll_owner", rig.get_parent())
		var pm := PhysicsMaterial.new()
		pm.friction = 0.9
		pm.bounce = 0.0
		body.physics_material_override = pm
		var cs := CollisionShape3D.new()
		var cap := CapsuleShape3D.new()
		cap.radius = seg[2]
		cap.height = maxf(length, cap.radius * 2.0 + 0.01)
		cs.shape = cap
		body.add_child(cs)
		_holder.add_child(body)
		body.global_transform = Transform3D(basis, a + dir * length * 0.5)
		body.linear_velocity = velocity
		bodies.append(body)
		seg_body.append(body)
		_bone_idx.append(bi)
		_offsets.append(body.global_transform.affine_inverse() * bone_w)
		var d := body.global_position.distance_squared_to(impulse_pos)
		if d < best_d:
			best_d = d
			best = body
		var parent_i: int = seg[4]
		if parent_i >= 0 and seg_body[parent_i] != null:
			var joint := ConeTwistJoint3D.new()
			_holder.add_child(joint)
			# Twist axis = joint X = bone direction.
			joint.global_transform = Transform3D(Basis(dir, basis.z, basis.x), a)
			joint.swing_span = deg_to_rad(seg[5])
			joint.twist_span = deg_to_rad(seg[6])
			joint.exclude_nodes_from_collision = true
			joint.node_a = joint.get_path_to(seg_body[parent_i])
			joint.node_b = joint.get_path_to(body)
	for i in bodies.size():
		for j in range(i + 1, bodies.size()):
			bodies[i].add_collision_exception_with(bodies[j])
	if best != null and impulse.length_squared() > 0.0001:
		best.apply_impulse(impulse, impulse_pos - best.global_position)
	for mi in rig.model.find_children("*", "MeshInstance3D", true, false):
		(mi as MeshInstance3D).extra_cull_margin = 60.0
	active = true
	_settle = 0.0
	set_physics_process(true)


func apply_blast(origin: Vector3, strength: float) -> void:
	for b in bodies:
		var d := b.global_position - origin
		var f := strength / maxf(d.length_squared(), 1.0)
		b.freeze = false
		b.apply_central_impulse((d.normalized() + Vector3.UP * 0.5) * minf(f, 7.0) * b.mass)
	_settle = 0.0


func _physics_process(delta: float) -> void:
	if bodies.is_empty():
		return
	_settle += delta
	if _settle > 7.0:  # put the corpse to rest to save CPU
		for b in bodies:
			b.freeze = true
		set_physics_process(false)


func hips_position() -> Vector3:
	return bodies[0].global_position if not bodies.is_empty() else rig.global_position


func _process_modification() -> void:
	var skel := get_skeleton()
	if skel == null or bodies.is_empty():
		return
	var inv := skel.global_transform.affine_inverse()
	for i in bodies.size():
		skel.set_bone_global_pose(_bone_idx[i], inv * bodies[i].global_transform * _offsets[i])
