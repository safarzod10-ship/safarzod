extends Node3D
## Step-up / step-down tests (run: godot --headless --path . res://tests/step_tests.tscn).
## Separate lanes walking towards -Z; every obstacle's front face is at z = -3.
##   steps 0.10 / 0.20 / 0.25 / 0.30 m must be climbed (walk and run), 0.40 m must be blocked,
##   a staircase (12 × 0.17 m rise, 0.30 m tread) up and down with a smooth model/camera,
##   stepping off a 0.30 m ledge, a 20° ramp (walkable) and a 50° ramp (not climbable),
##   a 1.2 m wall, a narrow 4 cm edge, a step under a low ceiling, jumping onto a 0.5 m box and on stairs.

var player: PlayerController
var results: Array[String] = []
var ok_all := true
var body: StaticBody3D
var shooting := false        ## out=<png>: also render side views (needs a display, e.g. xvfb-run)
var shots: Array = []
var shot_cam: Camera3D


func _ready() -> void:
	for a in OS.get_cmdline_user_args():
		shooting = shooting or a.begins_with("out=")
	if shooting:
		add_child(EnvironmentRig.new())
		shot_cam = Camera3D.new()
		shot_cam.fov = 40
		add_child(shot_cam)
	body = StaticBody3D.new()
	add_child(body)
	_box(Vector3(0, -0.5, 0), Vector3(400, 1, 400))
	var heights := [0.10, 0.20, 0.25, 0.30, 0.40]
	for i in heights.size():
		var h: float = heights[i]
		_box(Vector3(i * 6.0, h * 0.5, -8), Vector3(4, h, 10))
	# staircase at x = 40: 12 steps, rise 0.17, tread 0.30, then a 6 m landing
	for k in 12:
		var top := 0.17 * (k + 1)
		_box(Vector3(40, top * 0.5, -3 - 0.30 * k - 0.15), Vector3(3, top, 0.30))
	_box(Vector3(40, 2.04 * 0.5, -3 - 3.6 - 3.0), Vector3(3, 2.04, 6))
	# ledge to step off at x = 50 (player starts on it)
	_box(Vector3(50, 0.15, 2), Vector3(4, 0.30, 6))
	# 20° and 50° ramps at x = 60 / 66
	_ramp(Vector3(60, 0, -3), 20.0, 8.0)
	_ramp(Vector3(66, 0, -3), 50.0, 3.0)
	# 1.2 m wall at x = 72
	_box(Vector3(72, 0.6, -3.5), Vector3(4, 1.2, 1.0))
	# narrow 4 cm edge, 0.25 m high at x = 78
	_box(Vector3(78, 0.125, -3.02), Vector3(4, 0.25, 0.04))
	# 0.25 m step under a low ceiling at x = 84: 1.5 m clear above the step top
	_box(Vector3(84, 0.125, -8), Vector3(4, 0.25, 10))
	_box(Vector3(84, 0.25 + 1.5 + 0.1, -8), Vector3(4, 0.2, 10))
	# 0.5 m box to jump onto at x = 90
	_box(Vector3(90, 0.25, -6), Vector3(4, 0.5, 6))

	player = (load("res://scenes/player/player.tscn") as PackedScene).instantiate()
	add_child(player)
	player.teleport(Vector3(0, 0, 0), 0.0)
	await _frames(20)

	for i in heights.size():
		var h: float = heights[i]
		var y := await _walk_lane(Vector3(i * 6.0, 0, 0), false, 330)
		if h <= player.step_height + 0.001:
			_check("step %.2f m climbed walking: y=%.3f" % [h, y], absf(y - h) < 0.02)
			var yr := await _walk_lane(Vector3(i * 6.0, 0, 0), true, 120)
			_check("step %.2f m climbed running: y=%.3f" % [h, yr], absf(yr - h) < 0.02)
		else:
			_check("step %.2f m (above the %.2f m limit) blocked: y=%.3f, z=%.2f" % [h, player.step_height, y, player.global_position.z],
				y < 0.02 and player.global_position.z > -3.05)

	# staircase up: model and camera must not pop
	await _place(Vector3(40, 0, 0))
	PlayerInput.scripted_move = Vector2(0, -1)
	var m := await _track(470)      # walking 1 m/s: 12 steps + part of the landing
	_check("staircase up (12 × 0.17 m): top y=%.3f, %d step-ups" % [player.global_position.y, m["steps"]],
		absf(player.global_position.y - 2.04) < 0.02 and m["steps"] >= 12)
	_check("staircase up: model moves smoothly, max %.3f m per frame (a pop would be 0.17)" % m["model_dy"], m["model_dy"] < 0.052)
	_check("staircase up: camera moves smoothly, max vertical speed %.2f m/s (a pop would be ~10)" % m["cam_dy"], m["cam_dy"] < 3.1)
	_check("staircase up: no jump/landing states, states seen %s" % [m["states"]], not m["states"].has("jump_land") and not m["states"].has("air"))
	# jump while on the stairs
	await _place(Vector3(40, 0, -3 - 0.30 * 5 - 0.15), 0.0)
	var y0 := player.global_position.y
	PlayerInput.queue_jump()
	var peak := y0
	for k in 90:
		await get_tree().physics_frame
		peak = maxf(peak, player.global_position.y)
	_check("jump on the stairs: +%.2f m" % (peak - y0), peak - y0 > 0.6)
	# staircase down
	await _place(Vector3(40, 0, -3 - 3.6 - 1.0), PI)
	PlayerInput.scripted_move = Vector2(0, -1)
	m = await _track(600)
	_check("staircase down: bottom y=%.3f" % player.global_position.y, absf(player.global_position.y) < 0.02)
	_check("staircase down: model max %.3f m per frame, camera max %.2f m/s" % [m["model_dy"], m["cam_dy"]], m["model_dy"] < 0.052 and m["cam_dy"] < 3.1)
	_check("staircase down: no landing animation, states seen %s" % [m["states"]], not m["states"].has("jump_land"))

	# step down a 0.30 m ledge
	await _place(Vector3(50, 0, 3.5))
	PlayerInput.scripted_move = Vector2(0, 1)
	m = await _track(200)
	_check("step down 0.30 m: y=%.3f, model max %.3f m per frame, camera max %.2f m/s, states %s" % [player.global_position.y, m["model_dy"], m["cam_dy"], m["states"]],
		absf(player.global_position.y) < 0.02 and m["model_dy"] < 0.052 and m["cam_dy"] < 3.1 and not m["states"].has("jump_land"))

	# ramps
	await _place(Vector3(60, 0, 0))
	PlayerInput.scripted_move = Vector2(0, -1)
	var yr20 := 0.0
	for i in 720:                                              # 8 m ramp at 1 m/s walking: highest point reached
		await get_tree().physics_frame
		yr20 = maxf(yr20, player.global_position.y)
	PlayerInput.scripted_move = null
	_check("20° ramp walkable: y=%.2f" % yr20, yr20 > 1.5)
	var yr50 := await _walk_lane(Vector3(66, 0, 0), false, 400)
	_check("50° ramp (> %d° limit) not climbed: y=%.2f" % [int(player.max_slope_deg), yr50], yr50 < 0.35)
	# wall / narrow edge / low ceiling
	var yw := await _walk_lane(Vector3(72, 0, 0), true, 150)
	_check("1.2 m wall blocks: y=%.3f, z=%.2f" % [yw, player.global_position.z], yw < 0.02 and player.global_position.z > -3.05)
	var ye := await _walk_lane(Vector3(78, 0, 0), false, 330)
	_check("narrow 4 cm edge is not used as a step: y=%.3f" % ye, ye < 0.02 and player.global_position.z > -3.05)
	var yc := await _walk_lane(Vector3(84, 0, 0), false, 330)
	_check("step under a low ceiling (1.5 m clear) not climbed: y=%.3f, z=%.2f" % [yc, player.global_position.z], yc < 0.02)
	# jump onto a 0.5 m box (too high to step, reachable by jumping)
	await _place(Vector3(90, 0, 4.0))                       # run-up: a 0.5 m box needs a running jump
	PlayerInput.scripted_move = Vector2(0, -1)
	PlayerInput.scripted_run = true
	for i in 300:
		await get_tree().physics_frame
		if player.global_position.z < -1.9:
			break
	PlayerInput.queue_jump()
	await _frames(150)
	PlayerInput.scripted_run = false
	_check("running jump onto a 0.5 m box: y=%.3f" % player.global_position.y, absf(player.global_position.y - 0.5) < 0.02)

	PlayerInput.scripted_move = null
	PlayerInput.scripted_run = false
	print("STEP_TESTS ", "ALL PASS" if ok_all else "SOME FAILED")
	if shooting:
		_save_sheet()
	var f := FileAccess.open("res://docs/reports/step_tests.txt", FileAccess.WRITE)
	if f:
		f.store_string("\n".join(results) + "\n")
	get_tree().quit(0 if ok_all else 1)


