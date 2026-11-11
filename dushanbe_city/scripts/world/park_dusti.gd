class_name ParkDusti
extends RefCounted
## «Парк Дусти» (150 x 150 m) after the owner's reference pictures:
##   front (+Z, the street): a polished marble plaza with red bands, the grand gate - cream marble piers
##   with black marble panels in gold frames, an arch with a gold trim, the black «ПАРК ДУСТИ» board,
##   a gold crown on top, wall lanterns, open wrought-iron gate leaves; low wings to the fence; the
##   black marble name plaque «ПАРК ДУСТИ · ДУШАНБЕ» with a crown; three-headed lamp posts; flower beds
##   all round the perimeter: cream pillars with lanterns, black iron bars with gold tips and gold
##   rosettes, a cream base wall, flower beds in front
##   inside: the main alley, a big central fountain (two tiers, ring + vertical jets), two rectangular
##   fountain pools, two rotundas with blue domes, a pond with a domed gazebo on an island, a carousel,
##   a playground, a pergola with benches, food kiosks, benches, lamps, chinar / elm alleys, flower beds
## (the Ferris wheel FerrisRide stands in the back-left quarter: PhotoPlaces places it)
## All the static geometry is merged per material (a few draw calls); repeated bars are a MultiMesh.

const H := 75.0                 ## half size of the plot
const FZ := 60.0                ## the fence line at the front (the plaza lies outside it, to the street)

var n: Node3D
var body: StaticBody3D
var jets: Callable              ## PhotoPlaces._jets(parent, pos, spread, speed, amount, dir)
var _tools := {}
var _mats := {}
var _bars: Array[Transform3D] = []
var _tips: Array[Transform3D] = []
var M := {}                     ## materials
var props := {"bench_park_soviet": [], "light_park_4m": [], "bin_modern_steel": [], "urn_concrete_round": []}
var trees := {"chinar_mature": [], "chinar_middle": [], "elm_a": [], "thuja_cone": [], "rose_bush": [],
		"flowers_petunia": [], "flowers_salvia": [], "flowers_marigold": [], "shrub_lilac": [], "hedge_privet": []}
var _keep_out: Array = []       ## [Vector2 centre, radius] - no trees there


func _init(node: Node3D, b: StaticBody3D, jets_fn: Callable) -> void:
	n = node
	body = b
	jets = jets_fn


# ------------------------------------------------------------------------------------------ helpers
func _mat(c: Color, rough := 0.6, metal := 0.0, emit := Color.BLACK, e := 1.0) -> StandardMaterial3D:
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


func box(size: Vector3, pos: Vector3, m: Material, solid := false, yaw := 0.0) -> void:
	var b := BoxMesh.new()
	b.size = size
	_add(b, Transform3D(Basis(Vector3.UP, yaw), pos), m)
	if solid:
		_col(size, pos, yaw)


func _col(size: Vector3, pos: Vector3, yaw := 0.0) -> void:
	var cs := CollisionShape3D.new()
	var bs := BoxShape3D.new()
	bs.size = size
	cs.shape = bs
	cs.position = pos
	cs.rotation.y = yaw
	body.add_child(cs)


func cyl(rt: float, rb: float, h: float, pos: Vector3, m: Material, seg := 16, solid := false) -> void:
	var c := CylinderMesh.new()
	c.top_radius = rt
	c.bottom_radius = rb
	c.height = h
	c.radial_segments = seg
	c.rings = 1
	_add(c, Transform3D(Basis.IDENTITY, pos), m)
	if solid:
		var cs := CollisionShape3D.new()
		var sh := CylinderShape3D.new()
		sh.radius = maxf(rt, rb)
		sh.height = h
		cs.shape = sh
		cs.position = pos
		body.add_child(cs)


func disc(r: float, t: float, xf: Transform3D, m: Material, seg := 16) -> void:
	var c := CylinderMesh.new()
	c.top_radius = r
	c.bottom_radius = r
	c.height = t
	c.radial_segments = seg
	c.rings = 1
	_add(c, xf, m)


func dome(r: float, pos: Vector3, m: Material) -> void:
	var s := SphereMesh.new()
	s.radius = r
	s.height = r
	s.is_hemisphere = true
	s.radial_segments = 20
	s.rings = 8
	_add(s, Transform3D(Basis.IDENTITY, pos), m)


func ball(r: float, pos: Vector3, m: Material) -> void:
	var s := SphereMesh.new()
	s.radius = r
	s.height = r * 2.0
	s.radial_segments = 10
	s.rings = 6
	_add(s, Transform3D(Basis.IDENTITY, pos), m)


## a bar a -> b with square section t
func bar(a: Vector3, b: Vector3, t: float, m: Material) -> void:
	var d := b - a
	var L := d.length()
	if L < 0.001:
		return
	var y := d / L
	var x := y.cross(Vector3.FORWARD if absf(y.dot(Vector3.FORWARD)) < 0.9 else Vector3.RIGHT).normalized()
	var z := x.cross(y)
	var bm := BoxMesh.new()
	bm.size = Vector3(t, L, t)
	_add(bm, Transform3D(Basis(x, y, z), (a + b) * 0.5), m)


func text(t: String, pos: Vector3, size: int, col: Color, px: float, yaw := 0.0) -> void:
	var l := Label3D.new()
	l.text = t
	l.font = load("res://assets/fonts/game_font.tres")
	l.font_size = size
	l.pixel_size = px
	l.modulate = col
	l.outline_size = 0
	l.position = pos
	l.rotation.y = yaw
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	l.visibility_range_end = 300.0
	n.add_child(l)


## a gold frame (four thin bars) round a w x h rectangle in the XY plane at pos (facing +Z / -Z)
func frame(w: float, h: float, pos: Vector3, t := 0.1) -> void:
	box(Vector3(w + t, t, t), pos + Vector3(0, h * 0.5, 0), M["gold"])
	box(Vector3(w + t, t, t), pos - Vector3(0, h * 0.5, 0), M["gold"])
	box(Vector3(t, h, t), pos + Vector3(w * 0.5, 0, 0), M["gold"])
	box(Vector3(t, h, t), pos - Vector3(w * 0.5, 0, 0), M["gold"])


## hand-built triangles (roofs) go to their own surface: no UV / tangent channels like the boxes have
func _roof(m: Material) -> Material:
	var k := "roof_%d" % m.get_instance_id()
	if not M.has(k):
		var d := (m as StandardMaterial3D).duplicate() as StandardMaterial3D
		d.cull_mode = BaseMaterial3D.CULL_DISABLED
		M[k] = d
	return M[k]


func _out(p: Vector2, r: float) -> void:
	_keep_out.append([p, r])


