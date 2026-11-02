extends Node3D
## Player tests (run: godot --headless --path . res://tests/player_tests.tscn) -> PASS/FAIL lines.
## Flat floor + 0.15 m curb + 0.30 m step. Measures: idle foot height, stance-foot sliding while
## walking/running, curb climbing, jump height.

var player: PlayerController
var skel: Skeleton3D
var results: Array[String] = []
var ok_all := true
var stance_height := 0.0
var idle_ankle := 0.0


func _ready() -> void:
	var body := StaticBody3D.new()
	add_child(body)
	_box(body, Vector3(0, -0.5, 0), Vector3(200, 1, 200))
	_box(body, Vector3(0, 0.075, -20), Vector3(20, 0.15, 10))      # curb/sidewalk 0.15
	_box(body, Vector3(30, 0.15, -20), Vector3(20, 0.30, 10))      # 0.30 step
	player = (load("res://scenes/player/player.tscn") as PackedScene).instantiate()
	add_child(player)
	player.teleport(Vector3(0, 0, 0), 0.0)
	await _frames(30)
	skel = player.find_children("*", "Skeleton3D", true, false)[0]
	# sample poses on the same clock as movement (headless runs several physics ticks per frame)
	for t in player.find_children("*", "AnimationTree", true, false):
		(t as AnimationTree).callback_mode_process = AnimationMixer.ANIMATION_CALLBACK_MODE_PROCESS_PHYSICS
	# 1. idle feet on ground
	var fy := minf(_bone_y("LeftFoot"), _bone_y("RightFoot"))
	idle_ankle = fy
	var ty := minf(_bone_y("LeftToes"), _bone_y("RightToes"))
	_check("idle: lowest foot/toe joint height %.3f m (0.0..0.12)" % minf(fy, ty), minf(fy, ty) > -0.02 and minf(fy, ty) < 0.12)
	# 2. walking: stance-foot sliding
	PlayerInput.scripted_move = Vector2(1, 0)
	PlayerInput.scripted_run = false
	await _frames(90)
	var slide_w := await _measure_slide(120)
	_check("walk %.2f m/s: contact-point slide %.3f m/s (%.0f%% of speed, < 5%%)" % [player.ground_speed, slide_w, slide_w / player.ground_speed * 100.0], slide_w < 0.05 * player.ground_speed)
	_check("feet on the ground: idle ankle %.3f m (rest 0.090 ± 0.025)" % idle_ankle, absf(idle_ankle - 0.09) < 0.025)
	PlayerInput.scripted_run = true
	await _frames(90)
	var slide_r := await _measure_slide(120)
	_check("run %.2f m/s: contact-point slide %.3f m/s (%.0f%% of speed, < 5%%)" % [player.ground_speed, slide_r, slide_r / player.ground_speed * 100.0], slide_r < 0.05 * player.ground_speed)
	# 3. curb 0.15 m
	PlayerInput.scripted_move = null
	PlayerInput.scripted_run = false
	player.teleport(Vector3(0, 0, -10), 0.0)
	await _frames(20)
	PlayerInput.scripted_move = Vector2(0, -1)
	await _frames(400)
	_check("curb 0.15 m climbed: y=%.3f, z=%.2f" % [player.global_position.y, player.global_position.z],
		player.global_position.y > 0.12 and player.global_position.z < -15.2)
	# 4. step 0.30
	PlayerInput.scripted_move = null
	player.teleport(Vector3(30, 0, -10), 0.0)
	await _frames(20)
	PlayerInput.scripted_move = Vector2(0, -1)
	await _frames(400)
	_check("step 0.30 m climbed: y=%.3f" % player.global_position.y, player.global_position.y > 0.27)
	# 5. jump
	PlayerInput.scripted_move = null
	player.teleport(Vector3(-20, 0, 20), 0.0)
	await _frames(40)
	var y0 := player.global_position.y
	PlayerInput.queue_jump()
	var ymax := y0
	for i in 90:
		await get_tree().physics_frame
		ymax = maxf(ymax, player.global_position.y)
	_check("jump height %.2f m (0.6..0.85, human standing jump)" % (ymax - y0), ymax - y0 > 0.6 and ymax - y0 < 0.85)
	await _frames(60)
	_check("landed on floor: y=%.3f" % player.global_position.y, absf(player.global_position.y) < 0.05)
	# 6. jump phases: ground -> jump_start (push-off, feet still on ground) -> air -> jump_land -> ground
	player.teleport(Vector3(-20, 0, 30), 0.0)
	await _frames(40)
	var pb: AnimationNodeStateMachinePlayback = player.get("_playback")
	var seq: Array[String] = []
	var t_press := Time.get_ticks_msec()
	var t_air := -1.0
	PlayerInput.queue_jump()
	for i in 150:
		await get_tree().physics_frame
		var st := String(pb.get_current_node())
		if seq.is_empty() or seq[-1] != st:
			seq.append(st)
		if t_air < 0.0 and player.global_position.y > 0.02:
			t_air = i / 60.0
	_check("jump states %s" % str(seq), seq.has("jump_start") and seq.has("air") and seq.has("jump_land") and seq[-1] == "ground")
	_check("take-off after the mocap push-off: body leaves ground at %.2f s (0.2..0.3)" % t_air, t_air > 0.2 and t_air < 0.3)
	# 7. punch while standing and while walking: upper-body layer active, alternates, legs unaffected
	player.teleport(Vector3(-20, 0, 40), 0.0)
	await _frames(40)
	var lf0 := _bone_world("LeftFoot")
	PlayerInput.queue_punch()
	await _frames(3)
	var active1: bool = player.call("is_punching")
	var alt1: bool = player.get("_punch_alt")
	await _frames(20)
	var lf1 := _bone_world("LeftFoot")
	await _frames(60)
	PlayerInput.queue_punch()
	await _frames(3)
	var alt2: bool = player.get("_punch_alt")
	_check("punch standing: active=%s, alternates jab/cross=%s, feet still (moved %.3f m)" % [active1, alt1 != alt2, lf0.distance_to(lf1)],
		active1 and alt1 != alt2 and lf0.distance_to(lf1) < 0.03)
	for i in 10:                               # mashing does not stack: at most one queued punch
		PlayerInput.queue_punch()
		await _frames(2)
	_check("punch mashing does not stack (queue is a single flag)", player.get("_punch_queue") is bool)
	await _frames(120)
	PlayerInput.scripted_move = Vector2(1, 0)
	await _frames(60)
	PlayerInput.queue_punch()
	await _frames(15)
	var walking_punch: bool = player.call("is_punching")
	var spd: float = player.ground_speed
	PlayerInput.scripted_move = null
	_check("punch while walking: punching=%s, keeps walking at %.2f m/s" % [walking_punch, spd], walking_punch and spd > 0.9)
	print("PLAYER_TESTS ", "ALL PASS" if ok_all else "SOME FAILED")
	var f := FileAccess.open("res://docs/reports/player_tests.txt", FileAccess.WRITE)
	if f:
		f.store_string("\n".join(results) + "\n")
	get_tree().quit(0 if ok_all else 1)


