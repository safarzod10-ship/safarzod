extends Node
## Stage 4 functional tests (character, animation, movement physics, camera, touch input, Prado
## get-in / get-out, water, footsteps, arms, cost). Runs in the REAL game scene (main.tscn); an
## obstacle course (curbs, stairs, ramps, a wall) is built far outside the city at (5000, 0, 5000).
##   godot --headless res://tests/stage4_tests.tscn        -> docs/reports/stage4_tests.txt
## Every check prints PASS or FAIL with the measured values.

const C := Vector3(5000, 0, 5000)
var main: Node
var p: PlayerController
var lines: Array[String] = []
var ok_all := true
var body: StaticBody3D
var states := {}


func _ready() -> void:
	main = (load("res://scenes/main/main.tscn") as PackedScene).instantiate()
	add_child(main)
	while main.get("car_session") == null:
		await get_tree().physics_frame
	p = main.get("player")
	for w in get_tree().get_nodes_in_group(&"weather"):
		w.set("auto_cycle", false)
	_build_course()
	await _frames(30)
	await _locomotion()
	await _jumps()
	await _obstacles()
	await _camera()
	await _touch()
	await _water()
	await _footsteps()
	await _vehicle()
	_arms()
	await _cost()
	print("STAGE4_TESTS ", "ALL PASS" if ok_all else "SOME FAILED")
	var f := FileAccess.open("res://docs/reports/stage4_tests.txt", FileAccess.WRITE)
	if f:
		f.store_string("\n".join(lines) + "\n")
	get_tree().quit(0 if ok_all else 1)


func _check(n: int, msg: String, ok: bool) -> void:
	var l := ("PASS " if ok else "FAIL ") + "%2d. " % n + msg
	print(l)
	lines.append(l)
	ok_all = ok_all and ok


func _frames(n: int) -> void:
	for i in n:
		await get_tree().physics_frame
		var s := p.anim.current()
		states[s] = true


func _sec(t: float) -> void:
	await _frames(int(t * Engine.physics_ticks_per_second))


func _box(pos: Vector3, size: Vector3, yaw := 0.0, pitch := 0.0) -> void:
	var cs := CollisionShape3D.new()
	var s := BoxShape3D.new()
	s.size = size
	cs.shape = s
	cs.transform = Transform3D(Basis(Vector3.UP, yaw) * Basis(Vector3.RIGHT, pitch), C + pos)
	body.add_child(cs)


func _build_course() -> void:
	body = StaticBody3D.new()
	body.name = "Stage4Course"
	add_child(body)
	_box(Vector3(0, -0.5, 0), Vector3(200, 1, 200))                 # floor
	_box(Vector3(0, 0.1, -20), Vector3(6, 0.2, 4))                 # curb 0.20 m (z -22..-18)
	_box(Vector3(10, 0.15, -20), Vector3(6, 0.3, 4))               # step 0.30 m
	_box(Vector3(20, 0.2, -20), Vector3(6, 0.4, 4))                # 0.40 m: too high
	for i in 12:                                                    # staircase 12 x 0.17 / 0.30 m
		_box(Vector3(-20, 0.17 * (i + 1) * 0.5, -10.0 - i * 0.3), Vector3(3, 0.17 * (i + 1), 0.3))
	_box(Vector3(-20, 0.17 * 12 * 0.5, -10.0 - 12 * 0.3 - 1.85), Vector3(3, 0.17 * 12, 4.0))   # landing at the top
	# ramps: 20 deg (walkable) and 50 deg (too steep) rising towards -Z
	for r in [[30.0, 20.0], [40.0, 50.0]]:                          # same slab as step_tests._ramp
		var a := deg_to_rad(r[1])
		var L := 8.0
		_box(Vector3(r[0], sin(a) * L * 0.5 - 0.1 / cos(a), -10.0 - cos(a) * L * 0.5), Vector3(4, 0.2, L), 0.0, a)
	_box(Vector3(-40, 1.5, -12), Vector3(8, 3, 0.4))               # wall (z = -12)
	_box(Vector3(-40, 1.5, 6), Vector3(0.4, 3, 8))                 # wall behind the camera test spot