# ------------------------------------------------------------------------------------------ build
func build() -> void:
	M["cream"] = _mat(Color(0.94, 0.89, 0.79), 0.25)
	M["cream2"] = _mat(Color(0.86, 0.8, 0.69), 0.35)
	M["black"] = _mat(Color(0.05, 0.05, 0.06), 0.12, 0.2)
	M["gold"] = _mat(Color(0.92, 0.72, 0.28), 0.25, 1.0, Color(0.35, 0.25, 0.05), 0.4)
	M["iron"] = _mat(Color(0.05, 0.05, 0.06), 0.4, 0.6)
	M["glass"] = _mat(Color(1.0, 0.92, 0.7), 0.2, 0.0, Color(1.0, 0.8, 0.45), 2.2)
	M["paving"] = PlotPatches.paving_material()
	M["stone"] = _mat(Color(0.8, 0.77, 0.72), 0.6)
	M["soil"] = _mat(Color(0.2, 0.14, 0.09), 0.95)
	M["water"] = _mat(Color(0.14, 0.45, 0.62, 0.8), 0.02, 0.2)
	M["pool"] = _mat(Color(0.2, 0.55, 0.8), 0.2)
	M["blue"] = _mat(Color(0.1, 0.32, 0.72), 0.3, 0.4)
	M["white"] = _mat(Color(0.96, 0.96, 0.95), 0.4)
	M["red"] = _mat(Color(0.82, 0.12, 0.12), 0.5)
	M["yellow"] = _mat(Color(0.97, 0.78, 0.12), 0.5)
	M["green"] = _mat(Color(0.15, 0.6, 0.3), 0.5)
	M["wood"] = _mat(Color(0.5, 0.32, 0.17), 0.7)
	M["rubber"] = _mat(Color(0.7, 0.25, 0.2), 0.95)
	_plaza()
	_gate()
	_plaque(Vector3(19, 0, 66.5))
	_fence()
	_alleys()
	_fountain(Vector3.ZERO)
	for sx: float in [-1.0, 1.0]:
		_pool(Vector3(sx * 17.0, 0, 38.0))
	_rotunda(Vector3(46, 0, 36))
	_rotunda(Vector3(24, 0, -26))
	_pond(Vector3(46, 0, -46))
	_carousel(Vector3(-30, 0, -14))
	_playground(Vector3(-46, 0, 34))
	_pergola(Vector3(-24, 0, 20))
	_kiosk(Vector3(-12, 0, 52), M["red"], "МОРОЖЕНОЕ")
	_kiosk(Vector3(12, 0, 52), M["blue"], "КОФЕ · ЧАЙ")
	_out(Vector2(-42, -44), 22.0)            # the Ferris wheel (PhotoPlaces)
	_vegetation()
	_commit()


func _commit() -> void:
	var am := ArrayMesh.new()
	for k in _tools:
		(_tools[k] as SurfaceTool).commit(am)
		am.surface_set_material(am.get_surface_count() - 1, _mats[k])
	var mi := MeshInstance3D.new()
	mi.name = "ParkDusti"
	mi.mesh = am
	mi.visibility_range_end = 900.0
	n.add_child(mi)
	for pair in [[_bars, Vector3(0.028, 1.8, 0.028), M["iron"]], [_tips, Vector3(0.07, 0.14, 0.04), M["gold"]]]:
		var arr: Array[Transform3D] = pair[0]
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		var mesh: Mesh
		if pair[2] == M["gold"]:
			var pm := PrismMesh.new()
			pm.size = pair[1]
			mesh = pm
		else:
			var bm := BoxMesh.new()
			bm.size = pair[1]
			mesh = bm
		mesh.surface_set_material(0, pair[2])
		mm.mesh = mesh
		mm.instance_count = arr.size()
		for i in arr.size():
			mm.set_instance_transform(i, arr[i])
		var mmi := MultiMeshInstance3D.new()
		mmi.multimesh = mm
		mmi.visibility_range_end = 260.0
		mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		n.add_child(mmi)


# ------------------------------------------------------------------------------------------ the front
func _plaza() -> void:
	# polished marble plaza between the fence and the street (the apron joins it to the sidewalk)
	box(Vector3(2 * H, 0.24, H - FZ + 1.0), Vector3(0, -0.04, (FZ + H) * 0.5), M["paving"], true)
	# lamp posts with three lanterns
	for x: float in [-64.0, -44.0, -26.0, 26.0, 44.0, 64.0]:
		_lamp3(Vector3(x, 0, 70.5))
	for x2: float in [-14.0, 14.0]:
		_lamp3(Vector3(x2, 0, 64.5))


func _lamp3(p: Vector3) -> void:
	cyl(0.35, 0.42, 0.6, p + Vector3(0, 0.3, 0), M["iron"], 12)
	cyl(0.09, 0.13, 4.6, p + Vector3(0, 2.9, 0), M["iron"], 10)
	ball(0.16, p + Vector3(0, 5.25, 0), M["gold"])
	for k in 3:
		var a := k * TAU / 3.0 + 0.5
		var d := Vector3(sin(a), 0, cos(a))
		bar(p + Vector3(0, 4.9, 0), p + d * 0.75 + Vector3(0, 5.1, 0), 0.06, M["iron"])
		var q := p + d * 0.75 + Vector3(0, 4.95, 0)
		box(Vector3(0.34, 0.08, 0.34), q, M["iron"])
		box(Vector3(0.26, 0.42, 0.26), q + Vector3(0, 0.25, 0), M["glass"])
		box(Vector3(0.38, 0.1, 0.38), q + Vector3(0, 0.5, 0), M["iron"])
		ball(0.06, q + Vector3(0, 0.6, 0), M["gold"])
	_col(Vector3(0.5, 5.0, 0.5), p + Vector3(0, 2.5, 0))


func _lantern(p: Vector3, s := 1.0) -> void:
	box(Vector3(0.42, 0.1, 0.42) * s, p, M["iron"])
	box(Vector3(0.3, 0.48, 0.3) * s, p + Vector3(0, 0.29, 0) * s, M["glass"])
	box(Vector3(0.46, 0.1, 0.46) * s, p + Vector3(0, 0.58, 0) * s, M["iron"])
	box(Vector3(0.24, 0.12, 0.24) * s, p + Vector3(0, 0.69, 0) * s, M["iron"])
	ball(0.05 * s, p + Vector3(0, 0.8, 0) * s, M["gold"])