func _measure_slide(n: int) -> float:
	## Slide of the CONTACT POINT (what touches the asphalt), not of the ankle: for each foot the
	## sole points heel (under the ankle) and ball (under the toe joint) are tracked through the foot
	## and toe bones; the lowest one is the contact point when it is within 2 cm of the ground.
	## Its horizontal world velocity while in contact is the visible sliding.
	var feet := {"LeftFoot": "LeftToes", "RightFoot": "RightToes"}
	var local := {}
	skel.reset_bone_poses()
	for f in feet:
		var fi := skel.find_bone(f)
		var ti := skel.find_bone(feet[f])
		var fr := skel.get_bone_global_rest(fi)
		var tr := skel.get_bone_global_rest(ti)
		local[f] = [fr.affine_inverse() * Vector3(fr.origin.x, 0.0, fr.origin.z),
				tr.affine_inverse() * Vector3(tr.origin.x, 0.0, tr.origin.z)]
	var prev := {}
	var sp: Array[float] = []
	var signed: Array[float] = []
	var lat: Array[float] = []
	var ground := player.global_position.y
	for i in n:
		await get_tree().physics_frame
		for f in feet:
			var fx := skel.global_transform * skel.get_bone_global_pose(skel.find_bone(f))
			var tx := skel.global_transform * skel.get_bone_global_pose(skel.find_bone(feet[f]))
			var heel: Vector3 = fx * (local[f][0] as Vector3)
			var ball: Vector3 = tx * (local[f][1] as Vector3)
			var c := heel if heel.y < ball.y else ball
			var which := 0 if heel.y < ball.y else 1
			if c.y - ground < 0.02 and prev.has(f) and prev[f][1] == which:
				var pc: Vector3 = prev[f][0]
				sp.append(Vector2(c.x - pc.x, c.z - pc.z).length() * Engine.physics_ticks_per_second)
				var vdir := Vector3(player.velocity.x, 0, player.velocity.z).normalized()
				signed.append(Vector3(c.x - pc.x, 0, c.z - pc.z).dot(vdir) * Engine.physics_ticks_per_second)
				lat.append(Vector3(c.x - pc.x, 0, c.z - pc.z).dot(vdir.cross(Vector3.UP)) * Engine.physics_ticks_per_second)
			prev[f] = [c, which]
	stance_height = _bone_y("LeftFoot")
	sp.sort()
	signed.sort()
	lat.sort()
	print("  contact samples=%d, along motion median %.3f m/s, sideways median %.3f m/s" % [sp.size(), signed[signed.size() / 2], lat[lat.size() / 2]])
	if sp.size() < 6:
		return 99.0
	return sp[sp.size() / 2]


func _bone_world(b: String) -> Vector3:
	return skel.global_transform * skel.get_bone_global_pose(skel.find_bone(b)).origin


func _bone_y(b: String) -> float:
	return _bone_world(b).y


func _box(parent: Node, pos: Vector3, size: Vector3) -> void:
	var cs := CollisionShape3D.new()
	var s := BoxShape3D.new()
	s.size = size
	cs.shape = s
	cs.position = pos
	parent.add_child(cs)


func _frames(n: int) -> void:
	for i in n:
		await get_tree().physics_frame


func _check(msg: String, ok: bool) -> void:
	var line := ("PASS " if ok else "FAIL ") + msg
	print(line)
	results.append(line)
	ok_all = ok_all and ok