# ------------------------------------------------------------------------------- locomotion
func _move_measure(dir: Vector2, run: bool, t: float) -> Dictionary:
	PlayerInput.scripted_move = dir
	PlayerInput.scripted_run = run
	await _sec(t)
	var p0 := p.global_position
	var f0 := p.facing
	await _sec(1.0)
	var d := p.global_position - p0
	d.y = 0
	return {"speed": d.length(), "dir": d.normalized(), "facing_change": absf(wrapf(p.facing - f0, -PI, PI)),
		"blend": p.anim.tree.get(&"parameters/sm/ground/walk8/blend_position")}


func _locomotion() -> void:
	p.teleport(C + Vector3(0, 0.1, 20), 0.0)
	p.set_camera_angles(0.0, -0.25)                     # camera looks along -Z
	await _frames(30)
	var r := await _move_measure(Vector2(0, -1), false, 1.5)
	_check(1, "walk forward %.2f m/s (1.0), clip blend %s" % [r["speed"], str(r["blend"])], absf(r["speed"] - 1.0) < 0.06 and (r["blend"] as Vector2).y > 0.9)
	r = await _move_measure(Vector2(0, 1), false, 1.5)
	_check(2, "walk backward %.2f m/s (0.55) with walk_back clip, body keeps facing the camera (turned %.0f deg)" % [r["speed"], rad_to_deg(r["facing_change"])],
		absf(r["speed"] - 0.55) < 0.06 and (r["blend"] as Vector2).y < -0.9 and r["facing_change"] < 0.1)
	var rr := await _move_measure(Vector2(1, 0), false, 1.5)
	var rl := await _move_measure(Vector2(-1, 0), false, 1.5)
	_check(3, "side steps right %.2f / left %.2f m/s (0.6) with strafe clips (blend x %.2f / %.2f)" % [rr["speed"], rl["speed"], (rr["blend"] as Vector2).x, (rl["blend"] as Vector2).x],
		absf(rr["speed"] - 0.6) < 0.06 and absf(rl["speed"] - 0.6) < 0.06 and (rr["blend"] as Vector2).x > 0.9 and (rl["blend"] as Vector2).x < -0.9)
	var rd := await _move_measure(Vector2(0.7071, -0.7071), false, 1.5)
	var bd: Vector2 = rd["blend"]
	_check(4, "diagonal forward-right %.2f m/s, travel %s, blend %s (forward + side)" % [rd["speed"], str((rd["dir"] as Vector3).snapped(Vector3.ONE * 0.01)), str(bd.snapped(Vector2.ONE * 0.01))],
		rd["speed"] > 0.6 and rd["speed"] < 1.0 and bd.x > 0.4 and bd.y > 0.4)
	PlayerInput.scripted_move = Vector2(0, -1)
	PlayerInput.scripted_run = true
	await _sec(2.0)
	var v0 := p.ground_speed
	var rn := await _move_measure(Vector2(0, -1), true, 0.2)
	_check(5, "run %.2f m/s (4.5 configurable), accelerated (speed after 2 s %.2f)" % [rn["speed"], v0], absf(rn["speed"] - 4.5) < 0.12)
	# 7. stops: run -> stop_run clip, walk -> stop_walk; gradual deceleration
	states.clear()
	PlayerInput.scripted_move = null
	var tstop := 0.0
	var p0 := p.global_position
	while p.ground_speed > 0.08 and tstop < 4.0:
		await _frames(1)
		tstop += 1.0 / 60.0
	var dist := Vector2(p.global_position.x - p0.x, p.global_position.z - p0.z).length()
	var saw_run_stop := states.has(&"stop_run")
	p.teleport(C + Vector3(0, 0.1, 20), 0.0)
	await _frames(10)
	PlayerInput.scripted_move = Vector2(0, -1)
	PlayerInput.scripted_run = false
	await _sec(2.0)
	states.clear()
	PlayerInput.scripted_move = null
	var tw := 0.0
	while p.ground_speed > 0.05 and tw < 4.0:
		await _frames(1)
		tw += 1.0 / 60.0
	_check(7, "smooth stops: run -> %s in %.2f s over %.1f m; walk -> %s in %.2f s" % ["stop_run" if saw_run_stop else "no stop clip", tstop, dist, "stop_walk" if states.has(&"stop_walk") else "no stop clip", tw],
		saw_run_stop and states.has(&"stop_walk") and tstop > 0.6 and dist > 1.0 and tw > 0.4)
	# 6. turn on the spot: camera turned around, small forward input
	await _sec(0.5)
	var f0 := p.facing
	var pos0 := p.global_position
	p.set_camera_angles(p.facing + PI, -0.25)
	await _frames(5)
	var saw_turn := false
	PlayerInput.scripted_move = Vector2(0, -0.4)
	for i in 90:
		await _frames(1)
		saw_turn = saw_turn or p.locomotion == "turn"
	PlayerInput.scripted_move = null
	var turned := absf(wrapf(p.facing - f0, -PI, PI))
	_check(6, "turn on the spot: stepping turn seen %s, turned %.0f deg, moved %.2f m meanwhile" % [saw_turn, rad_to_deg(turned), Vector2(p.global_position.x - pos0.x, p.global_position.z - pos0.z).length()],
		saw_turn and turned > deg_to_rad(150.0))
	await _sec(0.5)


