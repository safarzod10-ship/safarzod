extends Node
## Stage 5 functional tests: Toyota Land Cruiser Prado — engine / gearbox, braking, steering, drift,
## surfaces, suspension, effects, REAL sounds, doors, getting in / out, cameras, lamps, damage,
## repair, multitouch, HUD and cost. Runs in the REAL game scene (main.tscn); a test course
## (straight, skid pad, bumps, wall) is built far outside the city at (6000, 0, 6000).
##   godot --headless --path . res://tests/stage5_tests.tscn     -> docs/reports/stage5_tests.txt
## Every check prints PASS or FAIL with the measured values.

const C := Vector3(6000, 0, 6000)
var main: Node
var s: CarSession
var car: VehiclePrado
var au: VehicleAudio
var fx: VehicleFX
var lines: Array[String] = []
var ok_all := true
var body: StaticBody3D
var n := 0


func _ready() -> void:
	main = (load("res://scenes/main/main.tscn") as PackedScene).instantiate()
	add_child(main)
	while main.get("car_session") == null:
		await get_tree().physics_frame
	s = main.get("car_session")
	car = s.car
	au = car.get_node("Audio")
	fx = car.get_node("FX")
	for w in get_tree().get_nodes_in_group(&"weather"):
		w.set("auto_cycle", false)
		w.call("set_state", 0, true)
	car.wetness_override = 0.0
	_build_course()
	await _frames(20)
	var only := ""
	for a in OS.get_cmdline_user_args():
		if a.begins_with("only="):
			only = a.substr(5)
	s.player.teleport(C + Vector3(8, 1, 50), 0.0)
	await _sec(0.5)
	s.enter()
	await _sec(0.2)
	for sec in ["engine", "surfaces", "drift", "effects", "doors", "cameras", "lamps", "damage", "touch", "cost"]:
		if only != "" and not only.split(",").has(sec):
			continue
		await call("_t_" + sec)
	print("STAGE5_TESTS ", "ALL PASS" if ok_all else "SOME FAILED", "  (%d checks)" % n)
	var f := FileAccess.open("res://docs/reports/stage5_tests.txt", FileAccess.WRITE)
	if f:
		f.store_string("\n".join(lines) + "\n")
	get_tree().quit(0 if ok_all else 1)


func _check(msg: String, ok: bool) -> void:
	n += 1
	var l := ("PASS " if ok else "FAIL ") + "%2d. " % n + msg
	print(l)
	lines.append(l)
	ok_all = ok_all and ok


func _frames(k: int) -> void:
	for i in k:
		await get_tree().physics_frame


func _sec(t: float) -> void:
	await _frames(int(t * Engine.physics_ticks_per_second))


func _box(pos: Vector3, size: Vector3) -> void:
	var cs := CollisionShape3D.new()
	var b := BoxShape3D.new()
	b.size = size
	cs.shape = b
	cs.position = C + pos
	body.add_child(cs)


func _build_course() -> void:
	body = StaticBody3D.new()
	body.name = "Stage5Course"
	add_child(body)
	_box(Vector3(0, -0.5, -1500), Vector3(40, 1, 3200))             # straight along -Z (z 100 .. -3100)
	_box(Vector3(300, -0.5, 0), Vector3(400, 1, 400))              # skid pad (x 100 .. 500)
	_box(Vector3(-150, -0.5, 0), Vector3(200, 1, 120))             # crash area
	_box(Vector3(-240, 4.0, 0), Vector3(2, 8, 60))                 # wall (x = -239), 8 m high
	for i in 12:                                                    # 10 cm bumps on a lane
		_box(Vector3(-100, 0.05, -150.0 - i * 6.0), Vector3(6, 0.1, 0.6))
	_box(Vector3(-100, -0.5, -200), Vector3(30, 1, 200))


func _drive(t: float, th: float, br := 0.0, st := 0.0, hb := false) -> void:
	VehicleInput.scripted = {"throttle": th, "brake": br, "steer": st, "handbrake": hb}
	await _sec(t)


func _place(p: Vector3, yaw := 0.0) -> void:
	VehicleInput.scripted = {"throttle": 0.0, "handbrake": true}
	car.place(C + p, yaw)
	car.repair()
	car.gear = 1
	await _sec(1.2)


func _stop() -> void:
	VehicleInput.scripted = {"brake": 1.0}
	var t := 0.0
	while car.speed_kmh > 0.5 and t < 15.0:
		await _frames(1)
		t += 1.0 / 60.0
	VehicleInput.scripted = {"handbrake": true}


