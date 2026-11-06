extends Node3D
## Animation contact sheet: drives the real player (controller + AnimationTree) with scripted input
## on a flat lit ground and captures a side view at key moments of each action.
## godot --path . res://scenes/testing/anim_shots.tscn -- out=/abs/sheet.png

var player: PlayerController
var cam: Camera3D
var shots: Array = []   # [label, Image]


func _ready() -> void:
	var env := EnvironmentRig.new()
	add_child(env)
	var body := StaticBody3D.new()
	add_child(body)
	var cs := CollisionShape3D.new()
	var bs := BoxShape3D.new()
	bs.size = Vector3(400, 1, 400)
	cs.shape = bs
	cs.position.y = -0.5
	body.add_child(cs)
	var ground := MeshInstance3D.new()
	var pm := PlaneMesh.new()
	pm.size = Vector2(400, 400)
	ground.mesh = pm
	ground.material_override = CityMaterials.get_material("sidewalk")
	add_child(ground)
	player = (load("res://scenes/player/player.tscn") as PackedScene).instantiate()
	add_child(player)
	player.teleport(Vector3.ZERO, 0.0)
	cam = Camera3D.new()
	cam.fov = 40
	add_child(cam)
	cam.make_current()
	await _frames(30)
	await _shot("idle")
	PlayerInput.scripted_move = Vector2(0, -1)
	await _frames(90)
	await _shot("walk A")
	await _frames(20)
	await _shot("walk B")
	PlayerInput.scripted_run = true
	await _frames(90)
	await _shot("run A")
	await _frames(7)
	await _shot("run B")
	await _frames(7)
	await _shot("run C")
	PlayerInput.scripted_run = false
	PlayerInput.scripted_move = null
	await _frames(90)
	PlayerInput.queue_jump()
	await _frames(3)
	await _shot("jump: push-off")
	await _frames(12)
	await _shot("jump: rise")
	await _frames(18)
	await _shot("jump: apex")
	await _frames(14)
	await _shot("jump: fall")
	var t := 0
	while not player.is_on_floor() and t < 60:
		await _frames(1)
		t += 1
	await _frames(5)
	await _shot("landing")
	await _frames(40)
	await _shot("recovered")
	PlayerInput.queue_punch()
	await _frames(14)
	await _shot("punch 1 (jab)")
	await _frames(50)
	PlayerInput.queue_punch()
	await _frames(16)
	await _shot("punch 2 (cross)")
	await _frames(50)
	PlayerInput.scripted_move = Vector2(0, -1)
	PlayerInput.scripted_run = true
	await _frames(60)
	PlayerInput.queue_punch()
	await _frames(14)
	await _shot("punch while running")
	PlayerInput.scripted_move = null
	_save_sheet()
	get_tree().quit()


func _frames(n: int) -> void:
	for i in n:
		await get_tree().physics_frame


func _shot(label: String) -> void:
	var p := player.global_position
	var side := player.global_transform.basis.x
	cam.global_position = p + side * 4.2 + Vector3(0, 1.1, 0)
	cam.look_at(p + Vector3(0, 0.9, 0), Vector3.UP)
	await RenderingServer.frame_post_draw
	await RenderingServer.frame_post_draw
	var img := get_viewport().get_texture().get_image()
	shots.append([label, img])


func _save_sheet() -> void:
	var w := 320
	var h := 360
	var cols := 5
	var rows := int(ceil(shots.size() / float(cols)))
	var sheet := Image.create(w * cols, h * rows, false, Image.FORMAT_RGBA8)
	sheet.fill(Color(0.1, 0.1, 0.1))
	for i in shots.size():
		var im: Image = shots[i][1]
		im.convert(Image.FORMAT_RGBA8)
		var sw := im.get_width()
		var sh := im.get_height()
		var crop := im.get_region(Rect2i(int(sw * 0.5 - sh * 0.45), 0, int(sh * 0.9), sh))
		crop.resize(w, h)
		sheet.blit_rect(crop, Rect2i(0, 0, w, h), Vector2i((i % cols) * w, (i / cols) * h))
	var out := "/tmp/anim_sheet.png"
	for a in OS.get_cmdline_user_args():
		if a.begins_with("out="):
			out = a.substr(4)
	sheet.save_png(out)
	var labels := []
	for s in shots:
		labels.append(s[0])
	print("ANIM_SHEET ", out, " ", labels)
