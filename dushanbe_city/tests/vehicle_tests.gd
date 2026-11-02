extends Node3D
## Prado physics tests (godot --headless --path . res://tests/vehicle_tests.tscn).
## A 4.2 km straight (top speed), a wide pad (cornering, handbrake slide), a wall (crash damage),
## a row of 10 cm bumps (suspension). Prints PASS/FAIL and docs/reports/vehicle_tests.txt.

var car: VehiclePrado
var results: Array[String] = []
var ok_all := true
var body: StaticBody3D


func _ready() -> void:
	body = StaticBody3D.new()
	add_child(body)
	_box(Vector3(0, -0.5, -2000), Vector3(40, 1, 4400))            # straight along -Z
	_box(Vector3(300, -0.5, 0), Vector3(400, 1, 400))              # pad
	_box(Vector3(-200, 1.5, 0), Vector3(2, 3, 40))                 # wall (x = -199)
	_box(Vector3(-170, -0.5, 0), Vector3(60, 1, 40))               # ground in front of the wall
	for i in 12:                                                    # bumps on a side lane
		_box(Vector3(-100, 0.05, -60.0 - i * 6.0), Vector3(6, 0.1, 0.6))
	_box(Vector3(-100, -0.5, -100), Vector3(30, 1, 200))
	car = (load("res://scenes/vehicles/prado.tscn") as PackedScene).instantiate()
	add_child(car)
	await _frames(2)
	car.place(Vector3(0, 0, 0), 0.0)
	await _frames(150)

	# 1. settle
	var offs := []
	var contacts := 0
	for w in car.wheels:
		offs.append(snappedf(w["offset"], 0.001))
		contacts += 1 if w["contact"] else 0
	var ride := car.global_position.y
	_check("settles on 4 wheels at static ride height: offsets %s m, contacts %d" % [str(offs), contacts],
		contacts == 4 and offs.all(func(o: float) -> bool: return absf(o) < 0.03))

	# 2-3. acceleration and top speed on the straight
	VehicleInput.scripted = {"throttle": 1.0}
	var t := 0.0
	var t100 := -1.0
	var vmax := 0.0
	var speedo_err := 0.0
	var start_z := car.global_position.z
	while t < 90.0 and car.global_position.z > start_z - 4000.0:
		await get_tree().physics_frame
		t += 1.0 / 60.0
		var v := car.linear_velocity.length() * 3.6
		speedo_err = maxf(speedo_err, absf(v - car.speed_kmh))
		vmax = maxf(vmax, car.speed_kmh)
		if t100 < 0.0 and car.speed_kmh >= 100.0:
			t100 = t
	_check("0-100 km/h in %.1f s (heavy 4WD diesel: 9..14 s)" % t100, t100 > 9.0 and t100 < 14.0)
	_check("top speed %.1f km/h (game target 200, limiter holds)" % vmax, vmax > 197.0 and vmax < 202.0)
	_check("speedometer = physical body speed (max error %.2f km/h)" % speedo_err, speedo_err < 0.5)
	# 4. braking from 100 (fresh start on the straight)
	VehicleInput.scripted = {"brake": 1.0}
	while car.speed_kmh > 2.0:
		await get_tree().physics_frame
	VehicleInput.scripted = {}
	car.place(Vector3(0, 0, -300), 0.0)
	await _frames(60)
	await _drive_to(100.0)
	var p0 := car.global_position
	VehicleInput.scripted = {"brake": 1.0}
	var pitch_max := 0.0
	var tb := 0.0
	var dist := -1.0
	while tb < 8.0:
		await get_tree().physics_frame
		tb += 1.0 / 60.0
		pitch_max = maxf(pitch_max, rad_to_deg(car.global_transform.basis.z.y))   # nose down -> +z tilts up
		if car.speed_kmh < 1.0:
			dist = car.global_position.distance_to(p0)     # stopped (holding brake further would select reverse)
			break
	_check("braking 100-0 km/h: %.1f m (ABS, real Prado ~40-45 m)" % dist, dist > 34.0 and dist < 52.0)
	_check("nose dives under braking: %.1f deg" % pitch_max, pitch_max > 0.6 and pitch_max < 6.0)
	VehicleInput.scripted = {}
	await _frames(120)

	# 5. cornering on the pad: 60 km/h, steady steer
	car.place(Vector3(200, 0, 150), 0.0)
	await _frames(60)
	await _drive_to(60.0)
	VehicleInput.scripted = {"throttle": 0.35, "steer": 0.6}
	var lat_g := 0.0
	var roll := 0.0
	for i in 240:
		await get_tree().physics_frame
		var a: float = car.linear_velocity.cross(car.angular_velocity).length() / 9.81
		if i > 120:
			lat_g = maxf(lat_g, car.angular_velocity.y * car.linear_velocity.length() / 9.81 * signf(car.angular_velocity.y))
			roll = maxf(roll, absf(rad_to_deg(asin(car.global_transform.basis.x.y))))
	_check("cornering at 60 km/h: lateral %.2f g, body roll %.1f deg (SUV: <= 0.85 g, 2..8 deg)" % [lat_g, roll],
		lat_g > 0.35 and lat_g < 0.9 and roll > 1.5 and roll < 8.5)
	VehicleInput.scripted = {}
	await _frames(240)

	# 6. handbrake slide at 50 km/h + recovery
	car.place(Vector3(200, 0, 150), 0.0)
	await _frames(60)
	await _drive_to(50.0)
	VehicleInput.scripted = {"steer": 0.8, "handbrake": true}
	var slide_max := 0.0
	var yaw_max := 0.0
	for i in 60:
		await get_tree().physics_frame
		for w in car.wheels:
			if not w["front"]:
				slide_max = maxf(slide_max, w["slide"])
		yaw_max = maxf(yaw_max, absf(car.angular_velocity.y))
	VehicleInput.scripted = {"throttle": 0.3}
	var rec := -1.0
	for i in 360:
		await get_tree().physics_frame
		var rs := 0.0
		for w in car.wheels:
			rs = maxf(rs, w["slide"])
		if rec < 0.0 and rs < 0.05:
			rec = i / 60.0
	_check("handbrake slide: rear grip lost (slide %.2f), yaw rate %.2f rad/s" % [slide_max, yaw_max], slide_max > 0.6 and yaw_max > 0.6)
	_check("grip recovers gradually after release: %.2f s" % rec, rec > 0.2 and rec < 4.0)
	_check("did not roll over: up.y = %.2f" % car.global_transform.basis.y.y, car.global_transform.basis.y.y > 0.8)
	VehicleInput.scripted = {}
	await _frames(240)

	# 7. reverse
	car.place(Vector3(200, 0, 150), 0.0)
	await _frames(60)
	VehicleInput.scripted = {"brake": 1.0}
	await _frames(60 * 6)
	_check("holding brake at standstill engages reverse: gear %d, %.1f km/h backwards (limit 25)" % [car.gear, -car.forward_speed * 3.6],
		car.gear == -1 and car.forward_speed < -2.0 and car.speed_kmh < 26.0)
	VehicleInput.scripted = {"throttle": 1.0}
	await _frames(120)
	_check("gas brings it back into drive: gear %d" % car.gear, car.gear >= 1)
	VehicleInput.scripted = {}
	await _frames(200)

	# 8. suspension over bumps
	car.place(Vector3(-100, 0, -30), 0.0)
	await _frames(60)
	VehicleInput.scripted = {"throttle": 0.5}
	var omin := 1.0
	var omax := -1.0
	var up_min := 1.0
	for i in 720:
		await get_tree().physics_frame
		for w in car.wheels:
			omin = minf(omin, w["offset"])
			omax = maxf(omax, w["offset"])
		up_min = minf(up_min, car.global_transform.basis.y.y)
	_check("10 cm bumps: wheel travel %.3f..%.3f m, body stays upright (up.y >= %.2f)" % [omin, omax, up_min], omax > 0.04 and up_min > 0.95)
	VehicleInput.scripted = {}
	await _frames(120)

	# 9. crash into the wall at 45 km/h
	car.place(Vector3(-170, 0, 0), PI / 2.0)           # facing -X towards the wall
	await _frames(60)
	await _drive_to(45.0)
	VehicleInput.scripted = {"throttle": 1.0}
	for i in 240:
		await get_tree().physics_frame
		if car.health < 100.0:
			break
	VehicleInput.scripted = {}
	await _frames(60)
	var dents: int = car._dents.size()
	_check("crash at 45 km/h: health %.0f %%, dents %d, impact %.1f m/s" % [car.health, dents, car.last_impact], car.health < 95.0 and dents > 0)
	# still drivable
	car.place(Vector3(200, 0, 150), 0.0)
	await _frames(60)
	VehicleInput.scripted = {"throttle": 1.0}
	await _frames(60 * 6)
	_check("damaged car still drives: %.0f km/h after 6 s (health %.0f %%)" % [car.speed_kmh, car.health], car.speed_kmh > 30.0)
	# critical damage: crawl but never stuck
	for i in 12:
		car.damage_at(car.global_position + car.global_transform.basis.z * 2.3, -car.global_transform.basis.z, 9.0)
	car.place(Vector3(200, 0, 150), 0.0)
	await _frames(60)
	await _frames(60 * 12)
	_check("critical damage (health %.0f %%): slow but moving, %.0f km/h (limit ~%.0f)" % [car.health, car.speed_kmh, 200.0 * car._damage_factors()["vmax"]],
		car.speed_kmh > 8.0 and car.speed_kmh < 45.0)
	# repair
	var id := car.get_instance_id()
	car.repair()
	await _frames(2)
	var cnt := get_tree().get_nodes_in_group(&"vehicle").size()
	_check("repair: health %.0f %%, dents %d, same car (1 vehicle in scene: %d)" % [car.health, car._dents.size(), cnt],
		car.health == 100.0 and car._dents.size() == 0 and car.get_instance_id() == id and cnt == 1)
	VehicleInput.scripted = {"throttle": 1.0}
	car.place(Vector3(0, 0, -100), 0.0)
	await _frames(60 * 12)
	_check("after repair full power again: %.0f km/h after 12 s" % car.speed_kmh, car.speed_kmh > 110.0)
	VehicleInput.scripted = null

	print("VEHICLE_TESTS ", "ALL PASS" if ok_all else "SOME FAILED")
	var f := FileAccess.open("res://docs/reports/vehicle_tests.txt", FileAccess.WRITE)
	if f:
		f.store_string("\n".join(results) + "\n")
	get_tree().quit(0 if ok_all else 1)


func _drive_to(kmh: float) -> void:
	VehicleInput.scripted = {"throttle": 1.0}
	var n := 0
	while car.speed_kmh < kmh and n < 60 * 40:
		await get_tree().physics_frame
		n += 1


func _box(pos: Vector3, size: Vector3) -> void:
	var cs := CollisionShape3D.new()
	var s := BoxShape3D.new()
	s.size = size
	cs.shape = s
	cs.position = pos
	body.add_child(cs)


func _frames(n: int) -> void:
	for i in n:
		await get_tree().physics_frame


func _check(msg: String, ok: bool) -> void:
	var line := ("PASS " if ok else "FAIL ") + msg
	print(line)
	results.append(line)
	ok_all = ok_all and ok
