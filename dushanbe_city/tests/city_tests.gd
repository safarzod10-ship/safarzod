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
	_check("city loaded in %d ms: %d chunks" % [load_ms, world.chunks.size()], world.chunks.size() == 36)
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