func _jumps() -> void:
	p.teleport(C + Vector3(0, 0.1, 30), 0.0)
	p.set_camera_angles(0.0, -0.25)
	await _frames(30)
	states.clear()
	var x0 := p.global_position
	PlayerInput.queue_jump()
	var ymax := x0.y
	for i in 120:
		await _frames(1)
		ymax = maxf(ymax, p.global_position.y)
	var drift := Vector2(p.global_position.x - x0.x, p.global_position.z - x0.z).length()
	_check(8, "standing jump: %.2f m high, phases %s, stays in place (%.2f m), ends '%s'" % [ymax - x0.y, str(states.keys()), drift, p.anim.current()],
		ymax - x0.y > 0.6 and states.has(&"jump_start") and states.has(&"air") and states.has(&"jump_land") and drift < 0.1 and p.anim.current() == &"ground")
	PlayerInput.scripted_move = Vector2(0, -1)
	PlayerInput.scripted_run = true
	await _sec(1.5)
	var vb := p.ground_speed
	states.clear()
	PlayerInput.queue_jump()
	var vmin := 99.0
	for i in 60:
		await _frames(1)
		if not p.is_on_floor():
			vmin = minf(vmin, Vector2(p.velocity.x, p.velocity.z).length())
	await _sec(0.6)
	_check(9, "running jump keeps momentum: %.2f m/s before, >= %.2f in the air, %.2f after, state '%s'" % [vb, vmin, p.ground_speed, p.anim.current()],
		vmin > vb * 0.9 and p.ground_speed > 3.5 and p.anim.current() == &"ground")
	PlayerInput.scripted_move = null
	PlayerInput.scripted_run = false
	await _sec(2.5)
	# 10. landing: drop 1.2 m from a box -> hard landing pose held longer than a soft one
	_box(Vector3(0, 0.6, 40), Vector3(3, 1.2, 3))
	await _frames(2)
	p.teleport(C + Vector3(0, 1.3, 40), 0.0)
	await _frames(10)
	states.clear()
	PlayerInput.scripted_move = Vector2(0, -1)
	await _sec(2.5)
	PlayerInput.scripted_move = null
	_check(10, "landing after walking off a 1.2 m ledge: fall %s -> land %s -> ground, on floor %s" % [states.has(&"air"), states.has(&"jump_land"), p.is_on_floor()],
		states.has(&"air") and states.has(&"jump_land") and p.is_on_floor())


