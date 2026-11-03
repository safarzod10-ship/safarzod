extends Node3D
## City load test: loads the main scene, checks chunk count, colliders, instance counts,
## that the player stands on the ground at spawn and can walk along the sidewalk, and
## that every category resolves to an asset. Prints PASS/FAIL. Headless-friendly.
var ok_all := true
var lines: Array[String] = []


func _ready() -> void:
	var t0 := Time.get_ticks_msec()
	var main: Node = (load("res://scenes/main/main.tscn") as PackedScene).instantiate()
	add_child(main)
	await get_tree().process_frame
	var load_ms := Time.get_ticks_msec() - t0
	var world: CityWorld = main.get("world")
	var city_chunks := world.chunks.filter(func(c: Node3D) -> bool: return not String(c.name).begins_with("chunk_coast")).size()
	_check("city loaded in %d ms: %d city chunks (+%d coast chunks)" % [load_ms, city_chunks, world.chunks.size() - city_chunks], city_chunks == 36)
	_check("colliders %d, trees %d, props %d, multimeshes %d" % [world.stats.colliders, world.stats.trees, world.stats.props, world.stats.multimeshes],
		world.stats.colliders > 1000 and world.stats.trees > 1000 and world.stats.props > 1000)
	_check("all categories resolve to assets (missing: %s)" % str(world._missing.keys()), world._missing.is_empty())
	var player: Node3D = main.get("player")
	_check("player spawned", player != null)
	if player:
		for i in 60:
			await get_tree().physics_frame
		var y0 := player.global_position.y
		var want0 := 0.15 + CityWorld.city_relief(player.global_position.x, player.global_position.z)
		_check("player on sidewalk at spawn: y=%.3f (relief+0.15 = %.3f)" % [y0, want0], absf(y0 - want0) < 0.06)
		PlayerInput.scripted_move = Vector2(0, -1)
		PlayerInput.scripted_run = true
		var p0 := player.global_position
		for i in 300:
			await get_tree().physics_frame
		PlayerInput.scripted_move = null
		var moved := player.global_position.distance_to(p0)
		_check("player runs 5 s through the city: moved %.1f m, y=%.3f" % [moved, player.global_position.y], moved > 12.0 and player.global_position.y > -0.1)
	await _relief_tests(world)
	await _coast_tests(world)
	await _car_tests()
	print("CITY_TESTS ", "ALL PASS" if ok_all else "SOME FAILED")
	var f := FileAccess.open("res://docs/reports/city_tests.txt", FileAccess.WRITE)
	if f:
		f.store_string("\n".join(lines) + "\n")
	get_tree().quit(0 if ok_all else 1)


func _check(msg: String, ok: bool) -> void:
	var l := ("PASS " if ok else "FAIL ") + msg
	print(l)
	lines.append(l)
	ok_all = ok_all and ok


func _ray_y(x: float, z: float) -> float:
	var space := get_viewport().world_3d.direct_space_state
	var hit := space.intersect_ray(PhysicsRayQueryParameters3D.create(Vector3(x, 80, z), Vector3(x, -40, z), 1))
	return (hit.position as Vector3).y if not hit.is_empty() else -999.0


func _relief_tests(world: CityWorld) -> void:
	## the city is not a flat platform: ground follows city_relief(x, z) everywhere (roads = heightmap,
	## raised blocks = collision mesh), height range > 3 m, continuous with the coast terrain
	var worst_road := 0.0
	var worst_side := 0.0
	var lo := 99.0
	var hi := -99.0
	for r in world.city["roads"]:
		var c: float = r["c"]
		for a in [float(r["a0"]) + 20.0, (float(r["a0"]) + float(r["a1"])) * 0.5, float(r["a1"]) - 20.0]:
			var x: float = c if r["axis"] == "z" else a
			var z: float = a if r["axis"] == "z" else c
			var f := CityWorld.city_relief(x, z)
			lo = minf(lo, f)
			hi = maxf(hi, f)
			if float(r["carriage_half"]) > 0.0 and r["lanes"] > 0:
				# middle of a traffic lane (the avenue's centre is a raised median)
				var lo_: float = float(r["carriage_half"]) * 0.7
				var lx: float = x + (lo_ if r["axis"] == "z" else 0.0)
				var lz: float = z + (0.0 if r["axis"] == "z" else lo_)
				worst_road = maxf(worst_road, absf(_ray_y(lx, lz) - CityWorld.city_relief(lx, lz)))
			# sidewalk edge (outside the carriageway, raised by 0.15)
			var o: float = float(r["half"]) - 0.6
			var sx: float = x + (o if r["axis"] == "z" else 0.0)
			var sz: float = z + (0.0 if r["axis"] == "z" else o)
			var g := _ray_y(sx, sz)
			var fs := CityWorld.city_relief(sx, sz)
			worst_side = maxf(worst_side, minf(absf(g - fs - 0.15), absf(g - fs)))
	_check("roads follow the relief: worst |ray - f| = %.3f m" % worst_road, worst_road < 0.05)
	_check("sidewalks/blocks follow the relief (+0.15): worst = %.3f m" % worst_side, worst_side < 0.06)
	_check("relief height range along the streets %.2f .. %.2f m (not flat)" % [lo, hi], hi - lo > 2.5)
	var e1 := absf(_ray_y(-40.0, 303.0) - world.terrain_height(-40.0, 303.0))
	var g2 := _ray_y(-40.0, 297.0) - CityWorld.city_relief(-40.0, 297.0)
	var e2 := minf(absf(g2), absf(g2 - 0.15))          # road or sidewalk
	_check("city edge joins the terrain: |ray - terrain| %.2f / %.2f m" % [e1, e2], e1 < 0.15 and e2 < 0.03)


