extends Node3D
func _ready() -> void:
	var root3 := Node3D.new()
	add_child(root3)
	var b := VehicleBoat.new()
	b.freeze = true
	root3.add_child(b)
	var mark := MeshInstance3D.new()
	var bm := BoxMesh.new(); bm.size = Vector3(0.3, 3, 0.3)
	mark.mesh = bm
	mark.position = Vector3(0, 1.5, -4)   # -Z = forward
	root3.add_child(mark)
	var l := DirectionalLight3D.new(); l.rotation_degrees = Vector3(-50, 30, 0); root3.add_child(l)
	var we := WorldEnvironment.new(); var e := Environment.new(); e.background_mode = Environment.BG_COLOR; e.background_color = Color(0.5,0.6,0.7); e.ambient_light_color = Color.WHITE; e.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR; we.environment = e; root3.add_child(we)
	var c := Camera3D.new(); root3.add_child(c)
	c.look_at_from_position(Vector3(9, 4, 0), Vector3.ZERO)
	for i in 10:
		await get_tree().process_frame
	await RenderingServer.frame_post_draw
	get_viewport().get_texture().get_image().save_png(OS.get_cmdline_user_args()[0])
	get_tree().quit()