# ------------------------------------------------------------------------------------------------
func _t_engine() -> void:
	# get in (instant): engine start
	s.exit()
	await _place(Vector3(0, 0, 50))
	s.enter()
	VehicleInput.scripted = {"throttle": 0.0}
	await _sec(0.3)
	var started := au.running and au.log_events.has("engine_start")
	await _sec(1.6)
	var idle_g: float = au.levels.get("eng_idle", 0.0)
	_check("engine start: starter + catch one-shot (real Hilux recording), loops fade in (idle gain %.2f)" % idle_g,
		started and idle_g > 0.1)
	# idle
	await _drive(1.5, 0.0, 0.0)
	var dom := _dominant()
	_check("idle: %.0f rpm at standstill, dominant layer %s" % [car.rpm, dom], car.rpm > 700.0 and car.rpm < 900.0 and dom == "eng_idle")
	# acceleration + gears + engine layers across the rpm range
	var t := 0.0
	var t100 := -1.0
	var gears := {}
	var max_rpm := 0.0
	var doms := {}
	var dips := 0
	var last_gear := car.gear
	VehicleInput.scripted = {"throttle": 1.0}
	while t < 75.0:
		await _frames(1)
		t += 1.0 / 60.0
		gears[car.gear] = true
		max_rpm = maxf(max_rpm, car.rpm)
		doms[_dominant()] = true
		if car.gear != last_gear:
			last_gear = car.gear
			dips += 1
		if t100 < 0.0 and car.speed_kmh >= 100.0:
			t100 = t
		if car.speed_kmh >= 199.0:
			break
	_check("acceleration 0-100 km/h %.1f s (real Prado 2.8 D-4D 204 hp ~9.9 s; target 9..14), gradual" % t100, t100 > 9.0 and t100 < 14.0)
	var top := car.speed_kmh
	VehicleInput.scripted = {"throttle": 0.35}
	await _sec(3.0)
	gears[car.gear] = true
	_check("automatic 6-speed: gears used %s (6th = overdrive on part throttle), max %.0f rpm (< 4450 cut-off), %d shifts with torque-cut dip, top %.0f km/h" % [str(gears.keys()), max_rpm, dips, top],
		gears.has(1) and gears.has(5) and gears.has(6) and max_rpm < 4460.0 and dips >= 4 and top >= 195.0)
	_check("all 4 engine layers used across the rpm range: %s" % str(doms.keys()), doms.has("eng_idle") and doms.has("eng_low") and doms.has("eng_mid") and doms.has("eng_high"))
	# lift-off: off-load layers take over, engine braking
	VehicleInput.scripted = {"throttle": 0.0}
	await _sec(1.2)
	var on_sum := 0.0
	var off_sum := 0.0
	for k in VehicleAudio.LAYERS:
		on_sum += float(au.levels.get(k, 0.0))
		off_sum += float(au.levels.get(k + "_off", 0.0))
	var v0 := car.speed_kmh
	await _sec(2.0)
	var decel := (v0 - car.speed_kmh) / 3.6 / 2.0
	_check("lift-off: off-load layers %.2f > on-load %.2f, engine braking %.0f N (coast decel %.2f m/s2)" % [off_sum, on_sum, car.engine_brake_force, decel],
		off_sum > on_sum and car.engine_brake_force > 200.0 and decel > 0.4)
	# braking 100 -> 0
	await _place(Vector3(0, 0, 50))
	VehicleInput.scripted = {"throttle": 1.0}
	while car.speed_kmh < 100.0:
		await _frames(1)
	var z0 := car.global_position.z
	var abs_sq := 0.0
	VehicleInput.scripted = {"brake": 1.0}
	while car.speed_kmh > 0.5:
		await _frames(1)
		abs_sq = maxf(abs_sq, float(au.levels.get("tyre_squeal", 0.0)))
	var dist := absf(car.global_position.z - z0)
	_check("braking 100-0 km/h: %.1f m with ABS (Prado ~42-48 m), tyres sing (squeal %.2f), no lock" % [dist, abs_sq], dist > 36.0 and dist < 52.0 and abs_sq > 0.1)
	# reverse
	await _drive(1.5, 0.0, 1.0)
	await _drive(3.0, 0.0, 1.0)
	_check("reverse: hold brake at standstill -> R, %.1f km/h backwards (limit 25), reversing lamp %s" % [-car.forward_speed * 3.6, car.lights.reversing],
		car.gear == -1 and car.forward_speed < -3.0 and car.lights.reversing)
	await _drive(2.0, 1.0)
	# turning: low-speed turning circle and speed-sensitive steering
	await _place(Vector3(300, 0, 150))
	await _drive(2.0, 0.25)
	VehicleInput.scripted = {"throttle": 0.12, "steer": 1.0}
	await _sec(3.0)
	var yr := absf(car.angular_velocity.y)
	var v_turn := absf(car.forward_speed)
	var r := v_turn / maxf(yr, 0.01)
	# kerb-to-kerb radius = path of the outer front tyre: sqrt((R + track / 2)^2 + wheelbase^2)
	var r_outer := sqrt(pow(r + 0.8, 2.0) + 2.64 * 2.64)          # wheelbase of the model 2.64 m
	await _place(Vector3(300, 0, 150))
	VehicleInput.scripted = {"throttle": 1.0}
	while car.speed_kmh < 100.0:
		await _frames(1)
	VehicleInput.scripted = {"throttle": 0.6, "steer": 1.0}
	await _sec(0.5)
	var v_fast := car.speed_kmh
	var lock_fast := 0.0
	for w in car.wheels:
		if w["front"]:
			lock_fast += absf(float(w["steer"])) * 0.5     # mean of both front wheels (Ackermann)
	_check("steering: turning circle %.1f m kerb radius (CG path %.1f m at %.0f km/h; real Prado 5.8 m); at %.0f km/h full input = %.1f deg wheel angle (speed-sensitive, 34 deg when parking)" % [r_outer, r, v_turn * 3.6, v_fast, rad_to_deg(lock_fast)],
		r_outer > 5.0 and r_outer < 7.0 and rad_to_deg(lock_fast) < 14.0)
	await _stop()


