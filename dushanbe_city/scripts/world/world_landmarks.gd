class_name WorldLandmarks
extends RefCounted
## Landmarks of the open world, modelled from primitives at runtime (no external models; proportions
## after photos of the real buildings, game-scaled):
##   somoni       Dusti square + Ismoili Somoni monument (stele, golden crown arch, statue, lions)
##   rudaki_park  Rudaki park: paths, fountain, the Rudaki monument arch with mosaic
##   museum       National Museum (white, long colonnade, golden roof edge)
##   library      National Library (stepped volume, golden lattice facade)
##   flag         National Flag park: 120 m flagpole with a waving flag
##   palace       Palace of Nations (white palace, golden dome, portico)
##   navruz       Kokhi Navruz (teahouse palace: domes, arcades, blue tiles)
##   opera        Ayni Opera and Ballet Theatre (classical portico, pediment, pink walls)
##   mehrgon      Mehrgon market (huge hall, blue glass arches)
##   hisor_fort   Hisor fortress (two massive clay towers and the gate arch, walls)
##   hisor_bazaar market stalls with awnings

static var _mats := {}


static func _m(key: String) -> Material:
	if _mats.has(key):
		return _mats[key]
	if key in ["plaza", "grass"]:
		_mats[key] = CityMaterials.get_material("plaza" if key == "plaza" else "lawn")
		return _mats[key]
	var m := StandardMaterial3D.new()
	match key:
		"marble":
			m.albedo_color = Color(0.94, 0.93, 0.9)
			m.roughness = 0.35
		"stone":
			m.albedo_color = Color(0.78, 0.74, 0.68)
			m.roughness = 0.8
		"gold":
			m.albedo_color = Color(0.95, 0.72, 0.28)
			m.metallic = 1.0
			m.roughness = 0.25
		"glass":
			m.albedo_color = Color(0.25, 0.4, 0.5)
			m.metallic = 0.3
			m.roughness = 0.08
		"blue_glass":
			m.albedo_color = Color(0.2, 0.45, 0.7)
			m.metallic = 0.4
			m.roughness = 0.1
		"tile":
			m.albedo_color = Color(0.12, 0.45, 0.62)
			m.roughness = 0.3
		"pink":
			m.albedo_color = Color(0.92, 0.78, 0.72)
			m.roughness = 0.7
		"clay":
			m.albedo_color = Color(0.74, 0.6, 0.44)
			m.roughness = 0.95
		"red":
			m.albedo_color = Color(0.8, 0.12, 0.12)
		"white":
			m.albedo_color = Color(0.97, 0.97, 0.97)
		"green":
			m.albedo_color = Color(0.1, 0.5, 0.2)
		"water":
			m.albedo_color = Color(0.2, 0.45, 0.55)
			m.roughness = 0.05
			m.metallic = 0.2
		"dark":
			m.albedo_color = Color(0.2, 0.2, 0.22)
		"canvas":
			m.albedo_color = Color(0.85, 0.3, 0.2)
	_mats[key] = m
	return m


static func _box(root: Node3D, body: StaticBody3D, mat: String, pos: Vector3, size: Vector3, collide := true, yaw := 0.0) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	var b := BoxMesh.new()
	b.size = size
	mi.mesh = b
	mi.material_override = _m(mat)
	mi.position = pos
	mi.rotation.y = yaw
	root.add_child(mi)
	if collide and body:
		var cs := CollisionShape3D.new()
		var s := BoxShape3D.new()
		s.size = size
		cs.shape = s
		cs.position = pos
		cs.rotation.y = yaw
		body.add_child(cs)
	return mi


