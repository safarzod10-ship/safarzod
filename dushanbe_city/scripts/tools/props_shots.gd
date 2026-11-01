extends Node
## Multi-shot screenshot helper for the prop gallery (one scene load, many camera views).
## godot --path . --resolution 1280x720 res://scenes/testing/capture.tscn is single-shot; this one:
##   xvfb-run -a godot --path . --resolution 1280x720 --rendering-method mobile \
##     res://scenes/testing/props_shots.tscn -- shots=/abs/shots.json outdir=/abs/dir
## shots.json: [{"name": "benches_5m", "cam": [x, y, z, yaw_deg, pitch_deg], "fov": 60}, ...]

func _ready() -> void:
	var opt := {}
	for a in OS.get_cmdline_user_args():
		var kv := a.split("=", true, 1)
		opt[kv[0]] = kv[1] if kv.size() > 1 else "1"
	var scene: Node = (load(opt.get("scene", "res://scenes/testing/props_gallery.tscn")) as PackedScene).instantiate()
	add_child(scene)
	var shots: Array = JSON.parse_string(FileAccess.get_file_as_string(opt["shots"]))
	var only: String = opt.get("only", "")
	var cam := Camera3D.new()
	cam.far = 500.0
	add_child(cam)
	cam.make_current()
	var first := true
	for s in shots:
		if only != "" and not String(s["name"]).contains(only):
			continue
		var c: Array = s["cam"]
		cam.fov = float(s.get("fov", 60))
		cam.global_position = Vector3(c[0], c[1], c[2])
		cam.rotation = Vector3(deg_to_rad(c[4]), deg_to_rad(c[3]), 0.0)
		for i in (40 if first else 6):
			await get_tree().process_frame
		first = false
		var img := get_viewport().get_texture().get_image()
		var path: String = opt.get("outdir", "/tmp") + "/" + String(s["name"]) + ".png"
		img.save_png(path)
		print("SHOT ", path)
	get_tree().quit()
