extends Node
## Global graphics settings, persisted in user://settings.cfg.
##
## mode: "auto" or a fixed preset. In auto mode the preset comes from the first-launch benchmark
## (scripts/core/auto_graphics.gd) and may be lowered later by the adaptive controller
## (sustained low FPS, with hysteresis and cool-down). Systems listen to `quality_changed`.
## Dynamic resolution: scaling_3d_scale is moved within [scale_min, scale] of the preset based on
## measured GPU/frame time, with dead-band and delays so it does not oscillate.

signal quality_changed(level: int)
signal settings_changed

enum Quality { LOW, MEDIUM, HIGH, ULTRA }
const NAMES := ["Low", "Medium", "High", "Ultra"]

const PRESETS := {
	Quality.LOW: {
		"render_scale": 0.6, "scale_min": 0.45, "msaa": 0, "fxaa": false, "shadows": true, "shadow_distance": 35.0,
		"shadow_size": 1024, "shadow_splits": 1, "tree_shadows": false, "grass_radius": 8.0, "grass_density": 0.4,
		"tree_lod0_dist": 22.0, "tree_draw_dist": 220.0, "detail_dist": 40.0, "prop_dist": 55.0,
		"building_detail_dist": 35.0, "city_draw_dist": 420.0, "fog": true, "glow": false, "sky_radiance": 32,
		"macro_detail": false,
	},
	Quality.MEDIUM: {
		"render_scale": 0.72, "scale_min": 0.5, "msaa": 0, "fxaa": true, "shadows": true, "shadow_distance": 55.0,
		"shadow_size": 2048, "shadow_splits": 2, "tree_shadows": false, "grass_radius": 13.0, "grass_density": 0.6,
		"tree_lod0_dist": 40.0, "tree_draw_dist": 360.0, "detail_dist": 70.0, "prop_dist": 90.0,
		"building_detail_dist": 60.0, "city_draw_dist": 600.0, "fog": true, "glow": false, "sky_radiance": 64,
		"macro_detail": true,
	},
	Quality.HIGH: {
		"render_scale": 0.85, "scale_min": 0.6, "msaa": 0, "fxaa": true, "shadows": true, "shadow_distance": 90.0,
		"shadow_size": 2048, "shadow_splits": 4, "tree_shadows": true, "grass_radius": 20.0, "grass_density": 0.85,
		"tree_lod0_dist": 65.0, "tree_draw_dist": 500.0, "detail_dist": 110.0, "prop_dist": 130.0,
		"building_detail_dist": 100.0, "city_draw_dist": 900.0, "fog": true, "glow": true, "sky_radiance": 128,
		"macro_detail": true,
	},
	Quality.ULTRA: {
		"render_scale": 1.0, "scale_min": 0.7, "msaa": 2, "fxaa": false, "shadows": true, "shadow_distance": 140.0,
		"shadow_size": 4096, "shadow_splits": 4, "tree_shadows": true, "grass_radius": 26.0, "grass_density": 1.0,
		"tree_lod0_dist": 110.0, "tree_draw_dist": 700.0, "detail_dist": 130.0, "prop_dist": 170.0,
		"building_detail_dist": 170.0, "city_draw_dist": 1200.0, "fog": true, "glow": true, "sky_radiance": 256,
		"macro_detail": true,
	},
}

const CFG_PATH := "user://settings.cfg"
const BENCH_VERSION := 2      ## bump to force a new benchmark after big optimisations

var mode := "auto"             ## "auto" | "low" | "medium" | "high" | "ultra"
var quality: int = Quality.MEDIUM
var fps_cap := 30
var show_fps := true
var show_diagnostics := false
var dynamic_resolution := true
var bench: Dictionary = {}     ## last benchmark result
var current_scale := 0.72
var adaptive_log: Array[String] = []

var _ema_ms := 0.0
var _over_t := 0.0
var _under_t := 0.0
var _cooldown := 0.0
var _vp_rid: RID


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	var cfg := ConfigFile.new()
	if cfg.load(CFG_PATH) == OK:
		mode = str(cfg.get_value("graphics", "mode", "auto"))
		quality = clampi(int(cfg.get_value("graphics", "quality", Quality.MEDIUM)), 0, 3)
		fps_cap = int(cfg.get_value("graphics", "fps_cap", 30))
		show_fps = bool(cfg.get_value("graphics", "show_fps", true))
		show_diagnostics = bool(cfg.get_value("graphics", "show_diagnostics", false))
		dynamic_resolution = bool(cfg.get_value("graphics", "dynamic_resolution", true))
		bench = cfg.get_value("graphics", "bench", {})
	else:
		quality = Quality.LOW if OS.has_feature("mobile") else Quality.HIGH   # safe start until benchmarked
	if mode != "auto":
		quality = maxi(0, ["low", "medium", "high", "ultra"].find(mode))
	for a in OS.get_cmdline_user_args():      # test/CI overrides (not saved)
		if a.begins_with("quality="):
			var q := ["low", "medium", "high", "ultra"].find(a.substr(8).to_lower())
			if q >= 0:
				quality = q
				mode = a.substr(8).to_lower()
		elif a == "nodynres":
			dynamic_resolution = false
	current_scale = get_value("render_scale")
	_vp_rid = get_tree().root.get_viewport_rid()
	RenderingServer.viewport_set_measure_render_time(_vp_rid, true)
	_apply_viewport()


