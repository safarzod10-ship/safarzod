extends Node3D
## Measures the retargeted cycles on the player: ground speed (flat-foot ankle velocity), stance
## ankle height vs idle, and jump_start take-off time (when the feet leave the ground).
func _ready() -> void:
	var inst: Node3D = (load("res://assets/characters/player/player.glb") as PackedScene).instantiate()
	add_child(inst)
	var ap: AnimationPlayer = inst.find_children("*", "AnimationPlayer", true, false)[0]
	ap.add_animation_library("p", load("res://assets/characters/animations/player_anims.res"))
	var sk: Skeleton3D = inst.find_children("*", "Skeleton3D", true, false)[0]
	for an in ["p/idle", "p/walk", "p/jog", "p/sprint", "p/jump_start", "p/jump_land", "p/punch_jab"]:
		var a := ap.get_animation(an)
		ap.play(an)
		var L := a.length
		var n := 300
		var rec := []
		for i in n + 1:
			ap.seek(L * i / n, true)
			var r := []
			for b in ["LeftFoot", "LeftToes", "RightFoot", "RightToes", "Hips"]:
				r.append(sk.global_transform * sk.get_bone_global_pose(sk.find_bone(b)).origin)
			rec.append(r)
		var amin := 9.0
		var tmin := 9.0
		var hmin := 9.0
		var hmax := -9.0
		for r in rec:
			amin = minf(amin, minf(r[0].y, r[2].y)); tmin = minf(tmin, minf(r[1].y, r[3].y))
			hmin = minf(hmin, r[4].y); hmax = maxf(hmax, r[4].y)
		var acc := 0.0
		var cnt := 0
		var dirv := Vector3.ZERO
		for i in range(1, rec.size()):
			for k in [0, 2]:
				if rec[i][k].y < amin + 0.015 and rec[i][k + 1].y < tmin + 0.015:
					var v: Vector3 = (rec[i][k] - rec[i - 1][k]) / (L / n)
					acc += Vector2(v.x, v.z).length()
					dirv += v
					cnt += 1
		# mid-stance speed: frames where a foot is the lower one and within 3 cm of the minimum
		var sp := []
		for i in range(1, rec.size()):
			var k := 0 if rec[i][0].y < rec[i][2].y else 2
			if rec[i][k].y < amin + 0.03:
				var v: Vector3 = (rec[i][k] - rec[i - 1][k]) / (L / n)
				sp.append(Vector2(v.x, v.z).length())
		sp.sort()
		var med: float = sp[sp.size() / 2] if sp.size() > 0 else 0.0
		# contiguous stance segments per foot: slope of z over time
		var segs := []
		for k in [0, 2]:
			var start := -1
			for i in rec.size() + 1:
				var on: bool = i < rec.size() and rec[i][k].y < amin + 0.04
				if on and start < 0:
					start = i
				elif not on and start >= 0:
					if i - 1 - start >= 6:
						var dz: float = rec[i - 1][k].z - rec[start][k].z
						segs.append(absf(dz) / ((i - 1 - start) * L / n))
					start = -1
		var sm := 0.0
		for v in segs:
			sm += v
		print("   %s STANCE_SPEED=%.3f segments=%d" % [an, sm / maxf(segs.size(), 1), segs.size()])
		var hz0: float = rec[0][4].z
		var hzmin := 99.0
		var hzmax := -99.0
		for r in rec:
			hzmin = minf(hzmin, r[4].z - hz0); hzmax = maxf(hzmax, r[4].z - hz0)
		print("   %s midstance median speed=%.3f n=%d  hips dz range %.3f..%.3f end=%.3f" % [an, med, sp.size(), hzmin, hzmax, rec[rec.size()-1][4].z - hz0])
		var lift := -1.0
		for i in rec.size():
			if minf(rec[i][1].y, rec[i][3].y) > tmin + 0.05:
				lift = L * i / n
				break
		print("ANIM %s len=%.3f ground_speed=%.3f (n=%d dir=%s) ankle_min=%.3f toe_min=%.3f hips %.3f..%.3f first_toes_off=%.3f" % [an, L, acc / maxf(cnt, 1), cnt, str((dirv / maxf(cnt, 1)).snapped(Vector3.ONE * 0.01)), amin, tmin, hmin, hmax, lift])
	get_tree().quit()