func _gate() -> void:
	var z := FZ
	for sx: float in [-1.0, 1.0]:
		var x := sx * 6.4
		box(Vector3(3.6, 1.4, 3.2), Vector3(x, 0.7, z), M["black"], true)                 # black marble plinth
		box(Vector3(3.2, 10.0, 2.8), Vector3(x, 6.4, z), M["cream"], true)               # the pier
		box(Vector3(3.4, 0.3, 3.0), Vector3(x, 1.55, z), M["cream2"])
		for fz: float in [1.0, -1.0]:
			# black marble inset with a gold frame and a gold ornament line, front and back
			box(Vector3(1.5, 6.0, 0.08), Vector3(x, 6.0, z + fz * 1.43), M["black"])
			frame(1.5, 6.0, Vector3(x, 6.0, z + fz * 1.47), 0.09)
			for k in 4:
				ball(0.12, Vector3(x, 3.9 + k * 1.4, z + fz * 1.5), M["gold"])
			# wall lantern on the inner corner
			bar(Vector3(x - sx * 1.6, 7.0, z + fz * 1.0), Vector3(x - sx * 2.0, 7.0, z + fz * 1.0), 0.06, M["iron"])
			_lantern(Vector3(x - sx * 2.05, 6.5, z + fz * 1.0), 1.1)
		box(Vector3(3.6, 0.5, 3.2), Vector3(x, 11.55, z), M["cream2"])                   # pier capital
		box(Vector3(3.0, 0.25, 2.6), Vector3(x, 14.15, z), M["black"])
		cyl(0.25, 0.35, 0.5, Vector3(x, 14.5, z), M["gold"], 12)
		ball(0.35, Vector3(x, 15.0, z), M["gold"])
	# the arch: opening 9.2 m, springing 6.4 m; voussoir ring + gold inner trim
	var R0 := 4.6
	var R1 := 5.4
	var ys := 6.4
	for k in 17:
		var a0 := PI * k / 17.0
		var a1 := PI * (k + 1) / 17.0
		var am := (a0 + a1) * 0.5
		var mid := Vector3(cos(am) * (R0 + R1) * 0.5, ys + sin(am) * (R0 + R1) * 0.5, z)
		var b := Basis(Vector3.BACK, am - PI * 0.5)
		var bm := BoxMesh.new()
		bm.size = Vector3((R0 + R1) * 0.5 * (a1 - a0) + 0.02, R1 - R0, 2.6)
		_add(bm, Transform3D(b, mid), M["cream"])
		for fz2: float in [1.0, -1.0]:
			var tm := BoxMesh.new()
			tm.size = Vector3(R0 * (a1 - a0) + 0.02, 0.14, 0.12)
			_add(tm, Transform3D(b, Vector3(cos(am) * (R0 + 0.07), ys + sin(am) * (R0 + 0.07), z + fz2 * 1.32)), M["gold"])
	# spandrels: rows filling between the ring and the beam
	var y := ys
	while y < 11.3:
		var dy := y + 0.125 - ys
		var c := sqrt(maxf(R1 * R1 - dy * dy, 0.0)) if dy < R1 else 0.0
		var inner := maxf(c, 0.0)
		var outer := 4.8
		if outer > inner:
			for sx2: float in [-1.0, 1.0]:
				box(Vector3(outer - inner, 0.26, 2.4), Vector3(sx2 * (inner + outer) * 0.5, y + 0.125, z), M["cream"])
		y += 0.25
	for sx3: float in [-1.0, 1.0]:
		for fz3: float in [1.0, -1.0]:
			disc(0.55, 0.06, Transform3D(Basis(Vector3.RIGHT, PI * 0.5), Vector3(sx3 * 3.9, 10.2, z + fz3 * 1.22)), M["gold"], 16)
	# the beam with the name board, cornice, the crown
	box(Vector3(16.0, 2.6, 3.0), Vector3(0, 12.6, z), M["cream"], true)
	box(Vector3(16.6, 0.35, 3.4), Vector3(0, 14.05, z), M["cream2"])
	box(Vector3(16.0, 0.2, 3.1), Vector3(0, 11.35, z), M["gold"])
	for fz4: float in [1.0, -1.0]:
		box(Vector3(11.4, 2.0, 0.1), Vector3(0, 12.65, z + fz4 * 1.53), M["black"])
		frame(11.4, 2.0, Vector3(0, 12.65, z + fz4 * 1.58), 0.12)
		text("ПАРК ДУСТИ", Vector3(0, 12.6, z + fz4 * 1.62), 160, Color(1.0, 0.8, 0.36), 0.0095, 0.0 if fz4 > 0 else PI)
	box(Vector3(4.2, 1.5, 0.8), Vector3(0, 15.0, z), M["black"])
	frame(4.2, 1.5, Vector3(0, 15.0, z + 0.42), 0.1)
	frame(4.2, 1.5, Vector3(0, 15.0, z - 0.42), 0.1)
	_crown(Vector3(0, 15.85, z), 1.0)
	# open wrought-iron gate leaves in the arch
	for sx4: float in [-1.0, 1.0]:
		var hinge := Vector3(sx4 * 4.55, 0, z - 0.6)
		var dirv := Vector3(-sx4 * cos(1.22), 0, -sin(1.22))          # opened 70 deg into the park
		var w := 4.4
		for yy: float in [0.4, 3.2, 6.0]:
			bar(hinge + Vector3(0, yy, 0), hinge + dirv * w + Vector3(0, yy, 0), 0.08, M["iron"])
		var nb := 22
		for i in nb + 1:
			var p := hinge + dirv * (w * i / nb)
			bar(p + Vector3(0, 0.2, 0), p + Vector3(0, 6.3, 0), 0.04, M["iron"])
			ball(0.05, p + Vector3(0, 6.35, 0), M["gold"])
		disc(0.6, 0.05, Transform3D(Basis(Vector3.UP, atan2(dirv.x, dirv.z) + PI * 0.5) * Basis(Vector3.RIGHT, PI * 0.5), hinge + dirv * w * 0.5 + Vector3(0, 4.6, 0)), M["gold"])
	# wings: low cream walls with a pillar + lantern to the fence
	for sx5: float in [-1.0, 1.0]:
		box(Vector3(3.6, 3.6, 1.6), Vector3(sx5 * 9.9, 1.8, z), M["cream"], true)
		box(Vector3(1.6, 2.4, 0.06), Vector3(sx5 * 9.9, 2.0, z + 0.82), M["black"])
		frame(1.6, 2.4, Vector3(sx5 * 9.9, 2.0, z + 0.86), 0.07)
		box(Vector3(3.9, 0.3, 1.9), Vector3(sx5 * 9.9, 3.75, z), M["cream2"])
		box(Vector3(1.3, 4.4, 1.3), Vector3(sx5 * 12.3, 2.2, z), M["cream"], true)
		box(Vector3(1.5, 0.25, 1.5), Vector3(sx5 * 12.3, 4.5, z), M["cream2"])
		_lantern(Vector3(sx5 * 12.3, 4.62, z), 1.3)
	# flower beds at the foot of the gate
	for sx6: float in [-1.0, 1.0]:
		_bed(Vector3(sx6 * 10.0, 0, z + 2.3), Vector2(5.0, 1.2), true)


