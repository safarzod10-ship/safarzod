class_name PlazaDecor
extends Node3D
## 0.24: the front plaza of every AMID supermarket / mall (after the owner's reference picture): paved
## (PlotPatches), a fountain with a flower ring and benches on one side, a garden with hedges, trees,
## flower beds and a pergola on the other, a flower strip and a tree-lined sidewalk with lamps, bins and
## storm drains along the street, a bus shelter, bollards along the car park, trees on the car park's
## lamp islands. Library props (catalogue) and vegetation (species) go through OpenWorld's own placers
## (MultiMesh, LOD / visibility ranges); the fountain, beds, kerbs, pergola are built here.

var ow: OpenWorld
var pp: PlotPatches
var _mats := {}


func build(patches: PlotPatches, world: OpenWorld) -> void:
	pp = patches
	ow = world
	for P: Dictionary in pp.plots:
		if String(P["b"][0]) == "amid_m":
			_amid_site(P)
		else:
			_plaza(P)


func _m(key: String) -> Material:
	if _mats.has(key):
		return _mats[key]
	var m := StandardMaterial3D.new()
	match key:
		"stone":
			m.albedo_color = Color(0.86, 0.84, 0.8)
			m.roughness = 0.6
		"kerb":
			m.albedo_color = Color(0.7, 0.7, 0.68)
			m.roughness = 0.8
		"water":
			m.albedo_color = Color(0.25, 0.55, 0.75, 0.75)
			m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
			m.roughness = 0.05
			m.metallic_specular = 1.0
			m.emission_enabled = true
			m.emission = Color(0.05, 0.2, 0.3)
		"spray":
			m.albedo_color = Color(0.85, 0.93, 1.0, 0.45)
			m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
			m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		"soil":
			m.albedo_color = Color(0.25, 0.17, 0.11)
			m.roughness = 1.0
		"wood":
			m.albedo_color = Color(0.45, 0.3, 0.18)
			m.roughness = 0.8
		"flowers_red", "flowers_white", "flowers_mix":
			m.albedo_texture = _flower_tex(key)
			m.uv1_triplanar = true
			m.uv1_world_triplanar = true
			m.uv1_scale = Vector3(0.6, 0.6, 0.6)
			m.roughness = 0.9
		"zebra":
			m.albedo_color = Color(0.95, 0.95, 0.93)
			m.roughness = 0.6
		"hedge":
			m.albedo_color = Color(0.16, 0.36, 0.13)
			m.roughness = 0.95
	_mats[key] = m
	return m


## flower bed top: dense dots of blossoms over leaves (seen from far, where flower meshes are culled)
static func _flower_tex(key: String) -> Texture2D:
	var S := 128
	var img := Image.create(S, S, false, Image.FORMAT_RGB8)
	img.fill(Color(0.14, 0.32, 0.1))
	var rng := RandomNumberGenerator.new()
	rng.seed = key.hash()
	var pal: Array = {"flowers_red": [Color(0.85, 0.08, 0.1), Color(0.95, 0.2, 0.25)],
		"flowers_white": [Color(0.97, 0.96, 0.95), Color(0.95, 0.85, 0.95)],
		"flowers_mix": [Color(0.9, 0.1, 0.15), Color(0.98, 0.85, 0.15), Color(0.97, 0.97, 0.97), Color(0.75, 0.3, 0.75)]}[key]
	for k in 900:
		var c: Color = pal[rng.randi() % pal.size()]
		var x := rng.randi() % S
		var y := rng.randi() % S
		for dy in 2:
			for dx in 2:
				img.set_pixel((x + dx) % S, (y + dy) % S, c)
	img.generate_mipmaps()
	return ImageTexture.create_from_image(img)


func _box(parent: Node3D, size: Vector3, xf: Transform3D, mat: String, solid := false) -> void:
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = size
	mi.mesh = bm
	mi.material_override = _m(mat)
	mi.transform = xf
	mi.visibility_range_end = 700.0
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	parent.add_child(mi)
	if solid:
		var body := StaticBody3D.new()
		var cs := CollisionShape3D.new()
		var sh := BoxShape3D.new()
		sh.size = size
		cs.shape = sh
		body.add_child(cs)
		mi.add_child(body)