func get_value(key: String) -> Variant:
	return PRESETS[quality][key]


func needs_benchmark() -> bool:
	if DisplayServer.get_name() == "headless":
		return false
	for a in OS.get_cmdline_user_args():          # automated captures / tests
		if a.begins_with("cam=") or a.begins_with("scene=") or a == "nobench":
			return false
	return mode == "auto" and (bench.is_empty() or int(bench.get("version", 0)) != BENCH_VERSION)


func set_mode(m: String) -> void:
	mode = m
	if m != "auto":
		set_quality(["low", "medium", "high", "ultra"].find(m))
	else:
		if bench.has("quality"):
			set_quality(int(bench["quality"]))
	save()
	settings_changed.emit()


func set_quality(q: int) -> void:
	quality = clampi(q, 0, 3)
	current_scale = get_value("render_scale")
	_apply_viewport()
	save()
	quality_changed.emit(quality)


func set_fps_cap(cap: int) -> void:
	fps_cap = cap
	_apply_viewport()
	save()
	settings_changed.emit()


func set_flag(key: String, v: bool) -> void:
	set(key, v)
	if key == "dynamic_resolution" and not v:
		current_scale = get_value("render_scale")
		_apply_viewport()
	save()
	settings_changed.emit()


func store_benchmark(result: Dictionary) -> void:
	bench = result
	bench["version"] = BENCH_VERSION
	if mode == "auto":
		set_quality(int(result["quality"]))
	save()


func save() -> void:
	var cfg := ConfigFile.new()
	cfg.set_value("graphics", "mode", mode)
	cfg.set_value("graphics", "quality", quality)
	cfg.set_value("graphics", "fps_cap", fps_cap)
	cfg.set_value("graphics", "show_fps", show_fps)
	cfg.set_value("graphics", "show_diagnostics", show_diagnostics)
	cfg.set_value("graphics", "dynamic_resolution", dynamic_resolution)
	cfg.set_value("graphics", "bench", bench)
	cfg.save(CFG_PATH)


func quality_name() -> String:
	return NAMES[quality]


func target_frame_ms() -> float:
	return 1000.0 / float(fps_cap)


func gpu_time_ms() -> float:
	return RenderingServer.viewport_get_measured_render_time_gpu(_vp_rid)


func _apply_viewport() -> void:
	var vp := get_tree().root
	vp.scaling_3d_scale = current_scale
	# FSR 1.0 upscaling keeps reduced resolutions sharp (Mobile renderer); bilinear on Compatibility
	# FSR 1.0 exists only in Forward+; Mobile/Compatibility use bilinear upscaling
	if RenderingServer.get_current_rendering_method() == "forward_plus" and current_scale < 0.95:
		vp.scaling_3d_mode = Viewport.SCALING_3D_MODE_FSR
	else:
		vp.scaling_3d_mode = Viewport.SCALING_3D_MODE_BILINEAR
	vp.msaa_3d = [Viewport.MSAA_DISABLED, Viewport.MSAA_2X, Viewport.MSAA_4X][int(get_value("msaa")) / 2]
	vp.screen_space_aa = Viewport.SCREEN_SPACE_AA_FXAA if get_value("fxaa") else Viewport.SCREEN_SPACE_AA_DISABLED
	RenderingServer.directional_shadow_atlas_set_size(int(get_value("shadow_size")), true)
	Engine.max_fps = fps_cap
	DisplayServer.window_set_vsync_mode(DisplayServer.VSYNC_ENABLED)


## Dynamic resolution + adaptive quality (auto mode). Uses the GPU time when the renderer
## reports it (frame time is capped by vsync/max_fps and hides headroom), else frame delta.
func _process(delta: float) -> void:
	if get_tree().paused or delta <= 0.0:
		return
	var gpu := gpu_time_ms()
	var ms := gpu if gpu > 0.05 else delta * 1000.0
	ms = maxf(ms, Performance.get_monitor(Performance.TIME_PROCESS) * 1000.0)
	_ema_ms = ms if _ema_ms == 0.0 else lerpf(_ema_ms, ms, 0.05)
	_cooldown = maxf(0.0, _cooldown - delta)
	if not dynamic_resolution or _cooldown > 0.0:
		return
	var target := target_frame_ms() * 0.9
	if _ema_ms > target * 1.08:
		_over_t += delta
		_under_t = 0.0
	elif _ema_ms < target * 0.7:
		_under_t += delta
		_over_t = 0.0
	else:
		_over_t = 0.0
		_under_t = 0.0
	if _over_t > 1.5:
		_over_t = 0.0
		if current_scale > float(get_value("scale_min")) + 0.01:
			current_scale = maxf(float(get_value("scale_min")), current_scale - 0.05)
			_apply_viewport()
			_cooldown = 1.0
		elif mode == "auto" and quality > 0:
			# resolution floor reached and still too slow: lower the most expensive settings
			adaptive_log.append("%s: %.1f ms > %.1f, %s -> %s" % [Time.get_time_string_from_system(), _ema_ms, target, NAMES[quality], NAMES[quality - 1]])
			set_quality(quality - 1)
			_cooldown = 12.0
	elif _under_t > 5.0:
		_under_t = 0.0
		if current_scale < float(get_value("render_scale")) - 0.01:
			current_scale = minf(float(get_value("render_scale")), current_scale + 0.05)
			_apply_viewport()
			_cooldown = 2.0


func smoothed_frame_ms() -> float:
	return _ema_ms