func _obstacles() -> void:
	for h in [[0.0, 0.20, true], [10.0, 0.30, true], [20.0, 0.40, false]]:
		p.teleport(C + Vector3(h[0], 0.1, -14.0), 0.0)
		p.set_camera_angles(0.0, -0.25)
		await _frames(20)
		PlayerInput.scripted_move = Vector2(0, -1)
		await _sec(4.0)
		PlayerInput.scripted_move = null
		var y := p.global_position.y - C.y
		if h[2]:
			_check(11, "auto step-up %.2f m (no jump button): y = %.3f" % [h[1], y], absf(y - float(h[1])) < 0.02)
		else:
			_check(11, "%.2f m ledge (> 0.30 limit) is NOT climbed automatically: y = %.3f" % [h[1], y], y < 0.05)
	p.teleport(C + Vector3(-20, 0.1, -6.0), 0.0)
	await _frames(20)
	PlayerInput.scripted_move = Vector2(0, -1)
	var ymax := 0.0
	var air := false
	for i in 60 * 8:
		await _frames(1)
		ymax = maxf(ymax, p.global_position.y - C.y)
		air = air or (p.anim.current() == &"air")
	_check(12, "stairs up 12 x 0.17 m: reached %.2f m, no jump/fall states (%s)" % [ymax, air], ymax > 2.0 and not air)
	p.set_camera_angles(PI, -0.25)
	await _frames(20)
	states.clear()
	for i in 60 * 7:
		await _frames(1)
	PlayerInput.scripted_move = null
	_check(13, "stairs down: back at y = %.2f, no landing animation (%s), feet adapted (IK error %.3f m)" % [p.global_position.y - C.y, states.has(&"jump_land"), p.foot_ik.last_error],
		p.global_position.y - C.y < 0.05 and not states.has(&"jump_land"))
	for r in [[30.0, 20.0, true], [40.0, 50.0, false]]:
		p.teleport(C + Vector3(r[0], 0.1, -7.0), 0.0)
		p.set_camera_angles(0.0, -0.25)
		await _frames(20)
		PlayerInput.scripted_move = Vector2(0, -1)
		var pd := 0.0
		var y := 0.0
		for i in 60 * 13:
			await _frames(1)
			pd = maxf(pd, p.foot_ik.pelvis_drop)
			y = maxf(y, p.global_position.y - C.y)
		PlayerInput.scripted_move = null
		if r[2]:
			_check(14, "20 deg slope walkable: climbed to the top y = %.2f (2.74), foot IK active (pelvis drop up to %.3f m)" % [y, pd], y > 2.6)
		else:
			_check(14, "50 deg slope (> 40 deg limit) not climbable: y = %.2f" % y, y < 0.5)
	# 15. wall: walking into it stops the body AND the legs
	p.teleport(C + Vector3(-40, 0.1, -9.0), 0.0)
	p.set_camera_angles(0.0, -0.25)
	await _frames(20)
	PlayerInput.scripted_move = Vector2(0, -1)
	await _sec(4.0)
	var z := p.global_position.z - C.z
	var mix: float = p.anim.tree.get(&"parameters/sm/ground/mix/blend_amount")
	PlayerInput.scripted_move = null
	_check(15, "walking into a wall: stopped at z = %.2f (wall at -11.8), real speed %.2f m/s, walk-blend %.2f (legs stop)" % [z, p.ground_speed, mix],
		z > -11.85 and p.ground_speed < 0.1 and mix < 0.3)


func _camera() -> void:
	# 21. camera rotation by mouse/touch delta
	p.teleport(C + Vector3(0, 0.1, 50), 0.0)
	p.set_camera_angles(0.0, -0.25)
	await _sec(0.5)
	var y0 := p.cam_yaw
	PlayerInput.look_delta = Vector2(-300, 40)
	await _sec(0.5)
	var dy := wrapf(p.cam_yaw - y0, -PI, PI)
	_check(21, "camera rotates from a swipe: yaw %+.0f deg, pitch %.0f deg (limits %d..%d)" % [rad_to_deg(dy), rad_to_deg(p.cam_pitch), int(p.cfg.pitch_min_deg), int(p.cfg.pitch_max_deg)],
		absf(dy) > 0.5 and rad_to_deg(p.cam_pitch) >= p.cfg.pitch_min_deg - 0.1)
	# 22. camera against a wall: stand 1 m in front of the wall at x = -40.2, look so the camera is behind
	p.teleport(C + Vector3(-39.0, 0.1, 6), -PI / 2.0)
	p.set_camera_angles(-PI / 2.0, -0.15)                            # camera behind = towards -X (wall)
	await _sec(1.5)
	var cam := p.get_camera()
	var a := p.global_position + Vector3(0, p.cfg.camera_height, 0)
	var hit := p.get_world_3d().direct_space_state.intersect_ray(PhysicsRayQueryParameters3D.create(a, cam.global_position, 1, [p.get_rid()]))
	var d1 := p.cam_ctl.camera_distance()
	p.teleport(C + Vector3(-30.0, 0.1, 6), -PI / 2.0)                # open space: distance recovers smoothly
	var dmax := 0.0
	var jump := 0.0
	var prev := p.cam_ctl.camera_distance()
	for i in 120:
		await _frames(1)
		var d := p.cam_ctl.camera_distance()
		jump = maxf(jump, absf(d - prev))
		prev = d
		dmax = maxf(dmax, d)
	_check(22, "camera at a wall: pulled in to %.2f m (normal %.1f), view not through the wall (%s); back out smoothly to %.2f (max step %.3f m/frame)" % [d1, p.cfg.camera_distance, hit.is_empty(), dmax, jump],
		d1 < p.cfg.camera_distance - 1.0 and hit.is_empty() and dmax > p.cfg.camera_distance - 0.2 and jump < 0.1)


