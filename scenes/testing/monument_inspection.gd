extends Node3D
## Monument v3 inspection scene: the monument alone on a neutral plaza, real
## sky/sun rig, a free DevCamera, and named close-up shots at measured
## distances to the actual surface (20 / 10 / 5 / 2 / 1 m).
##
## Batch capture (real renderer; software Vulkan under xvfb on the server):
##   xvfb-run -a godot --path . --resolution 1280x720 res://scenes/testing/monument_inspection.tscn \
##       -- capture=<dir> [quality=ultra] [time=10.5] [shots=a,b] [dists=20,10,5,2,1]
## Interactive: keys 1-9 jump to the shots at 2 m; DevCamera controls as usual.

const FRONT := Vector3(0, 0, 1)   # monument front = +Z (statue faces the viewer)

## name: [element, aim point (approx, m, monument space), view direction (target -> camera)]
## The aim point is snapped to the real LOD0 surface along the view ray (_surface_point).
const SHOTS := {
	"statue_face": ["Statue", Vector3(0.0, 20.2, 2.0), Vector3(0.15, 0.05, 1.0)],
	"statue_robe": ["Statue", Vector3(0.3, 13.0, 2.0), Vector3(0.35, 0.0, 1.0)],
	"sceptre": ["Statue_Sceptre", Vector3(-1.8, 23.8, 4.6), Vector3(0.3, 0.0, 1.0)],
	"lion_head": ["Lion_L", Vector3(-14.0, 7.4, 8.0), Vector3(0.35, 0.1, 1.0)],
	"lion_mane": ["Lion_R", Vector3(14.0, 7.0, 7.5), Vector3(-1.0, 0.15, 0.4)],
	"arch_pylon": ["Arch", Vector3(-7.3, 11.0, 0.0), Vector3(-0.1, 0.05, 1.0)],
	"stalactites": ["Arch", Vector3(-3.0, 15.0, -2.0), Vector3(1.0, -0.15, 0.5)],
	"column": ["Colonnade_Columns", Vector3(10.6, 9.5, -2.0), Vector3(0.25, 0.0, 1.0)],
	"steps": ["Base_Platform", Vector3(3.0, 1.0, 12.0), Vector3(0.1, 1.0, 0.7)],
	"crown": ["Crown", Vector3(0.0, 41.6, -2.0), Vector3(0.3, 0.25, 1.0)],
}

## Fixed views matching the reference photos (docs/MONUMENT_REFERENCE_RESEARCH.md): camera, target, vfov
const VIEWS := {
	"photo_front_wide": [Vector3(0, 1.7, 115), Vector3(0, 19, 0), 40.0],      # front_wide_overcast_2015
	"photo_front_lowangle": [Vector3(0, 8.5, 21), Vector3(0, 21, 2), 70.0],   # front_lowangle_statue_arch_2015
	"photo_three_quarter": [Vector3(45, 1.7, 75), Vector3(0, 14, 0), 45.0],    # three_quarter_right_sunny_2018
	"photo_lion": [Vector3(-7.5, 6.0, 16.5), Vector3(-14, 6.5, 8), 60.0],      # lion_closeup_granite_platform_2015
	"photo_aerial": [Vector3(-60, 55, 70), Vector3(0, 10, 0), 40.0],           # aerial_three_quarter_platform_2018
}

@onready var camera: DevCamera = $DevCamera
@onready var monument: Node3D = $Monument   # MonumentLOD unless replaced by model=<path> (comparisons)
var _meshes := {}


func _ready() -> void:
	var opt := {}
	for a in OS.get_cmdline_user_args():
		var kv := a.split("=", true, 1)
		opt[kv[0]] = kv[1] if kv.size() > 1 else "1"
	if opt.has("model"):   # e.g. the v2 backup or the old monument, same cameras for comparison
		var other := (load(opt["model"]) as PackedScene).instantiate() as Node3D
		other.scale = Vector3.ONE * float(opt.get("model_scale", "1"))
		monument.replace_by(other)
		monument.queue_free()
		monument = other
		opt["shots"] = ""
	for mi: MeshInstance3D in monument.find_children("*_LOD0", "MeshInstance3D", true, false):
		_meshes[mi.name.trim_suffix("_LOD0")] = mi
	if opt.has("quality"):
		SettingsManager.set_quality(GraphicsPresets.from_name(opt["quality"]))
	for dn in get_tree().get_nodes_in_group(&"day_night"):
		dn.set("paused", true)
		dn.call("set_time", float(opt.get("time", "10.5")))
		dn.call("apply_now")
	if opt.has("capture"):
		await _batch(opt)
	else:
		jump("statue_face", 10.0)


