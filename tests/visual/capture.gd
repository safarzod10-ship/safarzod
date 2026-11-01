extends Node
## Captures a screenshot of a scene with a REAL renderer (software GPU when run
## under xvfb-run with Mesa) and optionally measures pixel values.
## Args after "--":  <scene> <quality> <out.png> [key=value ...]
##   frames=N            frames to wait (default 90)
##   cam=tx,ty,tz,dist,height,yaw,pitch   OrbitCamera framing
##   fly=x,y,z,yaw,pitch FreeFlyCamera pose (environment scenes)
##   time=H              DayNightCycle hour     weather=Name  WeatherManager state
##   hide_ui=1           hide CanvasLayers      probes=1  measure scene probe_points()
## Proves rendering works; it says nothing about mobile GPU speed.


func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	var scene_path := args[0]
	var q := GraphicsPresets.from_name(args[1])
	var out := args[2]
	var opt := {}
	for a in args.slice(3):
		var kv := a.split("=", true, 1)
		opt[kv[0]] = kv[1] if kv.size() > 1 else "1"
	SettingsManager.set_quality(q)
	await get_tree().process_frame
	var placeholder := Node.new()
	get_tree().root.add_child(placeholder)
	get_tree().current_scene = placeholder
	get_tree().change_scene_to_file(scene_path)
	await get_tree().process_frame
	await get_tree().process_frame
	var scene := get_tree().current_scene
	if opt.has("cam"):
		var c := String(opt["cam"]).split_floats(",")
		var cam := scene.get_node("Camera") as OrbitCamera
		cam.target = Vector3(c[0], c[1], c[2])
		cam.distance = c[3]
		cam.height = c[4]
		cam.yaw_deg = c[5]
		cam.pitch_deg = c[6]
		cam.auto_speed_deg = 0.0
	if opt.has("fly"):
		var f := String(opt["fly"]).split_floats(",")
		for cam in get_tree().get_nodes_in_group(&"dev_camera"):
			cam.call("set_pose", Vector3(f[0], f[1], f[2]), f[3], f[4])
	for dn in get_tree().get_nodes_in_group(&"day_night"):
		dn.set("paused", true)
		if opt.has("time"):
			dn.call("set_time", float(opt["time"]))
	if opt.has("weather"):
		for wm in get_tree().get_nodes_in_group(&"weather"):
			wm.call("set_state_immediate", String(opt["weather"]))
	# experiment overrides: env.<property>=value (Environment), sun.<property>=value (light, after apply)
	for key: String in opt:
		if key.begins_with("env."):
			for we in scene.find_children("*", "WorldEnvironment", true, false):
				(we as WorldEnvironment).environment.set(key.substr(4), str_to_var(opt[key]))
	if opt.get("hide_ui", "0") == "1":
		for n in scene.find_children("*", "CanvasLayer", true, false):
			(n as CanvasLayer).visible = false
	var frames := int(opt.get("frames", "90"))
	for key: String in opt:
		if key.begins_with("dn."):
			for dn in get_tree().get_nodes_in_group(&"day_night"):
				dn.set(key.substr(3), str_to_var(opt[key]))
				dn.call("apply_now")
	if opt.has("light_mult"):
		for dn in get_tree().get_nodes_in_group(&"day_night"):
			dn.call("set_weather", {"light_mult": float(opt["light_mult"])})
			dn.call("apply_now")
	for i in frames:
		await get_tree().process_frame
	var img := get_viewport().get_texture().get_image()
	img.save_png(out)
	var info := {"out": out, "quality": args[1], "w": img.get_width(), "h": img.get_height(),
		"fps": Engine.get_frames_per_second(), "renderer": RenderingServer.get_current_rendering_method(),
		"adapter": RenderingServer.get_video_adapter_name(),
		"draw_calls": Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME),
		"primitives": Performance.get_monitor(Performance.RENDER_TOTAL_PRIMITIVES_IN_FRAME),
		"objects": Performance.get_monitor(Performance.RENDER_TOTAL_OBJECTS_IN_FRAME),
		"video_mem_mb": snappedf(Performance.get_monitor(Performance.RENDER_VIDEO_MEM_USED) / 1048576.0, 0.1)}
	print("CAPTURED ", JSON.stringify(info))
	if opt.get("probes", "0") == "1" and scene.has_method("probe_points"):
		var cam3d := get_viewport().get_camera_3d()
		var res := {}
		var k := Vector2(img.get_width(), img.get_height()) / get_viewport().get_visible_rect().size
		var pts: Dictionary = scene.call("probe_points")
		for name: String in pts:
			var sp := cam3d.unproject_position(pts[name]) * k
			var acc := Color(0, 0, 0)
			var n := 0
			for dx in range(-3, 4):
				for dy in range(-3, 4):
					var x := clampi(int(sp.x) + dx, 0, img.get_width() - 1)
					var y := clampi(int(sp.y) + dy, 0, img.get_height() - 1)
					acc += img.get_pixel(x, y)
					n += 1
			acc /= n
			res[name] = [roundi(acc.r * 255), roundi(acc.g * 255), roundi(acc.b * 255)]
		print("PROBES ", JSON.stringify(res))
	get_tree().quit()