## a gold crown: a band, five points with balls, a ring of jewels and an orb with a cross-spike on top
func _crown(p: Vector3, s: float) -> void:
	cyl(0.95 * s, 0.85 * s, 0.45 * s, p + Vector3(0, 0.22 * s, 0), M["gold"], 20)
	for k in 5:
		var a := k * TAU / 5.0
		var q := p + Vector3(sin(a) * 0.85 * s, 0.45 * s, cos(a) * 0.85 * s)
		var pm := PrismMesh.new()
		pm.size = Vector3(0.42, 0.6, 0.12) * s
		_add(pm, Transform3D(Basis(Vector3.UP, a), q + Vector3(0, 0.3 * s, 0)), M["gold"])
		ball(0.09 * s, q + Vector3(0, 0.65 * s, 0), M["gold"])
	for k2 in 10:
		var a2 := k2 * TAU / 10.0
		ball(0.07 * s, p + Vector3(sin(a2) * 0.93 * s, 0.22 * s, cos(a2) * 0.93 * s), M["red"] if k2 % 2 == 0 else M["blue"])
	ball(0.22 * s, p + Vector3(0, 0.75 * s, 0), M["gold"])
	box(Vector3(0.08, 0.5, 0.08) * s, p + Vector3(0, 1.15 * s, 0), M["gold"])
	box(Vector3(0.3, 0.08, 0.08) * s, p + Vector3(0, 1.2 * s, 0), M["gold"])


func _plaque(p: Vector3) -> void:
	box(Vector3(7.6, 1.0, 1.4), p + Vector3(0, 0.5, 0), M["cream"], true)
	box(Vector3(7.9, 0.15, 1.6), p + Vector3(0, 1.05, 0), M["cream2"])
	box(Vector3(6.8, 2.8, 0.35), p + Vector3(0, 2.55, 0), M["black"], true)
	for fz: float in [1.0, -1.0]:
		frame(6.8, 2.8, p + Vector3(0, 2.55, fz * 0.2), 0.12)
		text("ПАРК ДУСТИ", p + Vector3(0, 2.3, fz * 0.19), 120, Color(1.0, 0.82, 0.38), 0.0085, 0.0 if fz > 0 else PI)
		text("ДУШАНБЕ", p + Vector3(0, 1.62, fz * 0.19), 64, Color(0.95, 0.85, 0.6), 0.0075, 0.0 if fz > 0 else PI)
	_crown(p + Vector3(0, 3.95, 0), 0.45)
	box(Vector3(1.2, 4.0, 1.2), p + Vector3(-4.2, 2.0, 0), M["cream"], true)
	box(Vector3(1.2, 4.0, 1.2), p + Vector3(4.2, 2.0, 0), M["cream"], true)
	_lantern(p + Vector3(-4.2, 4.0, 0), 1.1)
	_lantern(p + Vector3(4.2, 4.0, 0), 1.1)
	_bed(p + Vector3(0, 0, 1.6), Vector2(7.6, 1.2), true)


## a flower bed: stone kerb, soil, rows of flowers (centre p, size x along X / y along Z)
func _bed(p: Vector3, size: Vector2, roses := false) -> void:
	box(Vector3(size.x + 0.3, 0.3, size.y + 0.3), p + Vector3(0, 0.09, 0), M["stone"])
	box(Vector3(size.x, 0.06, size.y), p + Vector3(0, 0.25, 0), M["soil"])
	var kinds := ["flowers_salvia", "flowers_petunia", "flowers_marigold"]
	var nx := int(size.x / 0.34)
	var nz := maxi(1, int(size.y / 0.34))
	for i in nx:
		for j in nz:
			var id: String = kinds[(i / 5 + j) % 3]
			if roses and j == nz / 2 and i % 4 == 0:
				id = "rose_bush"
			var q := p + Vector3(-size.x * 0.5 + (i + 0.5) * size.x / nx, 0.27, -size.y * 0.5 + (j + 0.5) * size.y / nz)
			trees[id].append(Transform3D(Basis(Vector3.UP, float(i * 7 + j) * 1.3).scaled(Vector3.ONE * (0.8 if id == "rose_bush" else 1.25)), q))


# ------------------------------------------------------------------------------------------ the fence
func _fence() -> void:
	var runs := [[Vector3(-H + 1.0, 0, FZ), Vector3(-13.0, 0, FZ)], [Vector3(13.0, 0, FZ), Vector3(H - 1.0, 0, FZ)],
			[Vector3(H - 1.0, 0, FZ), Vector3(H - 1.0, 0, -H + 1.0)], [Vector3(H - 1.0, 0, -H + 1.0), Vector3(-H + 1.0, 0, -H + 1.0)],
			[Vector3(-H + 1.0, 0, -H + 1.0), Vector3(-H + 1.0, 0, FZ)]]
	for r in runs:
		var a: Vector3 = r[0]
		var b: Vector3 = r[1]
		var d := b - a
		var L := d.length()
		var dirv := d / L
		var yaw := atan2(dirv.x, dirv.z)
		var np := maxi(1, int(round(L / 6.0)))
		for i in np + 1:
			var p := a.lerp(b, float(i) / np)
			box(Vector3(0.95, 2.9, 0.95), p + Vector3(0, 1.45, 0), M["cream"])
			box(Vector3(1.15, 0.22, 1.15), p + Vector3(0, 0.25, 0), M["cream2"])
			box(Vector3(1.15, 0.22, 1.15), p + Vector3(0, 2.95, 0), M["cream2"])
			_lantern(p + Vector3(0, 3.06, 0), 0.9)
		for i2 in np:
			var p0 := a.lerp(b, float(i2) / np) + dirv * 0.5
			var p1 := a.lerp(b, float(i2 + 1) / np) - dirv * 0.5
			var mid := (p0 + p1) * 0.5
			var seg := p0.distance_to(p1)
			box(Vector3(0.5, 0.55, seg), mid + Vector3(0, 0.27, 0), M["cream"], false, yaw)
			for yy: float in [0.7, 2.45]:
				box(Vector3(0.05, 0.07, seg), mid + Vector3(0, yy, 0), M["iron"], false, yaw)
			var nb := int(seg / 0.14)
			for k in nb:
				var q := p0 + dirv * (k + 0.5) * seg / nb
				_bars.append(Transform3D(Basis(Vector3.UP, yaw), q + Vector3(0, 1.5, 0)))
				_tips.append(Transform3D(Basis(Vector3.UP, yaw), q + Vector3(0, 2.47, 0)))
			# the gold rosette in the middle of each panel: a disc in an iron ring + spokes
			var rb := Basis(Vector3.UP, yaw + PI * 0.5) * Basis(Vector3.RIGHT, PI * 0.5)
			disc(0.42, 0.05, Transform3D(rb, mid + Vector3(0, 1.55, 0)), M["gold"], 16)
			disc(0.2, 0.08, Transform3D(rb, mid + Vector3(0, 1.55, 0)), M["iron"], 12)
			_col(Vector3(0.4, 2.6, seg), mid + Vector3(0, 1.3, 0), yaw)
		# flower beds outside the front fence / hedges inside the others
		if absf(a.z - FZ) < 0.1 and absf(b.z - FZ) < 0.1:
			var c := (a + b) * 0.5
			_bed(c + Vector3(0, 0, 1.4), Vector2(L - 2.0, 1.1), true)
		else:
			var nh := int(L / 1.4)
			for k2 in nh:
				var q2 := a + dirv * (k2 + 0.5) * L / nh - Vector3(dirv.z, 0, -dirv.x) * 1.2 * (1.0 if r != runs[4] else -1.0)
				trees["hedge_privet"].append(Transform3D(Basis(Vector3.UP, yaw), q2))


