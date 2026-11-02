extends Node3D
## Pose check: drives the real player and renders each state from the side, front and back,
## and measures neck/head angles (deg from vertical, signed forward lean) in the character's frame.
## godot --path . res://scenes/testing/pose_views.tscn -- out=/abs/sheet.png
## Optional: model=res://...glb (compare another skeleton/clip set)

var player: PlayerController
var cam: Camera3D
var skel: Skeleton3D
var shots: Array = []


func _ready() -> void:
	add_child(EnvironmentRig.new())
	var body := StaticBody3D.new()
	add_child(body)
	var cs := CollisionShape3D.new()
	var bs := BoxShape3D.new()
	bs.size = Vector3(600, 1, 600)
	cs.shape = bs
	cs.position.y = -0.5
	body.add_child(cs)
	var ground := MeshInstance3D.new()
	var pm := PlaneMesh.new()
	pm.size = Vector2(600, 600)
	ground.mesh = pm
	ground.material_override = CityMaterials.get_material("sidewalk")
	add_child(ground)
	player = (load("res://scenes/player/player.tscn") as PackedScene).instantiate()
	add_child(player)
	player.teleport(Vector3.ZERO, 0.0)
	skel = player.find_children("*", "Skeleton3D", true, false)[0]
	cam = Camera3D.new()
	cam.fov = 32
	add_child(cam)
	cam.make_current()
	await _frames(30)
	await _views("idle")
	PlayerInput.scripted_move = Vector2(0, -1)
	await _frames(120)
	await _views("walk")
	PlayerInput.scripted_run = true
	await _frames(120)
	await _views("run")
	PlayerInput.scripted_run = false
	PlayerInput.scripted_move = null
	await _frames(90)
	PlayerInput.queue_jump()
	await _frames(28)
	await _views("jump (air)")
	await _frames(120)
	_save()
	get_tree().quit()


func _frames(n: int) -> void:
	for i in n:
		await get_tree().physics_frame


func _angles() -> String:
	## lean of the neck and head bones relative to the body's up axis, positive = forward
	var fwd := -player.global_transform.basis.z   # controller forward
	var out := ""
	for pair in [["Hips", "Spine"], ["UpperChest", "Neck"], ["Neck", "Head"]]:
		var a := skel.global_transform * skel.get_bone_global_pose(skel.find_bone(pair[0])).origin
		var b := skel.global_transform * skel.get_bone_global_pose(skel.find_bone(pair[1])).origin
		var d := (b - a).normalized()
		var lean := rad_to_deg(atan2(d.dot(fwd), d.y))
		out += "%s->%s %.0f°  " % [pair[0], pair[1], lean]
	var hb := skel.global_transform.basis * skel.get_bone_global_pose(skel.find_bone("Head")).basis
	var face := (hb * Vector3(0, 0, 1)).normalized()
	out += "head pitch %.0f°" % rad_to_deg(asin(clampf(-face.y, -1, 1)))
	return out


func _views(label: String) -> void:
	var p := player.global_position
	var bs := player.global_transform.basis
	var fwd := -bs.z
	var a := _angles()
	print("POSE ", label, ": ", a)
	for v in [["side", bs.x], ["front", fwd], ["back", -fwd]]:
		cam.global_position = p + (v[1] as Vector3) * 3.2 + Vector3(0, 1.15, 0)
		cam.look_at(p + Vector3(0, 1.05, 0), Vector3.UP)
		await RenderingServer.frame_post_draw
		await RenderingServer.frame_post_draw
		shots.append([label + " / " + v[0], get_viewport().get_texture().get_image()])


func _save() -> void:
	var w := 300
	var h := 400
	var cols := 3
	var rows := int(ceil(shots.size() / float(cols)))
	var sheet := Image.create(w * cols, h * rows, false, Image.FORMAT_RGBA8)
	for i in shots.size():
		var im: Image = shots[i][1]
		im.convert(Image.FORMAT_RGBA8)
		var sh := im.get_height()
		var crop := im.get_region(Rect2i(int(im.get_width() * 0.5 - sh * 0.375), 0, int(sh * 0.75), sh))
		crop.resize(w, h)
		sheet.blit_rect(crop, Rect2i(0, 0, w, h), Vector2i((i % cols) * w, (i / cols) * h))
	var out := "/tmp/pose.png"
	for a in OS.get_cmdline_user_args():
		if a.begins_with("out="):
			out = a.substr(4)
	sheet.save_png(out)
	print("POSE_SHEET ", out)
