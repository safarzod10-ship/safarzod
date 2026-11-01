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
				# v3: overhangs stretched to the J150 (2017+) length 4.78 m, wheelbase unchanged
				_check("prado_dimensions_j150", absf(stats["aabb_size"][1] - 1.845) < 0.04 and absf(stats["aabb_size"][2] - 4.78) < 0.05 and stats["aabb_size"][0] < 2.1,
					stats["aabb_size"])
				var missing := PackedStringArray()
				for n in ["Body", "Hood", "Tailgate", "Door_FL", "Door_FR", "Door_RL", "Door_RR", "Glass_Windshield", "Glass_Backlight",
						"Glass_FrontDoor_L", "Glass_RearDoor_R", "Headlights", "TailLights", "Interior", "Interior_Static",
						"SteeringWheel", "SteeringWheel_Pivot", "Hub_FL", "Caliper_FL"]:
					if inst.find_child(n, true, false) == null:
						missing.append(n)
				_check("prado_v3_separate_parts", missing.is_empty(), missing)
				var tint := (inst.find_child("Glass_FrontDoor_L", true, false) as MeshInstance3D).get_active_material(0) as ShaderMaterial
				var ws := (inst.find_child("Glass_Windshield", true, false) as MeshInstance3D).get_active_material(0) as ShaderMaterial
				_check("prado_v3_glass_vlt", tint != null and ws != null and is_equal_approx(float(tint.get_shader_parameter("vlt")), 0.20)
					and float(ws.get_shader_parameter("vlt")) >= 0.7, "%s / %s" % [tint.get_shader_parameter("vlt") if tint else null,
					ws.get_shader_parameter("vlt") if ws else null])
				var rig := inst as PradoRig
				var door := inst.find_child("Door_FL", true, false) as Node3D
				var before := door.global_transform * Vector3(0, 0, -0.9)
				rig.set_door("Door_FL", 1.0)
				var after := door.global_transform * Vector3(0, 0, -0.9)
				_check("prado_v3_door_opens_outwards", after.x > before.x + 0.4, "%.2f -> %.2f" % [before.x, after.x])
				rig.set_door("Door_FL", 0.0)
				_check("prado_left_is_plus_x", fl != null and fl.position.x > 0)
		inst.queue_free()

	# --- performance monitor (values are real but headless => not GPU representative)
	var s := PerformanceMonitor.take_sample()
	_check("perf_sample_keys", s.has_all(["fps", "draw_calls", "video_mem_mb", "static_mem_mb"]), s)

	# --- scene flow
	var changed: Array[String] = []
	SceneLoader.scene_changed.connect(func(p: String) -> void: changed.append(p))
	for scene_path in ["res://scenes/testing/diagnostics.tscn", "res://scenes/testing/asset_validation.tscn",
			"res://scenes/testing/lighting_calibration.tscn", "res://scenes/world/dushanbe_environment.tscn"]:
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
	_s2_dynamic_done = false
	if get_tree().current_scene and get_tree().current_scene.name == "DushanbeEnvironment":
		await _stage2_checks(get_tree().current_scene)
	_check("s2_dynamic_checks_completed", _s2_dynamic_done, "a script error inside _stage2_checks aborts it -> FAIL")
	_stage2_static_checks()
	await _monument_v3_checks()
	_check("no_boot_errors", GameManager.boot_errors.is_empty(), GameManager.boot_errors)


# ------------------------------------------------------------------ stage 2
var _s2_dynamic_done := false
const STAGE2_RESOURCES := [
	"res://assets/world/world_config.json", "res://assets/world/vegetation_instances.json",
	"res://assets/world/osm_layout.json", "res://assets/world/terrain/heightmap_2m.bin",
	"res://assets/world/terrain/skirt_heights.bin", "res://assets/world/terrain/splat_1m.png",
	"res://assets/world/terrain/terrain.glb", "res://assets/world/mountains/mountains.glb",
	"res://assets/vegetation/plane.glb", "res://assets/vegetation/elm.glb", "res://assets/vegetation/poplar.glb",
	"res://assets/vegetation/thuja.glb", "res://assets/vegetation/boxwood.glb", "res://assets/vegetation/juniper.glb",
	"res://assets/vegetation/rose.glb", "res://assets/vegetation/grass.glb",
	"res://assets/shaders/sky_dushanbe.gdshader", "res://assets/shaders/terrain.gdshader",
	"res://assets/shaders/foliage.gdshader", "res://assets/shaders/grass.gdshader", "res://assets/shaders/mountains.gdshader",
	"res://assets/materials/terrain/terrain_high.tres", "res://assets/materials/terrain/terrain_low.tres",
	"res://assets/materials/mountains/mountains.tres", "res://assets/materials/vegetation/grass.tres",
	"res://assets/materials/monument/stone_light.tres", "res://assets/materials/monument/stone_dark.tres",
	"res://scenes/world/environment_rig.tscn", "res://scenes/world/dushanbe_environment.tscn",
]