func _cyl(parent: Node3D, r: float, h: float, pos: Vector3, mat: String, r_top := -1.0, solid := false) -> void:
	var mi := MeshInstance3D.new()
	var cm := CylinderMesh.new()
	cm.bottom_radius = r
	cm.top_radius = r if r_top < 0.0 else r_top
	cm.height = h
	cm.radial_segments = 28
	mi.mesh = cm
	mi.material_override = _m(mat)
	mi.position = pos
	mi.visibility_range_end = 700.0
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	parent.add_child(mi)
	if solid:
		var body := StaticBody3D.new()
		var cs := CollisionShape3D.new()
		var sh := CylinderShape3D.new()
		sh.radius = r
		sh.height = h
		cs.shape = sh
		body.add_child(cs)
		mi.add_child(body)


func _plaza(P: Dictionary) -> void:
	var c: Vector2 = P["c"]
	var rt: Vector2 = P["rt"]
	var f: Vector2 = P["f"]
	var L: float = P["L"]
	var D: float = P["D"]
	var kerb: float = P["kerb"]
	var yaw: float = P["yaw"]
	var front := D * 0.5
	var depth := kerb - front
	if depth < 4.0:
		return
	var root := Node3D.new()
	root.name = "Plaza%d" % get_child_count()
	add_child(root)
	# world point / transform from plot-local (lx across, fz towards the street), on the patch surface
	var at := func(lx: float, fz: float, up := 0.0) -> Vector3:
		var p := c + rt * lx + f * fz
		var y := pp.surface(p.x, p.y)
		if is_nan(y):
			y = ow.wd.height_at(p.x, p.y)
		return Vector3(p.x, y + up, p.y)
	var face_street := Basis(Vector3.UP, yaw + PI)      # props' -Z towards the street
	var props := {}
	var trees := {}
	var add := func(dict: Dictionary, id: String, xf: Transform3D) -> void:
		if not dict.has(id):
			dict[id] = []
		(dict[id] as Array).append(xf)
	var half := L * 0.5
	var drive_w := 5.0                                   # keep the driveway (lx = 0) clear
	# ---- the sidewalk along the street: trees, lamps, bins, storm drains, bus shelter
	var sw := kerb - 1.4
	var k := 0
	var lx := -half + 4.0
	while lx < half - 2.0:
		if absf(lx) > drive_w + 2.0:
			add.call(trees, "elm_a" if k % 2 == 0 else "chinar_middle", Transform3D(Basis(Vector3.UP, k * 1.7).scaled(Vector3.ONE * 0.9), at.call(lx, sw)))
			if k % 2 == 1:
				add.call(props, "light_street_single", Transform3D(face_street, at.call(lx + 4.5, kerb - 0.5)))
				add.call(props, "bin_modern_steel", Transform3D(face_street, at.call(lx + 5.3, kerb - 1.0)))
			if k % 3 == 0:
				add.call(props, "storm_grate", Transform3D(face_street, at.call(lx + 2.0, kerb - 0.2, 0.02)))
		lx += 9.0
		k += 1
	add.call(props, "bus_stop_shelter", Transform3D(face_street, at.call(half - 12.0, kerb - 1.6)))
	add.call(props, "bench_modern_metal", Transform3D(face_street, at.call(half - 18.0, kerb - 1.3)))
	add.call(props, "manhole_cover", Transform3D(face_street, at.call(-half * 0.5, kerb - 2.4, 0.02)))
	add.call(props, "manhole_cover", Transform3D(face_street, at.call(half * 0.45, kerb - 2.4, 0.02)))
	# ---- flower strip behind the sidewalk (kerbed beds), both sides of the driveway
	var fs := kerb - 3.4
	for sgn: float in [-1.0, 1.0]:
		var x0 := drive_w + 1.5
		var x1 := half - 1.0
		var n := int((x1 - x0) / 7.0)
		for q in n:
			var xx := sgn * (x0 + 3.5 + q * 7.0)
			var p0: Vector3 = at.call(xx, fs, 0.0)
			var bxf := Transform3D(Basis(Vector3.UP, yaw), p0 + Vector3(0, 0.12, 0))
			_box(root, Vector3(6.0, 0.24, 1.6), bxf, "kerb")
			_box(root, Vector3(5.8, 0.06, 1.4), bxf.translated_local(Vector3(0, 0.13, 0)), "flowers_red" if q % 2 == 0 else "flowers_mix")
			add.call(trees, "rose_bush" if q % 2 == 0 else "flowers_petunia", Transform3D(Basis(Vector3.UP, q * 0.9), p0 + Vector3(0, 0.2, 0)))
	# ---- the middle band: the fountain (right) and the garden (left)
	var mid := front + (depth - 5.0) * 0.5
	var R := clampf((depth - 6.5) * 0.5 - 1.2, 1.8, 4.0)
	var fc: Vector3 = at.call(half * 0.45, mid)
	if depth > 9.0:
		var fnode := Node3D.new()
		fnode.name = "Fountain"
		root.add_child(fnode)
		fnode.position = fc
		_cyl(fnode, R + 1.6, 0.18, Vector3(0, 0.09, 0), "flowers_mix")       # flower ring (under the basin)
		_cyl(fnode, R + 1.75, 0.2, Vector3(0, 0.08, 0), "kerb")
		_cyl(fnode, R, 0.55, Vector3(0, 0.28, 0), "stone", -1.0, true)
		_cyl(fnode, R - 0.22, 0.04, Vector3(0, 0.5, 0), "water")
		_cyl(fnode, 0.35, 1.3, Vector3(0, 1.1, 0), "stone", 0.25)
		_cyl(fnode, 1.3, 0.16, Vector3(0, 1.35, 0), "stone", 1.0)
		_cyl(fnode, 1.1, 0.03, Vector3(0, 1.44, 0), "water")
		_cyl(fnode, 0.18, 0.7, Vector3(0, 1.8, 0), "stone", 0.12)
		_cyl(fnode, 0.6, 0.12, Vector3(0, 2.15, 0), "stone", 0.45)
		_cyl(fnode, 0.04, 1.4, Vector3(0, 2.9, 0), "spray", 0.1)            # the central jet
		for q in 8:
			var a := q * TAU / 8.0
			var jet := Vector3(cos(a), 0, sin(a)) * (R - 0.6)
			_cyl(fnode, 0.05, 0.9, jet + Vector3(0, 0.95, 0), "spray", 0.02)
		# falling spray (cheap CPU particles, only near)
		var sp := CPUParticles3D.new()
		sp.amount = 48
		sp.lifetime = 1.1
		sp.position = Vector3(0, 3.4, 0)
		sp.direction = Vector3.UP
		sp.spread = 35.0
		sp.initial_velocity_min = 1.5
		sp.initial_velocity_max = 2.4
		sp.gravity = Vector3(0, -9.8, 0)
		sp.scale_amount_min = 0.08
		sp.scale_amount_max = 0.14
		var qm := QuadMesh.new()
		qm.size = Vector2(0.12, 0.12)
		qm.material = _m("spray")
		sp.mesh = qm
		sp.visibility_range_end = 90.0
		fnode.add_child(sp)
		for q in 4:
			var a := q * TAU / 4.0 + PI * 0.25
			var bp := fc + Vector3(cos(a), 0, sin(a)) * (R + 2.6)
			bp.y = (at.call(half * 0.45, mid) as Vector3).y
			add.call(props, "bench_park_soviet", Transform3D(Basis(Vector3.UP, -a + PI * 0.5), bp))
			add.call(props, "planter_vase_soviet", Transform3D(Basis.IDENTITY, fc + Vector3(cos(a + PI * 0.25), 0, sin(a + PI * 0.25)) * (R + 2.8)))
	# garden: hedge-bordered lawn bed with flowers, trees, a pergola with benches
	var gx := -half * 0.45
	var gw := minf(18.0, half * 0.55)
	var gd := maxf(depth - 6.5, 3.0)
	var gc: Vector3 = at.call(gx, mid)
	var gxf := Transform3D(Basis(Vector3.UP, yaw), gc + Vector3(0, 0.1, 0))
	_box(root, Vector3(gw, 0.2, gd), gxf, "kerb")
	_box(root, Vector3(gw - 0.4, 0.06, gd - 0.4), gxf.translated_local(Vector3(0, 0.12, 0)), "flowers_white")
	for q in 3:
		add.call(trees, "chinar_middle", Transform3D(Basis(Vector3.UP, q * 2.1), at.call(gx - gw * 0.33 + q * gw * 0.33, mid)))
	var e := 0.0
	while e < gw:
		for side: float in [-1.0, 1.0]:
			add.call(trees, "hedge_privet", Transform3D(Basis(Vector3.UP, yaw + PI * 0.5), at.call(gx - gw * 0.5 + e, mid + side * (gd * 0.5 - 0.3), 0.15)))
		e += 2.2
	if depth > 10.0:
		var pg := Node3D.new()
		pg.name = "Pergola"
		root.add_child(pg)
		var pc: Vector3 = at.call(gx + gw * 0.5 + 4.5, mid)
		pg.transform = Transform3D(Basis(Vector3.UP, yaw), pc)
		for px in [-1.6, 1.6]:
			for pz in [-1.2, 1.2]:
				_box(pg, Vector3(0.16, 2.6, 0.16), Transform3D(Basis.IDENTITY, Vector3(px, 1.3, pz)), "wood", true)
		for q in 7:
			_box(pg, Vector3(3.8, 0.1, 0.12), Transform3D(Basis.IDENTITY, Vector3(0, 2.62, -1.4 + q * 0.47)), "wood")
		for pz in [-1.2, 1.2]:
			_box(pg, Vector3(3.6, 0.14, 0.16), Transform3D(Basis.IDENTITY, Vector3(0, 2.52, pz)), "wood")
		add.call(props, "bench_courtyard", Transform3D(Basis(Vector3.UP, yaw), pc + Vector3(0, 0, 0)))
	# ---- the car park: bollards along its front, trees on the lamp islands
	var b := -half + 1.5
	while b < half:
		if absf(b) > drive_w + 1.0:
			add.call(props, "bollard_concrete", Transform3D(Basis.IDENTITY, at.call(b, front + 0.4)))
		b += 3.0
	if String(P["b"][0]) == "amid_m":
		for q in 5:
			var ix := -42.0 + 8.0 + q * (84.0 - 16.0) / 4.0
			for dx in [-1.8, 1.8]:
				add.call(trees, "thuja_oval", Transform3D(Basis.IDENTITY.scaled(Vector3.ONE * 0.8), at.call(ix + dx, front - 13.5)))
	ow._place_props(root, props)
	ow._trees(root, trees, 0)