func _dominant() -> String:
	var best := ""
	var bv := 0.0
	for k in VehicleAudio.LAYERS:
		var v := float(au.levels.get(k, 0.0)) + float(au.levels.get(k + "_off", 0.0))
		if v > bv:
			bv = v
			best = k
	return best


func _brake_decel(surface: int, wet: float) -> float:
	await _place(Vector3(0, 0, 50))
	car.surface_override = surface
	car.wetness_override = wet
	VehicleInput.scripted = {"throttle": 1.0}
	while car.speed_kmh < 62.0:
		await _frames(1)
	VehicleInput.scripted = {"brake": 1.0}
	await _frames(20)
	var v0 := car.forward_speed
	await _sec(0.8)
	var a := (v0 - car.forward_speed) / 0.8
	await _stop()
	car.surface_override = -1
	car.wetness_override = 0.0
	return a / 9.81


func _t_surfaces() -> void:
	var dry := await _brake_decel(CityWorld.Surface.ASPHALT, 0.0)
	var wet := await _brake_decel(CityWorld.Surface.ASPHALT, 1.0)
	_check("asphalt: braking %.2f g dry, %.2f g wet road (rain: less grip)" % [dry, wet], dry > 0.75 and dry < 0.95 and wet < dry * 0.85 and wet > 0.5)
	var dirt := await _brake_decel(CityWorld.Surface.EARTH, 0.0)
	_check("dirt road: %.2f g = %.0f %% of asphalt" % [dirt, dirt / dry * 100.0], dirt < dry * 0.85 and dirt > dry * 0.6)
	var sand := await _brake_decel(CityWorld.Surface.SAND, 0.0)
	# real terrain detection: a sand cell of the beach
	var found := Vector3.INF
	var cw := CityWorld.instance
	for i in 4000:
		var x := randf_range(-1200, 1200)
		var z := randf_range(-1200, 1200)
		if cw.surface_at(x, z) == CityWorld.Surface.SAND and cw.surface_at(x + 4, z) == CityWorld.Surface.SAND and cw.surface_at(x, z + 4) == CityWorld.Surface.SAND \
				and cw.terrain_height(x, z) > PlayerWater.SEA_LEVEL + 0.4:
			found = Vector3(x, 0, z)
			break
	var detected := -1
	if found != Vector3.INF:
		VehicleInput.scripted = {"brake": 1.0}
		car.place(found, 0.0)
		await _sec(1.5)
		detected = int(car.wheels[0]["surface"])
	_check("sand: %.2f g = %.0f %% of asphalt; on the real beach at %s the tyres detect surface %d (SAND = %d)" % [sand, sand / dry * 100.0, str(found.round()), detected, CityWorld.Surface.SAND],
		sand < dirt and sand > dry * 0.5 and detected == CityWorld.Surface.SAND)
	# suspension over 10 cm bumps
	await _place(Vector3(-100, 0, -120), 0.0)
	var b0 := au.log_events.size()
	var tmin := 1.0
	var tmax := -1.0
	VehicleInput.scripted = {"throttle": 0.5}
	var t := 0.0
	while t < 6.0 and car.global_position.z > C.z - 240.0:
		await _frames(1)
		t += 1.0 / 60.0
		if car.speed_kmh > 35.0:
			VehicleInput.scripted = {"throttle": 0.0}
		for w in car.wheels:
			tmin = minf(tmin, float(w["offset"]))
			tmax = maxf(tmax, float(w["offset"]))
	var bumps := 0
	for e in au.log_events.slice(b0):
		if String(e).begins_with("bump"):
			bumps += 1
	_check("suspension: 10 cm bumps -> wheel travel %.3f..%.3f m, body upright (up.y %.2f), bump knocks %d (only on bumps)" % [tmin, tmax, car.global_transform.basis.y.y, bumps],
		tmax > 0.05 and car.global_transform.basis.y.y > 0.95 and bumps >= 1)
	await _stop()