func _stage2_static_checks() -> void:
	var missing := PackedStringArray()
	for path: String in STAGE2_RESOURCES:
		if not (ResourceLoader.exists(path) or FileAccess.file_exists(path)):
			missing.append(path)
	_check("s2_resources_present", missing.is_empty(), missing)
	# every res:// reference inside scenes / materials points to an existing file
	var broken := PackedStringArray()
	var files := _collect("res://scenes", [".tscn"]) + _collect("res://assets/materials", [".tres"])
	var re := RegEx.create_from_string('path="(res://[^"]+)"')
	for f: String in files:
		for m in re.search_all(FileAccess.get_file_as_string(f)):
			var ref := m.get_string(1)
			if not (ResourceLoader.exists(ref) or FileAccess.file_exists(ref)):
				broken.append("%s -> %s" % [f.get_file(), ref])
	_check("s2_no_broken_references", broken.is_empty(), "%d files scanned %s" % [files.size(), broken])
	# materials
	var tm := load("res://assets/materials/terrain/terrain_high.tres") as ShaderMaterial
	var ok := tm != null and tm.shader != null
	for k in ["splat", "l0_albedo", "l1_albedo", "l2_albedo", "l3_albedo", "l0_normal", "macro_noise"]:
		ok = ok and tm.get_shader_parameter(k) is Texture2D
	_check("s2_terrain_material_complete", ok)
	var fol_ok := true
	for n in ["plane", "elm", "poplar", "thuja", "boxwood", "juniper", "rose"]:
		var fm := load("res://assets/materials/vegetation/leaves_%s.tres" % n) as ShaderMaterial
		fol_ok = fol_ok and fm != null and fm.shader != null and fm.get_shader_parameter("leaves") is Texture2D
	_check("s2_foliage_materials_complete", fol_ok)
	# world config / territory
	var cfg := WorldConfig.data()
	var pb: Array = cfg["bounds"]["playable"]
	_check("s2_territory_600x600", float(pb[2]) - float(pb[0]) == 600.0 and float(pb[3]) - float(pb[1]) == 600.0, pb)
	var n := WorldConfig.grid_size()
	_check("s2_heightmap_800m_2m", n == 401 and is_equal_approx(WorldConfig.grid_step(), 2.0), "n=%d" % n)
	var h0 := WorldConfig.height_at(0, 0)
	var hmin := INF
	var hmax := -INF
	for z in range(-300, 301, 10):
		for x in range(-300, 301, 10):
			var hh := WorldConfig.height_at(x, z)
			hmin = minf(hmin, hh)
			hmax = maxf(hmax, hh)
	_check("s2_city_relief_gentle", absf(h0) < 0.05 and hmax - hmin < 25.0 and hmax - hmin > 2.0,
		"h(0,0)=%.3f range=%.2f..%.2f m" % [h0, hmin, hmax])
	_check("s2_chunk_grid_8x8", (cfg["chunks"] as Array).size() == 64 and int(cfg["terrain"]["chunk_size_m"]) == 100)
	var veg: Variant = JSON.parse_string(FileAccess.get_file_as_string("res://assets/world/vegetation_instances.json"))
	var in_square := 0
	for t: Dictionary in veg["trees"]:
		if Vector2(t["x"], t["z"]).length() < 78.0:
			in_square += 1
	_check("s2_no_trees_on_square", in_square == 0 and (veg["trees"] as Array).size() > 500, "trees=%d in_square=%d" % [(veg["trees"] as Array).size(), in_square])
	# imported models
	var terr := (load("res://assets/world/terrain/terrain.glb") as PackedScene).instantiate()
	var chunk_meshes := terr.find_children("Chunk_*", "MeshInstance3D", true, false).size()
	terr.free()
	_check("s2_terrain_glb_chunks", chunk_meshes == 64, chunk_meshes)
	var mnt := (load("res://assets/world/mountains/mountains.glb") as PackedScene).instantiate()
	var mstats := MeshStats.collect(mnt)
	mnt.free()
	_check("s2_mountains_glb", mstats["mesh_nodes"].size() == 3 and mstats["triangles"] > 30000 and mstats["triangles"] < 80000, mstats["triangles"])
	var veg_ok := true
	for sp in ["plane", "elm", "poplar", "thuja"]:
		var r := (load("res://assets/vegetation/%s.glb" % sp) as PackedScene).instantiate()
		var st := MeshStats.collect(r)
		veg_ok = veg_ok and st["mesh_nodes"].size() == 2 and st["triangles"] < 4000
		r.free()
	_check("s2_tree_glbs_lod0_lod1", veg_ok)


