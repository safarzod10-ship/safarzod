extends Node3D
## Prado v3 inspection: car on a neutral plaza, real sky rig, shots at 20/10/5/2/1 m from real
## points of the car, driver view, cabin through the 20 % VLT glass, doors-open rig check.
##   xvfb-run -a godot --path . --rendering-method mobile res://scenes/testing/prado_inspection.tscn \
##       -- capture=<dir> [quality=ultra] [time=10.5] [shots=a,b] [dists=20,10,5,2,1]

## name: [target (car space, Godot: front +Z, left +X, y up), direction target -> camera]
const SHOTS := {
	"front34": [Vector3(0.0, 0.95, 2.2), Vector3(0.55, 0.22, 1.0)],
	"headlight": [Vector3(0.62, 0.98, 2.25), Vector3(0.25, 0.10, 1.0)],
	"side_door": [Vector3(0.93, 0.95, 0.2), Vector3(1.0, 0.10, 0.15)],
	"wheel": [Vector3(0.95, 0.40, 1.36), Vector3(1.0, 0.12, 0.25)],
	"cabin_through_glass": [Vector3(0.80, 1.40, 0.0), Vector3(1.0, 0.08, 0.05)],
	"rear34": [Vector3(0.0, 1.10, -2.35), Vector3(0.45, 0.25, -1.0)],
}
const VIEWS := {   # camera, target, vfov
	"driver_view": [Vector3(0.40, 1.34, -0.10), Vector3(0.28, 1.05, 1.4), 70.0],
	"rear_seat_view": [Vector3(-0.25, 1.42, 0.45), Vector3(0.05, 0.85, -1.3), 70.0],
	"dash_closeup": [Vector3(0.05, 1.22, 0.15), Vector3(0.15, 1.05, 0.80), 55.0],
}

@onready var camera: DevCamera = $DevCamera
@onready var car: PradoRig = $Prado


func _ready() -> void:
	var opt := {}
	for a in OS.get_cmdline_user_args():
		var kv := a.split("=", true, 1)
		opt[kv[0]] = kv[1] if kv.size() > 1 else "1"
	if opt.has("quality"):
		SettingsManager.set_quality(GraphicsPresets.from_name(opt["quality"]))
	for dn in get_tree().get_nodes_in_group(&"day_night"):
		dn.set("paused", true)
		dn.call("set_time", float(opt.get("time", "10.5")))
		dn.call("apply_now")
	if opt.has("capture"):
		await _batch(opt)
	else:
		_look(Vector3(5.5, 1.6, 6.0), Vector3(0, 0.9, 0))


func _look(cam: Vector3, target: Vector3, fov := 70.0) -> void:
	var d := target - cam
	camera.set_pose(cam, rad_to_deg(atan2(-d.x, -d.z)), rad_to_deg(asin(clampf(d.normalized().y, -1, 1))))
	camera.fov = fov


func _batch(opt: Dictionary) -> void:
	var dir: String = opt["capture"]
	DirAccess.make_dir_recursive_absolute(dir)
	var frames := int(opt.get("frames", "12"))
	var names: PackedStringArray = String(opt.get("shots", ",".join(SHOTS.keys()))).split(",", false)
	var dists := String(opt.get("dists", "20,10,5,2,1")).split_floats(",")
	var res := []
	for v: String in VIEWS:
		_look(VIEWS[v][0], VIEWS[v][1], VIEWS[v][2])
		res.append(await _grab(dir, v, frames))
	for n in names:
		for d in dists:
			var t: Vector3 = SHOTS[n][0]
			_look(t + (SHOTS[n][1] as Vector3).normalized() * d, t)
			res.append(await _grab(dir, "%s_%02dm" % [n, int(d)], frames))
	# rig check: doors, hood, tailgate open; wheels steered
	for dn in ["Door_FL", "Door_FR", "Door_RL", "Door_RR"]:
		car.set_door(dn, 1.0)
	car.set_hood(0.8)
	car.set_tailgate(1.0)
	car.set_wheels(25.0, 0.0)
	_look(Vector3(5.0, 2.4, 5.5), Vector3(0, 0.9, 0))
	res.append(await _grab(dir, "rig_open_front", frames))
	_look(Vector3(-4.5, 2.2, -6.0), Vector3(0, 0.9, -0.5))
	res.append(await _grab(dir, "rig_open_rear", frames))
	print("INSPECTION ", JSON.stringify(res))
	get_tree().quit()


func _grab(dir: String, name: String, frames: int) -> Dictionary:
	camera.fov = camera.fov
	for i in frames:
		await get_tree().process_frame
	get_viewport().get_texture().get_image().save_png("%s/%s.png" % [dir, name])
	camera.fov = 70.0 if not VIEWS.has(name) else camera.fov
	return {"shot": name, "draw_calls": Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME),
		"primitives": Performance.get_monitor(Performance.RENDER_TOTAL_PRIMITIVES_IN_FRAME),
		"video_mem_mb": snappedf(Performance.get_monitor(Performance.RENDER_VIDEO_MEM_USED) / 1048576.0, 0.1)}
