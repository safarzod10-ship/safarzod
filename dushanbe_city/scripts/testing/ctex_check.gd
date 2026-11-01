extends SceneTree
func _init() -> void:
	var src := Image.load_from_file(ProjectSettings.globalize_path("res://assets/textures/impostors/elm_a.png"))
	src.convert(Image.FORMAT_RGBA8)
	var imp := ConfigFile.new()
	imp.load("res://assets/textures/impostors/elm_a.png.import")
	for key in ["path.s3tc", "path.etc2"]:
		var p: String = imp.get_value("remap", key, "")
		if p == "":
			continue
		var t := ResourceLoader.load(p) as Texture2D
		var img := t.get_image()
		print(key, " format=", img.get_format(), " size=", img.get_size())
		img.decompress()
		img.convert(Image.FORMAT_RGBA8)
		var err := 0.0
		var whites := 0
		var n := 0
		for y in range(0, src.get_height(), 4):
			for x in range(0, src.get_width(), 4):
				var a := src.get_pixel(x, y)
				var b := img.get_pixel(x, y)
				if a.a > 0.5:
					err += absf(a.r - b.r) + absf(a.g - b.g) + absf(a.b - b.b)
					n += 1
					if b.r > 0.85 and b.g > 0.85 and b.b > 0.85:
						whites += 1
		print("  opaque-pixel mean abs error=", err / maxf(n, 1), " white pixels=", whites, "/", n)
		img.save_png("/tmp/claude-0/-home-user-safarzod/a46b42c2-beab-5efe-837a-7f7bc68c0bbc/scratchpad/dec_%s.png" % key.substr(5))
	quit()
