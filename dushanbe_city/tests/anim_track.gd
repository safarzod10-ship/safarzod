extends Node3D
func _ready() -> void:
	var inst: Node3D = (load("res://assets/characters/player/player.glb") as PackedScene).instantiate()
	add_child(inst)
	var ap: AnimationPlayer = inst.find_children("*", "AnimationPlayer", true, false)[0]
	ap.add_animation_library("p", load("res://assets/characters/animations/player_mocap.res"))
	var sk: Skeleton3D = inst.find_children("*", "Skeleton3D", true, false)[0]
	for an: String in ["p/run"]:
		ap.play(an)
		var L := ap.get_animation(an).length
		var line: String = an + ": "
		for i in 24:
			ap.seek(L * i / 24.0, true)
			var h := sk.global_transform * sk.get_bone_global_pose(sk.find_bone("Hips")).origin
			var t := sk.global_transform * sk.get_bone_global_pose(sk.find_bone("LeftToes")).origin
			var w := sk.global_transform * sk.get_bone_global_pose(sk.find_bone("RightHand")).origin
			var w2 := sk.global_transform * sk.get_bone_global_pose(sk.find_bone("LeftHand")).origin
			var lf := sk.global_transform * sk.get_bone_global_pose(sk.find_bone("LeftFoot")).origin
			var rf := sk.global_transform * sk.get_bone_global_pose(sk.find_bone("RightFoot")).origin
			line += "%.2fs L(%.2f,%.2f) R(%.2f,%.2f) | " % [L * i / 24.0, lf.z, lf.y, rf.z, rf.y]
		print(line)
	get_tree().quit()
