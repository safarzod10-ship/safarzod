extends SceneTree
func _init() -> void:
	for p in ["res://assets/characters/player/player.glb", "res://assets/characters/animations/cmu/16_15.glb"]:
		var n: Node = (load(p) as PackedScene).instantiate()
		var sk: Skeleton3D = n.find_children("*", "Skeleton3D", true, false)[0]
		var names := []
		for i in mini(sk.get_bone_count(), 12):
			names.append(sk.get_bone_name(i))
		print(p, " skeleton=", sk.name, " bones=", sk.get_bone_count(), " ", names)
		var ap: AnimationPlayer = n.find_children("*", "AnimationPlayer", true, false)[0]
		var a := ap.get_animation(ap.get_animation_list()[1])
		print("  anim ", ap.get_animation_list()[1], " tracks=", a.get_track_count(), " t0=", a.track_get_path(0), " t1=", a.track_get_path(1))
		n.free()
	quit()
