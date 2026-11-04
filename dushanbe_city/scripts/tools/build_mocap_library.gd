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
	if args.has("scanidle"):
		_torso_profile()
		for f in DirAccess.get_files_at(DIR):
			if f.ends_with(".glb"):
				_scan_idle(f.get_basename())
		get_tree().quit()
		return
	if args.has("armsdbg"):
		_torso_profile()
		var lib0: AnimationLibrary = load(OUT)
		var an: Animation = lib0.get_animation("run")
		for i in 22:
			_anim_eval(an, an.length * i / 22.0)
			for pp in _arm_points():
				var p: Vector3 = pp[1]
				var key := int(floor(p.y / 0.05))
				if _profile.has(key):
					var e: Array = _profile[key]
					var c := absf(p.x) - float(e[0]) - 0.04
					if c < 0.0 and not (p.z < float(e[1]) - 0.04 or p.z > float(e[2]) + 0.04):
						print("RUNBAD t=%.2f %s p=%s profile w=%.2f z[%.2f,%.2f] clear=%.3f" % [an.length * i / 22.0, pp[0], p.snapped(Vector3.ONE * 0.01), e[0], e[1], e[2], c])
		get_tree().quit()
		return
	if args.has("arms"):
		_torso_profile()
		var lib: AnimationLibrary = load(OUT)
		for n in lib.get_animation_list():
			print("ARMS ", n, " ", JSON.stringify(arm_clearance(lib.get_animation(n), true)))
		get_tree().quit()
		return
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
	if args.has("ual"):
		var ul: AnimationLibrary = load("res://assets/characters/animations/player_anims.res")
		for n in ["jog", "sprint"]:
			var an := ul.get_animation(n)
			var c := _contact_curve(an, 240)
			var vals: Array[float] = []
			for v in c:
				if v > 0.2:
					vals.append(v)
			vals.sort()
			print("UAL ", n, " len ", an.length, " contact speed ", vals[vals.size() / 2] if vals.size() > 0 else -1.0, " stride/cycle ", (vals[vals.size() / 2] if vals.size() > 0 else 0.0) * an.length, " arms ", JSON.stringify(arm_clearance(an, true)))
		get_tree().quit()
		return
	if args.has("list"):
		for f in ["16_16", "16_15", "35_17", "16_55", "09_01", "09_02", "09_03", "09_04", "09_05", "09_06", "09_07", "09_08", "09_09", "09_10", "09_11"]:
			var a := _src(f)
			var c := _find_cycle(a, f)
			print("CYCLE ", f, " ", c)
		get_tree().quit()
		return
	var lib := AnimationLibrary.new()
	var picks: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://data/mocap_picks.json"))
	var ankle_ref := _rest_ankle()
	for key in ["walk", "run", "run_fast"]:
		if not picks.has(key):
			continue
		var pv: Variant = picks[key]
		var f: String = pv["clip"] if pv is Dictionary else String(pv)
		var a := _src(f)
		var c := _find_cycle(a, f, pv.get("t0", -1.0) if pv is Dictionary else -1.0, pv.get("t1", -1.0) if pv is Dictionary else -1.0)
		if c.has("error"):
			report[key] = c
			continue
		var anim := _make_cycle(a, c)
		var dy := _ground(anim, ankle_ref)
		var warp := _contact_warp(anim)
		anim = warp["anim"]
		var lat := _lateral_lock(anim)
		var arms := _fix_arms(anim)
		if key == "walk":
			_FWD_YAW_REF = _facing_yaw(anim)
		lib.add_animation(key, anim)
		report[key] = {"clip": f, "hips_speed": c["speed"], "contact_speed": warp["speed"], "cycle_s": anim.length,
			"cycle_s_src": warp["src_len"], "ground_offset": dy, "warp_range": warp["range"], "contact_p25_p75_after": warp["after_p25_p75"], "lateral_lock": lat, "arms": arms}
	# directional walks (8-way locomotion): built in the TRAVEL frame (travel -> +Z: contact warp and
	# lateral lock work as for the forward walk), then turned so the BODY faces +Z again
	for key in ["walk_back", "strafe_left", "strafe_right"]:
		if not picks.has(key):
			continue
		var pk: Dictionary = picks[key]
		var a := _src(pk["clip"])
		var c := _find_cycle(a, pk["clip"], pk.get("t0", -1.0), pk.get("t1", -1.0))
		if c.has("error"):
			report[key] = c
			continue
		var anim := _make_cycle(a, c)
		var warp := _contact_warp(anim)
		anim = warp["anim"]
		var lat := _lateral_lock(anim)
		var face := _face_forward(anim)
		var dy := _ground(anim, ankle_ref)
		var arms := _fix_arms(anim)
		lib.add_animation(key, anim)
		report[key] = {"clip": pk["clip"], "hips_speed": c["speed"], "contact_speed": warp["speed"], "cycle_s": anim.length,
			"travel_dir_body": face["travel"], "turned_deg": face["deg"], "ground_offset": dy, "lateral_lock": lat, "arms": arms}
	for key in ["stop_walk", "stop_run"]:
		if not picks.has(key):
			continue
		var pk2: Dictionary = picks[key]
		var a2 := _src(pk2["clip"])
		var st := _make_stop(a2, pk2)
		var sa: Animation = st["anim"]
		_ground(sa, ankle_ref)
		report[key] = {"clip": pk2["clip"], "len": sa.length, "speed_curve": st["curve"], "arms": _fix_arms(sa)}
		lib.add_animation(key, sa)
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
	report["arms_jump"] = [_fix_arms(js), _fix_arms(jair), _fix_arms(jl)]
	lib.add_animation("jump_start", js)
	lib.add_animation("jump_air", jair)
	lib.add_animation("jump_land", jl)
	var idf: String = picks["idle"]
	var ia := _src(idf)
	var idle := _loop_segment(ia, picks.get("idle_t0", 0.1), picks.get("idle_t1", 1.6))
	report["idle_offset"] = _ground(idle, ankle_ref, false)
	report["arms_idle"] = _fix_arms(idle, true)
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


