extends Node
## Builds the player's locomotion AnimationLibrary from CMU motion-capture clips (retargeted at import
## to %GeneralSkeleton via BoneMap -> SkeletonProfileHumanoid).
##
## Every clip is evaluated ON OUR PLAYER SKELETON (its proportions) to:
##   * locomotion: find left-foot strikes, take one full gait cycle from the steady middle part,
##     measure ground speed from the hips displacement, remove root translation (in-place),
##     rotate the heading to +Z (character forward), close the loop (cross-fade last 15 %);
##   * idle: a standing segment, looped with a cross-fade;
##   * jump: detect take-off / touch-down from the toes, cut push-off, air and landing phases,
##     remove the ballistic hips rise in the air phase (physics moves the body).
## Writes res://assets/characters/animations/player_mocap.res and prints measured speeds as JSON.
## Run: godot --headless --path . res://scenes/testing/build_mocap.tscn -- [list=1]

const OUT := "res://assets/characters/animations/player_mocap.res"
const DIR := "res://assets/characters/animations/cmu/"
const FPS := 120.0

var player: Node3D
var ap: AnimationPlayer
var sk: Skeleton3D
var report := {}


## CMU clavicle channels are noisy and, retargeted onto our straight-rest rig, lift the shoulders
## into a permanent shrug: the clavicles keep the rig's natural rest pose instead.
const SKIP_BONES := ["LeftShoulder", "RightShoulder"]

func _ready() -> void:
	player = (load("res://assets/characters/player/player.glb") as PackedScene).instantiate()
	add_child(player)
	ap = player.find_children("*", "AnimationPlayer", true, false)[0]
	sk = player.find_children("*", "Skeleton3D", true, false)[0]
	var args := OS.get_cmdline_user_args()
	if args.has("trace"):
		var a := _src(OS.get_cmdline_user_args()[-1] if OS.get_cmdline_user_args().size() > 1 else "35_17")
		var s := _sample(a)
		var line := ""
		for i in range(0, s.size(), 6):
			line += "%.2f:%.3f/%.3f h%.2f,%.2f  " % [s[i]["t"], s[i]["lf"].y, s[i]["rf"].y, s[i]["hips"].z, s[i]["hips"].y]
		print("TRACE ", line)
		print("tracks: ", a.get_track_count(), " ", a.track_get_path(0), " type ", a.track_get_type(0))
		get_tree().quit()
		return
	if args.has("list"):
		for f in ["132_17", "132_18", "91_17", "81_04", "07_12", "16_15", "16_16", "35_01", "16_35", "16_36", "35_17", "35_18"]:
			var a := _src(f)
			var c := _find_cycle(a, f)
			print("CYCLE ", f, " ", c)
		get_tree().quit()
		return
	var lib := AnimationLibrary.new()
	var picks: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://data/mocap_picks.json"))
	var ankle_ref := _rest_ankle()
	for key in ["walk", "run"]:
		var f: String = picks[key]
		var a := _src(f)
		var c := _find_cycle(a, f)
		var anim := _make_cycle(a, c)
		var dy := _ground(anim, ankle_ref)
		var warp := _contact_warp(anim)
		anim = warp["anim"]
		var lat := _lateral_lock(anim)
		lib.add_animation(key, anim)
		report[key] = {"clip": f, "hips_speed": c["speed"], "contact_speed": warp["speed"], "cycle_s": anim.length,
			"cycle_s_src": warp["src_len"], "ground_offset": dy, "warp_range": warp["range"], "contact_p25_p75_after": warp["after_p25_p75"], "lateral_lock": lat}
	var jf: String = picks["jump"]
	var ja := _src(jf)
	var j := _find_jump(ja)
	report["jump"] = {"clip": jf} .merged(j)
	var js := _segment(ja, j["takeoff"] - picks.get("jump_prep", 0.55), j["takeoff"], false, false)
	var jdy := _ground(js, ankle_ref, false)
	var jair := _segment(ja, j["takeoff"], j["touchdown"], false, true)
	_shift_hips(jair, jdy)
	var jl := _segment(ja, j["touchdown"], j["touchdown"] + picks.get("land_len", 0.75), false, false)
	_ground(jl, ankle_ref, false)
	lib.add_animation("jump_start", js)
	lib.add_animation("jump_air", jair)
	lib.add_animation("jump_land", jl)
	var idf: String = picks["idle"]
	var ia := _src(idf)
	var idle := _loop_segment(ia, picks.get("idle_t0", 0.1), picks.get("idle_t1", 1.6))
	report["idle_offset"] = _ground(idle, ankle_ref, false)
	lib.add_animation("idle", idle)
	ResourceSaver.save(lib, OUT)
	var fo := FileAccess.open("res://data/mocap_report.json", FileAccess.WRITE)
	fo.store_string(JSON.stringify(report, " "))
	report["motion_scale"] = sk.motion_scale
	print("MOCAP_DONE ", JSON.stringify(report))
	get_tree().quit()