func _stage2_checks(scene: Node) -> void:
	var dn := scene.get_node("EnvironmentRig/DayNightCycle") as DayNightCycle
	var wm := scene.get_node("WeatherManager") as WeatherManager
	var veg := scene.get_node("Vegetation") as VegetationSystem
	var terr := scene.get_node("Terrain") as TerrainSystem
	var sun := scene.get_node("EnvironmentRig/Sun") as DirectionalLight3D
	_check("s2_env_scene_systems", dn != null and wm != null and veg != null and terr != null)
	_check("s2_terrain_chunks_loaded", terr.chunks.size() == 64 and terr.outskirts.size() == 8, "%d + %d" % [terr.chunks.size(), terr.outskirts.size()])
	_check("s2_terrain_colliders", terr.colliders.size() == 36, terr.colliders.size())
	# --- collision: ray down onto the terrain near the square and in the park
	await get_tree().physics_frame
	await get_tree().physics_frame
	var space := (scene as Node3D).get_world_3d().direct_space_state
	var hits := []
	for p in [Vector2(-120, 30), Vector2(-60, -150), Vector2(200, 100)]:
		var q := PhysicsRayQueryParameters3D.create(Vector3(p.x, 60, p.y), Vector3(p.x, -60, p.y))
		var r := space.intersect_ray(q)
		hits.append(absf(float(r.get("position", Vector3(0, 999, 0)).y) - WorldConfig.height_at(p.x, p.y)) if r else 999.0)
	_check("s2_terrain_collision_matches_heightmap", hits.max() < 0.25, hits)
	# --- day / night
	dn.paused = true
	dn.set_time(12.0)
	var el12 := dn.sun_elevation_deg
	var e12 := sun.light_energy
	dn.set_time(6.0)
	var el6 := dn.sun_elevation_deg
	var az6 := dn.sun_azimuth_deg
	dn.set_time(18.0)
	var az18 := dn.sun_azimuth_deg
	var e18 := sun.light_energy
	dn.set_time(0.0)
	var el0 := dn.sun_elevation_deg
	var moon := sun.light_color.is_equal_approx(DayNightCycle.MOON_COLOR)
	_check("s2_daynight_noon", absf(el12 - 66.3) < 1.5 and e12 > e18, "el=%.1f E=%.2f" % [el12, e12])
	_check("s2_daynight_morning_east", el6 > 4.0 and el6 < 14.0 and az6 > 55.0 and az6 < 115.0, "el=%.1f az=%.1f" % [el6, az6])
	_check("s2_daynight_evening_west", az18 > 245.0 and az18 < 305.0, "az=%.1f" % az18)
	_check("s2_daynight_night_moon", el0 < -20.0 and moon, "el=%.1f moon=%s" % [el0, moon])
	dn.set_time(10.0)
	dn.time_scale = 3600.0
	dn.paused = false
	var t0 := dn.time_of_day
	for i in 10:
		await get_tree().process_frame
	_check("s2_daynight_time_advances", dn.time_of_day > t0)
	dn.paused = true
	var t1 := dn.time_of_day
	for i in 5:
		await get_tree().process_frame
	_check("s2_daynight_pause", is_equal_approx(dn.time_of_day, t1))
	dn.set_time(12.0)
	# --- weather
	var env := (scene.get_node("EnvironmentRig/WorldEnvironment") as WorldEnvironment).environment
	wm.set_state_immediate("Clear")
	var fog_clear := env.fog_density
	var rain := wm.rain_node()
	var clear_rain_off := not bool(rain.get("emitting"))
	wm.set_state_immediate("Rain")
	var wet := float(wm.current["wetness"])   # (global shader params read back null under --headless)
	_check("s2_weather_rain", bool(rain.get("emitting")) and clear_rain_off and wet > 0.9 and sun.light_energy < e12 * 0.2,
		"emitting=%s wet=%.2f E=%.2f" % [rain.get("emitting"), wet, sun.light_energy])
	wm.set_state_immediate("Fog")
	_check("s2_weather_fog", env.fog_density > fog_clear * 20.0, "%.5f vs %.5f" % [env.fog_density, fog_clear])
	var all_states := true
	for st: String in WeatherManager.STATES:
		wm.set_state_immediate(st)
		all_states = all_states and wm.state == st
	_check("s2_weather_all_states", all_states and WeatherManager.STATES.size() == 6)
	wm.set_state("Overcast", 0.2)
	for i in 30:
		await get_tree().process_frame
	_check("s2_weather_transition_completes", wm.progress >= 1.0 and absf(float(wm.current["overcast"]) - 0.75) < 0.01, wm.progress)
	wm.set_state_immediate("Clear")
	# --- presets drive the environment (not decorative)
	var res := []
	for q: int in [GraphicsPresets.Quality.LOW, GraphicsPresets.Quality.ULTRA]:
		SettingsManager.set_quality(q)
		var p := GraphicsPresets.get_preset(q)
		veg.update_grass(Vector3(-60, 1, -150), -1)
		res.append([is_equal_approx(veg.lod0_batches[0].visibility_range_end, p["tree_detail_distance"]),
			is_equal_approx(veg.lod1_batches[0].visibility_range_end, p["tree_distance"]),
			env.sky.radiance_size == p["sky_radiance_size"], int(rain.get("amount")) == int(p["rain_particles"]),
			veg.grass_instance_count()])
	_check("s2_presets_apply_to_environment", res[0].slice(0, 4).all(func(v: bool) -> bool: return v) and res[1].slice(0, 4).all(func(v: bool) -> bool: return v)
		and res[1][4] > res[0][4], res)
	SettingsManager.set_quality(GraphicsPresets.Quality.MEDIUM)
	_check("s2_vegetation_counts", veg.counts["trees"] > 500 and veg.counts["shrubs"] > 500 and veg.lod0_batches.size() == veg.lod1_batches.size(),
		"%s lod0=%d lod1=%d" % [veg.counts, veg.lod0_batches.size(), veg.lod1_batches.size()])
	_s2_dynamic_done = true