func _find_cycle(a: Animation, f: String, tw0 := -1.0, tw1 := -1.0) -> Dictionary:
	## tw0 / tw1 (s): optional window of the source clip to take the cycle from (clips that change
	## direction, e.g. 113_18 sidesteps right, then left)
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
	var i_lo := int(0.1 * FPS) if tw0 < 0.0 else int(tw0 * FPS)
	var i_hi := s.size() - int(0.1 * FPS) if tw1 < 0.0 else mini(s.size() - int(0.1 * FPS), int(tw1 * FPS))
	for i in range(i_lo, i_hi):
		if ys[i] > p10 + 0.07:
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
	var mid := s.size() / 2 if tw0 < 0.0 else (i_lo + i_hi) / 2
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


func _facing_yaw(an: Animation) -> float:
	## mean body facing of a clip (yaw of the hips' forward = up x (right hip - left hip)), radians
	var acc := Vector2.ZERO
	for i in 12:
		_anim_eval(an, an.length * i / 12.0)
		var side := _pos("RightUpperLeg") - _pos("LeftUpperLeg")
		var fwd := Vector3.UP.cross(side)
		acc += Vector2(fwd.x, fwd.z).normalized()
	return atan2(acc.x, acc.y)


func _face_forward(an: Animation) -> Dictionary:
	## rotate a travel-frame cycle (travel = +Z) about Y so the BODY faces +Z; returns the travel
	## direction in the body frame (walk back ~ (0,-1), strafe right ~ (-1,0) / left (+1,0) in +Z-forward
	## model space, checked against the forward walk which must give ~0 deg)
	var phi := _facing_yaw(an) - _FWD_YAW_REF
	var q := Quaternion(Vector3.UP, -phi)
	for tr in an.get_track_count():
		if not String(an.track_get_path(tr)).ends_with(":Hips"):
			continue
		for k in an.track_get_key_count(tr):
			var v: Variant = an.track_get_key_value(tr, k)
			if v is Quaternion:
				an.track_set_key_value(tr, k, (q * (v as Quaternion)).normalized())
			elif v is Vector3:
				an.track_set_key_value(tr, k, q * (v as Vector3))
	var travel := q * Vector3(0, 0, 1)
	return {"travel": [snappedf(travel.x, 0.01), snappedf(travel.z, 0.01)], "deg": snappedf(rad_to_deg(phi), 0.1)}


var _FWD_YAW_REF := 0.0