# ------------------------------------------------------------------------------------------ inside
func _path(a: Vector2, b: Vector2, w: float) -> void:
	var d := b - a
	var L := d.length()
	var yaw := atan2(d.x, d.y)
	var c := (a + b) * 0.5
	box(Vector3(w, 0.22, L), Vector3(c.x, -0.05, c.y), M["paving"], true, yaw)


func _alleys() -> void:
	_path(Vector2(0, FZ), Vector2(0, 20), 10.0)                 # the main alley
	box(Vector3(46, 0.22, 26), Vector3(0, -0.05, 38), M["paving"], true)   # the square with the pools
	cyl(24.0, 24.0, 0.22, Vector3(0, -0.04, 0), M["paving"], 48, false)
	_col(Vector3(48, 0.22, 48), Vector3(0, -0.04, 0))
	_path(Vector2(-H + 2, 0), Vector2(H - 2, 0), 7.0)
	_path(Vector2(0, 0), Vector2(0, -H + 2), 7.0)
	_path(Vector2(0, -8), Vector2(46, -46), 5.0)                # to the pond
	_path(Vector2(0, -8), Vector2(-40, -40), 5.0)               # to the wheel
	_path(Vector2(-20, 24), Vector2(-46, 34), 4.0)              # playground
	_path(Vector2(20, 24), Vector2(46, 36), 4.0)                # rotunda
	_path(Vector2(10, -10), Vector2(24, -26), 4.0)
	# benches + lamps along the alleys
	for k in 5:
		var z := 56.0 - k * 7.0
		if z > 50.0 or z < 24.0:
			for sx: float in [-1.0, 1.0]:
				props["bench_park_soviet"].append(Transform3D(Basis(Vector3.UP, -sx * PI * 0.5), Vector3(sx * 5.6, 0.1, z)))
	for k2 in 8:
		for sx2: float in [-1.0, 1.0]:
			var x := 30.0 + k2 * 5.5
			props["light_park_4m"].append(Transform3D(Basis.IDENTITY, Vector3(sx2 * x, 0.1, 4.2 * sx2)))
			if k2 % 2 == 0:
				props["bench_park_soviet"].append(Transform3D(Basis(Vector3.UP, PI if sx2 > 0 else 0.0), Vector3(sx2 * (x + 2.5), 0.1, -4.4 * sx2)))
	for k3 in 6:
		props["light_park_4m"].append(Transform3D(Basis.IDENTITY, Vector3(4.2, 0.1, -30.0 - k3 * 7.0)))
		props["bench_park_soviet"].append(Transform3D(Basis(Vector3.UP, PI * 0.5), Vector3(-4.6, 0.1, -32.0 - k3 * 7.0)))
	for k4 in 4:
		props["bin_modern_steel"].append(Transform3D(Basis.IDENTITY, Vector3(5.6, 0.1, 54.0 - k4 * 9.0)))


func _fountain(c: Vector3) -> void:
	# the big central fountain: wide basin, middle tier, top bowl, ring of tall jets and arcing jets
	var segs := 44
	cyl(12.0, 12.0, 0.25, c + Vector3(0, 0.12, 0), M["pool"], 44)
	disc(11.7, 0.05, Transform3D(Basis.IDENTITY, c + Vector3(0, 0.6, 0)), M["water"], 44)
	for k in segs:
		var a := k * TAU / segs
		box(Vector3(1.75, 0.8, 0.6), c + Vector3(sin(a) * 12.0, 0.4, cos(a) * 12.0), M["cream"], true, a)
		box(Vector3(1.8, 0.1, 0.8), c + Vector3(sin(a) * 12.0, 0.85, cos(a) * 12.0), M["cream2"], false, a)
	cyl(5.4, 5.0, 1.2, c + Vector3(0, 1.0, 0), M["cream"], 32, true)
	disc(5.2, 0.05, Transform3D(Basis.IDENTITY, c + Vector3(0, 1.62, 0)), M["water"], 32)
	cyl(1.0, 1.4, 2.4, c + Vector3(0, 2.8, 0), M["cream"], 16)
	cyl(2.6, 1.2, 0.5, c + Vector3(0, 4.2, 0), M["cream"], 24)
	disc(2.4, 0.05, Transform3D(Basis.IDENTITY, c + Vector3(0, 4.46, 0)), M["water"], 24)
	cyl(0.3, 0.45, 1.4, c + Vector3(0, 5.1, 0), M["gold"], 12)
	ball(0.45, c + Vector3(0, 5.9, 0), M["gold"])
	jets.call(n, c + Vector3(0, 6.2, 0), 0.6, 9.0, 220, Vector3.ZERO)
	for k2 in 12:
		var a2 := k2 * TAU / 12.0
		jets.call(n, c + Vector3(sin(a2) * 8.5, 0.7, cos(a2) * 8.5), 0.1, 7.0, 40, Vector3.ZERO)
	for k3 in 16:
		var a3 := k3 * TAU / 16.0
		jets.call(n, c + Vector3(sin(a3) * 11.2, 0.9, cos(a3) * 11.2), 0.1, 4.0, 18, -Vector3(sin(a3), 0, cos(a3)))
	# a ring of roses + flower beds round the fountain
	for k4 in 28:
		var a4 := k4 * TAU / 28.0
		trees["rose_bush"].append(Transform3D(Basis(Vector3.UP, a4), c + Vector3(sin(a4) * 14.5, 0.1, cos(a4) * 14.5)))
	for k5 in 4:
		var a5 := PI * 0.25 + k5 * PI * 0.5
		_bed(c + Vector3(sin(a5) * 19.0, 0, cos(a5) * 19.0), Vector2(4.0, 4.0))
		props["light_park_4m"].append(Transform3D(Basis.IDENTITY, c + Vector3(sin(a5 + 0.4) * 22.5, 0.1, cos(a5 + 0.4) * 22.5)))
		props["bench_park_soviet"].append(Transform3D(Basis(Vector3.UP, a5 + PI), c + Vector3(sin(a5 - 0.35) * 21.5, 0.1, cos(a5 - 0.35) * 21.5)))
	_out(Vector2(c.x, c.z), 25.0)


