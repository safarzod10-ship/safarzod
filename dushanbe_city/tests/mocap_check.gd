extends Node3D
## Validates built mocap cycles on the player skeleton: stance-foot velocity (should be -speed along
## +Z travel, i.e. moving backwards), ankle min height (ground contact) per clip.
func _ready() -> void:
	var inst: Node3D = (load("res://assets/characters/player/player.glb") as PackedScene).instantiate()
	add_child(inst)
	var ap: AnimationPlayer = inst.find_children("*", "AnimationPlayer", true, false)[0]
	ap.add_animation_library(&"m", load("res://assets/characters/animations/player_mocap.res"))
	var sk: Skeleton3D = inst.find_children("*", "Skeleton3D", true, false)[0]
	for an: String in ["m/idle", "m/walk", "m/run", "m/jump_start", "m/jump_air", "m/jump_land"]:
		var a := ap.get_animation(an)
		ap.play(an)
		var n := 120
		var lf: Array = []
		var amin := 9.0
		var hy := 0.0
		for i in n + 1:
			ap.seek(a.length * i / n, true)
			var p := sk.get_bone_global_pose(sk.find_bone("LeftFoot")).origin
			var q := sk.get_bone_global_pose(sk.find_bone("RightFoot")).origin
			lf.append(p)
			amin = minf(amin, minf(p.y, q.y))
			hy += sk.get_bone_global_pose(sk.find_bone("Hips")).origin.y / (n + 1)
		var vz := []
		for i in range(1, lf.size()):
			if lf[i].y < amin + 0.03:
				vz.append((lf[i].z - lf[i - 1].z) / (a.length / n))
		vz.sort()
		print("MC %s len=%.3f ankle_min=%.3f hips_avg=%.3f stance vz median=%s n=%d" % [an, a.length, amin, hy, str(vz[vz.size() / 2]) if vz.size() > 0 else "-", vz.size()])
	get_tree().quit()