func _coast_tests(world: Node) -> void:
	## peninsula: collision = visible terrain, walk to the beach, wading limit, promenade, minimap
	var players := get_tree().get_nodes_in_group(&"player")
	if players.is_empty():
		return
	var player: PlayerController = players[0]
	for pt in [Vector2(-20, 385), Vector2(420, 176), Vector2(-300, -700)]:
		var want: float = world.call("terrain_height", pt.x, pt.y)
		var got := _ray_y(pt.x, pt.y)
		_check("terrain collision at (%d, %d): ray %.2f m, baked height %.2f m" % [pt.x, pt.y, got, want], absf(got - want) < 0.15)
	var P: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://data/terrain/paths.json"))
	var prom: Array = P["promenade"]
	var pm: Array = prom[prom.size() / 2]
	var py := _ray_y(pm[0], pm[1])
	_check("promenade surface walkable at (%.0f, %.0f): y=%.2f" % [pm[0], pm[1], py], py > 0.4 and py < 3.0)
	# walk from the end of the avenue down the path to the south beach and into the sea:
	# shallow -> medium -> swimming at the surface -> boundary far out -> swim back -> on land
	player.teleport(Vector3(-40, 0.2 + CityWorld.city_relief(-40, 296), 296), PI)
	player.set_camera_angles(PI, player.cam_pitch)
	await _frames(10)
	PlayerInput.scripted_move = Vector2(0, -1)
	PlayerInput.scripted_run = true
	var zmax := 0.0
	var seen := {}
	var swim_y_err := 0.0
	var swim_frames := 0
	var below_floor := false
	var wade_speed := 0.0
	for i in 60 * 70:
		await get_tree().physics_frame
		zmax = maxf(zmax, player.global_position.z)
		var m: int = player.water.mode
		seen[m] = true
		if m == PlayerWater.Mode.MEDIUM and player.water.depth > 0.8:
			wade_speed = maxf(wade_speed, Vector2(player.velocity.x, player.velocity.z).length())
		if m == PlayerWater.Mode.SWIM:
			swim_frames += 1
			if swim_frames > 90:
				swim_y_err = maxf(swim_y_err, absf(player.global_position.y - (PlayerWater.SEA_LEVEL - PlayerWater.SWIM_BODY)))
				var fy := _ray_y(player.global_position.x, player.global_position.z)
				below_floor = below_floor or player.global_position.y < fy - 0.05
	var swim_z := player.global_position.z
	_check("into the sea: shallow %s, medium %s (deep wading speed %.2f m/s < run), swimming %s" % [
		seen.has(PlayerWater.Mode.SHALLOW), seen.has(PlayerWater.Mode.MEDIUM), wade_speed, seen.has(PlayerWater.Mode.SWIM)],
		seen.has(PlayerWater.Mode.SHALLOW) and seen.has(PlayerWater.Mode.MEDIUM) and seen.has(PlayerWater.Mode.SWIM) and wade_speed < 2.0)
	_check("swims at the surface (feet %.2f m below it ±%.2f), never on/under the sea bed: %s" % [PlayerWater.SWIM_BODY, swim_y_err, not below_floor],
		swim_frames > 120 and swim_y_err < 0.12 and not below_floor)
	_check("swam out to z=%.0f (well beyond the wading line ~370-410) and stopped at the swimming boundary" % zmax, zmax > 420.0)
	# back to the beach
	player.set_camera_angles(0.0, player.cam_pitch)
	for i in 60 * 90:
		await get_tree().physics_frame
		if player.water.mode == PlayerWater.Mode.DRY and player.is_on_floor():
			break
	PlayerInput.scripted_move = null
	PlayerInput.scripted_run = false
	await _frames(20)
	_check("swims back and walks out onto the beach: mode %d (0 = dry), on floor %s, z=%.0f" % [player.water.mode, player.is_on_floor(), player.global_position.z],
		player.water.mode == PlayerWater.Mode.DRY and player.is_on_floor() and player.global_position.z < swim_z)
	var sa: SeaAudio = world.get_node_or_null("SeaAudio")
	_check("sea sounds: surf + coastal wind playing near the shore (shore %.0f m)" % (sa.shore_distance if sa else -1.0),
		sa != null and sa.shore_distance < 120.0 and sa._wind.playing)
	_check("player stays inside the playable boundary: z=%.0f" % player.global_position.z, player.global_position.z < 700.0)
	# minimap follows the player
	var mm := get_tree().root.find_children("*", "Control", true, false).filter(func(n: Node) -> bool: return n is Minimap)
	var ok := false
	if not mm.is_empty():
		await get_tree().process_frame
		var c: Vector2 = ((mm[0] as Control).get_child(0).material as ShaderMaterial).get_shader_parameter("center")
		ok = c.distance_to(Vector2(player.global_position.x, player.global_position.z)) < 2.0
	_check("minimap present and centred on the player", ok)