func _src(f: String) -> Animation:
	var n: Node = (load(DIR + f + ".glb") as PackedScene).instantiate()
	var p: AnimationPlayer = n.find_children("*", "AnimationPlayer", true, false)[0]
	var a: Animation = p.get_animation(p.get_animation_list()[0] if p.get_animation_list()[0] != "RESET" else p.get_animation_list()[1]).duplicate(true)
	n.free()
	return a


func _pose_at(a: Animation, t: float) -> void:
	## Apply the animation to our skeleton at time t (rotation tracks + hips position).
	sk.reset_bone_poses()
	for tr in a.get_track_count():
		var path := String(a.track_get_path(tr))
		var bone := sk.find_bone(path.get_slice(":", 1))
		if bone < 0:
			continue
		match a.track_get_type(tr):
			Animation.TYPE_ROTATION_3D:
				sk.set_bone_pose_rotation(bone, a.rotation_track_interpolate(tr, t))
			Animation.TYPE_POSITION_3D:
				sk.set_bone_pose_position(bone, a.position_track_interpolate(tr, t) * sk.motion_scale)


func _pos(b: String) -> Vector3:
	return sk.get_bone_global_pose(sk.find_bone(b)).origin


func _sample(a: Animation) -> Array:
	var out := []
	var n := int(a.length * FPS)
	for i in n:
		var t := i / FPS
		_pose_at(a, t)
		out.append({"t": t, "hips": _pos("Hips"), "lf": _pos("LeftFoot"), "rf": _pos("RightFoot"),
			"lt": _pos("LeftToes"), "rt": _pos("RightToes")})
	return out


func _find_cycle(a: Animation, f: String) -> Dictionary:
	var s := _sample(a)
	var ys: Array[float] = []
	for x in s:
		ys.append(x["lf"].y)
	var sorted_y := ys.duplicate()
	sorted_y.sort()
	var p10: float = sorted_y[int(sorted_y.size() * 0.1)]
	# left-foot strikes: local minima of the foot height (window +-0.12 s) near the low percentile,
	# at least 0.35 s apart; skip the first/last 0.1 s (edge frames of a capture are unreliable)
	var strikes: Array[int] = []
	var w := int(0.12 * FPS)
	for i in range(int(0.1 * FPS), s.size() - int(0.1 * FPS)):
		if ys[i] > p10 + 0.04:
			continue
		var is_min := true
		for k in range(maxi(0, i - w), mini(s.size(), i + w + 1)):
			if ys[k] < ys[i]:
				is_min = false
				break
		if is_min and (strikes.is_empty() or i - strikes[-1] > int(0.35 * FPS)):
			strikes.append(i)
	if strikes.size() < 2:
		return {"error": "strikes %d" % strikes.size(), "speed": 0.0, "t0": 0.0, "t1": a.length}
	# choose the cycle closest to the middle of the clip (steady state)
	var best := 0
	var mid := s.size() / 2
	for k in range(strikes.size() - 1):
		if absi((strikes[k] + strikes[k + 1]) / 2 - mid) < absi((strikes[best] + strikes[best + 1]) / 2 - mid):
			best = k
	var i0 := strikes[best]
	var i1 := strikes[best + 1]
	var d: Vector3 = s[i1]["hips"] - s[i0]["hips"]
	d.y = 0.0
	var dt := (i1 - i0) / FPS
	return {"t0": s[i0]["t"], "t1": s[i1]["t"], "speed": snappedf(d.length() / dt, 0.001), "dir": [d.normalized().x, d.normalized().z],
		"strikes": strikes.size()}