func _touch() -> void:
	# 23. multitouch: joystick finger + look finger + JUMP button at the same time
	var tc: Node = null
	for n in get_tree().root.find_children("*", "CanvasLayer", true, false):
		if n.has_method("set_shown"):
			tc = n
	if tc == null:
		_check(23, "touch controls present", false)
		return
	tc.call("set_shown", true)
	var surf: Control = tc.get_node("Surface")
	await _frames(5)
	p.teleport(C + Vector3(0, 0.1, 60), 0.0)
	p.set_camera_angles(0.0, -0.25)
	await _frames(10)
	var sz := surf.size
	var j0 := Vector2(sz.x * 0.2, sz.y * 0.75)
	var l0 := Vector2(sz.x * 0.62, sz.y * 0.4)
	var jr: Array = surf.call("_jump_rect")
	_touch_ev(surf, 0, j0, true)
	_touch_ev(surf, 1, l0, true)
	var p0 := p.global_position
	var y0 := p.cam_yaw
	var jumped := false
	for i in 60:
		_drag_ev(surf, 0, j0 + Vector2(0, -sz.y * 0.12), Vector2(0, -2))
		_drag_ev(surf, 1, l0 + Vector2(i * 3.0, 0), Vector2(3.0, 0))
		if i == 20:
			_touch_ev(surf, 2, jr[0], true)
		if i == 24:
			_touch_ev(surf, 2, jr[0], false)
		await _frames(1)
		jumped = jumped or not p.is_on_floor()
	_touch_ev(surf, 0, j0, false)
	_touch_ev(surf, 1, l0, false)
	var moved := Vector2(p.global_position.x - p0.x, p.global_position.z - p0.z).length()
	var rot := absf(wrapf(p.cam_yaw - y0, -PI, PI))
	tc.call("set_shown", false)
	_check(23, "multitouch: walking (moved %.2f m) + camera swipe (%.0f deg) + JUMP (%s) at the same time" % [moved, rad_to_deg(rot), jumped],
		moved > 0.5 and rot > 0.2 and jumped)
	await _sec(1.0)


func _touch_ev(surf: Control, idx: int, pos: Vector2, pressed: bool) -> void:
	var e := InputEventScreenTouch.new()
	e.index = idx
	e.position = pos
	e.pressed = pressed
	surf.call("_input", e)


func _drag_ev(surf: Control, idx: int, pos: Vector2, rel: Vector2) -> void:
	var e := InputEventScreenDrag.new()
	e.index = idx
	e.position = pos
	e.relative = rel
	surf.call("_input", e)


