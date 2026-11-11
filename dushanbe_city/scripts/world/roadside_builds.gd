class_name RoadsideBuilds
extends RefCounted
## 0.27: the filling station and the auto service after the owner's pictures, built from boxes merged per
## material (a few draw calls), local +X towards the road.
##   АЗС: a red-white canopy with the «АЗС» drop logo over two pump islands (four dispensers with
##        displays and hoses), the «Мини-Маркет» shop with a glass front and a red band, a tall price
##        pylon «АЗС» with the price board and «Добро пожаловать!», lamp posts, painted arrows, flower
##        beds and thujas along the street
##   АВТОСЕРВИС: a grey-blue workshop with three numbered open bays (lifts, lit interiors, tool walls),
##        a glazed office, the «АВТОСЕРВИС» band with a car outline, the service list panel, a blue pylon
##        «АВТОСЕРВИС 24/7», tyre stacks, oil drums, marked parking, flower beds and thujas

var root: Node3D
var body: StaticBody3D
var _tools := {}
var _mats := {}
var plants := {}                 ## veg id -> Array of local Transform3D


func _init(r: Node3D, b: StaticBody3D) -> void:
	root = r
	body = b


static func mat(c: Color, rough := 0.6, metal := 0.0, emit := Color.BLACK, e := 1.0) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = c
	m.roughness = rough
	m.metallic = metal
	if emit != Color.BLACK:
		m.emission_enabled = true
		m.emission = emit
		m.emission_energy_multiplier = e
	if c.a < 1.0:
		m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	return m


func _add(mesh: Mesh, xf: Transform3D, m: Material) -> void:
	var k := m.get_instance_id()
	if not _tools.has(k):
		var st := SurfaceTool.new()
		st.begin(Mesh.PRIMITIVE_TRIANGLES)
		_tools[k] = st
		_mats[k] = m
	(_tools[k] as SurfaceTool).append_from(mesh, 0, xf)


func box(size: Vector3, pos: Vector3, m: Material, solid := false) -> void:
	var b := BoxMesh.new()
	b.size = size
	_add(b, Transform3D(Basis.IDENTITY, pos), m)
	if solid:
		var cs := CollisionShape3D.new()
		var sh := BoxShape3D.new()
		sh.size = size
		cs.shape = sh
		cs.position = pos
		body.add_child(cs)


func cyl(r: float, h: float, pos: Vector3, m: Material, seg := 12) -> void:
	var c := CylinderMesh.new()
	c.top_radius = r
	c.bottom_radius = r
	c.height = h
	c.radial_segments = seg
	c.rings = 1
	_add(c, Transform3D(Basis.IDENTITY, pos), m)


func torus(ri: float, ro: float, pos: Vector3, m: Material) -> void:
	var t := TorusMesh.new()
	t.inner_radius = ri
	t.outer_radius = ro
	t.rings = 12
	t.ring_segments = 8
	_add(t, Transform3D(Basis.IDENTITY.scaled(Vector3(1, 1.3, 1)), pos), m)


## a label facing local +X (side > 0) or -X; or +Z / -Z when along_z
func text(t: String, pos: Vector3, size: int, col: Color, px: float, yaw := PI * 0.5, outline := 0) -> Label3D:
	var l := Label3D.new()
	l.text = t
	l.font = load("res://assets/fonts/game_font.tres")
	l.font_size = size
	l.pixel_size = px
	l.modulate = col
	l.outline_size = outline
	l.position = pos
	l.rotation.y = yaw
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	l.visibility_range_end = 260.0
	root.add_child(l)
	return l


func plant(id: String, pos: Vector3, s := 1.0) -> void:
	if not plants.has(id):
		plants[id] = []
	(plants[id] as Array).append(Transform3D(Basis(Vector3.UP, pos.x * 1.7 + pos.z).scaled(Vector3.ONE * s), pos))


