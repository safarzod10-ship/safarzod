extends Node
## Vegetation build step (run with a real renderer: xvfb-run godot --path . res://scenes/testing/veg_build.tscn):
##  1. assigns res://assets/materials/vegetation/<name>.tres to GLB surfaces and saves Mesh .res per LOD;
##  2. bakes a 3-view impostor atlas per tree (unshaded orthographic renders, transparent bg)
##     matching the far-card UVs, writes impostor material + far mesh;
##  3. writes res://data/vegetation_catalog.json.

const SRC := "res://assets/models/vegetation/"
const OUTM := "res://assets/models/vegetation/meshes/"
const MAT := "res://assets/materials/vegetation/"
const REPORT_T := "/home/user/safarzod/dushanbe_city_src/tools/vegetation/build_report_trees.json"

const INFO := {
	"chinar_mature": ["tree", "Platanus orientalis", "чинар (платан восточный), взрослый", 0.62, [70, 180, 700]],
	"chinar_middle": ["tree", "Platanus orientalis", "чинар, средний", 0.42, [60, 160, 650]],
	"elm_a": ["tree", "Ulmus pumila", "карагач (вяз приземистый)", 0.32, [55, 150, 600]],
	"elm_b": ["tree", "Ulmus densa", "карагач густой", 0.28, [55, 150, 600]],
	"poplar_a": ["tree", "Populus nigra 'Italica'", "тополь пирамидальный", 0.35, [60, 170, 700]],
	"poplar_b": ["tree", "Populus nigra 'Italica'", "тополь пирамидальный, молодой", 0.28, [60, 160, 650]],
	"acacia": ["tree", "Robinia pseudoacacia", "акация белая", 0.3, [55, 150, 600]],
	"mulberry": ["tree", "Morus alba", "тутовник (шелковица белая)", 0.3, [45, 120, 450]],
	"sapling": ["tree", "Ulmus sp.", "саженец с опорами", 0.06, [35, 90, 250]],
	"thuja_cone": ["tree", "Platycladus orientalis", "туя восточная, коническая", 0.12, [40, 110, 400]],
	"thuja_oval": ["tree", "Platycladus orientalis", "туя восточная, овальная", 0.12, [40, 110, 400]],
	"shrub_lilac": ["shrub", "Syringa vulgaris", "сирень", null, [35, 90, 220]],
	"rose_bush": ["shrub", "Rosa hybrida", "роза", null, [30, 70, 150]],
	"hedge_privet": ["hedge", "Ligustrum vulgare", "живая изгородь (бирючина)", null, [50, 120, 250]],
	"flowers_marigold": ["flower", "Tagetes", "бархатцы", null, [30, 45, 45]],
	"flowers_petunia": ["flower", "Petunia", "петуния", null, [30, 45, 45]],
	"flowers_salvia": ["flower", "Salvia splendens", "сальвия", null, [30, 45, 45]],
	"grass_clump_a": ["grass", "Poa / Lolium", "газонная трава", null, [30, 30, 30]],
}


func _ready() -> void:
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(OUTM))
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://assets/textures/impostors"))
	var rep: Dictionary = JSON.parse_string(FileAccess.get_file_as_string(REPORT_T)) if FileAccess.file_exists(REPORT_T) else {}
	var rep_p: Variant = JSON.parse_string(FileAccess.get_file_as_string(REPORT_T.replace("trees", "plants")))
	if rep_p is Dictionary:
		rep.merge(rep_p)
	var catalog := {"version": 1, "assets": []}
	for id: String in INFO:
		var inf: Array = INFO[id]
		var files := {}
		for lod: String in ["lod0", "lod1", "far"]:
			var src: String = SRC + id + ("" if lod == "lod0" else "_" + lod) + ".glb"
			if not ResourceLoader.exists(src):
				continue
			var mesh := _glb_mesh(src)
			if mesh == null:
				continue
			if lod == "far" and rep.has(id):
				var mat := await _bake_impostor(id, rep[id])
				for s in mesh.get_surface_count():
					mesh.surface_set_material(s, mat)
			var out: String = OUTM + id + "_" + lod + ".res"
			ResourceSaver.save(mesh, out)
			files[lod] = out
		var e := {"id": id, "kind": inf[0], "latin": inf[1], "ru": inf[2], "files": files,
			"trunk_radius": inf[3], "visibility": {"lod0_end": inf[4][0], "lod1_end": inf[4][1], "far_end": inf[4][2]}}
		if rep.has(id):
			e["height"] = rep[id].get("height", 0.0)
			e["crown_radius"] = rep[id].get("crown_radius", 0.0)
		if id == "hedge_privet":
			e["segment_length"] = 2.0
		catalog["assets"].append(e)
		print("veg ", id, " ", files.keys())
	# extra grass variants
	for g: String in ["grass_clump_b", "grass_clump_c", "grass_clump_d", "grass_clump_lite"]:
		var m := _glb_mesh(SRC + g + ".glb")
		if m:
			ResourceSaver.save(m, OUTM + g + "_lod0.res")
	var f := FileAccess.open("res://data/vegetation_catalog.json", FileAccess.WRITE)
	f.store_string(JSON.stringify(catalog, " "))
	f.close()
	print("VEG_DONE ", catalog["assets"].size())
	get_tree().quit()