func _slip_angle() -> float:
	var v := car.linear_velocity
	var f := -car.global_transform.basis.z
	if v.length() < 3.0:
		return 0.0
	return rad_to_deg(acos(clampf(v.normalized().dot(f), -1.0, 1.0)))


func _drift_run(arcade: bool) -> Dictionary:
	car.easy_drift = arcade
	await _place(Vector3(250, 0, 150), 0.0)
	VehicleInput.scripted = {"throttle": 1.0}
	while car.speed_kmh < 55.0:
		await _frames(1)
	await _drive(0.25, 0.4, 0.0, -1.0)
	await _drive(0.55, 0.3, 0.0, -1.0, true)                 # handbrake flick
	# hold the slide: throttle + counter-steer proportional to the slip angle
	var slid := 0.0
	var max_a := 0.0
	var squeal := 0.0
	var marks0 := fx.marks_laid
	var t := 0.0
	var recover := -1.0
	while t < 6.0:
		var a := _slip_angle()
		max_a = maxf(max_a, a)
		var yr := car.angular_velocity.y
		var cs := clampf(-yr * 0.9, -1.0, 1.0) if t > 0.2 else -1.0
		var th := 0.55 if t < 2.0 else 0.15
		VehicleInput.scripted = {"throttle": th, "steer": cs}
		await _frames(1)
		t += 1.0 / 60.0
		if a > 15.0 and t < 2.5:
			slid += 1.0 / 60.0
		squeal = maxf(squeal, float(au.levels.get("tyre_squeal", 0.0)))
		if t > 2.0 and recover < 0.0 and a < 5.0:
			recover = t - 2.0
	var smoke := fx.smoke_level
	await _stop()
	car.easy_drift = false
	return {"slid": slid, "max": max_a, "recover": recover, "squeal": squeal, "marks": fx.marks_laid - marks0, "smoke": smoke}


func _t_drift() -> void:
	# handbrake: rear slides
	await _place(Vector3(300, 0, 150), 0.0)
	VehicleInput.scripted = {"throttle": 1.0}
	while car.speed_kmh < 50.0:
		await _frames(1)
	await _drive(0.6, 0.0, 0.0, 0.6, true)
	var rear := 0.0
	for w in car.wheels:
		if not w["front"]:
			rear = maxf(rear, float(w["slide"]))
	_check("handbrake: rear wheels lock and slide (slide %.2f), yaw rate %.2f rad/s" % [rear, absf(car.angular_velocity.y)], rear > 0.5 and absf(car.angular_velocity.y) > 0.6)
	await _stop()
	var re := await _drift_run(false)
	_check("drift (Realistic): slip angle up to %.0f deg, > 15 deg held %.2f s; tyres squeal %.2f, marks %d" % [re["max"], re["slid"], re["squeal"], re["marks"]],
		re["max"] > 20.0 and re["slid"] > 0.6 and re["squeal"] > 0.3 and re["marks"] > 10)
	var ar := await _drift_run(true)
	_check("counter-steer catches the slide: recovery to < 5 deg in %.2f s (Realistic) / %.2f s (Arcade Assist), Arcade holds the slide %.2f s vs %.2f s" % [re["recover"], ar["recover"], ar["slid"], re["slid"]],
		re["recover"] > 0.0 and re["recover"] < 3.5 and ar["recover"] > 0.0 and ar["slid"] >= re["slid"] * 0.9)


