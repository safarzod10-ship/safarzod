extends Node
## Character audit (stage 4): model, skeleton, rest pose, skin weights, collision, animations and
## the arm/torso clearance of every clip. Writes docs/reports/character_audit.json.
## godot --headless --path . res://scenes/testing/character_audit.tscn

func _ready() -> void:
	var out := {}
	var ps: PackedScene = load("res://scenes/player/player.tscn")
	var p: Node3D = ps.instantiate()
	add_child(p)
	await get_tree().process_frame
	var sk: Skeleton3D = p.find_children("*", "Skeleton3D", true, false)[0]
	var meshes := p.find_children("*", "MeshInstance3D", true, false)
	# --- skeleton
	var bones := []
	for b in sk.get_bone_count():
		bones.append(sk.get_bone_name(b))
	out["skeleton"] = {"name": sk.name, "bones": sk.get_bone_count(), "motion_scale": sk.motion_scale,
		"humanoid_profile_bones_present": _profile_check(sk)}
	sk.reset_bone_poses()
	var g := func(n: String) -> Vector3:
		return sk.global_transform * sk.get_bone_global_pose(sk.find_bone(n)).origin
	var head: Vector3 = g.call("Head")
	var lf: Vector3 = g.call("LeftFoot")
	var hips: Vector3 = g.call("Hips")
	var aabb := AABB()
	var first := true
	var verts := 0
	var infl := {}
	var w_bad := 0
	for m in meshes:
		var mi := m as MeshInstance3D
		var a := mi.global_transform * mi.get_aabb()
		aabb = a if first else aabb.merge(a)
		first = false
		for s in mi.mesh.get_surface_count():
			var arr := mi.mesh.surface_get_arrays(s)
			var ws: PackedFloat32Array = arr[Mesh.ARRAY_WEIGHTS] if arr[Mesh.ARRAY_WEIGHTS] != null else PackedFloat32Array()
			var nv: int = (arr[Mesh.ARRAY_VERTEX] as PackedVector3Array).size()
			verts += nv
			if ws.size() == 0:
				continue
			var per := ws.size() / nv
			for v in nv:
				var sum := 0.0
				var c := 0
				for k in per:
					var w := ws[v * per + k]
					sum += w
					if w > 0.001:
						c += 1
				infl[c] = int(infl.get(c, 0)) + 1
				if absf(sum - 1.0) > 0.01:
					w_bad += 1
	out["model"] = {"height_m": snappedf(aabb.size.y, 0.001), "aabb": [aabb.position, aabb.size], "vertices": verts,
		"influences_per_vertex": infl, "weights_not_normalised": w_bad, "head_y": snappedf(head.y, 0.01),
		"hips_y": snappedf(hips.y, 0.01), "ankle_y": snappedf(lf.y, 3)}
	# rest pose: upper-arm angle from vertical (A-pose / T-pose), elbows, feet
	var ua: Vector3 = g.call("LeftLowerArm") - g.call("LeftUpperArm")
	var la: Vector3 = g.call("LeftHand") - g.call("LeftLowerArm")
	out["rest_pose"] = {"upper_arm_from_vertical_deg": snappedf(rad_to_deg(ua.angle_to(Vector3.DOWN)), 0.1),
		"elbow_bend_deg": snappedf(rad_to_deg(ua.angle_to(la)), 0.1),
		"neck_from_vertical_deg": snappedf(rad_to_deg((g.call("Head") - g.call("Neck")).angle_to(Vector3.UP)), 0.1),
		"feet_on_ground": absf(lf.y - 0.07) < 0.06}
	# collision / centre of mass
	var shapes := []
	for cs in p.find_children("*", "CollisionShape3D", true, false):
		var c := cs as CollisionShape3D
		shapes.append({"name": c.name, "type": c.shape.get_class(), "y": snappedf(c.position.y, 0.01),
			"size": [snappedf(c.shape.get("radius") if c.shape.get("radius") != null else 0.0, 0.01), snappedf(c.shape.get("height") if c.shape.get("height") != null else 0.0, 0.01)]})
	out["collision"] = shapes
	out["centre_of_mass_est_y"] = snappedf(hips.y + 0.05, 0.01)
	out["model_forward"] = "Model node rotated 180 deg: mesh faces +Z, body forward = -Z (Godot convention)"
	# animations
	var anims := {}
	for lib_path in ["res://assets/characters/animations/player_mocap.res", "res://assets/characters/animations/player_anims.res"]:
		var lib: AnimationLibrary = load(lib_path)
		for n in lib.get_animation_list():
			var an := lib.get_animation(n)
			var root_motion := false
			for t in an.get_track_count():
				if String(an.track_get_path(t)).ends_with(":Root"):
					root_motion = true
			anims[n] = {"lib": lib_path.get_file(), "len": snappedf(an.length, 0.001), "tracks": an.get_track_count(),
				"loop": an.loop_mode != Animation.LOOP_NONE, "root_track": root_motion}
	out["animations"] = anims
	var rep: Variant = JSON.parse_string(FileAccess.get_file_as_string("res://data/mocap_report.json"))
	var arms := {}
	if rep is Dictionary:
		for k in rep:
			if rep[k] is Dictionary and (rep[k] as Dictionary).has("arms"):
				arms[k] = rep[k]["arms"]
		arms["idle"] = rep.get("arms_idle")
	out["arm_clearance_mocap"] = arms
	var f := FileAccess.open("res://docs/reports/character_audit.json", FileAccess.WRITE)
	f.store_string(JSON.stringify(out, " "))
	print("AUDIT ", JSON.stringify(out))
	get_tree().quit()


func _profile_check(sk: Skeleton3D) -> Dictionary:
	var prof := SkeletonProfileHumanoid.new()
	var missing := []
	for i in prof.bone_size:
		if sk.find_bone(prof.get_bone_name(i)) < 0:
			missing.append(prof.get_bone_name(i))
	return {"total": prof.bone_size, "missing": missing}