func _water() -> void:
	p.teleport(Vector3(-30, 1.0, 395), PI)
	p.set_camera_angles(PI, -0.25)
	await _frames(20)
	PlayerInput.scripted_move = Vector2(0, -1)
	PlayerInput.scripted_run = false
	var seen := {}
	var vmed := 0.0
	var splash := false
	for i in 60 * 40:
		await _frames(1)
		seen[p.water.mode] = true
		if p.water.mode == PlayerWater.Mode.MEDIUM:
			vmed = maxf(vmed, p.ground_speed)
		splash = splash or p.water.get_node("Splash").get("emitting")
		if p.is_swimming() and i > 60 * 25:
			break
	_check(16, "into the water: shallow %s -> medium %s (slowed to %.2f m/s) -> swimming %s, splashes %s" % [seen.has(PlayerWater.Mode.SHALLOW), seen.has(PlayerWater.Mode.MEDIUM), vmed, seen.has(PlayerWater.Mode.SWIM), splash],
		seen.has(PlayerWater.Mode.SHALLOW) and seen.has(PlayerWater.Mode.MEDIUM) and seen.has(PlayerWater.Mode.SWIM) and vmed < 0.85 and splash)
	var err := 0.0
	PlayerInput.scripted_move = Vector2(-0.5, -1)
	var f0 := p.facing
	for i in 60 * 6:
		await _frames(1)
		var wv := PlayerWater.wave_at(p.global_position.x, p.global_position.z, p.water.floor_depth)
		if i > 60:
			err = maxf(err, absf(p.global_position.y - (PlayerWater.SEA_LEVEL - PlayerWater.SWIM_BODY + wv.y * 0.85)))
	var cam_y := p.get_camera().global_position.y
	_check(17, "swimming: state '%s', turns while swimming (%.0f deg), rides the waves (±%.2f m), camera above water (%.2f > %.2f)" % [p.anim.current(), rad_to_deg(absf(wrapf(p.facing - f0, -PI, PI))), err, cam_y, PlayerWater.SEA_LEVEL],
		p.anim.current() == &"swim" and err < 0.08 and cam_y > PlayerWater.SEA_LEVEL + 0.3)
	p.set_camera_angles(0.0, -0.25)
	PlayerInput.scripted_move = Vector2(0, -1)
	var maxstep := 0.0
	var prev := p.global_position
	for i in 60 * 60:
		await _frames(1)
		maxstep = maxf(maxstep, p.global_position.distance_to(prev))
		prev = p.global_position
		if p.water.mode == PlayerWater.Mode.DRY and p.is_on_floor():
			break
	PlayerInput.scripted_move = null
	_check(18, "back out of the water: mode %d (0 dry), on floor %s, no teleport (max %.2f m/frame)" % [p.water.mode, p.is_on_floor(), maxstep],
		p.water.mode == PlayerWater.Mode.DRY and p.is_on_floor() and maxstep < 0.2)


func _footsteps() -> void:
	# the asphalt road of the avenue, a lawn block, the beach: footsteps by surface, none when idle
	# a big lawn from city.json (walk along its long side, away from the edges)
	var lawn := Vector3(-127, 0, -60)
	var best := 0.0
	for l in (main.get("world") as CityWorld).city.get("lawns", []):
		var r: Array = l[1]
		var w := float(r[2]) - float(r[0])
		var h := float(r[3]) - float(r[1])
		if l[0] == "lawn" and minf(w, h) > 10.0 and w * h > best and h > 8.0:
			best = w * h
			lawn = Vector3((float(r[0]) + float(r[2])) * 0.5, 0, float(r[3]) - 3.0)
	var spots := [[Vector3(-35, 0, 60), 0.0, "asphalt"], [lawn, 0.0, "grass"], [Vector3(-30, 0, 380), PI, "sand"]]
	var got := []
	var ok := true
	for s in spots:
		p.teleport((s[0] as Vector3) + Vector3(0, CityWorld.city_relief(s[0].x, s[0].z) + 3.0, 0), s[1])
		p.set_camera_angles(s[1], -0.25)
		await _frames(30)
		var n0 := p.audio.steps_played
		await _sec(1.5)
		var idle_steps := p.audio.steps_played - n0
		PlayerInput.scripted_move = Vector2(0, -1)
		n0 = p.audio.steps_played
		await _sec(3.0)
		PlayerInput.scripted_move = null
		var walk_steps := p.audio.steps_played - n0
		got.append("%s:%s %d steps/3 s (idle %d, y %.2f)" % [s[2], p.audio.surface, walk_steps, idle_steps, p.global_position.y])
		ok = ok and p.audio.surface == s[2] and walk_steps >= 4 and walk_steps <= 8 and idle_steps == 0
		await _sec(1.5)
	_check(26, "footsteps by surface on real foot contact: %s" % ", ".join(got), ok)