func _place(p: Vector3, yaw := 0.0) -> void:
	PlayerInput.scripted_move = null
	PlayerInput.scripted_run = false
	player.teleport(p, yaw)
	player.set_camera_angles(yaw, player.cam_pitch)
	await _frames(15)


func _walk_lane(start: Vector3, run: bool, n: int) -> float:
	await _place(start)
	PlayerInput.scripted_move = Vector2(0, -1)
	PlayerInput.scripted_run = run
	await _frames(170 if not run else 55)           # around the moment the step face is reached
	if not run:
		await _shot("walk %.2f m" % _lane_h(start.x))
	await _frames(n - (170 if not run else 55))
	PlayerInput.scripted_move = null
	PlayerInput.scripted_run = false
	await _frames(10)
	return player.global_position.y


func _lane_h(x: float) -> float:
	var hs := [0.10, 0.20, 0.25, 0.30, 0.40]
	var i := int(round(x / 6.0))
	return hs[i] if x < 30.0 and i < hs.size() else 0.0


func _shot(label: String) -> void:
	if not shooting:
		return
	var p := player.global_position
	shot_cam.global_position = p + Vector3(3.2, 1.0, 0.4)
	shot_cam.look_at(p + Vector3(0, 0.75, 0), Vector3.UP)
	shot_cam.make_current()
	await RenderingServer.frame_post_draw
	await RenderingServer.frame_post_draw
	shots.append([label, get_viewport().get_texture().get_image()])
	player.get_camera().make_current()