func _make_stop(a: Animation, pk: Dictionary) -> Dictionary:
	## one-shot stop: from the last steady steps until standing; hips translation removed completely
	## (in place) and its speed profile returned, so the controller decelerates exactly like the
	## capture (no sliding while the stop plays)
	var s := _sample(a)
	var sp: Array[float] = []
	var win := int(0.1 * FPS)
	for i in s.size():
		var i0 := maxi(0, i - win); var i1 := mini(s.size() - 1, i + win)
		var d: Vector3 = s[i1]["hips"] - s[i0]["hips"]
		d.y = 0
		sp.append(d.length() / ((i1 - i0) / FPS))
	var vmax := 0.0
	for v in sp:
		vmax = maxf(vmax, v)
	var stop_i := s.size() - 1
	for i in range(s.size() - 1, 0, -1):
		if sp[i] > float(pk.get("stop_speed", 0.12)):
			stop_i = i
			break
	var dec_i := stop_i
	while dec_i > 0 and sp[dec_i] < vmax * 0.85:
		dec_i -= 1
	var t0: float = maxf(0.0, s[dec_i]["t"] - float(pk.get("lead", 0.15)))
	var t1: float = minf(a.length, s[stop_i]["t"] + float(pk.get("settle", 0.6)))
	var d0: Vector3 = s[stop_i]["hips"] - s[dec_i]["hips"]
	d0.y = 0
	var yaw := Quaternion(Vector3.UP, atan2(d0.x, d0.z)).inverse()
	var hp: Array = []
	for x in s:
		hp.append([x["t"], x["hips"]])
	var hips_at := func(t: float) -> Vector3:
		var k := clampi(int(t * FPS), 0, hp.size() - 1)
		return hp[k][1]
	var h0: Vector3 = hips_at.call(t0)
	var an := _resample(a, t0, t1, yaw, func(t: float, p: Vector3) -> Vector3:
		var d: Vector3 = (hips_at.call(t) - h0) / sk.motion_scale
		return Vector3(p.x - d.x, p.y, p.z - d.z))
	an.loop_mode = Animation.LOOP_NONE
	var curve: Array = []
	var t := t0
	while t <= t1 + 0.001:
		curve.append([snappedf(t - t0, 0.01), snappedf(sp[clampi(int(t * FPS), 0, sp.size() - 1)], 0.01)])
		t += 0.05
	return {"anim": an, "curve": curve}


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



# ------------------------------------------------------------------------------------------- arms
var _profile := {}      ## height bin (5 cm, relative to the hips) -> [half width |x|, z min, z max] of the torso + coat


func _torso_profile() -> void:
	## Torso shape of OUR character (incl. the chapan coat) from the skinned mesh in rest pose:
	## vertices driven mainly by Hips/Spine/Chest/UpperChest, binned by height relative to the hips.
	var mi: MeshInstance3D = player.find_children("*", "MeshInstance3D", true, false)[0]
	var torso := {}
	for b in ["Hips", "Spine", "Chest", "UpperChest"]:
		torso[sk.find_bone(b)] = true
	var skin := mi.skin
	var hips_y := sk.get_bone_global_rest(sk.find_bone("Hips")).origin.y
	for si in mi.mesh.get_surface_count():
		var arr := mi.mesh.surface_get_arrays(si)
		var vs: PackedVector3Array = arr[Mesh.ARRAY_VERTEX]
		var bs: PackedInt32Array = arr[Mesh.ARRAY_BONES]
		var ws: PackedFloat32Array = arr[Mesh.ARRAY_WEIGHTS]
		var per := bs.size() / vs.size()
		for i in vs.size():
			var best := 0.0
			var bb := -1
			for k in per:
				if ws[i * per + k] > best:
					best = ws[i * per + k]
					bb = bs[i * per + k]
			if skin and bb >= 0 and bb < skin.get_bind_count():
				bb = sk.find_bone(skin.get_bind_name(bb)) if skin.get_bind_name(bb) != "" else skin.get_bind_bone(bb)
			if not torso.has(bb):
				continue
			var v := vs[i]
			var key := int(floor((v.y - hips_y) / 0.05))
			var e: Array = _profile.get(key, [0.0, 9.0, -9.0])
			e[0] = maxf(e[0], absf(v.x))
			e[1] = minf(e[1], v.z)
			e[2] = maxf(e[2], v.z)
			_profile[key] = e
	var keys := _profile.keys()
	keys.sort()
	var line := ""
	for k in keys:
		line += "%+.2f:%.2f " % [k * 0.05, _profile[k][0]]
	print("PROFILE torso half-width by height above hips: ", line)