## a street-side flower bed along local Z at x (from z0 to z1) with thujas at its ends
func bed(x: float, z0: float, z1: float, w := 1.4) -> void:
	var c := Vector3(x, 0, (z0 + z1) * 0.5)
	box(Vector3(w + 0.25, 0.3, z1 - z0), c + Vector3(0, 0.15, 0), _m("kerb"))
	box(Vector3(w, 0.06, z1 - z0 - 0.2), c + Vector3(0, 0.3, 0), _m("soil"))
	var n := int((z1 - z0 - 1.6) / 0.32)
	for i in n:
		for j in 3:
			plant(["flowers_salvia", "flowers_petunia", "flowers_marigold"][(i / 5 + j) % 3], Vector3(x - w * 0.33 + j * w * 0.33, 0.32, z0 + 0.8 + i * 0.32), 1.25)
	plant("thuja_cone", Vector3(x, 0.32, z0 + 0.5), 0.38)
	plant("thuja_cone", Vector3(x, 0.32, z1 - 0.5), 0.38)


var _mcache := {}


func _m(k: String) -> StandardMaterial3D:
	if not _mcache.has(k):
		_mcache[k] = {"kerb": mat(Color(0.8, 0.78, 0.74), 0.8), "soil": mat(Color(0.18, 0.13, 0.08), 0.95),
				"white": mat(Color(0.95, 0.95, 0.95), 0.45), "red": mat(Color(0.82, 0.08, 0.1), 0.4),
				"dark": mat(Color(0.12, 0.12, 0.14), 0.5, 0.3), "glass": mat(Color(0.22, 0.3, 0.35), 0.05, 0.3, Color(1.0, 0.86, 0.6), 0.7),
				"light": mat(Color(1, 1, 0.95), 0.3, 0.0, Color(1.0, 0.97, 0.9), 2.5), "steel": mat(Color(0.62, 0.64, 0.66), 0.35, 0.8),
				"blue": mat(Color(0.1, 0.25, 0.6), 0.4), "navy": mat(Color(0.06, 0.12, 0.3), 0.45), "grey": mat(Color(0.82, 0.83, 0.84), 0.6),
				"paint": mat(Color(0.95, 0.95, 0.92), 0.7), "yellow": mat(Color(0.95, 0.78, 0.1), 0.6), "rubber": mat(Color(0.06, 0.06, 0.065), 0.9),
				"green": mat(Color(0.1, 0.55, 0.25), 0.5), "screen": mat(Color(0.05, 0.1, 0.08), 0.2, 0.0, Color(0.3, 1.0, 0.5), 1.5)}[k]
	return _mcache[k]


func commit() -> void:
	var am := ArrayMesh.new()
	for k in _tools:
		(_tools[k] as SurfaceTool).commit(am)
		am.surface_set_material(am.get_surface_count() - 1, _mats[k])
	var mi := MeshInstance3D.new()
	mi.mesh = am
	mi.visibility_range_end = 900.0
	root.add_child(mi)


## street lamp (two heads) on a grey pole
func lamp_post(p: Vector3) -> void:
	cyl(0.1, 7.0, p + Vector3(0, 3.5, 0), _m("steel"), 8)
	box(Vector3(1.4, 0.1, 0.1), p + Vector3(-0.6, 7.0, 0), _m("steel"))
	box(Vector3(0.6, 0.14, 0.3), p + Vector3(-1.2, 6.95, 0), _m("light"))


