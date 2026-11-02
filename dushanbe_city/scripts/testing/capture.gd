extends Node
## Real-renderer screenshot tool (works headless-GPU via xvfb-run + Mesa lavapipe).
## godot --path . res://scenes/testing/capture.tscn -- scene=<res path> out=<png> [frames=60]
##   [cam=x,y,z,yaw,pitch] [player=x,z,yaw] [time=H] [quality=low|medium|high] [hide_ui=1]

func _ready() -> void:
	var opt := {}
	for a in OS.get_cmdline_user_args():
		var kv := a.split("=", true, 1)
		opt[kv[0]] = kv[1] if kv.size() > 1 else "1"
	var packed: PackedScene = load(opt.get("scene", "res://scenes/main/main.tscn"))
	var scene := packed.instantiate()
	get_tree().root.add_child.call_deferred(scene)
	for i in 8:
		await get_tree().process_frame
	if opt.has("time"):
		for n in get_tree().get_nodes_in_group(&"time_of_day"):
			n.call("set_hour", float(opt["time"]))
	if opt.has("player"):
		var p := String(opt["player"]).split_floats(",")
		for pl in get_tree().get_nodes_in_group(&"player"):
			pl.call("teleport", Vector3(p[0], 0.0, p[1]), deg_to_rad(p[2]) if p.size() > 2 else 0.0)
	if opt.has("cam"):
		var c := String(opt["cam"]).split_floats(",")
		var cam := Camera3D.new()
		cam.far = 9500.0
		cam.fov = float(opt.get("fov", "70"))
		get_tree().root.add_child(cam)
		cam.global_position = Vector3(c[0], c[1], c[2])
		cam.rotation = Vector3(deg_to_rad(c[4]), deg_to_rad(c[3]), 0.0)
		cam.make_current()
		for n in get_tree().get_nodes_in_group(&"streaming_camera_override"):
			n.set("override_camera", cam)
	for key: String in opt:
		if key.begins_with("sun."):
			for l in get_tree().root.find_children("*", "DirectionalLight3D", true, false):
				l.set(key.substr(4), str_to_var(opt[key]))
		elif key.begins_with("env."):
			for we in get_tree().root.find_children("*", "WorldEnvironment", true, false):
				(we as WorldEnvironment).environment.set(key.substr(4), str_to_var(opt[key]))
	if opt.has("carinput"):     # throttle,steer[,handbrake] for driving captures (with the 'drive' arg)
		var ci := String(opt["carinput"]).split_floats(",")
		VehicleInput.scripted = {"throttle": ci[0], "steer": ci[1] if ci.size() > 1 else 0.0, "handbrake": ci.size() > 2 and ci[2] > 0.5}
	if opt.get("hide_ui", "0") == "1":
		for n in get_tree().root.find_children("*", "CanvasLayer", true, false):
			(n as CanvasLayer).visible = false
	for i in int(opt.get("frames", "60")):
		await get_tree().process_frame
	for v in get_tree().get_nodes_in_group(&"vehicle"):
		var c := v as VehiclePrado
		print("CAR pos=%s yaw=%.0f speed=%.0f driven=%s gear=%d" % [c.global_position.snapped(Vector3.ONE * 0.1), rad_to_deg(c.global_rotation.y), c.speed_kmh, c.driven, c.gear])
	for cc in get_tree().root.find_children("*", "CarControls", true, false):
		print("CARUI visible=%s vis_tree=%s size=%s touch=%s" % [cc.visible, (cc as CanvasItem).is_visible_in_tree(), (cc as Control).size, cc.get("touch_mode")])
	var img := get_viewport().get_texture().get_image()
	img.save_png(opt.get("out", "/tmp/capture.png"))
	print("CAPTURED ", opt.get("out"), " fps=", Engine.get_frames_per_second(),
		" draw_calls=", RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_DRAW_CALLS_IN_FRAME),
		" prims=", RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_PRIMITIVES_IN_FRAME))
	get_tree().quit()