func _arm_points() -> Array:
	## points along the forearm and hand (in the hips' yaw frame, relative to the hips)
	var hips := sk.get_bone_global_pose(sk.find_bone("Hips"))
	var fwd := hips.basis.z
	fwd.y = 0.0
	fwd = fwd.normalized()
	var yaw := Basis(Vector3.UP, atan2(fwd.x, fwd.z))
	var inv := yaw.inverse()
	var out := []
	for side in ["Left", "Right"]:
		var el := _pos(side + "LowerArm")
		var wr := _pos(side + "Hand")
		var hand_dir := (wr - el).normalized()
		for t in [0.35, 0.7, 1.0]:
			out.append([side, inv * (el.lerp(wr, t) - hips.origin)])
		out.append([side, inv * (wr + hand_dir * 0.08 - hips.origin)])     # middle of the hand
	return out


func arm_clearance(a: Animation, already_built := false) -> Dictionary:
	## worst clearance (m) between forearm/hand points and the torso+coat profile (+4 cm arm radius);
	## negative = the arm sinks into the body. Also the mean lateral hand distance.
	var worst := 9.0
	var bad := 0
	var n := 0
	var hand_x := 0.0
	var steps := int(a.length * 30.0)
	for i in steps:
		if already_built:
			_anim_eval(a, a.length * i / steps)
		else:
			_pose_at(a, a.length * i / steps)
		var pts := _arm_points()
		for pp in pts:
			var c := _ellipse_clear(pp[1])
			if c > 8.0:
				continue
			worst = minf(worst, c)
			if c < 0.0:
				bad += 1
		hand_x += (absf((pts[3][1] as Vector3).x) + absf((pts[7][1] as Vector3).x)) * 0.5
		n += 1
	return {"worst_clearance": snappedf(worst, 0.001), "frames_inside_pct": snappedf(100.0 * bad / maxf(n * 8, 1), 0.1), "hand_x": snappedf(hand_x / maxf(n, 1), 0.01)}


func _scan_idle(f: String) -> void:
	## standing windows (hips speed < 0.12 m/s for >= 1 s) where the arms hang beside the body
	var a := _src(f)
	var step := 1.0 / 20.0
	var prev := Vector3.ZERO
	var run_start := -1.0
	var t := 0.0
	var best := []
	while t < a.length:
		_pose_at(a, t)
		var h := _pos("Hips")
		var v := Vector2(h.x - prev.x, h.z - prev.z).length() / step if t > 0.0 else 0.0
		prev = h
		var pts := _arm_points()
		var lx := absf((pts[3][1] as Vector3).x)
		var rx := absf((pts[7][1] as Vector3).x)
		var lz := absf((pts[3][1] as Vector3).z)
		var rz := absf((pts[7][1] as Vector3).z)
		var ly := (pts[3][1] as Vector3).y
		var ok := v < 0.12 and lx > 0.2 and rx > 0.2 and lz < 0.16 and rz < 0.16 and ly < 0.05
		if v < 0.15 and int(t / step) % 10 == 0:
			print("  STAND %s t=%.1f hands L(x %.2f z %+.2f y %+.2f) R(x %.2f z %+.2f)" % [f, t, lx, (pts[3][1] as Vector3).z, ly, rx, (pts[7][1] as Vector3).z])
		if ok and run_start < 0.0:
			run_start = t
		if (not ok or t + step >= a.length) and run_start >= 0.0:
			if t - run_start >= 1.0:
				best.append([snappedf(run_start, 0.01), snappedf(t, 0.01)])
			run_start = -1.0
		t += step
	print("IDLE ", f, " len %.1f s windows %s" % [a.length, str(best)])