func _make_cycle(a: Animation, c: Dictionary) -> Animation:
	var t0: float = c["t0"]
	var t1: float = c["t1"]
	var dir := Vector3(c["dir"][0], 0, c["dir"][1])
	var yaw := Quaternion(Vector3.UP, atan2(dir.x, dir.z)).inverse()   # rotate travel direction onto +Z
	_pose_at(a, t0)
	var h0 := _pos("Hips")
	_pose_at(a, t1)
	var h1 := _pos("Hips")
	var cyc := _resample(a, t0, t1, yaw, func(t: float, p: Vector3) -> Vector3:
		var drift := h0.lerp(h1, (t - t0) / (t1 - t0)) / sk.motion_scale
		return Vector3(p.x - drift.x, p.y, p.z - drift.z))
	_close_loop(cyc)
	return cyc


func _find_jump(a: Animation) -> Dictionary:
	var s := _sample(a)
	var tmin := 9.0
	for x in s:
		tmin = minf(tmin, minf(x["lt"].y, x["rt"].y))
	var take := -1
	var touch := -1
	for i in s.size():
		var low := minf(s[i]["lt"].y, s[i]["rt"].y)
		if take < 0 and low > tmin + 0.05:
			take = i
		elif take >= 0 and touch < 0 and low < tmin + 0.03 and i > take + 10:
			touch = i
	return {"takeoff": s[take]["t"] if take >= 0 else 0.0, "touchdown": s[touch]["t"] if touch >= 0 else 0.0,
		"air_s": (touch - take) / FPS if take >= 0 and touch >= 0 else 0.0}


func _segment(a: Animation, t0: float, t1: float, loop: bool, flatten_air: bool) -> Animation:
	t0 = maxf(t0, 0.0)
	t1 = minf(t1, a.length)
	_pose_at(a, t0)
	var h0 := _pos("Hips")
	var hn := h0 / sk.motion_scale
	var r := _resample(a, t0, t1, Quaternion.IDENTITY, func(_t: float, p: Vector3) -> Vector3:
		var y := hn.y if flatten_air else p.y
		return Vector3(p.x - hn.x, y, p.z - hn.z))
	return r


func _loop_segment(a: Animation, t0: float, t1: float) -> Animation:
	_pose_at(a, t0)
	var h0 := _pos("Hips")
	var hn := h0 / sk.motion_scale
	var lp := _resample(a, t0, t1, Quaternion.IDENTITY, func(_t: float, p: Vector3) -> Vector3:
		return Vector3(p.x - hn.x, p.y, p.z - hn.z))
	_close_loop(lp)
	return lp


func _resample(a: Animation, t0: float, t1: float, yaw: Quaternion, pos_fn: Callable) -> Animation:
	## New animation sampled at 60 Hz from [t0, t1]; hips rotation/position re-oriented by yaw,
	## hips position remapped by pos_fn; loops get the last 15 % cross-faded into the first frame.
	var out := Animation.new()
	var L := t1 - t0
	out.length = L
	var step := 1.0 / 60.0
	for tr in a.get_track_count():
		var path := a.track_get_path(tr)
		var bone := String(path).get_slice(":", 1)
		if bone == "Root" or sk.find_bone(bone) < 0 or bone in SKIP_BONES:
			continue
		var typ := a.track_get_type(tr)
		if typ != Animation.TYPE_ROTATION_3D and typ != Animation.TYPE_POSITION_3D:
			continue
		var nt := out.add_track(typ)
		out.track_set_path(nt, path)
		out.track_set_interpolation_type(nt, Animation.INTERPOLATION_LINEAR)
		var t := 0.0
		while t <= L + 0.0001:
			var st := t0 + t
			if typ == Animation.TYPE_ROTATION_3D:
				var q := a.rotation_track_interpolate(tr, st)
				if bone == "Hips":
					q = yaw * q
				out.rotation_track_insert_key(nt, t, q.normalized())
			else:
				var p := a.position_track_interpolate(tr, st)
				p = pos_fn.call(st, p)
				if bone == "Hips":
					p = yaw * p
				out.position_track_insert_key(nt, t, p)
			t += step
	return out