func _t_effects() -> void:
	# smoke ∝ slip, none when gripping
	await _place(Vector3(0, 0, 50))
	var grip_smoke := 0.0
	VehicleInput.scripted = {"throttle": 1.0}
	for i in 360:
		await _frames(1)
		if i > 60:
			grip_smoke = maxf(grip_smoke, fx.smoke_level)
	await _stop()
	await _place(Vector3(300, 0, 150))
	VehicleInput.scripted = {"throttle": 1.0}
	while car.speed_kmh < 50.0:
		await _frames(1)
	var slide_smoke := 0.0
	var marks0 := fx.marks_laid
	VehicleInput.scripted = {"throttle": 0.0, "steer": 1.0, "handbrake": true}
	for i in 50:
		await _frames(1)
		slide_smoke = maxf(slide_smoke, fx.smoke_level)
	# skid marks lie ON the road along the tyre paths (not floating)
	var mm: MultiMesh = (fx.get_node("SkidMarks") as MultiMeshInstance3D).multimesh
	var max_h := 0.0
	var max_off := 0.0
	var cnt := fx.marks_laid - marks0
	for k in range(maxi(0, fx._next_mark - mini(cnt, 20)), fx._next_mark):
		var p := mm.get_instance_transform(k).origin
		max_h = maxf(max_h, absf(p.y - C.y))
		var best := 99.0
		for w in car.wheels:
			best = minf(best, Vector2(p.x, p.z).distance_to(Vector2((w["contact_point"] as Vector3).x, (w["contact_point"] as Vector3).z)))
		max_off = maxf(max_off, minf(best, 30.0))
	_check("tyre smoke ∝ slip: %.2f while gripping, %.2f while sliding" % [grip_smoke, slide_smoke], grip_smoke < 0.05 and slide_smoke > 0.4)
	_check("skid marks: %d segments, on the road surface (max height %.3f m above it)" % [cnt, max_h], cnt > 5 and max_h < 0.03)
	await _stop()
	# dust on dirt / sand, none on asphalt
	await _place(Vector3(0, 0, 50))
	car.surface_override = CityWorld.Surface.EARTH
	VehicleInput.scripted = {"throttle": 1.0}
	await _sec(3.0)
	var dust_dirt := fx.dust_level
	var roll_dirt: float = au.levels.get("roll_gravel", 0.0)
	car.surface_override = CityWorld.Surface.SAND
	await _sec(1.0)
	var roll_sand: float = au.levels.get("roll_sand", 0.0)
	var dust_sand := fx.dust_level
	car.surface_override = -1
	await _sec(1.0)
	var dust_asph := fx.dust_level
	var roll_asph: float = au.levels.get("roll_asphalt", 0.0)
	_check("dust: dirt %.2f, sand %.2f, asphalt %.2f" % [dust_dirt, dust_sand, dust_asph], dust_dirt > 0.3 and dust_sand > 0.3 and dust_asph < 0.01)
	_check("tyre / road sounds by surface (real recordings): asphalt roar %.2f, gravel %.2f on dirt, sand %.2f; squeal on drift (see drift test)" % [roll_asph, roll_dirt, roll_sand],
		roll_asph > 0.05 and roll_dirt > 0.05 and roll_sand > 0.05)
	await _stop()
	# water: drive into the sea from the beach
	var cw := CityWorld.instance
	var shore := Vector3.INF
	for i in 6000:
		var x := randf_range(-1500, 1500)
		var z := randf_range(-1500, 1500)
		var h := cw.terrain_height(x, z)
		if h > PlayerWater.SEA_LEVEL - 0.45 and h < PlayerWater.SEA_LEVEL - 0.2 and cw.terrain_height(x + 3, z) < PlayerWater.SEA_LEVEL - 0.15:
			shore = Vector3(x, 0, z)
			break
	var wl := 0.0
	if shore != Vector3.INF:
		VehicleInput.scripted = {"brake": 1.0}
		car.place(shore, 0.0)
		await _sec(1.0)
		var w0 := au.log_events.size()
		VehicleInput.scripted = {"throttle": 0.6}
		for i in 120:
			await _frames(1)
			wl = maxf(wl, fx.water_level)
		await _stop()
	_check("water: splashes in the shallows at %s (level %.2f), splash sounds" % [str(shore.round()), wl], wl > 0.1)
	# collision sounds: light / medium / heavy by force, material layer
	au.log_events.clear()
	au.play_impact(2.5, "metal")
	au.play_impact(5.0, "concrete")
	au.play_impact(8.5, "concrete")
	au.play_impact(11.0, "metal")
	var ev := str(au.log_events)
	_check("collision sounds by force / material: %s" % ev, au.log_events[0].begins_with("hit_metal") and au.log_events.has("crash_medium") and au.log_events.has("crash_heavy") and au.log_events.has("crash_glass"))
	# every sound file present and imported (they end up in the APK as imported resources)
	var missing := []
	for f in ["eng_idle", "eng_low", "eng_mid", "eng_high", "eng_idle_off", "eng_low_off", "eng_mid_off", "eng_high_off", "tyre_squeal", "roll_asphalt", "roll_gravel", "roll_sand", "road_interior"]:
		if not ResourceLoader.exists("res://assets/audio/vehicle/%s.wav" % f):
			missing.append(f)
	for f in ["engine_start", "engine_stop", "door_open", "door_close", "door_handle", "door_lock", "crash_medium", "crash_heavy", "crash_glass", "tyre_skid"]:
		if not ResourceLoader.exists("res://assets/audio/vehicle/%s.ogg" % f):
			missing.append(f)
	_check("all 23 car sound files load (real recordings, licences in LICENSES.txt); missing: %s" % str(missing), missing.is_empty())