func _fix_arms(an: Animation, hang := false) -> Dictionary:
	## Arm spacing for OUR (wider) body: per key and side, the smallest outward rotation of the upper
	## arm (about the body's forward axis, at the shoulder) that keeps forearm + hand >= 2.5 cm outside
	## the torso+chapan profile; hang = true also swings the arm back so the hand hangs beside the
	## thigh (idle). Angles are smoothed over time (no popping), max 40 deg (target 3.5 cm before smoothing).
	if _profile.is_empty():
		_torso_profile()
	var before := arm_clearance(an, true)
	var tracks := {}
	for tr in an.get_track_count():
		var b := String(an.track_get_path(tr)).get_slice(":", 1)
		if an.track_get_type(tr) == Animation.TYPE_ROTATION_3D and b in ["LeftUpperArm", "RightUpperArm"]:
			tracks[b] = tr
	for side in ["Left", "Right"]:
		var bname: String = side + "UpperArm"
		if not tracks.has(bname):
			continue
		var tr: int = tracks[bname]
		var bi := sk.find_bone(bname)
		var parent := sk.get_bone_parent(bi)
		var nk := an.track_get_key_count(tr)
		var angles: Array[float] = []
		var backs: Array[float] = []
		for k in nk:
			_anim_eval(an, an.track_get_key_time(tr, k))
			var q0: Quaternion = an.track_get_key_value(tr, k)
			var best := 40.0
			var back := 0.0
			if hang:
				# swing back until the hand is no more than 4 cm in front of the hips line
				for bdeg in range(0, 26, 2):
					_set_arm(bi, parent, q0, 0.0, float(bdeg), side)
					var hz := (_side_points(side)[3] as Vector3).z
					back = float(bdeg)
					if hz < 0.04:
						break
			var found := false
			# smallest correction first: abduction alone, then with the arm carried slightly forward
			# (bent running arms pass IN FRONT of the chest instead of through the coat)
			for fwd in [0.0, -6.0, -12.0, -18.0]:
				for deg in range(0, 41):
					_set_arm(bi, parent, q0, float(deg), back + fwd, side)
					if _side_clear(side) >= 0.035:
						best = float(deg)
						back += fwd
						found = true
						break
				if found:
					break
			angles.append(best)
			backs.append(back)
		# smoothing: running max over +-0.12 s, then a moving average (loops wrap)
		var sm := _smooth(angles, an.loop_mode != Animation.LOOP_NONE)
		var sb := _smooth(backs, an.loop_mode != Animation.LOOP_NONE)
		for k in nk:
			_anim_eval(an, an.track_get_key_time(tr, k))
			var q0: Quaternion = an.track_get_key_value(tr, k)
			an.track_set_key_value(tr, k, _arm_rot(bi, parent, q0, sm[k], sb[k], side))
	var after := arm_clearance(an, true)
	return {"before": before, "after": after}


func _smooth(v: Array[float], loop: bool) -> Array[float]:
	var n := v.size()
	var w := 7
	var mx: Array[float] = []
	for i in n:
		var m := 0.0
		for d in range(-w, w + 1):
			var j := posmod(i + d, n) if loop else clampi(i + d, 0, n - 1)
			m = maxf(m, v[j])
		mx.append(m)
	var out: Array[float] = []
	for i in n:
		var a := 0.0
		for d in range(-w, w + 1):
			var j := posmod(i + d, n) if loop else clampi(i + d, 0, n - 1)
			a += mx[j]
		out.append(a / (2 * w + 1))
	return out


func _arm_rot(bi: int, parent: int, q0: Quaternion, abd_deg: float, back_deg: float, side: String) -> Quaternion:
	var hips := sk.get_bone_global_pose(sk.find_bone("Hips"))
	var fwd := hips.basis.z
	fwd.y = 0.0
	fwd = fwd.normalized()
	var yaw := Basis(Vector3.UP, atan2(fwd.x, fwd.z))
	var sgn := 1.0 if side == "Left" else -1.0
	# body-frame rotation: abduction about forward (z), swing back about lateral (x)
	var r := yaw * Basis(Vector3.BACK, deg_to_rad(abd_deg) * sgn) * Basis(Vector3.RIGHT, deg_to_rad(back_deg)) * yaw.inverse()
	var gp := sk.get_bone_global_pose(parent).basis.orthonormalized()
	var local := Basis(q0)
	return Quaternion((gp.inverse() * r * gp * local).orthonormalized())


func _set_arm(bi: int, parent: int, q0: Quaternion, abd_deg: float, back_deg: float, side: String) -> void:
	sk.set_bone_pose_rotation(bi, _arm_rot(bi, parent, q0, abd_deg, back_deg, side))


func _side_points(side: String) -> Array:
	var pts := _arm_points()
	var out := []
	for p in pts:
		if p[0] == side:
			out.append(p[1])
	return out


func _ellipse_clear(p: Vector3) -> float:
	## distance (approx.) of p outside the torso+coat cross-section at its height, modelled as an
	## ellipse (half-width w, depth from z-min to z-max), minus a 4 cm arm radius; 9 if no torso there
	var key := int(floor(p.y / 0.05))
	if not _profile.has(key):
		return 9.0
	var e: Array = _profile[key]
	var w: float = maxf(float(e[0]), 0.02)
	var zc: float = (float(e[1]) + float(e[2])) * 0.5
	var d: float = maxf((float(e[2]) - float(e[1])) * 0.5, 0.02)
	var r := sqrt(pow(p.x / w, 2.0) + pow((p.z - zc) / d, 2.0))
	return (r - 1.0) * minf(w, d) - 0.04


func _side_clear(side: String) -> float:
	var worst := 9.0
	for p: Vector3 in _side_points(side):
		worst = minf(worst, _ellipse_clear(p))
	return worst