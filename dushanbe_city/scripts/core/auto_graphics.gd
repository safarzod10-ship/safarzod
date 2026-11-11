class_name AutoGraphics
extends Node
## First-launch graphics auto-configuration (and on request from the menu).
##
## 1. Reads what the device reports (model, GPU adapter, renderer, CPU cores, RAM) and picks a
##    SAFE starting preset only from that (never the final choice).
## 2. Runs a short benchmark inside the real city: 3 representative views (tree-lined avenue,
##    courtyard, park), each: warm-up, then measured frames with the FPS cap and vsync OFF.
## 3. Walks presets up/down: a preset passes when the 90th-percentile frame time fits the 30 FPS
##    budget with 10 % headroom (Ultra must also fit a 60 FPS-capable budget).
## 4. Applies and saves the result (Settings.store_benchmark); recommends the 60 FPS cap when
##    the chosen preset still renders under ~15 ms.
## Not repeated on later launches unless the user asks (menu) or BENCH_VERSION changes.

signal finished(result: Dictionary)

const VIEWS := [   # x, y, z, yaw, pitch — representative load (dense trees / buildings / park / coast)
	[-50.0, 1.7, -60.0, 15.0, 3.0],
	[-262.0, 1.7, -205.0, 200.0, 4.0],
	[-80.0, 1.7, -30.0, -60.0, 0.0],
	[-28.0, 2.6, 360.0, -110.6, -3.0],     # promenade: terrain, coast trees, sea, far mountains
]
const WARMUP_S := 0.8
const MEASURE_S := 1.2
const BUDGET_30 := 1000.0 / 30.0 * 0.9      ## 30 ms
const BUDGET_ULTRA := 1000.0 / 60.0 * 1.2   ## 20 ms

var results: Array = []
var _cam: Camera3D
var _ui: CanvasLayer
var _label: Label


static func device_info() -> Dictionary:
	var mem := OS.get_memory_info()
	return {
		"model": OS.get_model_name(), "os": OS.get_name() + " " + OS.get_version(),
		"adapter": RenderingServer.get_video_adapter_name(), "vendor": RenderingServer.get_video_adapter_vendor(),
		"api": RenderingServer.get_video_adapter_api_version(), "renderer": RenderingServer.get_current_rendering_method(),
		"cores": OS.get_processor_count(), "ram_mb": int(mem.get("physical", 0) / 1048576),
		"screen": str(DisplayServer.screen_get_size()),
	}


static func safe_start(info: Dictionary) -> int:
	## Starting point only. Low RAM or the GLES3 fallback start at Low.
	var ram: int = info.get("ram_mb", 0)
	if info.get("renderer", "") == "gl_compatibility" or (ram > 0 and ram < 3500):
		return Settings.Quality.LOW
	if ram > 0 and ram < 6500:
		return Settings.Quality.MEDIUM
	return Settings.Quality.HIGH if OS.has_feature("mobile") else Settings.Quality.ULTRA


## first launch without the camera tour: the preset from what the device reports; the in-game
## adaptive resolution / quality (Settings) then tunes it to the real frame time while playing
static func quick_pick() -> void:
	var info := device_info()
	var q := safe_start(info)
	Settings.store_benchmark({"quality": q, "quality_name": Settings.NAMES[q], "recommended_fps_cap": 30,
			"quick": true, "device": info, "date": Time.get_datetime_string_from_system()})
	print("AUTO_GRAPHICS quick ", Settings.NAMES[q])