func _track(n: int) -> Dictionary:
	## max per-frame vertical movement of the visible model and of the camera; states visited; step-ups
	var steps := [0]
	var cb := func(_h: float) -> void: steps[0] += 1
	player.stepped_up.connect(cb)
	var mdy := 0.0
	var cdy := 0.0
	var states := []
	var my := player.model.global_position.y
	var cam := {"y": player.get_camera().global_position.y, "max": 0.0}   # lambdas capture by value: use a dict
	var cam_speed := func() -> void:   # camera moves in _process: vertical speed per rendered frame
		var c := player.get_camera().global_position.y
		cam["max"] = maxf(cam["max"], absf(c - cam["y"]) / maxf(get_process_delta_time(), 1e-4))
		cam["y"] = c
	get_tree().process_frame.connect(cam_speed)
	for i in n:
		await get_tree().physics_frame
		var y := player.model.global_position.y
		mdy = maxf(mdy, absf(y - my))
		my = y
		if shooting and i % 40 == 20 and shots.size() < 40:
			await _shot("stairs")
			my = player.model.global_position.y        # physics ran while capturing: restart the metric
		var st := String((player.get("_playback") as AnimationNodeStateMachinePlayback).get_current_node())
		if not states.has(st):
			states.append(st)
	player.stepped_up.disconnect(cb)
	get_tree().process_frame.disconnect(cam_speed)
	cdy = cam["max"]
	PlayerInput.scripted_move = null
	await _frames(10)
	return {"model_dy": mdy, "cam_dy": cdy, "states": states, "steps": steps[0]}


func _box(pos: Vector3, size: Vector3) -> void:
	var cs := CollisionShape3D.new()
	var s := BoxShape3D.new()
	s.size = size
	cs.shape = s
	cs.position = pos
	body.add_child(cs)
	if shooting:
		var mi := MeshInstance3D.new()
		var bm := BoxMesh.new()
		bm.size = size
		mi.mesh = bm
		mi.position = pos
		mi.material_override = CityMaterials.get_material("curb" if size.y < 3.0 else "sidewalk") if size.x < 100 else CityMaterials.get_material("sidewalk")
		add_child(mi)


func _ramp(foot: Vector3, deg: float, length: float) -> void:
	## a slab rising towards -Z from foot, then a flat top
	var a := deg_to_rad(deg)
	var cs := CollisionShape3D.new()
	var s := BoxShape3D.new()
	s.size = Vector3(4, 0.2, length)
	cs.shape = s
	cs.rotation.x = a
	cs.position = foot + Vector3(0, sin(a) * length * 0.5 - 0.1 / cos(a), -cos(a) * length * 0.5)
	body.add_child(cs)
	if shooting:
		var mi := MeshInstance3D.new()
		var bm := BoxMesh.new()
		bm.size = s.size
		mi.mesh = bm
		mi.transform = cs.transform
		mi.material_override = CityMaterials.get_material("curb")
		add_child(mi)


func _frames(n: int) -> void:
	for i in n:
		await get_tree().physics_frame


func _check(msg: String, ok: bool) -> void:
	var line := ("PASS " if ok else "FAIL ") + msg
	print(line)
	results.append(line)
	ok_all = ok_all and ok


func _save_sheet() -> void:
	var w := 320
	var h := 240
	var cols := 4
	var rows := int(ceil(shots.size() / float(cols)))
	var sheet := Image.create(w * cols, h * rows, false, Image.FORMAT_RGBA8)
	for i in shots.size():
		var im: Image = shots[i][1]
		im.convert(Image.FORMAT_RGBA8)
		im.resize(w, h)
		sheet.blit_rect(im, Rect2i(0, 0, w, h), Vector2i((i % cols) * w, (i / cols) * h))
	var out := "/tmp/steps.png"
	for a in OS.get_cmdline_user_args():
		if a.begins_with("out="):
			out = a.substr(4)
	sheet.save_png(out)
	print("STEP_SHEET ", out, " ", shots.map(func(x: Array) -> String: return x[0]))
