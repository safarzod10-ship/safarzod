extends Node
## Captures screenshots of the test scenes with a REAL renderer (software GPU
## when run under xvfb-run with Mesa). Args after "--":
##   <scene path> <quality low|medium|ultra> <out png> [frames] [tx,ty,tz,distance,height,yaw,pitch]
## This proves rendering works; it says nothing about mobile GPU speed.


func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	var scene_path := args[0]
	var q := GraphicsPresets.from_name(args[1])
	var out := args[2]
	var frames := int(args[3]) if args.size() > 3 else 90
	SettingsManager.set_quality(q)
	await get_tree().process_frame
	var placeholder := Node.new()
	get_tree().root.add_child(placeholder)
	get_tree().current_scene = placeholder
	get_tree().change_scene_to_file(scene_path)
	await get_tree().process_frame
	if args.size() > 4:
		var c := args[4].split_floats(",")
		var cam := get_tree().current_scene.get_node("Camera") as OrbitCamera
		cam.target = Vector3(c[0], c[1], c[2])
		cam.distance = c[3]
		cam.height = c[4]
		cam.yaw_deg = c[5]
		cam.pitch_deg = c[6]
		cam.auto_speed_deg = 0.0
	for i in frames:
		await get_tree().process_frame
	var img := get_viewport().get_texture().get_image()
	img.save_png(out)
	print("CAPTURED %s %s %dx%d fps=%d renderer=%s adapter=%s" % [out, args[1], img.get_width(), img.get_height(),
		Engine.get_frames_per_second(), RenderingServer.get_current_rendering_method(), RenderingServer.get_video_adapter_name()])
	get_tree().quit()
