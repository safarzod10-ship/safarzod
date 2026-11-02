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
		_check("player on sidewalk at spawn: y=%.3f (≈0.15)" % y0, absf(y0 - 0.15) < 0.06)
		PlayerInput.scripted_move = Vector2(0, -1)
		PlayerInput.scripted_run = true
		var p0 := player.global_position
		for i in 300:
			await get_tree().physics_frame
		PlayerInput.scripted_move = null
		var moved := player.global_position.distance_to(p0)
		_check("player runs 5 s through the city: moved %.1f m, y=%.3f" % [moved, player.global_position.y], moved > 12.0 and player.global_position.y > -0.1)
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
	# walk from the end of the avenue down the path to the south beach
	player.teleport(Vector3(-40, 0.2, 296), PI)
	player.set_camera_angles(PI, player.cam_pitch)
	await _frames(10)
	PlayerInput.scripted_move = Vector2(0, -1)
	PlayerInput.scripted_run = true
	var zmax := 0.0
	for i in 60 * 40:
		await get_tree().physics_frame
		zmax = maxf(zmax, player.global_position.z)
	PlayerInput.scripted_move = null
	PlayerInput.scripted_run = false
	var y := player.global_position.y
	var depth := -1.6 - y
	_check("walk from the city to the sea: reached z=%.0f, stopped at water depth %.2f m (wading limit 0.9)" % [zmax, depth],
		zmax > 370.0 and depth < 1.0 and depth > 0.3)
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