# ------------------------------------------------------------------------------------------ АЗС
## local: +X to the road (edge ~ +17.5), the pumps round (7.5, 0, 0.3), the plot x -12.5 .. 17.5, z -9.5 .. 12.5
func fuel_station() -> void:
	var W := _m("white")
	var R := _m("red")
	var D := _m("dark")
	# canopy: 4 white columns, the roof slab, white lit underside, red fascia all round
	var cc := Vector3(7.5, 0, 0.3)
	for sx: float in [-3.0, 3.0]:
		for sz: float in [-4.2, 4.6]:
			box(Vector3(0.5, 5.2, 0.5), cc + Vector3(sx, 2.6, sz), W, true)
	box(Vector3(11.0, 0.5, 15.0), cc + Vector3(0, 5.45, 0.2), W)
	box(Vector3(11.2, 1.0, 0.25), cc + Vector3(0, 5.6, 7.8), R)
	box(Vector3(11.2, 1.0, 0.25), cc + Vector3(0, 5.6, -7.4), R)
	box(Vector3(0.25, 1.0, 15.4), cc + Vector3(5.6, 5.6, 0.2), R)
	box(Vector3(0.25, 1.0, 15.4), cc + Vector3(-5.6, 5.6, 0.2), R)
	box(Vector3(11.3, 0.12, 15.5), cc + Vector3(0, 6.15, 0.2), W)
	box(Vector3(0.26, 0.12, 15.5), cc + Vector3(5.62, 5.05, 0.2), W)                     # white edge line
	for k in 3:
		for k2 in 2:
			box(Vector3(1.8, 0.05, 0.6), cc + Vector3(-3.0 + k * 3.0, 5.18, -2.5 + k2 * 5.6), _m("light"))
	# the «АЗС» logo on the fascia (street side and both ends): white drop on red + text
	for fp in [[cc + Vector3(5.75, 5.6, 0.2), PI * 0.5], [cc + Vector3(0, 5.6, 7.95), 0.0], [cc + Vector3(0, 5.6, -7.55), PI]]:
		var p: Vector3 = fp[0]
		var yaw: float = fp[1]
		text("● АЗС", p, 96, Color(1, 1, 1), 0.0085, yaw)
	# two pump islands (along X) with two dispensers each
	for iz: float in [-2.5, 3.1]:
		var ic := cc + Vector3(0, 0, iz)
		box(Vector3(6.4, 0.22, 1.2), ic + Vector3(0, 0.11, 0), _m("kerb"), true)
		box(Vector3(6.6, 0.04, 1.4), ic + Vector3(0, 0.02, 0), _m("yellow"))
		for dx: float in [-1.6, 1.6]:
			var d := ic + Vector3(dx, 0.22, 0)
			box(Vector3(0.9, 1.9, 0.6), d + Vector3(0, 0.95, 0), W, true)
			box(Vector3(0.92, 0.5, 0.62), d + Vector3(0, 1.75, 0), R)
			for sz2: float in [-0.31, 0.31]:
				box(Vector3(0.6, 0.35, 0.02), d + Vector3(0, 1.25, sz2), _m("screen"))
				box(Vector3(0.12, 0.3, 0.06), d + Vector3(0.35, 0.8, sz2 * 1.25), D)             # nozzle
				box(Vector3(0.04, 0.6, 0.04), d + Vector3(0.45, 0.6, sz2 * 1.3), D)              # hose
			text("92 · 95 · ДТ", d + Vector3(0, 1.75, 0.32), 40, Color(1, 1, 1), 0.006, 0.0)
			text("92 · 95 · ДТ", d + Vector3(0, 1.75, -0.32), 40, Color(1, 1, 1), 0.006, PI)
		box(Vector3(0.4, 0.8, 0.4), ic + Vector3(2.9, 0.62, 0), R)                         # bollards
		box(Vector3(0.4, 0.8, 0.4), ic + Vector3(-2.9, 0.62, 0), R)
	# Мини-Маркет: white box, full glass front (towards the pumps / +X), red band with the name
	var sh := Vector3(-6.0, 0, 0.4)
	box(Vector3(12.0, 4.4, 17.0), sh + Vector3(0, 2.2, 0), W, true)
	box(Vector3(0.1, 2.9, 13.0), sh + Vector3(6.02, 1.6, -1.2), _m("glass"))
	for k3 in 7:
		box(Vector3(0.14, 3.0, 0.1), sh + Vector3(6.05, 1.6, -7.7 + k3 * 2.15), D)
	box(Vector3(0.14, 0.1, 13.0), sh + Vector3(6.05, 3.1, -1.2), D)
	box(Vector3(0.1, 2.4, 1.8), sh + Vector3(6.04, 1.2, 6.6), _m("glass"))                 # door
	box(Vector3(0.6, 1.1, 18.0), sh + Vector3(6.1, 3.9, 0), R)                              # red band
	box(Vector3(12.4, 0.3, 17.4), sh + Vector3(0, 4.55, 0), D)                              # roof edge
	text("Мини-Маркет", sh + Vector3(6.42, 3.9, -1.0), 96, Color(1, 1, 1), 0.0085)
	text("24 часа", sh + Vector3(6.42, 3.9, 6.6), 64, Color(1, 0.9, 0.5), 0.007)
	# shelves seen through the glass + a counter, lit ceiling
	for k4 in 3:
		box(Vector3(0.6, 1.6, 9.0), sh + Vector3(-2.0 + k4 * 2.2, 0.8, -1.5), mat(Color(0.7, 0.3 + k4 * 0.15, 0.2), 0.7))
	box(Vector3(1.0, 1.0, 3.0), sh + Vector3(4.3, 0.5, 4.5), R)
	box(Vector3(10.0, 0.06, 0.4), sh + Vector3(0, 4.15, -3.0), _m("light"))
	box(Vector3(10.0, 0.06, 0.4), sh + Vector3(0, 4.15, 3.0), _m("light"))
	for k5 in 3:
		box(Vector3(1.2, 0.7, 1.0), sh + Vector3(-3.5 + k5 * 2.4, 4.9, 4.5), _m("steel"))      # roof AC units
	# the price pylon by the road (both faces)
	var py := Vector3(15.8, 0, -8.0)
	box(Vector3(0.9, 0.5, 2.6), py + Vector3(0, 0.25, 0), _m("kerb"), true)
	box(Vector3(0.6, 7.0, 2.2), py + Vector3(0, 3.6, 0), R, true)
	for side: float in [1.0, -1.0]:
		var f := py + Vector3(0.31 * side, 0, 0)
		var yaw2 := PI * 0.5 if side > 0 else -PI * 0.5
		# the white drop logo: a ball + a cone
		var dm := SphereMesh.new()
		dm.radius = 0.38
		dm.height = 0.76
		_add(dm, Transform3D(Basis.IDENTITY, f + Vector3(0.05 * side, 6.25, 0)), W)
		var cm := CylinderMesh.new()
		cm.top_radius = 0.0
		cm.bottom_radius = 0.3
		cm.height = 0.5
		_add(cm, Transform3D(Basis.IDENTITY, f + Vector3(0.05 * side, 6.7, 0)), W)
		text("АЗС", f + Vector3(0, 5.5, 0), 120, Color(1, 1, 1), 0.008, yaw2)
		box(Vector3(0.04, 2.4, 1.9), f + Vector3(0, 3.55, 0), D)
		text("АИ-92   14.00\nАИ-95   14.00\nДТ        14.00", f + Vector3(0.03 * side, 3.55, 0), 56, Color(1.0, 0.92, 0.55), 0.0075, yaw2)
		box(Vector3(0.04, 1.0, 2.1), f + Vector3(0, 1.35, 0), W)
		text("Добро\nпожаловать!", f + Vector3(0.03 * side, 1.35, 0), 44, Color(0.82, 0.08, 0.1), 0.006, yaw2)
	# painted arrows on the forecourt (in / out), lamp posts, flower beds + thujas along the street
	for az: float in [-6.5, 8.5]:
		var a := Vector3(12.5, 0.07, az)
		box(Vector3(2.4, 0.02, 0.25), a, _m("paint"))
		var tip := a + Vector3(-1.3 if az < 0 else 1.3, 0, 0)
		for sg: float in [-1.0, 1.0]:
			var hb := BoxMesh.new()
			hb.size = Vector3(0.9, 0.02, 0.22)
			var back := Vector3(0.32 if az < 0 else -0.32, 0, sg * 0.3)
			_add(hb, Transform3D(Basis(Vector3.UP, atan2(back.z, back.x) * -1.0), tip + back), _m("paint"))
	lamp_post(Vector3(15.5, 0, 11.0))
	lamp_post(Vector3(-11.5, 0, -8.5))
	bed(16.6, -4.6, 5.8)
	bed(16.6, 11.0, 12.6)
	bed(-11.5, -8.0, 9.5, 1.2)


