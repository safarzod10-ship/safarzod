extends Node
## menu_capture.tscn -- <out_prefix>
func _ready() -> void:
	var prefix := OS.get_cmdline_user_args()[0]
	var menu := (load("res://scenes/combat/main_menu.tscn") as PackedScene).instantiate()
	get_tree().root.add_child.call_deferred(menu)
	for i in 75: await get_tree().process_frame
	await _shot(prefix + "_a.png")
	menu.call("_step_char", 1)
	menu.call("_step_weapon", 1)
	for i in 12: await get_tree().process_frame
	await _shot(prefix + "_raise.png")
	for i in 60: await get_tree().process_frame
	await _shot(prefix + "_b.png")
	menu.call("_step_char", 1)
	for i in 70: await get_tree().process_frame
	await _shot(prefix + "_c.png")
	get_tree().quit()

func _shot(path: String) -> void:
	await RenderingServer.frame_post_draw
	get_viewport().get_texture().get_image().save_png(path)
	print("CAPTURED ", path)