func _close_loop(an: Animation) -> void:
	## Cross-fade the last 15 % of every track into its first key so the loop has no pop.
	an.loop_mode = Animation.LOOP_LINEAR
	var L := an.length
	for tr in an.get_track_count():
		var n := an.track_get_key_count(tr)
		if n < 3:
			continue
		var first: Variant = an.track_get_key_value(tr, 0)
		for k in n:
			var t := an.track_get_key_time(tr, k)
			if t < L * 0.85:
				continue
			var w := smoothstep(0.0, 1.0, (t - L * 0.85) / (L * 0.15))
			var v: Variant = an.track_get_key_value(tr, k)
			if v is Quaternion:
				an.track_set_key_value(tr, k, (v as Quaternion).slerp(first, w))
			elif v is Vector3:
				an.track_set_key_value(tr, k, (v as Vector3).lerp(first, w))


func _rest_ankle() -> float:
	sk.reset_bone_poses()
	return minf(_pos("LeftFoot").y, _pos("RightFoot").y)


func _anim_eval(an: Animation, t: float) -> void:
	sk.reset_bone_poses()
	for tr in an.get_track_count():
		var bone := sk.find_bone(String(an.track_get_path(tr)).get_slice(":", 1))
		if bone < 0:
			continue
		if an.track_get_type(tr) == Animation.TYPE_ROTATION_3D:
			sk.set_bone_pose_rotation(bone, an.rotation_track_interpolate(tr, t))
		elif an.track_get_type(tr) == Animation.TYPE_POSITION_3D:
			sk.set_bone_pose_position(bone, an.position_track_interpolate(tr, t) * sk.motion_scale)


func _ground(an: Animation, ankle_ref: float, by_sole := true) -> float:
	## Shift the hips so the lowest SOLE point of the clip (heel under the ankle / ball under the toe
	## joint, taken from the rest pose) touches y = 0: feet neither float nor sink into the asphalt.
	var local := []
	for f in [["LeftFoot", "LeftToes"], ["RightFoot", "RightToes"]]:
		var fr := sk.get_bone_global_rest(sk.find_bone(f[0]))
		var tr := sk.get_bone_global_rest(sk.find_bone(f[1]))
		local.append([f[0], fr.affine_inverse() * Vector3(fr.origin.x, 0.0, fr.origin.z), f[1], tr.affine_inverse() * Vector3(tr.origin.x, 0.0, tr.origin.z)])
	var cmin := 9.0
	var n := 90
	if not by_sole:   # standing clips: flat feet -> ankle at its rest height
		var amin := 9.0
		for i in n + 1:
			_anim_eval(an, an.length * i / n)
			amin = minf(amin, minf(_pos("LeftFoot").y, _pos("RightFoot").y))
		_shift_hips(an, ankle_ref - amin)
		return snappedf(ankle_ref - amin, 0.001)
	for i in n + 1:
		_anim_eval(an, an.length * i / n)
		for l in local:
			var heel := sk.get_bone_global_pose(sk.find_bone(l[0])) * (l[1] as Vector3)
			var ball := sk.get_bone_global_pose(sk.find_bone(l[2])) * (l[3] as Vector3)
			cmin = minf(cmin, minf(heel.y, ball.y))
	var dy := -cmin
	_shift_hips(an, dy)
	return snappedf(dy, 0.001)


func _shift_hips(an: Animation, dy: float) -> void:
	for tr in an.get_track_count():
		if an.track_get_type(tr) == Animation.TYPE_POSITION_3D and String(an.track_get_path(tr)).ends_with(":Hips"):
			for k in an.track_get_key_count(tr):
				an.track_set_key_value(tr, k, an.track_get_key_value(tr, k) + Vector3(0, dy / sk.motion_scale, 0))


func _stance_speed(an: Animation) -> float:
	## Ground speed = speed of the planted foot: per contact segment (ankle within 2 cm of its
	## minimum) a least-squares slope of the foot's z over time; mean over both feet.
	var n := 240
	var data := {"LeftFoot": [], "RightFoot": []}
	var amin := 9.0
	for i in n:
		var t := an.length * i / n
		_anim_eval(an, t)
		for b in data:
			var p := _pos(b)
			data[b].append([t, p.z, p.y])
			amin = minf(amin, p.y)
	var slopes: Array[float] = []
	for b in data:
		var seg: Array = []
		for i in n + 1:
			var on: bool = i < n and data[b][i][2] < amin + 0.02
			if on:
				seg.append(data[b][i])
			elif seg.size() >= 6:
				var mt := 0.0
				var mz := 0.0
				for e in seg:
					mt += e[0]; mz += e[1]
				mt /= seg.size(); mz /= seg.size()
				var num := 0.0
				var den := 0.0
				for e in seg:
					num += (e[0] - mt) * (e[1] - mz); den += (e[0] - mt) * (e[0] - mt)
				slopes.append(absf(num / den))
				seg = []
			else:
				seg = []
	var sm := 0.0
	for v in slopes:
		sm += v
	return snappedf(sm / maxf(slopes.size(), 1), 0.001)


