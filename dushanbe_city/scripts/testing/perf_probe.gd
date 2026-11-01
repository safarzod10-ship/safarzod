extends Node
## Performance probe: loads the main scene at a fixed camera, optionally disables subsystems,
## then measures over N frames: wall frame time, measured GPU/CPU render time of the viewport,
## process/physics script time, draw calls, primitives, objects, video memory.
## Usage (one line per run, JSON appended to out file):
##   godot --path . res://scenes/testing/perf_probe.tscn -- cam=x,y,z,yaw,pitch label=NAME out=FILE
##        [quality=low|medium|high|ultra] [off=shadows,trees,grass,props,detail,backdrop,lights,foliage_shadows,sky_rt]
##        [scale=0.5] [frames=40]

func _ready() -> void:
	var opt := {}
	for a in OS.get_cmdline_user_args():
		var kv := a.split("=", true, 1)
		opt[kv[0]] = kv[1] if kv.size() > 1 else "1"
	var scene: Node = (load("res://scenes/main/main.tscn") as PackedScene).instantiate()
	get_tree().root.add_child.call_deferred(scene)
	for i in 10:
		await get_tree().process_frame
	var c := String(opt.get("cam", "-50,1.7,-60,15,3")).split_floats(",")
	var cam := Camera3D.new()
	cam.far = 4500.0
	get_tree().root.add_child(cam)
	cam.global_position = Vector3(c[0], c[1], c[2])
	cam.rotation = Vector3(deg_to_rad(c[4]), deg_to_rad(c[3]), 0)
	cam.make_current()
	for n in get_tree().get_nodes_in_group(&"streaming_camera_override"):
		n.set("override_camera", cam)
	for p in get_tree().get_nodes_in_group(&"player"):
		(p as Node3D).visible = opt.get("player", "0") == "1"
		p.set_physics_process(opt.get("player", "0") == "1")
	var off := String(opt.get("off", "")).split(",", false)
	for o in off:
		match o:
			"shadows":
				for l in get_tree().root.find_children("*", "DirectionalLight3D", true, false):
					(l as DirectionalLight3D).shadow_enabled = false
			"trees":
				for n in get_tree().get_nodes_in_group(&"city_trees"):
					(n as Node3D).visible = false
			"props":
				for n in get_tree().get_nodes_in_group(&"city_props"):
					(n as Node3D).visible = false
			"detail":
				for n in get_tree().get_nodes_in_group(&"city_detail"):
					(n as Node3D).visible = false
			"grass":
				for g in get_tree().root.find_children("Grass", "", true, false):
					(g as Node3D).visible = false
					g.set_process(false)
			"backdrop":
				for b in get_tree().root.find_children("Backdrop", "", true, false):
					(b as Node3D).visible = false
			"foliage_shadows":
				for n in get_tree().get_nodes_in_group(&"city_trees"):
					(n as GeometryInstance3D).cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
			"sky_rt":
				for we in get_tree().root.find_children("*", "WorldEnvironment", true, false):
					(we as WorldEnvironment).environment.sky.process_mode = Sky.PROCESS_MODE_QUALITY
			"city":
				for ch in get_tree().root.find_children("chunk_*", "", true, false):
					(ch as Node3D).visible = false
			"fog":
				for we in get_tree().root.find_children("*", "WorldEnvironment", true, false):
					(we as WorldEnvironment).environment.fog_enabled = false
			"glow":
				for we in get_tree().root.find_children("*", "WorldEnvironment", true, false):
					(we as WorldEnvironment).environment.glow_enabled = false
	if opt.has("scale"):
		get_viewport().scaling_3d_scale = float(opt["scale"])
	var vp := get_viewport().get_viewport_rid()
	RenderingServer.viewport_set_measure_render_time(vp, true)
	for i in 15:
		await get_tree().process_frame
	var n := int(opt.get("frames", "30"))
	var t0 := Time.get_ticks_usec()
	var gpu := 0.0
	var cpu := 0.0
	var proc := 0.0
	var phys := 0.0
	var worst := 0.0
	var last := t0
	for i in n:
		await get_tree().process_frame
		var now := Time.get_ticks_usec()
		worst = maxf(worst, (now - last) / 1000.0)
		last = now
		gpu += RenderingServer.viewport_get_measured_render_time_gpu(vp)
		cpu += RenderingServer.viewport_get_measured_render_time_cpu(vp) + RenderingServer.get_frame_setup_time_cpu()
		proc += Performance.get_monitor(Performance.TIME_PROCESS) * 1000.0
		phys += Performance.get_monitor(Performance.TIME_PHYSICS_PROCESS) * 1000.0
	var wall := (Time.get_ticks_usec() - t0) / 1000.0 / n
	var r := {
		"label": opt.get("label", "run"), "quality": Settings.quality_name(), "off": opt.get("off", ""),
		"scale": get_viewport().scaling_3d_scale, "frame_ms": snappedf(wall, 0.1), "worst_ms": snappedf(worst, 0.1),
		"gpu_ms": snappedf(gpu / n, 0.1), "render_cpu_ms": snappedf(cpu / n, 0.1),
		"process_ms": snappedf(proc / n, 0.01), "physics_ms": snappedf(phys / n, 0.01),
		"draw_calls": RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_DRAW_CALLS_IN_FRAME),
		"primitives": RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_PRIMITIVES_IN_FRAME),
		"objects": RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_OBJECTS_IN_FRAME),
		"vram_mb": snappedf(RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_VIDEO_MEM_USED) / 1048576.0, 0.1),
		"tex_mb": snappedf(RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TEXTURE_MEM_USED) / 1048576.0, 0.1),
		"buf_mb": snappedf(RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_BUFFER_MEM_USED) / 1048576.0, 0.1),
		"static_mem_mb": snappedf(Performance.get_monitor(Performance.MEMORY_STATIC) / 1048576.0, 0.1),
		"nodes": Performance.get_monitor(Performance.OBJECT_NODE_COUNT),
	}
	var line := JSON.stringify(r)
	print("PERF ", line)
	if opt.has("out"):
		var f := FileAccess.open(opt["out"], FileAccess.READ_WRITE if FileAccess.file_exists(opt["out"]) else FileAccess.WRITE)
		f.seek_end()
		f.store_line(line)
		f.close()
	get_tree().quit()