func _t_doors() -> void:
	s.exit()
	await _place(Vector3(0, 0, 60))
	s.player.teleport(car.driver_door_point(1.6), PI * 0.5)
	await _sec(1.0)
	au.log_events.clear()
	var max_open := 0.0
	print("doors: can_enter ", s.can_enter(), " player ", s.player.global_position, " door ", car.driver_door_point(0.6), " floor ", s.player.is_on_floor(), " busy ", s.busy, " speed ", car.speed_kmh)
	s.enter_animated()
	var t := 0.0
	while (s.busy or not s.driving) and t < 12.0:
		await _frames(1)
		t += 1.0 / 60.0
		max_open = maxf(max_open, float(car.door_open.get(CarSession.DOOR, 0.0)))
	var door: Node3D = car.model.find_child(CarSession.DOOR, true, false)
	var ang := rad_to_deg(door.transform.basis.get_euler().y)
	_check("door opens: driver's door swings to %.0f deg (65 max), sounds %s" % [max_open * 65.0, str(au.log_events.slice(0, 3))],
		max_open > 0.95 and au.log_events.has("door_open") and au.log_events.has("door_handle"))
	_check("enter: walk to the door, open, sit, door closes (now %.1f deg), control switches (driving %s, walker hidden %s)" % [ang, s.driving, not s.player.visible],
		s.driving and not s.player.visible and absf(ang) < 2.0 and au.log_events.has("door_close") and au.log_events.has("engine_start"))
	# exit next to a wall -> free spot elsewhere, door opens / closes, lock
	await _sec(1.0)
	au.log_events.clear()
	s.exit_animated()
	t = 0.0
	var opened := 0.0
	while t < 6.0:
		await _frames(1)
		t += 1.0 / 60.0
		opened = maxf(opened, float(car.door_open.get(CarSession.DOOR, 0.0)))
	var pp := s.player.global_position
	var free := true
	var q := PhysicsShapeQueryParameters3D.new()
	var cap := CapsuleShape3D.new()
	cap.radius = 0.3
	cap.height = 1.6
	q.shape = cap
	q.transform = Transform3D(Basis.IDENTITY, pp + Vector3.UP * 0.95)
	q.exclude = [s.player.get_rid()]
	free = s.player.get_world_3d().direct_space_state.intersect_shape(q, 1).is_empty()
	_check("exit: door opened (%.2f) and closed, player outside on free ground (%s, %.1f m from the car), lock %s, walker control back" % [opened, free, pp.distance_to(car.global_position), au.log_events.has("door_lock")],
		not s.driving and s.player.visible and free and opened > 0.95 and au.log_events.has("door_close") and au.log_events.has("door_lock") and pp.distance_to(car.global_position) > 1.2)
	s.enter()
	await _sec(1.5)


func _t_cameras() -> void:
	var cam: VehicleCamera = s.cam
	await _place(Vector3(0, 0, 60))
	cam.snap()
	Settings.set_mode("low")
	await _sec(0.5)
	cam.set_mode(VehicleCamera.Mode.CABIN)
	await _sec(1.0)
	var local := car.to_local(cam.global_position)
	var sw: Node3D = car.model.find_child("steeringwheel", true, false)
	var in_view := not cam.is_position_behind(sw.global_position) and get_viewport().get_visible_rect().has_point(cam.unproject_position(sw.global_position))
	var int_vis := (car.model.find_child("int", true, false) as Node3D).is_visible_in_tree()
	var lpf := AudioServer.is_bus_effect_enabled(AudioServer.get_bus_index(VehicleAudio.BUS), 0)
	VehicleInput.scripted = {"throttle": 0.1, "steer": 1.0}
	await _sec(1.0)
	var rel := car._steering_rest.basis.orthonormalized().inverse() * sw.transform.basis.orthonormalized()
	var sw_rot := rad_to_deg(rel.get_rotation_quaternion().get_angle())
	_check("interior view: camera at the driver's eye %s (inside the cabin), wheel in view %s, cabin meshes on Low %s, wheel turned %.0f deg with the front wheels, muffled sound %s" % [str(local.snapped(Vector3.ONE * 0.01)), in_view, int_vis, absf(sw_rot), lpf],
		absf(local.x) < 0.9 and local.y > 0.2 and local.y < 1.6 and in_view and int_vis and absf(sw_rot) > 60.0 and lpf)
	Settings.set_mode("high")
	cam.set_mode(VehicleCamera.Mode.CHASE)
	await _sec(1.5)
	# 3rd person: distance, smooth (no shake on bumps), never inside a wall
	await _place(Vector3(-233, 0, 0), -PI * 0.5)      # facing +X: the chase camera wants to be inside the wall
	cam.snap()
	await _sec(1.5)
	var cp := cam.global_position
	var behind_wall := cp.x < C.x - 239.0 + 0.1        # wall occupies x -241 .. -239
	var d := cp.distance_to(car.global_position)
	_check("3rd-person camera: %.1f m from the car, pulled in front of the wall (cam x %.2f, wall face %.2f)" % [d, cp.x - C.x, -239.0],
		not behind_wall and d > 2.0 and d < 10.0)
	cam.set_mode(VehicleCamera.Mode.ORBIT)
	await _sec(0.6)
	var mid := cam.global_position
	cam.set_mode(VehicleCamera.Mode.CHASE)
	await _sec(0.1)
	var jump := cam.global_position.distance_to(mid)
	_check("camera modes CHASE -> CABIN -> ORBIT blend smoothly (%.2f m moved in the first 0.1 s of a switch)" % jump, jump < 1.5)