func _contact_curve(an: Animation, n: int) -> Array:
	## Backward speed of the current contact point (heel under the ankle / ball under the toe joint of
	## the lower foot) at n samples; -1 where no foot touches the ground (flight phase).
	var local := []
	for f in [["LeftFoot", "LeftToes"], ["RightFoot", "RightToes"]]:
		var fr := sk.get_bone_global_rest(sk.find_bone(f[0]))
		var tr := sk.get_bone_global_rest(sk.find_bone(f[1]))
		local.append([f[0], fr.affine_inverse() * Vector3(fr.origin.x, 0.0, fr.origin.z), f[1], tr.affine_inverse() * Vector3(tr.origin.x, 0.0, tr.origin.z)])
	var pts := []
	for i in n + 1:
		_anim_eval(an, an.length * i / n)
		var best := Vector3(0, 99, 0)
		var key := ""
		for li in local.size():
			var l: Array = local[li]
			var heel := sk.get_bone_global_pose(sk.find_bone(l[0])) * (l[1] as Vector3)
			var ball := sk.get_bone_global_pose(sk.find_bone(l[2])) * (l[3] as Vector3)
			if heel.y < best.y:
				best = heel; key = "%d0" % li
			if ball.y < best.y:
				best = ball; key = "%d1" % li
		pts.append([best, key])
	var dt := an.length / n
	var c: Array[float] = []
	for i in n:
		var a: Array = pts[i]
		var b: Array = pts[i + 1]
		if a[1] == b[1] and (a[0] as Vector3).y < 0.025:
			c.append(-((b[0] as Vector3).z - (a[0] as Vector3).z) / dt)
		else:
			c.append(-1.0)
	return c


func _contact_points(an: Animation, n: int) -> Array:
	## [point, key] of the lowest sole point (heel/ball of either foot) at n + 1 samples
	var local := []
	for f in [["LeftFoot", "LeftToes"], ["RightFoot", "RightToes"]]:
		var fr := sk.get_bone_global_rest(sk.find_bone(f[0]))
		var tr := sk.get_bone_global_rest(sk.find_bone(f[1]))
		local.append([f[0], fr.affine_inverse() * Vector3(fr.origin.x, 0.0, fr.origin.z), f[1], tr.affine_inverse() * Vector3(tr.origin.x, 0.0, tr.origin.z)])
	var pts := []
	for i in n + 1:
		_anim_eval(an, an.length * i / n)
		var best := Vector3(0, 99, 0)
		var key := ""
		for li in local.size():
			var l: Array = local[li]
			var heel := sk.get_bone_global_pose(sk.find_bone(l[0])) * (l[1] as Vector3)
			var ball := sk.get_bone_global_pose(sk.find_bone(l[2])) * (l[3] as Vector3)
			if heel.y < best.y:
				best = heel; key = "%d0" % li
			if ball.y < best.y:
				best = ball; key = "%d1" % li
		pts.append([best, key])
	return pts


func _lateral_rms(an: Animation, n: int) -> float:
	var pts := _contact_points(an, n)
	var dt := an.length / n
	var acc := 0.0
	var cnt := 0
	for i in n:
		if pts[i][1] == pts[i + 1][1] and (pts[i][0] as Vector3).y < 0.025:
			var v := ((pts[i + 1][0] as Vector3).x - (pts[i][0] as Vector3).x) / dt
			acc += v * v; cnt += 1
	return snappedf(sqrt(acc / maxf(cnt, 1)), 0.001)


