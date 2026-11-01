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
	var fy := minf(_bone_y("foot.L"), _bone_y("foot.R"))
	idle_ankle = fy
	var ty := minf(_bone_y("toe.L"), _bone_y("toe.R"))
	_check("idle: lowest foot/toe joint height %.3f m (0.0..0.12)" % minf(fy, ty), minf(fy, ty) > -0.02 and minf(fy, ty) < 0.12)
	# 2. walking: stance-foot sliding
	PlayerInput.scripted_move = Vector2(1, 0)
	PlayerInput.scripted_run = false
	await _frames(90)
	var slide_w := await _measure_slide(120)
	_check("walk %.2f m/s: stance foot slide %.3f m/s (< 0.15)" % [player.ground_speed, slide_w], slide_w < 0.15)
	_check("walk: stance ankle height %.3f m vs idle %.3f (|diff| < 0.02 — no floating/sinking)" % [stance_height, idle_ankle], absf(stance_height - idle_ankle) < 0.02)
	PlayerInput.scripted_run = true
	await _frames(90)
	var slide_r := await _measure_slide(120)
	_check("run %.2f m/s: stance foot slide %.3f m/s (< 0.3)" % [player.ground_speed, slide_r], slide_r < 0.3)
	# 3. curb 0.15 m
	PlayerInput.scripted_move = null
	PlayerInput.scripted_run = false
	player.teleport(Vector3(0, 0, -10), 0.0)
	await _frames(20)
	PlayerInput.scripted_move = Vector2(0, -1)
	await _frames(240)
	_check("curb 0.15 m climbed: y=%.3f, z=%.2f" % [player.global_position.y, player.global_position.z],
		player.global_position.y > 0.12 and player.global_position.z < -15.2)
	# 4. step 0.30
	PlayerInput.scripted_move = null
	player.teleport(Vector3(30, 0, -10), 0.0)
	await _frames(20)
	PlayerInput.scripted_move = Vector2(0, -1)
	await _frames(240)
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
	_check("jump height %.2f m (0.8..1.2)" % (ymax - y0), ymax - y0 > 0.8 and ymax - y0 < 1.2)
	await _frames(60)
	_check("landed on floor: y=%.3f" % player.global_position.y, absf(player.global_position.y) < 0.05)
	print("PLAYER_TESTS ", "ALL PASS" if ok_all else "SOME FAILED")
	var f := FileAccess.open("res://docs/reports/player_tests.txt", FileAccess.WRITE)
	if f:
		f.store_string("\n".join(results) + "\n")
	get_tree().quit(0 if ok_all else 1)


func _measure_slide(n: int) -> float:
	## Flat-foot stance frames: ankle AND toe joints both within 1.5 cm of their cycle minimum.
	## Then the foot is planted, and its world-space horizontal velocity is the sliding error.
	var rec: Array = []
	for i in n:
		await get_tree().physics_frame
		rec.append([_bone_world("foot.L"), _bone_world("toe.L"), _bone_world("foot.R"), _bone_world("toe.R")])
	var amin := 9.0
	var tmin := 9.0
	for r in rec:
		amin = minf(amin, minf(r[0].y, r[2].y))
		tmin = minf(tmin, minf(r[1].y, r[3].y))
	var acc := 0.0
	var cnt := 0
	for i in range(1, rec.size()):
		for k in [0, 2]:
			var p: Vector3 = rec[i][k]
			var t: Vector3 = rec[i][k + 1]
			if p.y < amin + 0.015 and t.y < tmin + 0.015:
				var q: Vector3 = rec[i - 1][k]
				acc += Vector2(p.x - q.x, p.z - q.z).length() * Engine.physics_ticks_per_second
				cnt += 1
	stance_height = amin
	print("  flat-foot samples=%d, stance ankle y=%.3f" % [cnt, amin])
	if cnt < 4:
		return 99.0
	return acc / cnt


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
