extends Node3D
## Measures the true ground speed of in-place walk/run cycles (flat-foot stance ankle velocity).
func _ready() -> void:
	var inst: Node3D = (load("res://assets/characters/player/player.glb") as PackedScene).instantiate()
	add_child(inst)
	var ap: AnimationPlayer = inst.find_children("*", "AnimationPlayer", true, false)[0]
	var sk: Skeleton3D = inst.find_children("*", "Skeleton3D", true, false)[0]
	for an in ["walk", "run"]:
		var a := ap.get_animation(an)
		ap.play(an)
		var L := a.length
		var n := 400
		var rec := []
		for i in n + 1:
			ap.seek(L * i / n, true)
			var r := []
			for b in ["foot.L", "toe.L", "foot.R", "toe.R"]:
				r.append(sk.global_transform * sk.get_bone_global_pose(sk.find_bone(b)).origin)
			rec.append(r)
		var amin := 9.0
		var tmin := 9.0
		for r in rec:
			amin = minf(amin, minf(r[0].y, r[2].y)); tmin = minf(tmin, minf(r[1].y, r[3].y))
		var acc := 0.0
		var cnt := 0
		for i in range(1, rec.size()):
			for k in [0, 2]:
				if rec[i][k].y < amin + 0.015 and rec[i][k + 1].y < tmin + 0.015:
					acc += (rec[i][k] - rec[i - 1][k]).z / (L / n)
					cnt += 1
		print("ANIM %s len=%.4f ground_speed=%.4f m/s (n=%d)" % [an, L, -acc / cnt, cnt])
	get_tree().quit()