static func _cyl(root: Node3D, body: StaticBody3D, mat: String, pos: Vector3, r: float, h: float, r_top := -1.0, seg := 16, collide := true) -> void:
	var mi := MeshInstance3D.new()
	var c := CylinderMesh.new()
	c.bottom_radius = r
	c.top_radius = r if r_top < 0 else r_top
	c.height = h
	c.radial_segments = seg
	mi.mesh = c
	mi.material_override = _m(mat)
	mi.position = pos + Vector3(0, h * 0.5, 0)
	root.add_child(mi)
	if collide and body:
		var cs := CollisionShape3D.new()
		var s := CylinderShape3D.new()
		s.radius = r
		s.height = h
		cs.shape = s
		cs.position = mi.position
		body.add_child(cs)


static func _dome(root: Node3D, mat: String, pos: Vector3, r: float, h_scale := 1.0) -> void:
	var mi := MeshInstance3D.new()
	var s := SphereMesh.new()
	s.radius = r
	s.height = r * 2.0
	s.is_hemisphere = true
	s.radial_segments = 24
	s.rings = 10
	mi.mesh = s
	mi.material_override = _m(mat)
	mi.position = pos
	mi.scale = Vector3(1, h_scale, 1)
	root.add_child(mi)


static func _columns(root: Node3D, body: StaticBody3D, mat: String, a: Vector3, b: Vector3, n: int, r: float, h: float) -> void:
	for i in n:
		var p := a.lerp(b, float(i) / maxf(n - 1, 1))
		_cyl(root, body, mat, p, r, h, r * 0.9, 12)


static func _label(root: Node3D, text: String, pos: Vector3, yaw := 0.0, size := 0.02) -> void:
	var lb := Label3D.new()
	lb.text = text
	lb.font_size = 96
	lb.pixel_size = size
	lb.modulate = Color(0.95, 0.8, 0.4)
	lb.outline_size = 8
	lb.position = pos
	lb.rotation.y = yaw
	root.add_child(lb)