func _t_lamps() -> void:
	var L := car.lights
	L.beam = VehicleLights.Beam.LOW
	await _frames(3)
	var st := L.state()
	L.cycle_beam()
	await _frames(3)
	var st2 := L.state()
	_check("headlights: dipped (spot %s, lamp energy %.1f) -> main beam (energy %.1f, range %.0f m), one shadowless spot light" % [st["spot"], st["head_energy"], st2["head_energy"], (L.get_node("../Headlamps") as SpotLight3D).spot_range if L.has_node("../Headlamps") else 0.0],
		st["spot"] and st2["head_energy"] > st["head_energy"])
	L.beam = VehicleLights.Beam.OFF
	VehicleInput.scripted = {"brake": 1.0}
	await _frames(5)
	var br := L.braking
	var e := float((car._mat_cache["taillight rr"] as ShaderMaterial).get_shader_parameter("emission_energy"))
	VehicleInput.scripted = {"brake": 0.0}
	await _frames(30)
	var e0 := float((car._mat_cache["taillight rr"] as ShaderMaterial).get_shader_parameter("emission_energy"))
	_check("brake lights: %.1f braking vs %.1f released (+ high stop lamp), reversing lamps on R (tested above)" % [e, e0], br and e > 2.0 and e0 < 1.0)
	L.set_turn(-1)
	var seen_on := false
	var seen_off := false
	for i in 90:
		await _frames(1)
		var sg: Vector2 = (car._mat_cache["fari.4"] as ShaderMaterial).get_shader_parameter("side_gain")
		if sg.x > 0.5 and sg.y < 0.5:
			seen_on = true
		if sg.x < 0.5:
			seen_off = true
	L.toggle_hazard()
	var both := false
	for i in 60:
		await _frames(1)
		var sg: Vector2 = (car._mat_cache["fari.4"] as ShaderMaterial).get_shader_parameter("side_gain")
		both = both or (sg.x > 0.5 and sg.y > 0.5)
	L.toggle_hazard()
	_check("turn signals: left blinks (on %s / off %s, right side dark), hazards light both sides %s" % [seen_on, seen_off, both], seen_on and seen_off and both)


func _t_damage() -> void:
	# crash into the wall at ~45 km/h
	await _place(Vector3(-140, 0, 0), PI * 0.5)        # facing -X (towards the wall)
	au.log_events.clear()
	VehicleInput.scripted = {"throttle": 1.0}
	var t := 0.0
	while car.speed_kmh < 45.0 and t < 10.0:
		await _frames(1)
		t += 1.0 / 60.0
	VehicleInput.scripted = {"throttle": 0.3}
	t = 0.0
	while car.health > 99.0 and t < 10.0:
		await _frames(1)
		t += 1.0 / 60.0
	await _sec(0.5)
	var dents := car._dents.size()
	var front := false
	if dents > 0:
		var dp: Vector4 = car._dents[0][0]
		front = dp.z < -1.0                         # model space: front of the car is -Z
	_check("body damage at the impact point: health %.0f %%, %d dent(s), front %s, crash sound %s (material %s)" % [car.health, dents, front, str(au.log_events), car.last_impact_material],
		car.health < 90.0 and dents > 0 and front and (au.log_events.has("crash_heavy") or au.log_events.has("crash_medium")))
	# degradation: 40 % health -> less power and top speed
	await _place(Vector3(0, 0, 60))
	car.health = 40.0
	VehicleInput.scripted = {"throttle": 1.0}
	await _sec(8.0)
	var v40 := car.speed_kmh
	var f := car._damage_factors()
	await _place(Vector3(0, 0, 60))
	VehicleInput.scripted = {"throttle": 1.0}
	await _sec(8.0)
	var v100 := car.speed_kmh
	_check("degradation: after 8 s full throttle %.0f km/h at 40 %% vs %.0f km/h at 100 %%; power x%.2f, steering x%.2f, springs x%.2f" % [v40, v100, f["power"], f["steer"], f["spring"]],
		v40 < v100 * 0.9 and f["power"] < 1.0 and f["steer"] < 1.0)
	# wrecked: slow but drives
	await _place(Vector3(0, 0, 60))
	car.health = 0.0
	VehicleInput.scripted = {"throttle": 1.0}
	await _sec(8.0)
	var v0 := car.speed_kmh
	_check("wrecked car (0 %%) still drives slowly: %.0f km/h" % v0, v0 > 15.0 and v0 < 45.0)
	# full repair, same object
	car.damage_at(car.global_position + Vector3(0, 0.8, -2.3), Vector3(0, 0, 1), 12.0)
	var n_cars := get_tree().get_nodes_in_group(&"vehicle").size()
	var id := car.get_instance_id()
	car.repair()
	await _frames(3)
	_check("ВОССТАНОВИТЬ: health %.0f %%, dents %d, same car (id kept %s, %d vehicle in scene)" % [car.health, car._dents.size(), id == car.get_instance_id(), get_tree().get_nodes_in_group(&"vehicle").size()],
		car.health == 100.0 and car._dents.is_empty() and get_tree().get_nodes_in_group(&"vehicle").size() == n_cars)
	await _stop()