func run() -> void:
	var info := device_info()
	_make_ui()
	var prev_cap := Engine.max_fps
	var prev_dyn := Settings.dynamic_resolution
	Settings.dynamic_resolution = false
	Engine.max_fps = 0
	DisplayServer.window_set_vsync_mode(DisplayServer.VSYNC_DISABLED)
	_cam = Camera3D.new()
	_cam.far = 4500.0
	get_tree().root.add_child(_cam)
	_cam.make_current()
	for n in get_tree().get_nodes_in_group(&"streaming_camera_override"):
		n.set("override_camera", _cam)
	var pl := get_tree().get_nodes_in_group(&"player")
	for p in pl:
		p.set_physics_process(false)

	var q := safe_start(info)
	var tested := {}
	var chosen := -1
	var step := 0
	while step < 4:
		step += 1
		var r: Dictionary = await _measure(q, step)
		tested[q] = r
		var budget := BUDGET_ULTRA if q == Settings.Quality.ULTRA else BUDGET_30
		var ok: bool = r["p90_ms"] <= budget
		if ok:
			chosen = q
			if q == Settings.Quality.ULTRA or tested.has(q + 1):
				break
			q += 1
		else:
			if q == Settings.Quality.LOW or tested.has(q - 1):
				break
			q -= 1
	if chosen < 0:
		chosen = Settings.Quality.LOW        # even Low misses 30 FPS: dynamic resolution takes over
	var best: Dictionary = tested.get(chosen, {})
	var p90: float = best.get("p90_ms", 99.0)
	var result := {
		"quality": chosen, "quality_name": Settings.NAMES[chosen], "recommended_fps_cap": 60 if p90 <= 15.0 else 30,
		"tests": results, "device": info, "date": Time.get_datetime_string_from_system(),
	}
	# restore
	for p in pl:
		p.set_physics_process(true)
	for n in get_tree().get_nodes_in_group(&"streaming_camera_override"):
		n.set("override_camera", null)
	_cam.queue_free()
	var player_cam: Camera3D = pl[0].call("get_camera") if not pl.is_empty() else null
	if player_cam:
		player_cam.make_current()
	Settings.dynamic_resolution = prev_dyn
	Settings.store_benchmark(result)
	if result["recommended_fps_cap"] == 60 and not Settings.bench.has("cap_set_by_user"):
		Settings.set_fps_cap(60)
	else:
		Settings.set_fps_cap(maxi(30, prev_cap))
	_ui.queue_free()
	print("AUTO_GRAPHICS ", JSON.stringify(result))
	finished.emit(result)


func _measure(q: int, step: int) -> Dictionary:
	Settings.set_quality(q)
	var frames: Array[float] = []
	var gpu: Array[float] = []
	for vi in VIEWS.size():
		var v: Array = VIEWS[vi]
		_cam.global_position = Vector3(v[0], v[1], v[2])
		_cam.rotation = Vector3(deg_to_rad(v[4]), deg_to_rad(v[3]), 0.0)
		_label.text = "Подбор настроек графики…\nтест %d · %s · вид %d/%d" % [step, Settings.NAMES[q], vi + 1, VIEWS.size()]
		var t := 0.0
		while t < WARMUP_S:
			await get_tree().process_frame
			t += get_process_delta_time()
		t = 0.0
		while t < MEASURE_S:
			await get_tree().process_frame
			var d := get_process_delta_time()
			t += d
			var g := Settings.gpu_time_ms()
			# frame cost = max(wall delta, GPU time): wall time alone can hide GPU-bound work
			frames.append(maxf(d * 1000.0, g))
			gpu.append(g)
	frames.sort()
	var avg := 0.0
	for f in frames:
		avg += f
	avg /= maxf(frames.size(), 1)
	var g := 0.0
	for x in gpu:
		g += x
	var r := {"quality": Settings.NAMES[q], "avg_ms": snappedf(avg, 0.1), "p90_ms": snappedf(frames[int(frames.size() * 0.9)] if frames.size() > 0 else 99.0, 0.1),
		"gpu_ms": snappedf(g / maxf(gpu.size(), 1), 0.1), "frames": frames.size()}
	results.append(r)
	print("AUTO_GRAPHICS test ", r)
	return r


func _make_ui() -> void:
	_ui = CanvasLayer.new()
	_ui.layer = 60
	var panel := PanelContainer.new()
	panel.set_anchors_preset(Control.PRESET_CENTER_TOP)
	panel.position = Vector2(-260, 40)
	panel.custom_minimum_size = Vector2(520, 0)
	_label = Label.new()
	_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_label.add_theme_font_size_override("font_size", 26)
	panel.add_child(_label)
	_ui.add_child(panel)
	add_child(_ui)
