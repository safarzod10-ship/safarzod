extends Node
func _ready() -> void:
	var m: Control = (load("res://scenes/menu/main_menu.tscn") as PackedScene).instantiate()
	add_child(m)
	for i in 30:
		await get_tree().process_frame
	await RenderingServer.frame_post_draw
	get_viewport().get_texture().get_image().save_png("/tmp/claude-0/-home-user-safarzod/a46b42c2-beab-5efe-837a-7f7bc68c0bbc/scratchpad/menu.png")
	m.call("_open", m.get("_shop"))
	for i in 10:
		await get_tree().process_frame
	await RenderingServer.frame_post_draw
	get_viewport().get_texture().get_image().save_png("/tmp/claude-0/-home-user-safarzod/a46b42c2-beab-5efe-837a-7f7bc68c0bbc/scratchpad/menu_shop.png")
	get_tree().quit()
