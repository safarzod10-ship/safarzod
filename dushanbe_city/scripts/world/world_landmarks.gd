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
			# the Ismoili Somoni monument (assets/models/landmarks/somoni_monument.glb, own model after
			# the photos: ~42 m, stepped red-granite base, gilded statue, lions, marble arch, crown)
			var mon: Node3D = (load("res://assets/models/landmarks/somoni_monument.glb") as PackedScene).instantiate()
			mon.name = "Monument"
			mon.position = Vector3(0, 0.15, 6)
			root.add_child(mon)
			for mi in mon.find_children("*", "MeshInstance3D", true, false):
				(mi as MeshInstance3D).cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
			# collision: the three tiers (stairs walkable as ramps front / back), pedestal, pillars
			for k in 3:
				var r: float = [20.0, 16.5, 13.0][k]
				var cs := CollisionShape3D.new()
				var cy := CylinderShape3D.new()
				cy.radius = r
				cy.height = 1.1
				cs.shape = cy
				cs.position = Vector3(0, 0.15 + k * 1.1 + 0.55, 6)
				body.add_child(cs)
			for c in [[Vector3(8.4, 7.4, 7.4), Vector3(0, 3.3 + 3.7, 6 - 0.6)], [Vector3(3.0, 27.0, 3.0), Vector3(-8.2, 3.3 + 13.5, 6 + 2.6)],
					[Vector3(3.0, 27.0, 3.0), Vector3(8.2, 3.3 + 13.5, 6 + 2.6)]]:
				var cs2 := CollisionShape3D.new()
				var bx := BoxShape3D.new()
				bx.size = c[0]
				cs2.shape = bx
				cs2.position = c[1]
				body.add_child(cs2)
			# fountains on the square
			for fx in [-40.0, 40.0]:
				_cyl(root, body, "marble", Vector3(fx, 0.2, -20), 9.0, 0.6)
				_cyl(root, null, "water", Vector3(fx, 0.5, -20), 8.4, 0.25, -1.0, 24, false)
				_cyl(root, null, "marble", Vector3(fx, 0.5, -20), 0.6, 3.0, 0.3, 12, false)
		"rudaki_park":
			_box(root, null, "grass", Vector3(0, 0.08, 0), Vector3(L, 0.15, D), false)
			_box(root, null, "plaza", Vector3(0, 0.12, 0), Vector3(12, 0.2, D), false)
			_box(root, null, "plaza", Vector3(0, 0.12, 0), Vector3(L, 0.2, 10), false)
			_box(root, null, "plaza", Vector3(0, 0.07, -D * 0.5 - 5.0), Vector3(16, 0.2, 10.5), false)   # gate -> sidewalk
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
			# after the owner's photos: gate «БОҒИ КАЛОНИ ДУШАНБЕ», Ferris wheel, «I ♥ ДУШАНБЕ», rotundas
			for spec in [["park_gate", Vector3(0, 0.1, -D * 0.5 + 2.0), PI, Vector3(13.0, 10.0, 2.8)],
					["ferris_wheel", Vector3(-L * 0.3, 0.1, D * 0.25), PI * 0.5, Vector3(12.0, 34.0, 8.0)],
					["love_sign", Vector3(L * 0.22, 0.1, -D * 0.3), PI, Vector3(15.0, 3.0, 1.4)],
					["rotunda", Vector3(L * 0.3, 0.1, D * 0.25), 0.0, Vector3(13.0, 8.0, 13.0)],
					["rotunda", Vector3(-L * 0.28, 0.1, -D * 0.25), 0.0, Vector3(13.0, 8.0, 13.0)]]:
				var m := Node3D.new()
				m.name = String(spec[0])
				m.position = spec[1]
				m.rotation.y = spec[2]
				root.add_child(m)
				for part in WorldModels.parts(String(spec[0])):
					var mi := MeshInstance3D.new()
					mi.mesh = part[0]
					mi.transform = part[1]
					m.add_child(mi)
				var cs := CollisionShape3D.new()
				var bx := BoxShape3D.new()
				var sz: Vector3 = spec[3]
				bx.size = sz if spec[0] != "park_gate" else Vector3(2.6, 9.0, 2.6)
				cs.shape = bx
				cs.position = (spec[1] as Vector3) + Vector3(0, sz.y * 0.5, 0)
				if spec[0] == "park_gate":
					for sx: float in [-6.2, 6.2]:
						var c2 := CollisionShape3D.new()
						c2.shape = bx
						c2.position = (spec[1] as Vector3) + Vector3(0, 4.5, 0) + Basis(Vector3.UP, spec[2]) * Vector3(sx, 0, 0)
						body.add_child(c2)
				elif spec[0] != "rotunda":
					cs.rotation.y = spec[2]
					body.add_child(cs)
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
			# the imported flag of Tajikistan on its pole, x20: a 150 m flagpole, 97 x 67 m cloth
			var fl := WorldModels.place(root, "flag", Transform3D(Basis.IDENTITY.scaled(Vector3.ONE * 20.0), Vector3(0, 1.3, 0)), 0.0, true)
			fl.name = "NationalFlag"
			wave_flag(fl, root.global_position)
			var pcs := CollisionShape3D.new()
			var pcy := CylinderShape3D.new()
			pcy.radius = 2.0
			pcy.height = 150.0
			pcs.shape = pcy
			pcs.position = Vector3(0, 76, 0)
			body.add_child(pcs)
		"laklak":
			# LakLak delivery depot: concrete yard, warehouse, signs, van bays; the office door is the
			# job interaction point (LakLakJob.DEPOT_JOB_POINT, west face of the warehouse)
			_box(root, body, "plaza", Vector3(0, 0.05, 0), Vector3(L, 0.3, D), true)
			var wh := WorldModels.place(root, "laklak", Transform3D(Basis.IDENTITY, Vector3(12, 0.2, 6)), 0.0, true)
			wh.name = "Warehouse"
			var wcs := CollisionShape3D.new()
			var wbs := BoxShape3D.new()
			wbs.size = Vector3(18.0, 9.6, 25.7)
			wcs.shape = wbs
			wcs.position = Vector3(12, 5.0, 6)
			body.add_child(wcs)
			var sm := StandardMaterial3D.new()
			sm.albedo_texture = load("res://assets/vehicles/laklak/laklak_sign.png")
			sm.emission_enabled = true
			sm.emission_texture = sm.albedo_texture
			sm.emission_energy_multiplier = 0.35
			for spec in [[Vector3(2.85, 7.4, 6.0), -PI * 0.5, Vector2(16.0, 4.0)], [Vector3(-30.0, 6.2, -34.0), -PI * 0.5, Vector2(8.0, 2.0)]]:
				var q := QuadMesh.new()
				q.size = spec[2]
				var qi := MeshInstance3D.new()
				qi.name = "LakLakSign"
				qi.mesh = q
				qi.material_override = sm
				qi.position = spec[0]
				qi.rotation.y = spec[1]
				root.add_child(qi)
			# roadside sign: pole + panel (both faces)
			_box(root, body, "dark", Vector3(-30.0, 2.6, -34.0), Vector3(0.25, 5.2, 0.25))
			_box(root, null, "dark", Vector3(-29.85, 6.2, -34.0), Vector3(0.2, 2.2, 8.2), false)
			# office door (blue) and the van bays (white lines)
			_box(root, null, "blue_glass", Vector3(2.95, 1.4, 2.0), Vector3(0.12, 2.6, 2.0), false)
			for k in 3:
				_box(root, null, "white", Vector3(-16.0, 0.22, -20.0 + k * 6.0), Vector3(9.0, 0.02, 0.15), false)
			_label(root, "LakLak · ОФИС", Vector3(2.8, 3.2, 2.0), -PI * 0.5, 0.012)
			var sfl := WorldModels.place(root, "flag", Transform3D(Basis.IDENTITY.scaled(Vector3.ONE * 1.6), Vector3(-26.0, 0.2, 30.0)), 300.0, true)
			wave_flag(sfl, root.global_transform * Vector3(-26.0, 0.2, 30.0), 0.2)
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
		"tas":
			# TAS Group: the planned landmark tower (own model, 168 m + spire), glass on a stone podium
			_box(root, body, "plaza", Vector3(0, 0.05, 0), Vector3(L, 0.3, D), true)
			var tw := Node3D.new()
			tw.name = "TASTower"
			tw.rotation.y = PI                     # the model's front (+Z) to the plot's street side (-Z)
			root.add_child(tw)
			for part in WorldModels.parts("tas_tower"):
				var mi := MeshInstance3D.new()
				mi.mesh = part[0]
				mi.transform = part[1]
				mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
				tw.add_child(mi)
			for c in [[Vector3(60, 12, 44), Vector3(0, 6, 0)], [Vector3(30, 156, 22), Vector3(0, 90, 0)]]:
				var cs := CollisionShape3D.new()
				var bx := BoxShape3D.new()
				bx.size = c[0]
				cs.shape = bx
				cs.position = c[1]
				body.add_child(cs)
		"hero_home", "dealer", "dealer_mb", "dealer_bmw", "gunshop", "police", "city_park", "shop_street":
			pass                     # HeroHome / CarDealer / GunShop build their own buildings there
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
			# clearings around the park's attractions (Ferris wheel, rotundas, «I ♥ ДУШАНБЕ»)
			var clear := false
			for c in [Vector2(-L * 0.3, D * 0.25), Vector2(L * 0.3, D * 0.25), Vector2(-L * 0.28, -D * 0.25), Vector2(L * 0.22, -D * 0.3)]:
				if Vector2(x, z).distance_to(c) < 26.0:
					clear = true
			if clear:
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