static func build(parent: Node3D, d: Dictionary, lod: int) -> void:
	var root := Node3D.new()
	root.name = "Landmark_" + str(d["id"])
	root.position = Vector3(d["x"], d["y"], d["z"])
	root.rotation.y = float(d.get("yaw", 0.0))
	parent.add_child(root)
	var body := StaticBody3D.new()
	body.name = "LandmarkBody"
	root.add_child(body)
	var L := float(d["L"])
	var D := float(d["D"])
	match str(d["id"]):
		"somoni":
			_box(root, body, "plaza", Vector3(0, 0.05, 0), Vector3(L, 0.3, D), true)
			var mon := Node3D.new()
			mon.name = "Monument"
			mon.scale = Vector3.ONE * 1.6          # the real arch is ~40 m high
			mon.position = Vector3(0, 0, -10)
			root.add_child(mon)
			root = mon
			body = StaticBody3D.new()
			mon.add_child(body)
			for k in 3:                                          # stepped platform
				_box(root, body, "marble", Vector3(0, 0.4 + k * 0.5, 18), Vector3(34 - k * 6, 0.5, 22 - k * 4))
			_box(root, body, "stone", Vector3(0, 7.5, 18), Vector3(6, 12, 3.5))       # stele
			_box(root, body, "gold", Vector3(0, 3.0, 16.0), Vector3(4, 0.4, 0.2), false)
			for sx: float in [-1.0, 1.0]:                               # arch pillars + lions
				_box(root, body, "marble", Vector3(sx * 9.5, 9.0, 18), Vector3(2.2, 16, 2.2))
				_box(root, body, "gold", Vector3(sx * 12.5, 2.4, 9.5), Vector3(1.4, 1.6, 3.2))
			_box(root, body, "marble", Vector3(0, 17.6, 18), Vector3(21.5, 1.6, 2.4))
			# golden crown on top of the arch: ring of tall petals + small dome
			for k in 12:
				var a := TAU * k / 12.0
				_box(root, null, "gold", Vector3(cos(a) * 3.2, 21.5, 18 + sin(a) * 1.4), Vector3(1.0, 5.0 + (1.6 if k % 2 == 0 else 0.0), 0.3), false, -a)
			_dome(root, "gold", Vector3(0, 18.4, 18), 3.0, 0.8)
			# statue: robed figure raising a sceptre
			_cyl(root, body, "gold", Vector3(0, 3.0, 13.5), 1.3, 4.2, 0.7, 16)
			_cyl(root, null, "gold", Vector3(0, 7.2, 13.5), 0.75, 1.6, 0.6, 12, false)
			_dome(root, "gold", Vector3(0, 8.8, 13.5), 0.55, 1.4)
			_box(root, null, "gold", Vector3(0.9, 9.0, 13.3), Vector3(0.25, 2.6, 0.25), false)
			_box(root, null, "gold", Vector3(1.0, 10.9, 13.3), Vector3(0.12, 3.0, 0.12), false)
			# fountains on the square
			for fx in [-40.0, 40.0]:
				_cyl(root, body, "marble", Vector3(fx, 0.2, -20), 9.0, 0.6)
				_cyl(root, null, "water", Vector3(fx, 0.5, -20), 8.4, 0.25, -1.0, 24, false)
				_cyl(root, null, "marble", Vector3(fx, 0.5, -20), 0.6, 3.0, 0.3, 12, false)
		"rudaki_park":
			_box(root, null, "grass", Vector3(0, 0.08, 0), Vector3(L, 0.15, D), false)
			_box(root, null, "plaza", Vector3(0, 0.12, 0), Vector3(12, 0.2, D), false)
			_box(root, null, "plaza", Vector3(0, 0.12, 0), Vector3(L, 0.2, 10), false)
			_cyl(root, body, "marble", Vector3(0, 0.1, 40), 14.0, 0.7)
			_cyl(root, null, "water", Vector3(0, 0.6, 40), 13.2, 0.3, -1.0, 32, false)
			# Rudaki monument: tall arch with mosaic panel + golden statue before it
			for sx: float in [-1.0, 1.0]:
				_box(root, body, "marble", Vector3(sx * 5.0, 9.0, -60), Vector3(2.4, 18, 2.4))
			_box(root, body, "tile", Vector3(0, 12.0, -60.6), Vector3(7.6, 11, 0.4))
			_box(root, body, "marble", Vector3(0, 18.6, -60), Vector3(12.4, 1.6, 2.6))
			_dome(root, "gold", Vector3(0, 19.4, -60), 1.4)
			_cyl(root, body, "stone", Vector3(0, 0.1, -54), 2.0, 2.0)
			_cyl(root, null, "gold", Vector3(0, 2.1, -54), 0.8, 2.6, 0.5, 12, false)
			_dome(root, "gold", Vector3(0, 4.7, -54), 0.42, 1.4)
			if lod == 0:
				WorldLandmarks._trees_ring(root, L, D)
		"museum":
			_box(root, body, "marble", Vector3(0, 9, 0), Vector3(L * 0.8, 18, D * 0.55))
			_box(root, body, "glass", Vector3(0, 9, -D * 0.28), Vector3(L * 0.5, 14, 0.4))
			_columns(root, body, "marble", Vector3(-L * 0.38, 0, -D * 0.32), Vector3(L * 0.38, 0, -D * 0.32), 16, 0.7, 16)
			_box(root, body, "gold", Vector3(0, 18.4, 0), Vector3(L * 0.82, 0.8, D * 0.57), false)
			_box(root, body, "marble", Vector3(0, 0.5, -D * 0.38), Vector3(L * 0.6, 1.0, 10))
			_label(root, "МАТҲАФИ МИЛЛӢ", Vector3(0, 16.8, -D * 0.33), PI, 0.03)
		"library":
			for k in 4:
				_box(root, body, "marble", Vector3(0, 6 + k * 9, 0), Vector3(L * (0.9 - k * 0.12), 12, D * (0.7 - k * 0.1)))
			_box(root, null, "gold", Vector3(0, 20, -D * 0.36), Vector3(L * 0.45, 34, 0.5), false)
			_label(root, "КИТОБХОНАИ МИЛЛӢ", Vector3(0, 4.5, -D * 0.36), PI, 0.03)
		"flag":
			_box(root, null, "grass", Vector3(0, 0.08, 0), Vector3(L, 0.15, D), false)
			_cyl(root, body, "marble", Vector3(0, 0.1, 0), 12.0, 1.2)
			_cyl(root, body, "white", Vector3(0, 1.3, 0), 1.2, 120.0, 0.45, 16)
			var fl := MeshInstance3D.new()
			var pm := PlaneMesh.new()
			pm.size = Vector2(30, 15)
			pm.subdivide_width = 16
			pm.subdivide_depth = 8
			pm.orientation = PlaneMesh.FACE_Z
			fl.mesh = pm
			var sm := ShaderMaterial.new()
			sm.shader = load("res://assets/shaders/flag.gdshader")
			fl.material_override = sm
			fl.position = Vector3(15.5, 112, 0)
			root.add_child(fl)
		"palace":
			_box(root, body, "plaza", Vector3(0, 0.05, -D * 0.5 + 10), Vector3(L, 0.3, 20))
			_box(root, body, "marble", Vector3(0, 11, 10), Vector3(L * 0.85, 22, D * 0.55))
			_columns(root, body, "marble", Vector3(-26, 0, -D * 0.2), Vector3(26, 0, -D * 0.2), 10, 1.0, 20)
			_box(root, body, "marble", Vector3(0, 21, -D * 0.2), Vector3(58, 2.4, 6))
			_cyl(root, body, "marble", Vector3(0, 22, 10), 16, 8)
			_dome(root, "gold", Vector3(0, 30, 10), 16, 0.9)
			_cyl(root, null, "gold", Vector3(0, 44, 10), 0.6, 6, 0.1, 8, false)
			for sx: float in [-1.0, 1.0]:
				_cyl(root, body, "marble", Vector3(sx * L * 0.42, 0, 10), 5, 26)
				_dome(root, "gold", Vector3(sx * L * 0.42, 26, 10), 5, 1.0)
		"navruz":
			_box(root, body, "marble", Vector3(0, 8, 0), Vector3(L * 0.85, 16, D * 0.7))
			for k in 9:                                      # arcade of pointed arches (tile panels)
				var x := -L * 0.38 + k * L * 0.095
				_box(root, null, "tile", Vector3(x, 7, -D * 0.351), Vector3(L * 0.06, 10, 0.3), false)
			_cyl(root, body, "tile", Vector3(0, 16, 0), 14, 6)
			_dome(root, "tile", Vector3(0, 22, 0), 14, 1.1)
			_dome(root, "gold", Vector3(0, 36.8, 0), 2.0, 1.4)
			for sx: float in [-1.0, 1.0]:
				for sz: float in [-1.0, 1.0]:
					_cyl(root, body, "marble", Vector3(sx * L * 0.42, 0, sz * D * 0.33), 3.2, 22)
					_dome(root, "tile", Vector3(sx * L * 0.42, 22, sz * D * 0.33), 3.2, 1.3)
			_label(root, "КОХИ НАВРӮЗ", Vector3(0, 17.5, -D * 0.36), PI, 0.03)
		"opera":
			_box(root, body, "pink", Vector3(0, 10, 6), Vector3(L * 0.8, 20, D * 0.75))
			_columns(root, body, "marble", Vector3(-15, 0.8, -D * 0.25), Vector3(15, 0.8, -D * 0.25), 8, 0.8, 15)
			_box(root, body, "marble", Vector3(0, 0.4, -D * 0.25), Vector3(36, 0.8, 9))
			_box(root, body, "marble", Vector3(0, 16.6, -D * 0.25), Vector3(34, 1.8, 7))
			var ped := MeshInstance3D.new()
			var pr := PrismMesh.new()
			pr.size = Vector3(34, 5, 7)
			ped.mesh = pr
			ped.material_override = _m("marble")
			ped.position = Vector3(0, 20, -D * 0.25)
			root.add_child(ped)
			_box(root, body, "pink", Vector3(0, 24, 10), Vector3(30, 8, 26))
			_label(root, "ТЕАТРИ ОПЕРА ВА БАЛЕТ", Vector3(0, 15.5, -D * 0.25 - 3.6), PI, 0.022)
		"mehrgon":
			_box(root, body, "marble", Vector3(0, 7, 0), Vector3(L * 0.9, 14, D * 0.8))
			for k in 7:
				var x := -L * 0.36 + k * L * 0.12
				_box(root, null, "blue_glass", Vector3(x, 9, -D * 0.401), Vector3(L * 0.08, 10, 0.3), false)
			_dome(root, "blue_glass", Vector3(0, 14, 0), 26, 0.45)
			_label(root, "БОЗОРИ МЕҲРГОН", Vector3(0, 15.5, -D * 0.41), PI, 0.03)
		"hisor_fort":
			for sx: float in [-1.0, 1.0]:
				_cyl(root, body, "clay", Vector3(sx * 13, 0, -D * 0.4), 7.5, 17, 6.3, 20)
				_box(root, body, "clay", Vector3(sx * 45, 4, -D * 0.4), Vector3(56, 8, 3))
			_box(root, body, "clay", Vector3(0, 13.5, -D * 0.4), Vector3(13, 7, 6))
			_box(root, null, "dark", Vector3(0, 5, -D * 0.4 - 2.6), Vector3(7, 10, 0.4), false)
			for sx: float in [-1.0, 1.0]:
				_box(root, body, "clay", Vector3(sx * L * 0.5, 4, 0), Vector3(3, 8, D * 0.8))
			_box(root, body, "clay", Vector3(0, 4, D * 0.4), Vector3(L, 8, 3))
			_label(root, "ҚАЛЪАИ ҲИСОР", Vector3(0, 20, -D * 0.4 - 4), PI, 0.03)
		"hisor_bazaar":
			for k in 10:
				var x := -L * 0.4 + (k % 5) * L * 0.2
				var z := -10.0 + (k / 5) * 20.0
				_box(root, body, "stone", Vector3(x, 0.5, z), Vector3(8, 1.0, 3))
				_box(root, null, "canvas" if k % 2 == 0 else "tile", Vector3(x, 3.2, z), Vector3(9, 0.15, 5), false)
				for sx: float in [-1.0, 1.0]:
					_box(root, null, "dark", Vector3(x + sx * 4.2, 1.6, z + 2.2), Vector3(0.12, 3.2, 0.12), false)
		_:
			_box(root, body, "marble", Vector3(0, 6, 0), Vector3(L * 0.7, 12, D * 0.7))