## 0.24 AMID site (see dushanbe_city_src/tools/landmarks/amid_tas.py, SITE): the model brings the
## hardscape (paving, lawns, kerbs, lanes, bays, yard); here the living / furniture layer goes on it.
## Model coordinates (Blender x, y; -y = street) -> plot-local: lx = -x, fz = -y - 5.5.
func _amid_site(P: Dictionary) -> void:
	var c: Vector2 = P["c"]
	var rt: Vector2 = P["rt"]
	var f: Vector2 = P["f"]
	var yaw: float = P["yaw"]
	var root := Node3D.new()
	root.name = "AmidSite%d" % get_child_count()
	add_child(root)
	var at := func(bx: float, by: float, up := 0.0) -> Vector3:
		var lx := -bx
		var fz := -by - 5.5
		var p := c + rt * lx + f * fz
		var y := pp.surface(p.x, p.y)
		if is_nan(y):
			y = ow.wd.height_at(p.x, p.y)
		return Vector3(p.x, y + 0.05 + up, p.y)
	var face_street := Basis(Vector3.UP, yaw + PI)
	var props := {}
	var trees := {}
	var add := func(dict: Dictionary, id: String, xf: Transform3D) -> void:
		if not dict.has(id):
			dict[id] = []
		(dict[id] as Array).append(xf)
	var F := -63.0
	var B := 52.0
	var fy := -25.0
	# ---- the fountain on the axis (basin, tiers, jets, spray), benches and vases round it
	var fcy := (F + 7.0 + fy - 12.0) * 0.5
	var fc: Vector3 = at.call(0.0, fcy)
	var R := 4.2
	var fnode := Node3D.new()
	fnode.name = "Fountain"
	root.add_child(fnode)
	fnode.position = fc
	_cyl(fnode, R + 2.2, 0.16, Vector3(0, 0.08, 0), "flowers_mix")
	_cyl(fnode, R + 2.35, 0.2, Vector3(0, 0.07, 0), "kerb")
	_cyl(fnode, R + 0.6, 0.2, Vector3(0, 0.12, 0), "stone")
	_cyl(fnode, R, 0.6, Vector3(0, 0.3, 0), "stone", -1.0, true)
	_cyl(fnode, R - 0.25, 0.04, Vector3(0, 0.55, 0), "water")
	_cyl(fnode, 0.4, 1.4, Vector3(0, 1.2, 0), "stone", 0.28)
	_cyl(fnode, 1.6, 0.18, Vector3(0, 1.48, 0), "stone", 1.25)
	_cyl(fnode, 1.4, 0.03, Vector3(0, 1.58, 0), "water")
	_cyl(fnode, 0.2, 0.8, Vector3(0, 2.0, 0), "stone", 0.14)
	_cyl(fnode, 0.75, 0.14, Vector3(0, 2.4, 0), "stone", 0.55)
	_cyl(fnode, 0.05, 1.8, Vector3(0, 3.35, 0), "spray", 0.12)
	for q in 10:
		var a := q * TAU / 10.0
		_cyl(fnode, 0.05, 1.1, Vector3(cos(a), 0, sin(a)) * (R - 0.6) + Vector3(0, 1.1, 0), "spray", 0.02)
	var sp := CPUParticles3D.new()
	sp.amount = 56
	sp.lifetime = 1.2
	sp.position = Vector3(0, 4.1, 0)
	sp.direction = Vector3.UP
	sp.spread = 30.0
	sp.initial_velocity_min = 1.6
	sp.initial_velocity_max = 2.6
	sp.gravity = Vector3(0, -9.8, 0)
	var qm := QuadMesh.new()
	qm.size = Vector2(0.12, 0.12)
	qm.material = _m("spray")
	sp.mesh = qm
	sp.visibility_range_end = 90.0
	fnode.add_child(sp)
	for q in 4:
		var a := q * TAU / 4.0 + PI * 0.25
		add.call(props, "bench_park_soviet", Transform3D(Basis(Vector3.UP, -a - PI * 0.5), fc + Vector3(cos(a), 0, sin(a)) * (R + 3.4)))
		add.call(props, "planter_vase_soviet", Transform3D(Basis.IDENTITY, fc + Vector3(cos(a + PI * 0.25), 0, sin(a + PI * 0.25)) * (R + 3.0)))
	# ---- along the street: flower strip with trees, lamps, bins, storm drains, bus shelter
	for sx: float in [-1.0, 1.0]:
		var x := 9.5
		var q := 0
		while x < 43.0:
			add.call(trees, "chinar_middle" if q % 2 == 0 else "elm_a", Transform3D(Basis(Vector3.UP, q * 1.3).scaled(Vector3.ONE * 0.95), at.call(sx * x, F + 5.5)))
			add.call(trees, "rose_bush" if q % 2 == 0 else "flowers_petunia", Transform3D(Basis(Vector3.UP, q), at.call(sx * (x + 3.0), F + 5.5, 0.05)))
			add.call(trees, "flowers_salvia", Transform3D(Basis(Vector3.UP, q * 2.0), at.call(sx * (x + 1.5), F + 4.8, 0.05)))
			x += 6.5
			q += 1
		_box(root, Vector3(35.0, 0.06, 2.6), Transform3D(Basis(Vector3.UP, yaw), at.call(sx * 25.5, F + 5.5, 0.08)), "flowers_mix")
		for xx in [12.0, 30.0]:
			add.call(props, "light_street_single", Transform3D(face_street, at.call(sx * xx, F + 1.0)))
			add.call(props, "bin_modern_steel", Transform3D(face_street, at.call(sx * (xx + 1.0), F + 1.4)))
		add.call(props, "storm_grate", Transform3D(face_street, at.call(sx * 20.0, F + 0.4)))
		add.call(props, "light_avenue_double", Transform3D(face_street, at.call(sx * 7.0, F + 3.5)))
	add.call(props, "bus_stop_shelter", Transform3D(face_street, at.call(-34.0, F + 2.0)))
	add.call(props, "manhole_cover", Transform3D(face_street, at.call(18.0, F + 2.5)))
	# ---- the axis: bollards along its edges, lamps
	var y := F + 8.0
	while y < fy - 12.0:
		if absf(y - fcy) > 9.0:
			for sx: float in [-1.0, 1.0]:
				add.call(props, "bollard_concrete", Transform3D(Basis.IDENTITY, at.call(sx * 6.6, y)))
		y += 3.0
	for sx: float in [-1.0, 1.0]:
		add.call(props, "light_park_4m", Transform3D(Basis.IDENTITY, at.call(sx * 5.2, fy - 6.0)))
	# ---- car park islands: trees + lamps
	var ym := ((F + 7.0) + (fy - 11.0)) * 0.5
	for sx: float in [-1.0, 1.0]:
		var x := 12.0
		var q := 0
		while x < 41.0:
			add.call(trees, "chinar_middle" if q % 2 == 0 else "elm_a", Transform3D(Basis(Vector3.UP, q * 1.9).scaled(Vector3.ONE * 0.7), at.call(sx * x, ym)))
			if q % 2 == 1:
				add.call(props, "light_street_single", Transform3D(Basis(Vector3.UP, yaw + PI * 0.5), at.call(sx * (x + 4.0), ym)))
			x += 8.0
			q += 1
	# ---- along the hall's sides: thujas on the lawn; outer lawns: trees, fence
	for sx: float in [-1.0, 1.0]:
		var yy := fy + 2.0
		while yy < 24.0:
			add.call(trees, "thuja_cone", Transform3D(Basis.IDENTITY, at.call(sx * 44.0, yy)))
			yy += 5.0
		yy = F + 8.0
		var q := 0
		while yy < B - 2.0:
			add.call(trees, "elm_b" if q % 2 == 0 else "poplar_a", Transform3D(Basis(Vector3.UP, q * 1.1).scaled(Vector3.ONE * 0.9), at.call(sx * 56.5, yy)))
			add.call(props, "fence_decorative_15", Transform3D(Basis(Vector3.UP, yaw + PI * 0.5), at.call(sx * 57.6, yy + 3.0)))
			yy += 7.5
			q += 1
	# ---- the back: hedge along the back sidewalk, a few trees
	var xx := -54.0
	while xx < 54.0:
		add.call(trees, "hedge_privet", Transform3D(Basis(Vector3.UP, yaw), at.call(xx, B - 1.0)))
		xx += 2.2
	# ---- zebra crossings on the street at both car park exits (side lanes x = +-49.5)
	var kerb: float = P["kerb"]
	var shw: float = P["street_hw"]
	var sy: float = P["street_y"]
	for sx: float in [-1.0, 1.0]:
		for i in 7:
			var lx := sx * -60.0 + (i - 3) * 1.1
			var fzc := kerb + 0.4 + shw
			var p := c + rt * lx + f * fzc
			_box(root, Vector3(0.55, 0.03, shw * 2.0 - 0.6), Transform3D(Basis(Vector3.UP, yaw), Vector3(p.x, sy + 0.03, p.y)), "zebra")
	ow._place_props(root, props)
	ow._trees(root, trees, 0)
