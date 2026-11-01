extends Node
## Automated stage-1 checks. Run headless:
##   godot --headless --path . res://tests/test_runner.tscn
## Exit code 0 = all passed. Results: stdout lines "TEST ..." and
## user://test_results.json. Original user settings are restored afterwards.

var _results: Array[Dictionary] = []
var _settings_backup := ""


func _ready() -> void:
	if FileAccess.file_exists(SaveManager.SETTINGS_PATH):
		_settings_backup = FileAccess.get_file_as_string(SaveManager.SETTINGS_PATH)
	# The runner must survive scene changes: hand "current scene" to a placeholder.
	await get_tree().process_frame
	var placeholder := Node.new()
	placeholder.name = "Placeholder"
	get_tree().root.add_child(placeholder)
	get_tree().current_scene = placeholder
	await _run()
	_finish()


func _check(name: String, ok: bool, detail: Variant = "") -> void:
	_results.append({"name": name, "ok": ok, "detail": str(detail)})
	print("TEST %s %s %s" % ["PASS" if ok else "FAIL", name, str(detail)])


func _run() -> void:
	# --- core systems
	for n in ["SaveManager", "SettingsManager", "AssetRegistry", "PerformanceMonitor", "InputManager", "SceneLoader", "GameManager"]:
		_check("autoload_" + n, get_node_or_null("/root/" + n) != null)
	_check("engine_version_4_7", Engine.get_version_info()["major"] == 4 and Engine.get_version_info()["minor"] == 7, Engine.get_version_info()["string"])

	# --- SaveManager
	var data := {"player": {"pos": [1.5, 0, -3]}, "money": 120}
	_check("save_slot_write", SaveManager.save_slot(99, data) == OK)
	var back := SaveManager.load_slot(99)
	_check("save_slot_roundtrip", back.get("money") == 120.0 and back["player"]["pos"][0] == 1.5, back)
	var f := FileAccess.open(SaveManager.slot_path(98), FileAccess.WRITE)
	f.store_string("{corrupt")
	f.close()
	_check("save_slot_corrupt_handled", SaveManager.load_slot(98).is_empty())
	SaveManager.delete_slot(98)
	SaveManager.delete_slot(99)
	_check("save_no_tmp_left", not FileAccess.file_exists(SaveManager.slot_path(99) + ".tmp"))

	# --- graphics presets + persistence
	var vp := get_viewport()
	for q: int in [GraphicsPresets.Quality.LOW, GraphicsPresets.Quality.ULTRA, GraphicsPresets.Quality.MEDIUM]:
		SettingsManager.set_quality(q)
		var p := GraphicsPresets.get_preset(q)
		var applied: bool = is_equal_approx(vp.scaling_3d_scale, p["render_scale"]) and vp.msaa_3d == p["msaa_3d"] \
			and is_equal_approx(vp.mesh_lod_threshold, p["lod_threshold_px"])
		_check("preset_applied_" + GraphicsPresets.NAMES[q], applied,
			"scale=%s msaa=%d lod=%s" % [vp.scaling_3d_scale, vp.msaa_3d, vp.mesh_lod_threshold])
		var cfg := ConfigFile.new()
		cfg.load(SaveManager.SETTINGS_PATH)
		_check("preset_saved_" + GraphicsPresets.NAMES[q], cfg.get_value("graphics", "quality", "") == GraphicsPresets.NAMES[q])
	_check("preset_from_name", GraphicsPresets.from_name("ULTRA") == GraphicsPresets.Quality.ULTRA and GraphicsPresets.from_name("x") == -1)
	_check("renderer_override_write", SettingsManager.set_renderer("gl_compatibility") == OK and FileAccess.file_exists(SettingsManager.RENDERER_OVERRIDE_PATH))
	var o := ConfigFile.new()
	o.load(SettingsManager.RENDERER_OVERRIDE_PATH)
	_check("renderer_override_content", o.get_value("rendering", "renderer/rendering_method.mobile", "") == "gl_compatibility")
	_check("renderer_override_remove", SettingsManager.set_renderer("mobile") == OK and not FileAccess.file_exists(SettingsManager.RENDERER_OVERRIDE_PATH))
	print("CAPABILITIES ", JSON.stringify(SettingsManager.get_capabilities()))

	# --- assets
	var paths := AssetRegistry.validate_paths()
	for id: String in paths:
		_check("asset_path_" + id, paths[id] == "ok", paths[id])
	for id: String in AssetRegistry.assets:
		var info := AssetRegistry.get_info(id)
		var t0 := Time.get_ticks_usec()
		var inst := (load(info["path"]) as PackedScene).instantiate() as Node3D
		var load_ms := (Time.get_ticks_usec() - t0) / 1000.0
		add_child(inst)
		var stats := MeshStats.collect(inst)
		var problems := MeshStats.check(stats, info.get("expected", {}))
		_check("asset_geometry_" + id, problems.is_empty(), "%s load=%.1fms %s" % [problems, load_ms, JSON.stringify(stats)])
		match id:
			"monument.ismoili_somoni":
				_check("monument_height_43m", absf(stats["aabb_size"][1] - 43.0) < 0.1, stats["aabb_size"])
			"character.main":
				_check("character_height_1_75m", absf(stats["aabb_size"][1] - 1.75) < 0.01, stats["aabb_size"])
				_check("character_has_no_skeleton_documented", stats["skeletons"] == 0 and info["status"].contains("no_skeleton"))
			"vehicle.prado":
				var fl := inst.find_child("Wheel_FL") as Node3D
				var fr := inst.find_child("Wheel_FR") as Node3D
				var rl := inst.find_child("Wheel_RL") as Node3D
				var ok := fl != null and fr != null and rl != null
				var wb := fl.position.z - rl.position.z if ok else 0.0
				_check("prado_wheel_pivots", ok and absf(rl.position.y - 0.38) < 0.03 and absf(wb - 2.79) < 0.02,
					"wheelbase(FL-RL)=%.3f hub_y=%.3f" % [wb, rl.position.y if ok else 0.0])
				_check("prado_front_wheels_symmetric", ok and absf(fl.position.x + fr.position.x) < 0.01 and absf(fl.position.z - fr.position.z) < 0.01)
				_check("prado_dimensions_j150", absf(stats["aabb_size"][1] - 1.845) < 0.04 and absf(stats["aabb_size"][2] - 4.47) < 0.05 and stats["aabb_size"][0] < 2.1,
					stats["aabb_size"])
				_check("prado_left_is_plus_x", fl != null and fl.position.x > 0)
		inst.queue_free()

	# --- performance monitor (values are real but headless => not GPU representative)
	var s := PerformanceMonitor.take_sample()
	_check("perf_sample_keys", s.has_all(["fps", "draw_calls", "video_mem_mb", "static_mem_mb"]), s)

	# --- scene flow
	var changed: Array[String] = []
	SceneLoader.scene_changed.connect(func(p: String) -> void: changed.append(p))
	for scene_path in ["res://scenes/testing/diagnostics.tscn", "res://scenes/testing/asset_validation.tscn"]:
		var start := Time.get_ticks_msec()
		SceneLoader.change_scene(scene_path)
		while not changed.has(scene_path) and Time.get_ticks_msec() - start < 30000:
			await get_tree().process_frame
		for i in 30:
			await get_tree().process_frame
		_check("scene_loads_" + scene_path.get_file(), changed.has(scene_path), "%d ms" % (Time.get_ticks_msec() - start))
		if scene_path.ends_with("asset_validation.tscn") and get_tree().current_scene:
			var res: Dictionary = get_tree().current_scene.get("results")
			var all_ok := res.size() == 3
			for id: String in res:
				all_ok = all_ok and res[id]["ok"]
			_check("asset_validation_scene_all_ok", all_ok, res.keys())
	_check("no_boot_errors", GameManager.boot_errors.is_empty(), GameManager.boot_errors)


func _finish() -> void:
	if _settings_backup.is_empty():
		DirAccess.remove_absolute(SaveManager.SETTINGS_PATH)
	else:
		var f := FileAccess.open(SaveManager.SETTINGS_PATH, FileAccess.WRITE)
		f.store_string(_settings_backup)
		f.close()
	var failed := _results.filter(func(r: Dictionary) -> bool: return not r["ok"]).size()
	var out := FileAccess.open("user://test_results.json", FileAccess.WRITE)
	out.store_string(JSON.stringify({"engine": Engine.get_version_info()["string"], "passed": _results.size() - failed, "failed": failed, "results": _results}, "\t"))
	out.close()
	print("TEST_SUMMARY passed=%d failed=%d" % [_results.size() - failed, failed])
	get_tree().quit(1 if failed > 0 else 0)
