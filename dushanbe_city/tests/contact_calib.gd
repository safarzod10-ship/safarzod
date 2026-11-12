extends Node3D
## Calibrates the ground speed of each locomotion clip from the CONTACT POINT (heel under the ankle /
## ball under the toe joint): median backward speed while the contact point is within 2 cm of the ground.
func _ready() -> void:
	var inst: Node3D = (load("res://assets/characters/player/player.glb") as PackedScene).instantiate()
	add_child(inst)
	var ap: AnimationPlayer = inst.find_children("*", "AnimationPlayer", true, false)[0]
	ap.add_animation_library(&"m", load("res://assets/characters/animations/player_mocap.res"))
	var sk: Skeleton3D = inst.find_children("*", "Skeleton3D", true, false)[0]
	var feet := {"LeftFoot": "LeftToes", "RightFoot": "RightToes"}
	var local := {}
	for f in feet:
		var fr := sk.get_bone_global_rest(sk.find_bone(f))
		var tr := sk.get_bone_global_rest(sk.find_bone(feet[f]))
		local[f] = [fr.affine_inverse() * Vector3(fr.origin.x, 0.0, fr.origin.z), tr.affine_inverse() * Vector3(tr.origin.x, 0.0, tr.origin.z)]
	for an: String in ["m/walk", "m/run"]:
		var a := ap.get_animation(an)
		ap.play(an)
		var n := 480
		var dt := a.length / n
		var prev := {}
		var sp: Array[float] = []
		var cmin := 9.0
		var pts := []
		for i in n + 1:
			ap.seek(dt * i, true)
			var row := {}
			for f in feet:
				var fx := sk.get_bone_global_pose(sk.find_bone(f))
				var tx := sk.get_bone_global_pose(sk.find_bone(feet[f]))
				var heel: Vector3 = fx * (local[f][0] as Vector3)
				var ball: Vector3 = tx * (local[f][1] as Vector3)
				row[f] = [heel, ball]
				cmin = minf(cmin, minf(heel.y, ball.y))
			pts.append(row)
		for i in range(1, pts.size()):
			for f in feet:
				for k in 2:
					var c: Vector3 = pts[i][f][k]
					var p: Vector3 = pts[i - 1][f][k]
					var other: Vector3 = pts[i][f][1 - k]
					if c.y < cmin + 0.02 and c.y <= other.y + 0.005:
						sp.append(-(c.z - p.z) / dt)
		sp.sort()
		print("CALIB %s len=%.3f contact_min=%.3f median_back_speed=%.3f p25=%.3f p75=%.3f n=%d" % [an, a.length, cmin, sp[sp.size() / 2], sp[sp.size() / 4], sp[sp.size() * 3 / 4], sp.size()])
	get_tree().quit()