# ------------------------------------------------------------------------------------------ АВТОСЕРВИС
## local: +X to the road, the repair pad at (8, 0, 0); the workshop front at x = 2.35
func auto_service() -> void:
	var G := _m("grey")
	var B := _m("blue")
	var N := _m("navy")
	var D := _m("dark")
	var W := _m("white")
	var conc := mat(Color(0.6, 0.6, 0.58), 0.9)
	# ground: the forecourt (pad, parking with yellow lines)
	box(Vector3(16.0, 0.5, 34.0), Vector3(4.0, -0.15, 0.0), conc, true)
	box(Vector3(6.0, 0.02, 9.0), Vector3(8.0, 0.11, -4.0), _m("yellow"))
	box(Vector3(5.6, 0.02, 8.6), Vector3(8.0, 0.12, -4.0), conc)
	for k in 4:
		box(Vector3(5.0, 0.02, 0.14), Vector3(9.0, 0.11, 6.0 + k * 2.8), _m("yellow"))
	# the workshop: back + end walls, 3 bays (z -11.4 .. 4.2, 5.2 m each), grey facade, blue base
	var x0 := -6.5
	var xf := 2.35
	var zs := [-11.4, -6.2, -1.0, 4.2]
	box(Vector3(0.3, 5.4, 25.0), Vector3(x0, 2.7, -1.0), G, true)
	box(Vector3(xf - x0, 5.4, 0.3), Vector3((x0 + xf) * 0.5, 2.7, -11.5), G, true)
	for k2 in 3:
		var z0: float = zs[k2]
		var z1: float = zs[k2 + 1]
		var zc := (z0 + z1) * 0.5
		box(Vector3(xf - x0, 5.4, 0.25), Vector3((x0 + xf) * 0.5, 2.7, z1), G, true)          # partitions
		box(Vector3(xf - x0 - 0.3, 0.12, z1 - z0 - 0.3), Vector3((x0 + xf) * 0.5, 0.06, zc), mat(Color(0.35, 0.36, 0.38), 0.5))
		box(Vector3(0.1, 4.6, z1 - z0 - 0.3), Vector3(x0 + 0.2, 2.4, zc), mat(Color(0.75, 0.77, 0.8), 0.6))   # back wall panel
		for r in 3:
			box(Vector3(0.2, 0.05, 2.6), Vector3(x0 + 0.3, 1.2 + r * 0.7, zc - 0.6), _m("steel"))     # tool shelves
		box(Vector3(5.0, 0.06, 0.35), Vector3(-2.0, 4.85, zc), _m("light"))                  # ceiling light
		# two-post lift with arms
		for lz: float in [z0 + 0.6, z1 - 0.6]:
			box(Vector3(0.35, 3.8, 0.35), Vector3(-1.5, 1.9, lz), B)
			box(Vector3(2.2, 0.12, 0.18), Vector3(-1.5, 0.7 if k2 != 0 else 1.6, lz + (0.6 if lz < zc else -0.6)), _m("steel"))
		box(Vector3(0.3, 0.25, z1 - z0 - 0.8), Vector3(-1.5, 3.9, zc), B)
		# number on a blue square over the bay
		box(Vector3(0.1, 0.8, 0.8), Vector3(xf + 0.22, 4.55, zc), B)
		text(str(3 - k2), Vector3(xf + 0.29, 4.55, zc), 96, Color(1, 1, 1), 0.007)
		# a car body on the lift / on the floor (simple saloon shape)
		var cy := 1.95 if k2 == 0 else 0.3
		var col: Material = [W, D, mat(Color(0.55, 0.57, 0.6), 0.3, 0.6)][k2]
		box(Vector3(4.2, 0.7, 1.8), Vector3(-1.8, cy + 0.6, zc), col)
		box(Vector3(2.2, 0.6, 1.6), Vector3(-2.0, cy + 1.2, zc), mat(Color(0.1, 0.12, 0.14), 0.1, 0.3))
		for wx: float in [-3.1, -0.5]:
			for wz: float in [-0.85, 0.85]:
				cyl(0.34, 0.25, Vector3(wx, cy + 0.34, zc + wz), _m("rubber"))
	box(Vector3(0.4, 1.0, 16.0), Vector3(xf + 0.05, 4.9, -3.6), G)                          # lintel over the bays
	for zp: float in [-11.4, -6.2, -1.0, 4.2]:
		box(Vector3(0.45, 4.4, 0.45), Vector3(xf + 0.05, 2.2, zp), G)                       # piers
		box(Vector3(0.47, 0.5, 0.47), Vector3(xf + 0.05, 0.25, zp), B)
	# office (glass, blue frame) on the +Z end
	var oc := Vector3(-1.5, 0, 8.6)
	box(Vector3(8.0, 4.4, 8.4), oc + Vector3(-0.5, 2.2, 0), G, true)
	box(Vector3(0.1, 3.2, 6.4), oc + Vector3(3.55, 1.8, 0), _m("glass"))
	for k3 in 5:
		box(Vector3(0.14, 3.3, 0.1), oc + Vector3(3.6, 1.8, -3.2 + k3 * 1.6), N)
	box(Vector3(0.16, 0.14, 6.6), oc + Vector3(3.6, 3.45, 0), N)
	box(Vector3(1.4, 0.2, 7.0), oc + Vector3(3.3, 4.0, 0), N)                              # canopy
	box(Vector3(8.6, 0.3, 9.0), oc + Vector3(-0.5, 4.55, 0), N)
	# the big sign band over everything + the car outline + the service list panel
	box(Vector3(0.4, 1.8, 26.0), Vector3(xf + 0.3, 6.3, -1.0), N, true)
	box(Vector3(0.42, 0.12, 26.0), Vector3(xf + 0.31, 5.38, -1.0), B)
	text("АВТОСЕРВИС", Vector3(xf + 0.52, 6.15, -4.0), 150, Color(1, 1, 1), 0.0095)
	# a car outline over the name (white strokes)
	box(Vector3(0.05, 0.08, 2.6), Vector3(xf + 0.52, 6.95, -4.0), W)
	box(Vector3(0.05, 0.08, 1.4), Vector3(xf + 0.52, 7.15, -4.1), W)
	box(Vector3(0.3, 4.6, 4.8), Vector3(xf + 0.4, 2.6, 7.4), N)
	text("◉ Шиномонтаж\n◉ Диагностика\n◉ Ремонт\n◉ Замена масла", Vector3(xf + 0.57, 2.8, 7.4), 46, Color(1, 1, 1), 0.0075)
	# tyre stacks, oil drums
	for st in [Vector3(3.6, 0.1, -13.0), Vector3(4.5, 0.1, -13.2), Vector3(5.4, 0.1, -13.0)]:
		for k4 in 4:
			torus(0.22, 0.36, st + Vector3(0, 0.12 + k4 * 0.24, 0), _m("rubber"))
	for k5 in 3:
		cyl(0.3, 0.9, Vector3(3.4 + k5 * 0.7, 0.55, 13.6), B)
	# the pylon «АВТОСЕРВИС 24/7» by the road
	var py := Vector3(12.8, 0, -15.5)
	box(Vector3(0.9, 0.5, 2.6), py + Vector3(0, 0.25, 0), _m("kerb"), true)
	box(Vector3(0.12, 3.0, 0.12), py + Vector3(0, 1.5, 0), _m("steel"))
	box(Vector3(0.5, 3.4, 2.6), py + Vector3(0, 4.6, 0), B, true)
	for side: float in [1.0, -1.0]:
		var yaw := PI * 0.5 if side > 0 else -PI * 0.5
		var f := py + Vector3(0.26 * side, 0, 0)
		text("⚙", f + Vector3(0, 5.65, 0), 110, Color(1, 1, 1), 0.007, yaw)
		text("АВТОСЕРВИС", f + Vector3(0, 4.75, 0), 54, Color(1, 1, 1), 0.007, yaw)
		text("24/7", f + Vector3(0, 3.85, 0), 110, Color(1, 1, 1), 0.008, yaw)
	lamp_post(Vector3(12.5, 0, 16.0))
	# flower beds with thujas along the street (gaps: the entrance at the pad, the parking)
	bed(12.8, -13.0, -9.2)
	bed(12.8, 1.2, 4.6)
	bed(12.8, 15.0, 17.0)