func _pool(c: Vector3) -> void:
	# a rectangular fountain pool with two rows of jets
	box(Vector3(9.0, 0.2, 17.0), c + Vector3(0, 0.1, 0), M["pool"])
	box(Vector3(8.6, 0.05, 16.6), c + Vector3(0, 0.55, 0), M["water"])
	for sx: float in [-4.6, 4.6]:
		box(Vector3(0.5, 0.75, 17.6), c + Vector3(sx, 0.37, 0), M["cream"], true)
	for sz: float in [-8.55, 8.55]:
		box(Vector3(9.7, 0.75, 0.5), c + Vector3(0, 0.37, sz), M["cream"], true)
	for k in 6:
		for sx2: float in [-1.8, 1.8]:
			jets.call(n, c + Vector3(sx2, 0.6, -6.5 + k * 2.6), 0.08, 6.0 if k % 2 == 0 else 4.5, 30, Vector3.ZERO)
	_out(Vector2(c.x, c.z), 11.0)


func _rotunda(c: Vector3) -> void:
	# a white rotunda: round stepped base, 8 columns, entablature ring, a blue dome with a gold spire
	cyl(5.2, 5.4, 0.4, c + Vector3(0, 0.2, 0), M["cream2"], 32, true)
	cyl(4.8, 4.8, 0.3, c + Vector3(0, 0.55, 0), M["white"], 32, true)
	for k in 8:
		var a := k * TAU / 8.0
		var p := c + Vector3(sin(a) * 4.0, 0, cos(a) * 4.0)
		cyl(0.32, 0.36, 0.3, p + Vector3(0, 0.85, 0), M["white"], 12)
		cyl(0.22, 0.26, 4.0, p + Vector3(0, 3.0, 0), M["white"], 12)
		cyl(0.34, 0.26, 0.3, p + Vector3(0, 5.1, 0), M["white"], 12)
	cyl(4.7, 4.7, 0.7, c + Vector3(0, 5.6, 0), M["white"], 32)
	cyl(4.9, 4.9, 0.2, c + Vector3(0, 6.0, 0), M["cream2"], 32)
	dome(4.3, c + Vector3(0, 6.05, 0), M["blue"])
	cyl(0.15, 0.3, 0.8, c + Vector3(0, 10.5, 0), M["gold"], 10)
	ball(0.3, c + Vector3(0, 11.1, 0), M["gold"])
	for k2 in 4:
		var a2 := k2 * TAU / 4.0 + 0.4
		props["bench_park_soviet"].append(Transform3D(Basis(Vector3.UP, a2 + PI), c + Vector3(sin(a2) * 7.0, 0.1, cos(a2) * 7.0)))
	cyl(7.6, 7.6, 0.22, c + Vector3(0, -0.04, 0), M["paving"], 32)
	_out(Vector2(c.x, c.z), 9.0)


func _pond(c: Vector3) -> void:
	# an oval pond with a stone rim, an island with a domed gazebo, a little bridge
	var rx := 20.0
	var rz := 13.0
	var water := CylinderMesh.new()
	water.top_radius = 1.0
	water.bottom_radius = 1.0
	water.height = 0.05
	water.radial_segments = 48
	_add(water, Transform3D(Basis.IDENTITY.scaled(Vector3(rx, 1, rz)), c + Vector3(0, 0.12, 0)), M["water"])
	var bed := CylinderMesh.new()
	bed.top_radius = 1.0
	bed.bottom_radius = 1.0
	bed.height = 0.06
	bed.radial_segments = 48
	_add(bed, Transform3D(Basis.IDENTITY.scaled(Vector3(rx, 1, rz)), c + Vector3(0, 0.04, 0)), M["pool"])
	var segs := 56
	for k in segs:
		var a0 := k * TAU / segs
		var a1 := (k + 1) * TAU / segs
		var p0 := c + Vector3(sin(a0) * rx, 0.25, cos(a0) * rz)
		var p1 := c + Vector3(sin(a1) * rx, 0.25, cos(a1) * rz)
		var mid := (p0 + p1) * 0.5
		var yaw := atan2(p1.x - p0.x, p1.z - p0.z)
		box(Vector3(0.7, 0.5, p0.distance_to(p1) + 0.1), mid, M["stone"], false, yaw)
		_col(Vector3(0.7, 1.0, p0.distance_to(p1) + 0.1), mid + Vector3(0, 0.25, 0), yaw)
	# island + gazebo
	cyl(4.6, 4.8, 0.5, c + Vector3(0, 0.25, 0), M["stone"], 24, true)
	_gazebo(c + Vector3(0, 0.5, 0))
	# bridge from the shore to the island (to -Z side of the path)
	var b0 := c + Vector3(-rx * 0.62, 0, rz * 0.62)
	var b1 := c + Vector3(-3.0, 0, 3.0)
	var yawb := atan2(b1.x - b0.x, b1.z - b0.z)
	var lb := b0.distance_to(b1)
	box(Vector3(2.4, 0.2, lb), (b0 + b1) * 0.5 + Vector3(0, 0.6, 0), M["wood"], true, yawb)
	for sx: float in [-1.15, 1.15]:
		var off := Vector3(cos(yawb), 0, -sin(yawb)) * sx
		bar(b0 + off + Vector3(0, 1.6, 0), b1 + off + Vector3(0, 1.6, 0), 0.08, M["white"])
		for k2 in 6:
			var q := b0.lerp(b1, k2 / 5.0) + off
			bar(q + Vector3(0, 0.6, 0), q + Vector3(0, 1.6, 0), 0.08, M["white"])
	jets.call(n, c + Vector3(rx * 0.5, 0.2, -rz * 0.3), 0.1, 6.0, 40, Vector3.ZERO)
	_out(Vector2(c.x, c.z), 22.0)