func _collect(dir: String, exts: Array) -> PackedStringArray:
	var out := PackedStringArray()
	var d := DirAccess.open(dir)
	if d == null:
		return out
	for f in d.get_files():
		for e: String in exts:
			if f.ends_with(e):
				out.append(dir.path_join(f))
	for sub in d.get_directories():
		out.append_array(_collect(dir.path_join(sub), exts))
	return out


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


# ------------------------------------------------------------ monument v3
const MONUMENT_V3_ELEMENTS := ["Base_Platform", "Statue_Pedestal", "Lion_Plinth_Caps", "Arch", "Arch_Pilasters",
	"Colonnade_Columns", "Colonnade_Entablatures", "Statue", "Statue_Sceptre", "Statue_Details", "Crown",
	"Crown_Base", "Lion_L", "Lion_R", "Arch_Lining", "Museum_Portal", "Museum_Portal_Stone", "Museum_Portal_Steps",
	"Museum_Doors"]


func _monument_v3_checks() -> void:
	var inst := (load("res://assets/monuments/ismoili_somoni/ismoili_somoni.tscn") as PackedScene).instantiate() as MonumentLOD
	add_child(inst)
	await get_tree().process_frame
	var missing := PackedStringArray()
	for e: String in MONUMENT_V3_ELEMENTS:
		for lvl in 3:
			if inst.find_child("%s_LOD%d" % [e, lvl], true, false) == null:
				missing.append("%s_LOD%d" % [e, lvl])
	_check("v3_monument_lod_nodes", missing.is_empty(), missing)
	# collision: invisible static trimesh built from LOD2 of the walkable / blocking parts
	var shapes := inst.find_children("*", "CollisionShape3D", true, false)
	var faces := 0
	for cs: CollisionShape3D in shapes:
		if cs.shape is ConcavePolygonShape3D:
			faces += (cs.shape as ConcavePolygonShape3D).get_faces().size() / 3
	_check("v3_monument_collision", shapes.size() >= 1 and faces > 1000, "shapes=%d faces=%d" % [shapes.size(), faces])
	# materials: every surface uses the monument shader with all textures bound
	var shader := load("res://assets/shaders/monument_surface.gdshader")
	var names := {}
	var bad := PackedStringArray()
	for mi: MeshInstance3D in inst.find_children("*_LOD*", "MeshInstance3D", true, false):
		for s in mi.mesh.get_surface_count():
			var m := mi.get_active_material(s) as ShaderMaterial
			if m == null or m.shader != shader or not (m.get_shader_parameter("detail_albedo_rough") is Texture2D) \
					or not (m.get_shader_parameter("bake_map") is Texture2D):
				bad.append("%s/%d" % [mi.name, s])
			elif m:
				names[m.resource_name] = true
	_check("v3_monument_materials", bad.is_empty() and names.size() == 7, "%s %s" % [names.keys(), bad])
	# photo-checked material assignment and lion pose
	var statue := inst.find_child("Statue_LOD0", true, false) as MeshInstance3D
	var crown := inst.find_child("Crown_LOD0", true, false) as MeshInstance3D
	_check("v3_statue_is_bronze_crown_is_gold", statue.get_active_material(0).resource_name == "M_Mon_Bronze"
		and crown.get_active_material(0).resource_name == "M_Mon_Gold_Sculpt")
	var lion := inst.find_child("Lion_L_LOD0", true, false) as MeshInstance3D
	var la := lion.get_aabb()
	_check("v3_lions_lying_pose", la.size.y < 4.0 and la.size.z > la.size.y * 1.3, la.size)
	# LOD switching (measured ranges, Ultra = 1 px)
	var applied := inst.apply(1.0, true)
	var lod_ok := inst.visible_lod_at("Statue", 5.0) == 0 and inst.visible_lod_at("Statue", 50.0) == 1 \
		and inst.visible_lod_at("Statue", 300.0) == 2 and inst.visible_lod_at("Arch", 30.0) == 0
	for e: String in applied:
		lod_ok = lod_ok and applied[e][0] >= MonumentLOD.MIN_LOD1_M and applied[e][1] >= MonumentLOD.MIN_LOD2_M
	_check("v3_lod_switch_distances", lod_ok, applied)
	var low := inst.apply(2.0, false, false)
	_check("v3_low_preset_no_lod0", inst.visible_lod_at("Statue", 3.0) == 1 and inst.visible_lod_at("Arch", 100.0) == 2
		and not (inst.find_child("Statue_LOD0", true, false) as MeshInstance3D).visible, low["Arch"])
	inst.apply(1.0, true)
	# triangle budget per LOD (measured in Blender: docs/reports/monument_v3_build.json)
	var tri := [0, 0, 0]
	for mi: MeshInstance3D in inst.find_children("*_LOD*", "MeshInstance3D", true, false):
		var lvl := int(String(mi.name).right(1))
		tri[lvl] += MeshStats.collect(mi)["triangles"]
	_check("v3_triangle_budget", tri[0] <= 200000 and tri[1] <= 70000 and tri[2] <= 25000 and tri[0] > tri[1] and tri[1] > tri[2], tri)
	_check("v3_originals_kept", FileAccess.file_exists("res://assets/monuments/old_monument/old_monument.glb")
		and FileAccess.file_exists("res://source_assets/monument_v2_backup/ismoili_somoni_v2.glb")
		and FileAccess.file_exists("res://source_assets/monument_v3/monument_v3_lod0_source.blend")
		and FileAccess.file_exists("res://source_assets/monument_v3/ismoili_somoni_v3.glb")
		and FileAccess.file_exists("res://source_assets/monument_v4/monument_v4_lod0_source.blend"))
	inst.queue_free()