func _frames(n: int) -> void:
	for i in n:
		await get_tree().physics_frame


func _car_tests() -> void:
	## Prado in the city: «СЕСТЬ» near the driver's door, driving with the car inputs, leaving next to the door
	var sess: CarSession = get_tree().root.find_children("CarSession", "", true, false)[0] if not get_tree().root.find_children("CarSession", "", true, false).is_empty() else null
	if sess == null:
		_check("car session present", false)
		return
	var player: PlayerController = sess.player
	var car: VehiclePrado = sess.car
	_check("Prado parked on the avenue: on 4 wheels (%d), %.1f km/h" % [car.wheels_on_ground, car.speed_kmh], car.wheels_on_ground == 4 and car.speed_kmh < 1.0)
	player.teleport(car.driver_door_point(4.0), 0.0)
	await _frames(20)
	var far_ok := not sess.can_enter()
	player.teleport(car.driver_door_point(1.0), 0.0)
	await _frames(20)
	_check("«СЕСТЬ» only near the driver's door (far: %s, near: %s)" % [not far_ok, sess.can_enter()], far_ok and sess.can_enter())
	sess.enter()
	await _frames(5)
	_check("entered: car driven, car camera current, walker hidden", sess.driving and car.driven and sess.cam.current and not player.visible)
	var p0 := car.global_position
	VehicleInput.scripted = {"throttle": 0.6}
	await _frames(60 * 5)
	VehicleInput.scripted = {"brake": 1.0}
	for i in 60 * 4:
		await get_tree().physics_frame
		if car.speed_kmh < 0.8:
			break
	VehicleInput.scripted = {}
	await _frames(10)
	VehicleInput.scripted = null
	var moved := car.global_position.distance_to(p0)
	_check("drove %.0f m along the avenue and stopped (%.1f km/h)" % [moved, car.speed_kmh], moved > 15.0 and car.speed_kmh < 3.0)
	sess.exit()
	await _frames(60)
	var space := get_viewport().world_3d.direct_space_state
	var q := PhysicsShapeQueryParameters3D.new()
	var cap := CapsuleShape3D.new()
	cap.radius = 0.3
	cap.height = 1.7
	q.shape = cap
	q.transform = Transform3D(Basis.IDENTITY, player.global_position + Vector3.UP * 0.95)
	q.exclude = [player.get_rid()]
	var overlap := space.intersect_shape(q, 4)
	var d := player.global_position.distance_to(car.driver_door_point(0.0))
	_check("exit: on foot again beside the door (%.1f m), on the floor %s, not inside/under the car (overlaps %d)" % [d, player.is_on_floor(), overlap.size()],
		not sess.driving and player.visible and player.is_on_floor() and d < 3.0 and overlap.is_empty() and player.global_position.y > -0.1)