func _gazebo(c: Vector3) -> void:
	cyl(3.4, 3.4, 0.25, c + Vector3(0, 0.12, 0), M["white"], 24)
	for k in 6:
		var a := k * TAU / 6.0
		cyl(0.16, 0.18, 3.2, c + Vector3(sin(a) * 2.9, 1.85, cos(a) * 2.9), M["white"], 10)
		if k != 0:
			bar(c + Vector3(sin(a) * 2.9, 0.9, cos(a) * 2.9), c + Vector3(sin(a + TAU / 6) * 2.9, 0.9, cos(a + TAU / 6) * 2.9), 0.08, M["white"])
	cyl(3.3, 3.3, 0.35, c + Vector3(0, 3.55, 0), M["white"], 24)
	dome(3.0, c + Vector3(0, 3.7, 0), M["blue"])
	ball(0.25, c + Vector3(0, 6.85, 0), M["gold"])


func _carousel(c: Vector3) -> void:
	cyl(7.0, 7.0, 0.22, c + Vector3(0, -0.04, 0), M["paving"], 32)
	cyl(5.6, 5.6, 0.45, c + Vector3(0, 0.25, 0), M["white"], 32, true)
	cyl(0.45, 0.45, 4.6, c + Vector3(0, 2.6, 0), M["gold"], 12)
	for k in 16:
		var a := k * TAU / 16.0
		var p := c + Vector3(sin(a) * 4.6, 0, cos(a) * 4.6)
		bar(p + Vector3(0, 0.45, 0), p + Vector3(0, 4.6, 0), 0.07, M["gold"])
		if k % 2 == 0:
			# a horse (simple): body, neck, head, legs, saddle
			var yaw := a + PI * 0.5
			var col: Material = [M["white"], M["yellow"], M["red"], M["blue"]][(k / 2) % 4]
			var h := p + Vector3(0, 1.6 + 0.3 * sin(k), 0)
			box(Vector3(0.35, 0.45, 1.2), h, col, false, yaw)
			var fwd := Vector3(sin(yaw), 0, cos(yaw))
			bar(h + fwd * 0.45, h + fwd * 0.75 + Vector3(0, 0.55, 0), 0.22, col)
			box(Vector3(0.24, 0.24, 0.5), h + fwd * 0.92 + Vector3(0, 0.7, 0), col, false, yaw)
			box(Vector3(0.38, 0.08, 0.45), h + Vector3(0, 0.27, 0), M["red"], false, yaw)
			for s in [-1.0, 1.0]:
				bar(h + fwd * 0.4 * s, h + fwd * 0.55 * s + Vector3(0, -0.75, 0), 0.08, col)
	# striped conical roof (red / yellow sectors), a rim with lamps, a flag
	for k2 in 16:
		var a0 := k2 * TAU / 16.0
		var a1 := (k2 + 1) * TAU / 16.0
		var st := SurfaceTool.new()
		st.begin(Mesh.PRIMITIVE_TRIANGLES)
		var top := c + Vector3(0, 7.2, 0)
		var e0 := c + Vector3(sin(a0) * 6.0, 4.9, cos(a0) * 6.0)
		var e1 := c + Vector3(sin(a1) * 6.0, 4.9, cos(a1) * 6.0)
		var nrm := (e1 - top).cross(e0 - top).normalized()
		for v in [top, e1, e0, top, e0, e1]:
			st.set_normal(nrm)
			st.add_vertex(v)
		_add(st.commit(), Transform3D.IDENTITY, _roof(M["red"] if k2 % 2 == 0 else M["yellow"]))
	cyl(6.1, 6.1, 0.5, c + Vector3(0, 4.7, 0), M["white"], 32)
	for k3 in 24:
		var a3 := k3 * TAU / 24.0
		ball(0.09, c + Vector3(sin(a3) * 6.15, 4.6, cos(a3) * 6.15), M["glass"])
	cyl(0.06, 0.06, 1.4, c + Vector3(0, 7.9, 0), M["iron"], 6)
	box(Vector3(0.02, 0.4, 0.7), c + Vector3(0, 8.4, 0.35), M["red"])
	_out(Vector2(c.x, c.z), 9.0)


func _playground(c: Vector3) -> void:
	box(Vector3(20, 0.12, 16), c + Vector3(0, 0.02, 0), M["rubber"], true)
	# climbing tower with a slide and a roof
	var t := c + Vector3(-4, 0, -2)
	for sx: float in [-1.0, 1.0]:
		for sz: float in [-1.0, 1.0]:
			bar(t + Vector3(sx * 1.2, 0, sz * 1.2), t + Vector3(sx * 1.2, 3.6, sz * 1.2), 0.14, M["blue"])
	box(Vector3(2.6, 0.12, 2.6), t + Vector3(0, 1.6, 0), M["wood"], true)
	var roof := PrismMesh.new()
	roof.size = Vector3(3.0, 1.2, 3.0)
	_add(roof, Transform3D(Basis.IDENTITY, t + Vector3(0, 4.2, 0)), M["red"])
	var s0 := t + Vector3(1.3, 1.6, 0)
	var s1 := t + Vector3(5.0, 0.2, 0)
	var ln := s0.distance_to(s1)
	var sb := Basis(Vector3.BACK, -atan2(s0.y - s1.y, s1.x - s0.x))
	var sm := BoxMesh.new()
	sm.size = Vector3(ln, 0.06, 0.9)
	_add(sm, Transform3D(sb, (s0 + s1) * 0.5), M["yellow"])
	for sz2: float in [-0.48, 0.48]:
		bar(s0 + Vector3(0, 0.3, sz2), s1 + Vector3(0, 0.3, sz2), 0.08, M["yellow"])
	for k in 6:
		box(Vector3(0.1, 0.06, 1.0), t + Vector3(-1.3 - k * 0.0, 0.25 + k * 0.27, 0), M["green"])   # ladder rungs
	bar(t + Vector3(-1.3, 0, -0.5), t + Vector3(-1.3, 1.7, -0.5), 0.06, M["green"])
	bar(t + Vector3(-1.3, 0, 0.5), t + Vector3(-1.3, 1.7, 0.5), 0.06, M["green"])
	# swings
	var sw := c + Vector3(5, 0, 4)
	for sx3: float in [-2.2, 2.2]:
		bar(sw + Vector3(sx3, 0, -0.9), sw + Vector3(sx3, 2.6, 0), 0.1, M["red"])
		bar(sw + Vector3(sx3, 0, 0.9), sw + Vector3(sx3, 2.6, 0), 0.1, M["red"])
	bar(sw + Vector3(-2.3, 2.6, 0), sw + Vector3(2.3, 2.6, 0), 0.12, M["red"])
	for sx4: float in [-1.0, 1.0]:
		for rz in [-0.22, 0.22]:
			bar(sw + Vector3(sx4 + rz, 2.6, 0), sw + Vector3(sx4 + rz, 0.6, 0), 0.03, M["iron"])
		box(Vector3(0.6, 0.06, 0.3), sw + Vector3(sx4, 0.58, 0), M["yellow"])
	# spring riders + a sandbox
	for k2 in 3:
		var p := c + Vector3(5.0 + k2 * 1.8, 0, -4.5)
		cyl(0.12, 0.12, 0.5, p + Vector3(0, 0.3, 0), M["iron"], 8)
		box(Vector3(0.35, 0.45, 0.9), p + Vector3(0, 0.75, 0), [M["green"], M["yellow"], M["blue"]][k2])
	box(Vector3(4.0, 0.3, 4.0), c + Vector3(-5, 0.15, 5), M["wood"])
	box(Vector3(3.6, 0.1, 3.6), c + Vector3(-5, 0.27, 5), M["yellow"])
	_out(Vector2(c.x, c.z), 13.0)


