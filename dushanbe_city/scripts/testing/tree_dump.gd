extends SceneTree
func _init() -> void:
	for p in ["res://assets/characters/player/player.glb", "res://assets/characters/animations/ual_standard.glb"]:
		if not ResourceLoader.exists(p):
			print("missing ", p); continue
		var n: Node = (load(p) as PackedScene).instantiate()
		print("== ", p)
		_pr(n, n, 0)
		n.free()
	quit()
func _pr(root: Node, n: Node, d: int) -> void:
	if d < 4:
		print("  ".repeat(d), n.name, " (", n.get_class(), ") path=", root.get_path_to(n))
		for c in n.get_children():
			_pr(root, c, d + 1)