func _lateral_lock(an: Animation) -> Dictionary:
	## The retargeted legs do not fully cancel the source's hip sway, so the planted sole drifts
	## sideways (±2-3 cm per step). Integrate the contact point's sideways velocity during stance and
	## shift the hips by the opposite amount (periodic, drift-free, smoothed): the stance foot stays put.
	var n := 240
	var before := _lateral_rms(an, n)
	var pts := _contact_points(an, n)
	var dt := an.length / n
	var corr: Array[float] = [0.0]
	for i in n:
		var d := 0.0
		if pts[i][1] == pts[i + 1][1] and (pts[i][0] as Vector3).y < 0.025:
			d = -((pts[i + 1][0] as Vector3).x - (pts[i][0] as Vector3).x)
		corr.append(corr[i] + d)
	var end := corr[n]
	var mean := 0.0
	for i in n + 1:
		corr[i] -= end * i / n
		mean += corr[i]
	mean /= n + 1
	for i in n + 1:
		corr[i] -= mean
	var sm: Array[float] = []
	for i in n + 1:
		var a := 0.0
		for k in range(-3, 4):
			a += corr[posmod(i + k, n)]
		sm.append(a / 7.0)
	for tr in an.get_track_count():
		if an.track_get_type(tr) == Animation.TYPE_POSITION_3D and String(an.track_get_path(tr)).ends_with(":Hips"):
			for k in an.track_get_key_count(tr):
				var t := an.track_get_key_time(tr, k)
				var x := clampf(t / an.length * n, 0.0, n)
				var i0 := mini(int(x), n - 1)
				var c := lerpf(sm[i0], sm[i0 + 1], x - i0)
				an.track_set_key_value(tr, k, an.track_get_key_value(tr, k) + Vector3(c / sk.motion_scale, 0, 0))
	var amp := 0.0
	for v in sm:
		amp = maxf(amp, absf(v))
	return {"rms_before": before, "rms_after": _lateral_rms(an, n), "max_shift_m": snappedf(amp, 0.001)}


func _contact_warp(an: Animation) -> Dictionary:
	## Time-warp the cycle so the contact point moves backwards at a CONSTANT speed: then a body moving
	## at that constant speed has a perfectly planted sole (no sliding at any phase of the stance).
	var n := 240
	var c := _contact_curve(an, n)
	var vals: Array[float] = []
	for v in c:
		if v > 0.2:
			vals.append(v)
	vals.sort()
	var cbar: float = vals[vals.size() / 2]
	# factor f = c/cbar where in contact (clamped + smoothed), 1 in flight
	var f: Array[float] = []
	for v in c:
		f.append(clampf(v / cbar, 0.6, 1.6) if v > 0.2 else 1.0)
	for it in 2:   # light smoothing (circular)
		var g := f.duplicate()
		for i in n:
			f[i] = (g[(i - 1 + n) % n] + 2.0 * g[i] + g[(i + 1) % n]) / 4.0
	var dt := an.length / n
	var tau: Array[float] = [0.0]
	for i in n:
		tau.append(tau[-1] + f[i] * dt)
	var L2: float = tau[-1]
	var out := Animation.new()
	out.length = L2
	out.loop_mode = Animation.LOOP_LINEAR
	var step := 1.0 / 60.0
	for tr in an.get_track_count():
		var nt := out.add_track(an.track_get_type(tr))
		out.track_set_path(nt, an.track_get_path(tr))
		out.track_set_interpolation_type(nt, Animation.INTERPOLATION_LINEAR)
		var t2 := 0.0
		var j := 0
		while t2 <= L2 + 0.0001:
			while j < n - 1 and tau[j + 1] < t2:
				j += 1
			var w := clampf((t2 - tau[j]) / maxf(tau[j + 1] - tau[j], 1e-6), 0.0, 1.0)
			var t := (j + w) * dt
			if an.track_get_type(tr) == Animation.TYPE_ROTATION_3D:
				out.rotation_track_insert_key(nt, t2, an.rotation_track_interpolate(tr, t))
			else:
				out.position_track_insert_key(nt, t2, an.position_track_interpolate(tr, t))
			t2 += step
	var fmin := 9.0
	var fmax := 0.0
	for v in f:
		fmin = minf(fmin, v); fmax = maxf(fmax, v)
	# verify: contact speed spread after the warp
	var c2 := _contact_curve(out, n)
	var v2: Array[float] = []
	for v in c2:
		if v > 0.2:
			v2.append(v)
	v2.sort()
	return {"anim": out, "speed": snappedf(cbar, 0.001), "src_len": an.length, "range": [snappedf(fmin, 0.01), snappedf(fmax, 0.01)],
		"after_p25_p75": [snappedf(v2[v2.size() / 4], 0.01), snappedf(v2[v2.size() * 3 / 4], 0.01)]}