func _glb_mesh(path: String) -> ArrayMesh:
	var ps: PackedScene = load(path)
	if ps == null:
		return null
	var inst := ps.instantiate()
	var mis := inst.find_children("*", "MeshInstance3D", true, false)
	if mis.is_empty():
		inst.free()
		return null
	var mesh := (mis[0] as MeshInstance3D).mesh.duplicate() as ArrayMesh
	inst.free()
	for s in mesh.get_surface_count():
		var cur := mesh.surface_get_material(s)
		var nm := cur.resource_name if cur else ""
		if ResourceLoader.exists(MAT + nm + ".tres"):
			mesh.surface_set_material(s, load(MAT + nm + ".tres"))
	return mesh


func _bake_impostor(id: String, r: Dictionary) -> Material:
	var fr: Dictionary = r["framing"]
	var W: float = fr["width"]
	var y0: float = fr["y0"]
	var y1: float = fr["y1"]
	var S := 256
	var hpx := clampi(int(round(S * (y1 - y0) / W)), 64, 1024)
	var atlas := Image.create(S * 3, hpx, false, Image.FORMAT_RGBA8)
	var vp := SubViewport.new()
	vp.size = Vector2i(S, hpx)
	vp.transparent_bg = true
	vp.debug_draw = Viewport.DEBUG_DRAW_UNSHADED
	vp.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	vp.own_world_3d = true
	add_child(vp)
	var mi := MeshInstance3D.new()
	mi.mesh = _glb_mesh(SRC + id + ".glb")
	vp.add_child(mi)
	var cam := Camera3D.new()
	cam.projection = Camera3D.PROJECTION_ORTHOGONAL
	cam.keep_aspect = Camera3D.KEEP_HEIGHT
	cam.size = y1 - y0
	cam.far = 200.0
	vp.add_child(cam)
	for i in 3:
		var n: Array = fr["views"][i]["normal"]
		var nv := Vector3(n[0], n[1], n[2])
		var c := Vector3(0, (y0 + y1) * 0.5, 0)
		cam.look_at_from_position(c + nv * 60.0, c, Vector3.UP)
		cam.current = true
		for k in 6:
			await RenderingServer.frame_post_draw
		var img := vp.get_texture().get_image()
		img.convert(Image.FORMAT_RGBA8)
		atlas.blit_rect(img, Rect2i(0, 0, S, hpx), Vector2i(i * S, 0))
	vp.queue_free()
	_dilate(atlas)
	var tex_path := "res://assets/textures/impostors/%s.png" % id
	atlas.save_png(tex_path)
	# use the imported (VRAM-compressed, mipmapped) texture when available — run the bake twice:
	# the first run writes the PNGs, `godot --import` compresses them, the second run links them.
	var tex: Texture2D = load(tex_path) if ResourceLoader.exists(tex_path) and FileAccess.file_exists(tex_path + ".import") else ImageTexture.create_from_image(atlas)
	var mat := ShaderMaterial.new()
	mat.shader = load("res://assets/shaders/foliage.gdshader")
	mat.set_shader_parameter("albedo_tex", tex)
	mat.set_shader_parameter("tex_size", float(S))
	mat.set_shader_parameter("sway_amount", 0.05)
	mat.set_shader_parameter("branch_amount", 0.0)
	mat.set_shader_parameter("flutter_amount", 0.0)
	mat.set_shader_parameter("use_instance_custom", true)
	mat.set_shader_parameter("translucency", 0.15)
	mat.set_shader_parameter("specular", 0.05)
	mat.set_shader_parameter("roughness", 0.95)
	mat.resource_name = "impostor_" + id
	return mat


func _dilate(img: Image) -> void:
	## Bleed opaque colours into transparent pixels (avoids dark halos when mipmapped).
	var w := img.get_width()
	var h := img.get_height()
	for pass_i in 4:
		var src := img.duplicate() as Image
		for y in h:
			for x in w:
				if src.get_pixel(x, y).a > 0.05:
					continue
				var acc := Color(0, 0, 0, 0)
				var n := 0
				for d: Vector2i in [Vector2i(1, 0), Vector2i(-1, 0), Vector2i(0, 1), Vector2i(0, -1)]:
					var px := x + d.x
					var py := y + d.y
					if px >= 0 and py >= 0 and px < w and py < h:
						var c := src.get_pixel(px, py)
						if c.a > 0.05:
							acc += c
							n += 1
				if n > 0:
					var cc := acc / n
					img.set_pixel(x, y, Color(cc.r, cc.g, cc.b, 0.0))