func _pergola(c: Vector3) -> void:
	box(Vector3(5.0, 0.2, 12.0), c + Vector3(0, -0.02, 0), M["paving"], true)
	for sz in 5:
		for sx: float in [-2.0, 2.0]:
			box(Vector3(0.3, 2.8, 0.3), c + Vector3(sx, 1.4, -5.0 + sz * 2.5), M["wood"], true)
	for sx2: float in [-2.0, 2.0]:
		box(Vector3(0.25, 0.3, 12.4), c + Vector3(sx2, 2.95, 0), M["wood"])
	for k in 13:
		box(Vector3(5.2, 0.15, 0.15), c + Vector3(0, 3.15, -6.0 + k * 1.0), M["wood"])
	for k2 in 3:
		props["bench_park_soviet"].append(Transform3D(Basis(Vector3.UP, PI * 0.5), c + Vector3(-1.2, 0.1, -3.5 + k2 * 3.5)))
	for k3 in 10:
		trees["shrub_lilac"].append(Transform3D(Basis.IDENTITY.scaled(Vector3.ONE * 0.7), c + Vector3(2.6 if k3 % 2 == 0 else -2.6, 0.1, -5.5 + k3 * 1.2)))
	_out(Vector2(c.x, c.z), 8.0)


func _kiosk(c: Vector3, col: Material, title: String) -> void:
	box(Vector3(3.0, 2.4, 2.2), c + Vector3(0, 1.2, 0), M["white"], true)
	box(Vector3(2.6, 1.0, 0.05), c + Vector3(0, 1.5, 1.12), M["black"])
	box(Vector3(3.2, 0.12, 0.8), c + Vector3(0, 1.0, 1.4), M["wood"])
	box(Vector3(3.4, 0.5, 2.6), c + Vector3(0, 2.65, 0), col)
	text(title, c + Vector3(0, 2.65, 1.32), 48, Color(1, 1, 1), 0.007)
	# striped umbrella roof over the counter
	var u := c + Vector3(0, 0, 3.0)
	cyl(0.05, 0.05, 2.6, u + Vector3(0, 1.3, 0), M["iron"], 6)
	for k in 8:
		var a0 := k * TAU / 8.0
		var a1 := (k + 1) * TAU / 8.0
		var st := SurfaceTool.new()
		st.begin(Mesh.PRIMITIVE_TRIANGLES)
		var top := u + Vector3(0, 3.0, 0)
		var e0 := u + Vector3(sin(a0) * 1.8, 2.4, cos(a0) * 1.8)
		var e1 := u + Vector3(sin(a1) * 1.8, 2.4, cos(a1) * 1.8)
		var nrm := (e1 - top).cross(e0 - top).normalized()
		for v in [top, e1, e0, top, e0, e1]:
			st.set_normal(nrm)
			st.add_vertex(v)
		_add(st.commit(), Transform3D.IDENTITY, _roof(col if k % 2 == 0 else M["white"]))
	box(Vector3(0.8, 0.75, 0.8), u + Vector3(-1.0, 0.37, 0.6), M["white"])
	box(Vector3(0.8, 0.75, 0.8), u + Vector3(1.0, 0.37, 0.6), M["white"])
	_out(Vector2(c.x, c.z + 1.5), 4.5)


func _vegetation() -> void:
	var rng := RandomNumberGenerator.new()
	rng.seed = 2207
	# alleys of chinars along the main alley and the cross path
	for k in 6:
		for sx: float in [-1.0, 1.0]:
			trees["chinar_middle"].append(Transform3D(Basis(Vector3.UP, k * 1.7).scaled(Vector3.ONE * 0.85), Vector3(sx * 7.5, 0.1, -14.0 - k * 10.0)))
	for k2 in 7:
		for sz: float in [-1.0, 1.0]:
			for sx2: float in [-1.0, 1.0]:
				trees["thuja_cone" if k2 % 2 == 0 else "elm_a"].append(Transform3D(Basis(Vector3.UP, k2 * 2.1).scaled(Vector3.ONE * 0.85), Vector3(sx2 * (30.0 + k2 * 6.5), 0.1, sz * 6.0)))
	# free trees mostly in a belt along the fence (the middle of the park stays open, like the picture)
	var placed := 0
	for tries in 1500:
		if placed >= 46:
			break
		var p := Vector2(rng.randf_range(-H + 5, H - 5), rng.randf_range(-H + 5, FZ - 5))
		var edge := minf(H - absf(p.x), minf(p.y + H, FZ - p.y))
		if edge > 14.0 and rng.randf() > 0.15:
			continue
		if absf(p.x) < 9.0 or absf(p.y) < 6.0:
			continue
		var bad := false
		for ko in _keep_out:
			if p.distance_to(ko[0]) < float(ko[1]) + 4.0:
				bad = true
				break
		if bad or (p.y > 24.0 and absf(p.x) < 26.0):
			continue
		var id: String = ["chinar_middle", "elm_a", "thuja_cone", "chinar_middle", "thuja_cone"][rng.randi() % 5]
		trees[id].append(Transform3D(Basis(Vector3.UP, rng.randf() * TAU).scaled(Vector3.ONE * rng.randf_range(0.75, 0.95)), Vector3(p.x, 0.1, p.y)))
		_out(p, 7.0)
		placed += 1
	# low shrubs and flower beds dotted on the open lawns
	for k4 in 14:
		var q := Vector2(rng.randf_range(-60, 60), rng.randf_range(-60, 50))
		var bad2 := absf(q.x) < 8.0 or absf(q.y) < 6.0
		for ko2 in _keep_out:
			if q.distance_to(ko2[0]) < float(ko2[1]):
				bad2 = true
		if not bad2:
			_bed(Vector3(q.x, 0, q.y), Vector2(3.0, 3.0))
			_out(q, 4.0)
	# thujas along the inside of the front fence, between the beds
	for k3 in 10:
		for sx3: float in [-1.0, 1.0]:
			trees["thuja_cone"].append(Transform3D(Basis.IDENTITY.scaled(Vector3.ONE * 0.9), Vector3(sx3 * (18.0 + k3 * 5.5), 0.1, FZ - 2.5)))