func _unhandled_key_input(e: InputEvent) -> void:
	var k := e as InputEventKey
	if k and k.pressed and k.keycode >= KEY_1 and k.keycode <= KEY_9:
		var i: int = k.keycode - KEY_1
		if i < SHOTS.size():
			jump(SHOTS.keys()[i], 2.0)


## Nearest LOD0 surface point to the aim point along the view direction:
## among vertices within 0.25 m of the ray through `aim`, the front-most one.
func _surface_point(element: String, aim: Vector3, dir: Vector3) -> Vector3:
	var mi := _meshes.get(element) as MeshInstance3D
	if mi == null:
		return aim
	var xf := monument.global_transform.affine_inverse() * mi.global_transform
	var best := -INF
	var hit := aim
	for s in mi.mesh.get_surface_count():
		var verts: PackedVector3Array = mi.mesh.surface_get_arrays(s)[Mesh.ARRAY_VERTEX]
		for v0 in verts:
			var v := xf * v0
			var rel := v - aim
			var along := rel.dot(dir)
			if (rel - dir * along).length() < 0.25 and along > best:
				best = along
				hit = v
	return hit


func shot_pose(name: String, dist: float) -> Dictionary:
	var s: Array = SHOTS[name]
	var dir := (s[2] as Vector3).normalized()
	var p := _surface_point(s[0], s[1], dir)
	var cam := p + dir * dist
	return {"target": monument.global_transform * p, "camera": monument.global_transform * cam}


func jump(name: String, dist: float) -> Dictionary:
	var pose := shot_pose(name, dist)
	var d: Vector3 = pose["target"] - pose["camera"]
	var yaw := rad_to_deg(atan2(-d.x, -d.z))
	var pitch := rad_to_deg(asin(clampf(d.normalized().y, -1.0, 1.0)))
	camera.set_pose(pose["camera"], yaw, pitch)
	return pose


func _batch(opt: Dictionary) -> void:
	var dir: String = opt["capture"]
	DirAccess.make_dir_recursive_absolute(dir)
	var names: PackedStringArray = String(opt.get("shots", ",".join(SHOTS.keys()))).split(",", false)
	var dists := String(opt.get("dists", "20,10,5,2,1")).split_floats(",")
	var frames := int(opt.get("frames", "12"))
	var results := []
	if opt.get("views", "1") == "1":
		for v: String in VIEWS:
			var c: Array = VIEWS[v]
			var d: Vector3 = (c[1] as Vector3) - (c[0] as Vector3)
			camera.set_pose(c[0], rad_to_deg(atan2(-d.x, -d.z)), rad_to_deg(asin(clampf(d.normalized().y, -1.0, 1.0))))
			camera.fov = c[2]
			results.append(await _grab("%s/%s.png" % [dir, v], v, d.length(), frames))
		camera.fov = 70.0
	for n in names:
		for d in dists:
			var pose := jump(n, d)
			var r := await _grab("%s/%s_%02dm.png" % [dir, n, int(d)], n, d, frames)
			r["lod_visible"] = (monument as MonumentLOD).visible_lod_at(SHOTS[n][0], (pose["camera"] as Vector3).distance_to(pose["target"]))
			results.append(r)
	print("INSPECTION ", JSON.stringify(results))
	get_tree().quit()


func _grab(path: String, name: String, dist: float, frames: int) -> Dictionary:
	for i in frames:
		await get_tree().process_frame
	var img := get_viewport().get_texture().get_image()
	img.save_png(path)
	return {"shot": name, "dist_m": dist, "file": path.get_file(),
		"draw_calls": Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME),
		"primitives": Performance.get_monitor(Performance.RENDER_TOTAL_PRIMITIVES_IN_FRAME),
		"video_mem_mb": snappedf(Performance.get_monitor(Performance.RENDER_VIDEO_MEM_USED) / 1048576.0, 0.1)}
