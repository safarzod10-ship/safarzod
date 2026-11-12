extends Node3D
## Compares neck/head lean of the UAL mannequin vs our player for the same retargeted clips,
## plus rest-pose lean of both skeletons.
func _ready() -> void:
	var lib: AnimationLibrary = load("res://assets/characters/animations/player_anims.res")
	for path: String in ["res://assets/characters/animations/ual_standard.glb", "res://assets/characters/player/player.glb"]:
		var inst: Node3D = (load(path) as PackedScene).instantiate()
		add_child(inst)
		var ap: AnimationPlayer = inst.find_children("*", "AnimationPlayer", true, false)[0]
		if not ap.has_animation_library(&"p"):
			ap.add_animation_library(&"p", lib)
		var sk: Skeleton3D = inst.find_children("*", "Skeleton3D", true, false)[0]
		var line: String = path.get_file() + "  REST: " + _lean(sk, true)
		print(line)
		for an: String in ["p/idle", "p/walk", "p/jog", "p/jump_air"]:
			ap.play(an)
			ap.seek(0.3, true)
			print("   ", an, ": ", _lean(sk, false))
		inst.queue_free()
	get_tree().quit()

func _lean(sk: Skeleton3D, rest: bool) -> String:
	var s := ""
	for pair in [["Hips", "Spine"], ["Spine", "Chest"], ["Chest", "UpperChest"], ["UpperChest", "Neck"], ["Neck", "Head"]]:
		var ia := sk.find_bone(pair[0])
		var ib := sk.find_bone(pair[1])
		var a := (sk.get_bone_global_rest(ia) if rest else sk.get_bone_global_pose(ia)).origin
		var b := (sk.get_bone_global_rest(ib) if rest else sk.get_bone_global_pose(ib)).origin
		var d := (b - a).normalized()
		s += "%s %.0f° " % [pair[1], rad_to_deg(atan2(d.z, d.y))]   # character faces +Z in skeleton space
	return s