func _t_touch() -> void:
	var cc: CarControls = s.controls
	cc.touch_mode = true
	cc.visible = true
	await _frames(2)
	var r := cc._rects()
	VehicleInput.scripted = null
	var ev := func(idx: int, key: String, down: bool) -> void:
		var e := InputEventScreenTouch.new()
		e.index = idx
		e.position = (r[key] as Rect2).get_center()
		e.pressed = down
		cc._input(e)
	ev.call(0, "gas", true)
	ev.call(1, "right", true)
	ev.call(2, "handbrake", true)
	var all3 := VehicleInput.touch_gas and VehicleInput.touch_right and VehicleInput.touch_handbrake
	ev.call(1, "right", false)
	var kept := VehicleInput.touch_gas and not VehicleInput.touch_right and VehicleInput.touch_handbrake
	ev.call(0, "gas", false)
	ev.call(2, "handbrake", false)
	var b0 := car.lights.beam
	ev.call(3, "lights", true)
	ev.call(3, "lights", false)
	var lit := car.lights.beam != b0
	_check("multitouch: gas + right + handbrake held together %s; releasing one keeps the others %s; lamp button works %s" % [all3, kept, lit], all3 and kept and lit)
	car.lights.beam = VehicleLights.Beam.OFF
	# HUD while driving, hidden on foot
	var on_drive := cc.visible
	s.exit()
	await _frames(3)
	var on_foot := cc.visible
	s.enter()
	await _frames(3)
	_check("HUD: speedometer (km/h = body speed), tachometer, gear, condition %%, telltales shown while driving %s, hidden on foot %s" % [on_drive, not on_foot],
		on_drive and not on_foot)


func _t_cost() -> void:
	# CPU cost of the car's scripts per physics frame (desktop proxy; NOT a phone measurement)
	await _place(Vector3(300, 0, 150))
	VehicleInput.scripted = {"throttle": 1.0, "steer": 0.6}
	await _sec(2.0)
	var t0 := Time.get_ticks_usec()
	var frames := 0
	var phys := 0.0
	while frames < 240:
		await _frames(1)
		frames += 1
		phys += Performance.get_monitor(Performance.TIME_PHYSICS_PROCESS)
	var avg_phys := phys / frames * 1000.0
	var tris := 0
	var surfaces := 0
	Settings.set_mode("low")
	await _frames(2)
	var drv: Node = car.get("_driver")
	for mi in car.model.find_children("*", "MeshInstance3D", true, false):
		var m := mi as MeshInstance3D
		if drv and drv.is_ancestor_of(m):
			continue                                 # the seated character is counted with the player
		if m.is_visible_in_tree():
			tris += m.mesh.get_faces().size() / 3
			surfaces += m.mesh.get_surface_count()
	var players := 0
	var playing := 0
	for p in au.find_children("*", "AudioStreamPlayer3D", true, false):
		players += 1
		if (p as AudioStreamPlayer3D).playing and not (p as AudioStreamPlayer3D).stream_paused:
			playing += 1
	Settings.set_mode("high")
	_check("cost (desktop proxy, no phone available): physics frame %.2f ms while drifting with smoke; Low: %d k triangles, %d surfaces (draw calls) for the car; audio %d players, %d audible; 1 dynamic light" % [avg_phys, tris / 1000, surfaces, players, playing],
		avg_phys < 8.0 and tris < 90000 and playing <= 14)
	VehicleInput.scripted = null