static func _trees_ring(root: Node3D, L: float, D: float) -> int:
	var ids := ["chinar_mature", "chinar_middle", "elm_a"]
	var cat: Variant = JSON.parse_string(FileAccess.get_file_as_string("res://data/vegetation_catalog.json"))
	var mesh: Mesh
	for e in (cat as Dictionary).get("assets", []):
		if e["id"] == "chinar_middle":
			var f: Dictionary = e.get("files", {})
			if ResourceLoader.exists(str(f.get("lod1", ""))):
				mesh = load(str(f["lod1"]))
	if mesh == null:
		return 0
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_colors = true
	mm.mesh = mesh
	var pts: Array[Vector3] = []
	for x in range(-int(L * 0.45), int(L * 0.45), 16):
		for z in range(-int(D * 0.45), int(D * 0.45), 16):
			if absf(x) < 14 or absf(z) < 14:
				continue
			pts.append(Vector3(x + (z % 5), 0, z))
	mm.instance_count = pts.size()
	for i in pts.size():
		mm.set_instance_transform(i, Transform3D(Basis(Vector3.UP, i * 1.3), pts[i]))
		mm.set_instance_color(i, Color.WHITE)
	var mmi := MultiMeshInstance3D.new()
	mmi.multimesh = mm
	root.add_child(mmi)
	return pts.size()