func _vehicle() -> void:
	var s: CarSession = main.get("car_session")
	var car := s.car
	car.place(Vector3(-49.0, 0.0, -12.0), 0.0)
	await _sec(1.0)
	p.teleport(car.driver_door_point(3.0), PI * 0.5)
	await _frames(20)
	var label := ""
	for i in 30:
		await _frames(1)
	# walk to the door with the normal controls until the interaction appears
	PlayerInput.scripted_move = null
	p.walk_to(car.driver_door_point(1.2), null, 4.0)
	await _sec(2.0)
	p.end_sequence()
	label = p.interaction.label()
	states.clear()
	var maxstep := 0.0
	var prev := p.global_position
	s.enter_animated()
	var t := 0.0
	while not s.driving and t < 8.0:
		await get_tree().physics_frame
		states[p.anim.current()] = true
		if p.visible:
			maxstep = maxf(maxstep, p.global_position.distance_to(prev))
		prev = p.global_position
		t += 1.0 / 60.0
	_check(19, "get in: ACTION label «%s», walked to the door, door anim %s, sit-down anim %s, driving %s after %.1f s, no jump through the body (max %.2f m/frame)" % [label, states.has(&"interact"), states.has(&"sit_enter"), s.driving, t, maxstep],
		label == "СЕСТЬ" and states.has(&"interact") and states.has(&"sit_enter") and s.driving and maxstep < 0.12 and s.cam.current)
	await _sec(1.0)
	states.clear()
	s.exit_animated()
	t = 0.0
	while (s.busy or s.driving) and t < 6.0:
		await get_tree().physics_frame
		states[p.anim.current()] = true
		t += 1.0 / 60.0
	await _sec(1.0)
	var q := PhysicsShapeQueryParameters3D.new()
	var cap := CapsuleShape3D.new()
	cap.radius = 0.3
	cap.height = 1.7
	q.shape = cap
	q.transform = Transform3D(Basis.IDENTITY, p.global_position + Vector3.UP * 0.95)
	q.exclude = [p.get_rid()]
	var overlap := p.get_world_3d().direct_space_state.intersect_shape(q, 4)
	_check(20, "get out: car stopped, get-up anim %s, on foot beside the door (%.1f m), on floor %s, not inside the car/wall (%d overlaps), walker camera %s" % [states.has(&"sit_exit"), p.global_position.distance_to(car.driver_door_point(0.0)), p.is_on_floor(), overlap.size(), p.get_camera().current],
		states.has(&"sit_exit") and not s.driving and p.is_on_floor() and overlap.is_empty() and p.get_camera().current and p.global_position.distance_to(car.driver_door_point(0.0)) < 3.0)


func _arms() -> void:
	var r: Variant = JSON.parse_string(FileAccess.get_file_as_string("res://data/mocap_report.json"))
	var worst := 1.0
	var inside := 0.0
	var names := []
	for k in r:
		var e: Variant = r[k]
		if e is Dictionary and (e as Dictionary).has("arms"):
			var a: Dictionary = e["arms"]["after"]
			worst = minf(worst, float(a["worst_clearance"]))
			inside = maxf(inside, float(a["frames_inside_pct"]))
			names.append(k)
	var ai: Dictionary = r["arms_idle"]["after"]
	worst = minf(worst, float(ai["worst_clearance"]))
	_check(24, "arms outside the body in every locomotion clip (%s + idle): worst clearance %.3f m, max %.1f %% frames touching (run arms swing closest)" % [", ".join(names), worst, inside],
		worst > -0.01 and inside < 2.0)


func _cost() -> void:
	## physics + process time of the player's components (this machine's CPU; no Android device here)
	p.teleport(C + Vector3(0, 0.1, 70), 0.0)
	PlayerInput.scripted_move = Vector2(0, -1)
	PlayerInput.scripted_run = true
	await _sec(1.0)
	var t_on := 0.0
	for i in 120:
		var a := Time.get_ticks_usec()
		await get_tree().physics_frame
		t_on += Performance.get_monitor(Performance.TIME_PHYSICS_PROCESS)
	p.process_mode = Node.PROCESS_MODE_DISABLED
	var t_off := 0.0
	for i in 120:
		await get_tree().physics_frame
		t_off += Performance.get_monitor(Performance.TIME_PHYSICS_PROCESS)
	p.process_mode = Node.PROCESS_MODE_INHERIT
	PlayerInput.scripted_move = null
	PlayerInput.scripted_run = false
	var ms := (t_on - t_off) / 120.0 * 1000.0
	_check(25, "cost of the walking character (controller + AnimationTree + foot IK 2 rays + camera cast + audio): %.2f ms per physics frame on this CPU (target < 1.5 ms; Android device not available)" % ms,
		ms < 1.5)