## the imported flag's cloth parts get the waving shader (their own texture); pole at `pole_w`
static func wave_flag(fl: Node3D, pole_w: Vector3, amp := 2.6) -> void:
	for mi in fl.find_children("*", "MeshInstance3D", true, false):
		var m := mi as MeshInstance3D
		var src := m.mesh.surface_get_material(0) as BaseMaterial3D
		if src == null or src.albedo_texture == null or m.mesh.get_aabb().size.y > m.mesh.get_aabb().size.x * 1.5:
			continue                       # the pole (no texture) stays as it is
		var wb := m.global_transform * m.mesh.get_aabb()
		var c := wb.get_center()
		var along_w := Vector3(c.x - pole_w.x, 0, c.z - pole_w.z)
		var lw := along_w.length() * 2.0
		along_w = along_w.normalized()
		var normal_w := Vector3.UP.cross(along_w).normalized()
		var inv := m.global_transform.affine_inverse()
		var sm := ShaderMaterial.new()
		sm.shader = load("res://assets/shaders/flag_model.gdshader")
		sm.set_shader_parameter("tex", src.albedo_texture)
		sm.set_shader_parameter("pole_l", inv * pole_w)
		sm.set_shader_parameter("along_l", (inv.basis * along_w).normalized())
		sm.set_shader_parameter("normal_l", inv.basis * normal_w)
		sm.set_shader_parameter("len_l", (inv.basis * (along_w * lw)).length())
		sm.set_shader_parameter("amp", amp)
		m.material_override = sm
