class_name PhotoPlaces
extends Node3D
## 0.25: places from the owner's reference photos, on their own plots of the world plan (places.py):
##   police     police station: two-storey white building with a blue band, the blue «ПОЛИЦИЯ» sign
##              over the entrance, an own emblem (gold shield in a ring, no real insignia), glass
##              doors, flagpole, a wrought-iron fence with a gate, a small car park
##   city_park  «Парк Дусти»: arch gate with the park's name, a sign on a stone base, paved paths,
##              a round fountain with jets in the middle, two pavilions (gazebos), flower beds,
##              benches, lamps, bins and chinar trees
## Built near the player only (lazy, like the dealership's sectors); own collision.

const BUILD_DIST := 600.0

var wd: WorldData
var sites: Array = []           ## {id, xf: Transform3D, node: Node3D}


func _ready() -> void:
	wd = WorldData.get_instance()
	if wd == null or not wd.ok:
		return
	for id in ["police", "city_park"]:
		var lm: Dictionary = wd.landmark(id)
		if lm.is_empty():
			continue
		var c := Vector3(float(lm["x"]), float(lm["y"]), float(lm["z"]))
		# local +Z (the front) towards the nearest street: the plot's yaw turned by a multiple of 90 deg
		var yaw := float(lm["yaw"])
		var to := _nearest_road(c) - c
		var best := 0
		var bd := -INF
		for k in 4:
			var fz := Vector3(sin(yaw + k * PI * 0.5), 0, cos(yaw + k * PI * 0.5))
			var d := fz.dot(Vector3(to.x, 0, to.z).normalized())
			if d > bd:
				bd = d
				best = k
		var b := Basis(Vector3.UP, yaw + best * PI * 0.5)
		sites.append({"id": id, "xf": Transform3D(b, c), "node": null, "L": float(lm["L"]), "D": float(lm["D"]) if best % 2 == 0 else float(lm["L"])})


func _nearest_road(p: Vector3) -> Vector3:
	var best := INF
	var out := p + Vector3(0, 0, 1)
	for r in wd.roads:
		if String(r["cls"]) in ["dirt", "lane"] or String(r.get("id", "")).begins_with("drive"):
			continue
		for q in r["pts"]:
			var d := Vector2(float(q[0]) - p.x, float(q[2]) - p.z).length()
			if d < best:
				best = d
				out = Vector3(float(q[0]), float(q[1]), float(q[2]))
	return out


var _t := 0.0


func _process(delta: float) -> void:
	_t -= delta
	if _t > 0.0:
		return
	_t = 1.0
	var cam := get_viewport().get_camera_3d()
	if cam == null:
		return
	var f := cam.global_position
	for s in sites:
		var d := Vector2(f.x - (s["xf"] as Transform3D).origin.x, f.z - (s["xf"] as Transform3D).origin.z).length()
		if d < BUILD_DIST and s["node"] == null:
			build_site(s)
		elif d > BUILD_DIST + 100.0 and s["node"] != null:
			(s["node"] as Node).queue_free()
			s["node"] = null


func build_site(s: Dictionary) -> void:
	var n := Node3D.new()
	n.name = String(s["id"])
	add_child(n)
	n.global_transform = s["xf"]
	s["node"] = n
	var body := StaticBody3D.new()
	body.name = "Body"
	n.add_child(body)
	var B := _Builder.new(n, body)
	if s["id"] == "police":
		_police(B, n)
	else:
		_park(B, n)


# ------------------------------------------------------------------------------------------ police
func _police(B: _Builder, n: Node3D) -> void:
	var white := B.mat(Color(0.93, 0.92, 0.88), 0.7)
	var blue := B.mat(Color(0.05, 0.22, 0.6), 0.4)
	var dark := B.mat(Color(0.12, 0.13, 0.15), 0.5, 0.3)
	var glass := B.mat(Color(0.15, 0.25, 0.32, 0.55), 0.05, 0.5)
	glass.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	var paving := PlotPatches.paving_material()
	var asphalt := B.mat(Color(0.16, 0.16, 0.17), 0.85)
	var iron := B.mat(Color(0.05, 0.05, 0.06), 0.4, 0.7)
	var gold := B.mat(Color(0.85, 0.65, 0.15), 0.3, 0.9, Color(0.4, 0.3, 0.05), 0.3)
	var granite := B.mat(Color(0.5, 0.5, 0.52), 0.5)
	# ground: paved yard, asphalt car park on the left
	B.box(Vector3(40, 0.3, 50), Vector3(0, -0.12, 0), paving, false)
	B.box(Vector3(14, 0.31, 18), Vector3(-12, -0.11, 13), asphalt, false)
	for k in 4:
		B.box(Vector3(0.12, 0.02, 4.5), Vector3(-17.5 + k * 3.0, 0.05, 13), white, false)
	# building: 28 x 14 m, two floors (8 m), front (+Z) at z = 0
	var W := 28.0
	var Dp := 14.0
	var H := 8.0
	var bz := -7.0
	B.box(Vector3(W, H, Dp), Vector3(0, H * 0.5, bz), white)
	B.box(Vector3(W + 0.6, 0.5, Dp + 0.6), Vector3(0, H + 0.25, bz), B.mat(Color(0.75, 0.75, 0.74), 0.6))
	B.box(Vector3(W + 0.05, 0.9, Dp + 0.05), Vector3(0, H - 1.1, bz), blue, false)        # blue band
	B.box(Vector3(W + 0.1, 0.5, Dp + 0.1), Vector3(0, 0.25, bz), granite, false)         # plinth
	# windows on the front and the sides, both floors
	for fl in 2:
		var wy := 2.0 + fl * 3.3
		for i in 8:
			var wx := -12.0 + i * 3.4
			if absf(wx) < 3.0 and fl == 0:
				continue
			B.box(Vector3(1.8, 1.6, 0.08), Vector3(wx, wy, bz + Dp * 0.5 + 0.03), glass, false)
			B.box(Vector3(2.0, 0.12, 0.25), Vector3(wx, wy - 0.86, bz + Dp * 0.5 + 0.1), white, false)
	# entrance: portal, glass doors, canopy, steps
	B.box(Vector3(6.4, 4.2, 1.2), Vector3(0, 2.1, bz + Dp * 0.5 + 0.6), white)
	B.box(Vector3(4.6, 3.0, 0.1), Vector3(0, 1.8, bz + Dp * 0.5 + 1.22), glass, false)
	B.box(Vector3(0.1, 3.0, 0.14), Vector3(0, 1.8, bz + Dp * 0.5 + 1.25), dark, false)
	B.box(Vector3(8.0, 0.35, 3.4), Vector3(0, 4.4, bz + Dp * 0.5 + 1.7), dark, false)
	for k in 3:
		B.box(Vector3(7.0 - k * 0.6, 0.16, 3.0 - k * 0.8), Vector3(0, 0.08 + k * 0.16, bz + Dp * 0.5 + 1.5 + (2.0 - k * 0.4)), granite)
	# the blue sign «ПОЛИЦИЯ» over the canopy + the emblem
	B.box(Vector3(9.0, 1.5, 0.25), Vector3(0, 5.6, bz + Dp * 0.5 + 0.9), blue, false)
	B.text("ПОЛИЦИЯ", Vector3(0, 5.6, bz + Dp * 0.5 + 1.04), 150, Color(1, 1, 1), 0.01)
	B.text("POLITSIYA · МИЛИТСИЯ", Vector3(0, 4.95, bz + Dp * 0.5 + 1.04), 40, Color(0.85, 0.9, 1.0), 0.008)
	# emblem: a gold ring with a blue shield and a gold star (own design)
	var em := Node3D.new()
	em.position = Vector3(0, 7.1, bz + Dp * 0.5 + 0.2)
	n.add_child(em)
	var ring := MeshInstance3D.new()
	var tm := TorusMesh.new()
	tm.inner_radius = 0.55
	tm.outer_radius = 0.7
	ring.mesh = tm
	ring.material_override = gold
	ring.rotation.x = PI * 0.5
	em.add_child(ring)
	var shield := MeshInstance3D.new()
	var sm := PrismMesh.new()
	sm.size = Vector3(0.8, 0.95, 0.1)
	shield.mesh = sm
	shield.material_override = blue
	shield.rotation.z = PI
	shield.position = Vector3(0, -0.05, 0.05)
	em.add_child(shield)
	B.text("★", Vector3(0, 7.15, bz + Dp * 0.5 + 0.33), 90, Color(1.0, 0.8, 0.2), 0.006)
	# flagpoles beside the entrance
	if OpenWorld.instance:
		var props := {"flagpole": [], "bench_modern_metal": [], "bin_modern_steel": [], "light_park_4m": []}
		for sx in [-5.5, 5.5]:
			props["flagpole"].append(n.global_transform * Transform3D(Basis.IDENTITY, Vector3(sx, 0.05, 4.0)))
		props["bench_modern_metal"].append(n.global_transform * Transform3D(Basis(Vector3.UP, PI), Vector3(8.0, 0.05, 2.5)))
		props["bin_modern_steel"].append(n.global_transform * Transform3D(Basis.IDENTITY, Vector3(9.8, 0.05, 2.5)))
		for p in [Vector3(-6, 0.05, 20), Vector3(6, 0.05, 20), Vector3(-17, 0.05, 6), Vector3(15, 0.05, 10)]:
			props["light_park_4m"].append(n.global_transform * Transform3D(Basis.IDENTITY, p))
		var holder := Node3D.new()
		holder.name = "Props"
		add_child(holder)
		n.tree_exiting.connect(holder.queue_free)
		OpenWorld.instance._place_props(holder, props)
		var trees := {"thuja_cone": [], "chinar_middle": []}
		for sx in [-13.0, -9.0, 9.0, 13.0]:
			trees["thuja_cone"].append(n.global_transform * Transform3D(Basis.IDENTITY.scaled(Vector3.ONE * 0.9), Vector3(sx, 0.05, 1.6)))
		for p in [Vector3(16, 0.05, -18), Vector3(-16, 0.05, -18), Vector3(17, 0.05, 18)]:
			trees["chinar_middle"].append(n.global_transform * Transform3D(Basis.IDENTITY.scaled(Vector3.ONE * 0.85), p))
		OpenWorld.instance._trees(holder, trees, 0)
	# wrought-iron fence along the front (gate gap in the middle and the car-park entrance) and the sides
	var fz := 24.0
	B.fence(Vector3(-19.5, 0, fz), Vector3(-6.0, 0, fz), iron, gold)
	B.fence(Vector3(4.0, 0, fz), Vector3(19.5, 0, fz), iron, gold)
	B.fence(Vector3(-19.5, 0, fz), Vector3(-19.5, 0, -24.0), iron, gold)
	B.fence(Vector3(19.5, 0, fz), Vector3(19.5, 0, -24.0), iron, gold)
	B.fence(Vector3(-19.5, 0, -24.0), Vector3(19.5, 0, -24.0), iron, gold)
	for gx in [-6.0, -3.0, 1.0, 4.0]:
		B.box(Vector3(0.5, 2.6, 0.5), Vector3(gx, 1.3, fz), white)
		B.box(Vector3(0.6, 0.15, 0.6), Vector3(gx, 2.65, fz), granite, false)
	B.text("ПОЛИЦИЯ", Vector3(-4.5, 2.1, fz + 0.3), 44, Color(1, 1, 1), 0.006, blue)


# ------------------------------------------------------------------------------------------ park
func _park(B: _Builder, n: Node3D) -> void:
	var paving := PlotPatches.paving_material()
	var stone := B.mat(Color(0.86, 0.82, 0.74), 0.6)
	var dark := B.mat(Color(0.3, 0.27, 0.24), 0.6)
	var gold := B.mat(Color(0.88, 0.68, 0.18), 0.3, 0.9, Color(0.45, 0.32, 0.05), 0.35)
	var blue_t := B.mat(Color(0.08, 0.38, 0.6), 0.3)
	var water := B.mat(Color(0.12, 0.4, 0.55, 0.75), 0.02, 0.2)
	water.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	var wood := B.mat(Color(0.45, 0.28, 0.14), 0.7)
	var roof := B.mat(Color(0.1, 0.42, 0.35), 0.5, 0.2)
	# lawn + paths: the main alley from the gate (+Z) to the fountain, the ring round it, cross paths
	B.box(Vector3(8, 0.24, 50), Vector3(0, -0.04, 25), paving, false)
	B.box(Vector3(8, 0.24, 50), Vector3(0, -0.04, -25), paving, false)
	B.box(Vector3(100, 0.24, 6), Vector3(0, -0.04, 0), paving, false)
	B.cyl(18.0, 0.25, Vector3(0, -0.035, 0), paving, false)
	# fountain: two-tier round basin, water, central column with bowls and water jets
	B.cyl(8.8, 0.3, Vector3(0, 0.15, 0), stone)
	B.cyl(8.6, 0.06, Vector3(0, 0.52, 0), water, false)
	for k in 32:
		var a := k * TAU / 32.0
		B.box(Vector3(1.8, 0.75, 0.55), Vector3(sin(a) * 8.9, 0.37, cos(a) * 8.9), stone, true, a)
	B.cyl(2.0, 1.6, Vector3(0, 1.2, 0), stone)
	B.cyl(3.2, 0.3, Vector3(0, 2.1, 0), stone, false)
	B.cyl(3.0, 0.06, Vector3(0, 2.26, 0), water, false)
	B.cyl(0.6, 2.2, Vector3(0, 3.2, 0), stone, false)
	B.cyl(1.3, 0.25, Vector3(0, 4.3, 0), gold, false)
	_jets(n, Vector3(0, 4.4, 0), 1.0, 5.5, 160)
	for k in 8:
		var a := k * TAU / 8.0
		_jets(n, Vector3(sin(a) * 7.0, 0.65, cos(a) * 7.0), 0.15, 3.2, 14, -Vector3(sin(a), 0, cos(a)))
	# the arch gate at the front edge (+Z): two pillars, the arch beam with the name, gold ornament
	var gz := 47.0
	for sx in [-6.0, 6.0]:
		B.box(Vector3(2.4, 9.0, 2.4), Vector3(sx, 4.5, gz), stone)
		B.box(Vector3(2.9, 0.6, 2.9), Vector3(sx, 0.3, gz), dark)
		B.box(Vector3(2.8, 0.5, 2.8), Vector3(sx, 9.25, gz), dark, false)
		B.box(Vector3(1.6, 0.9, 1.6), Vector3(sx, 9.9, gz), gold, false)
	B.box(Vector3(14.4, 2.2, 2.0), Vector3(0, 8.3, gz), stone, false)
	B.box(Vector3(14.6, 0.35, 2.2), Vector3(0, 9.55, gz), dark, false)
	# the arch: a half ring of stone voussoirs between the pillars (radius 4.8 m, springing at 4.6 m)
	for k in 13:
		var a := PI * (k + 0.5) / 13.0
		var vb := B.box(Vector3(1.25, 0.75, 1.6), Vector3(cos(a) * 4.85, 4.6 + sin(a) * 2.9, gz), stone, false)
		vb.rotation.z = atan2(2.9 * cos(a), -4.85 * sin(a)) + PI * 0.5
	B.box(Vector3(1.0, 0.9, 1.7), Vector3(0, 7.55, gz), gold, false)          # keystone
	for side: float in [1.0, -1.0]:
		B.box(Vector3(10.5, 1.0, 0.06), Vector3(0, 8.4, gz + side * 1.03), blue_t, false)
		B.text("ПАРК ДУСТИ", Vector3(0, 8.4, gz + side * 1.07), 110, Color(1.0, 0.85, 0.35), 0.0085, null, side < 0)
	# the park sign on a stone base beside the gate
	B.box(Vector3(5.0, 0.8, 1.2), Vector3(11.5, 0.4, gz - 1.0), stone)
	B.box(Vector3(4.6, 1.6, 0.3), Vector3(11.5, 1.6, gz - 1.0), dark, false)
	B.text("ПАРК ДУСТИ\nPARKI DŪSTĪ", Vector3(11.5, 1.6, gz - 0.83), 56, Color(1.0, 0.85, 0.4), 0.007)
	# two pavilions (octagonal gazebos) on the cross path
	for sx in [-30.0, 30.0]:
		var c := Vector3(sx, 0, 0)
		B.cyl(4.2, 0.35, c + Vector3(0, 0.17, 0), stone)
		for k in 8:
			var a := k * TAU / 8.0
			B.cyl(0.16, 3.2, c + Vector3(sin(a) * 3.6, 1.95, cos(a) * 3.6), wood)
		B.cyl(4.3, 0.3, c + Vector3(0, 3.6, 0), wood, false)
		var cone := MeshInstance3D.new()
		var cm := CylinderMesh.new()
		cm.top_radius = 0.2
		cm.bottom_radius = 4.8
		cm.height = 2.4
		cm.radial_segments = 8
		cone.mesh = cm
		cone.material_override = roof
		cone.position = c + Vector3(0, 4.95, 0)
		n.add_child(cone)
		B.box(Vector3(0.5, 0.5, 0.5), c + Vector3(0, 6.3, 0), gold, false)
	# flower beds along the main alley, benches, lamps, bins, chinar trees round the edge
	if OpenWorld.instance:
		var props := {"bench_park_soviet": [], "light_park_4m": [], "bin_modern_steel": [], "urn_concrete_round": []}
		var trees := {"chinar_mature": [], "chinar_middle": [], "flowers_petunia": [], "flowers_salvia": [], "flowers_marigold": [], "thuja_cone": [], "rose_bush": []}
		var g := n.global_transform
		for k in 4:
			var z := 41.0 - k * 7.0
			for sx: float in [-1.0, 1.0]:
				props["bench_park_soviet"].append(g * Transform3D(Basis(Vector3.UP, -sx * PI * 0.5), Vector3(sx * 5.2, 0.1, z)))
				props["light_park_4m"].append(g * Transform3D(Basis.IDENTITY, Vector3(sx * 4.6, 0.1, z - 3.5)))
				for fk in 3:
					var fl: String = ["flowers_petunia", "flowers_salvia", "flowers_marigold"][(k + fk) % 3]
					trees[fl].append(g * Transform3D(Basis.IDENTITY, Vector3(sx * (7.0 + fk * 0.8), 0.1, z - 1.0 + fk * 0.9)))
			if k % 2 == 0:
				props["bin_modern_steel"].append(g * Transform3D(Basis.IDENTITY, Vector3(5.0, 0.1, z - 1.8)))
		for k in 12:
			var a := k * TAU / 12.0
			trees["rose_bush"].append(g * Transform3D(Basis.IDENTITY, Vector3(sin(a) * 10.5, 0.1, cos(a) * 10.5)))
			if k % 3 == 1:
				props["bench_park_soviet"].append(g * Transform3D(Basis(Vector3.UP, a + PI), Vector3(sin(a) * 15.5, 0.1, cos(a) * 15.5)))
			if k % 2 == 0:
				props["light_park_4m"].append(g * Transform3D(Basis.IDENTITY, Vector3(sin(a + 0.26) * 17.0, 0.1, cos(a + 0.26) * 17.0)))
		for sx in [-9.5, 9.5]:
			props["urn_concrete_round"].append(g * Transform3D(Basis.IDENTITY, Vector3(sx, 0.1, gz - 2.5)))
		var rng := RandomNumberGenerator.new()
		rng.seed = 77
		for k in 64:
			var p := Vector3(rng.randf_range(-47, 47), 0.1, rng.randf_range(-47, 44))
			if absf(p.x) < 7.0 or absf(p.z) < 6.0 or p.length() < 21.0 or (absf(absf(p.x) - 30.0) < 7.0 and absf(p.z) < 7.0):
				continue
			var id: String = "chinar_mature" if k % 3 == 0 else ("chinar_middle" if k % 3 == 1 else "thuja_cone")
			trees[id].append(g * Transform3D(Basis(Vector3.UP, rng.randf() * TAU).scaled(Vector3.ONE * rng.randf_range(0.8, 1.05)), p))
		var holder := Node3D.new()
		holder.name = "ParkProps"
		add_child(holder)
		n.tree_exiting.connect(holder.queue_free)
		OpenWorld.instance._place_props(holder, props)
		OpenWorld.instance._trees(holder, trees, 0)


## water jets: cheap CPU particles (mobile), arcs from p in direction dir (or straight up)
func _jets(parent: Node3D, p: Vector3, spread: float, speed: float, amount: int, dir := Vector3.ZERO) -> void:
	var cp := CPUParticles3D.new()
	cp.position = p
	cp.amount = amount
	cp.lifetime = 1.2
	cp.direction = (Vector3.UP * 1.5 + dir).normalized()
	cp.spread = 12.0 if dir != Vector3.ZERO else 25.0
	cp.initial_velocity_min = speed * 0.85
	cp.initial_velocity_max = speed
	cp.gravity = Vector3(0, -9.8, 0)
	cp.emission_shape = CPUParticles3D.EMISSION_SHAPE_SPHERE
	cp.emission_sphere_radius = spread * 0.3
	cp.scale_amount_min = 0.6
	cp.scale_amount_max = 1.0
	var qm := QuadMesh.new()
	qm.size = Vector2(0.12, 0.12)
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED
	m.albedo_color = Color(0.85, 0.93, 1.0, 0.55)
	qm.material = m
	cp.mesh = qm
	cp.visibility_range_end = 160.0
	parent.add_child(cp)


## mesh / collision helper (local coordinates of the site node)
class _Builder:
	var n: Node3D
	var body: StaticBody3D

	func _init(node: Node3D, b: StaticBody3D) -> void:
		n = node
		body = b

	func mat(col: Color, rough := 0.8, metal := 0.0, emit := Color.BLACK, emit_e := 1.0) -> StandardMaterial3D:
		var m := StandardMaterial3D.new()
		m.albedo_color = col
		m.roughness = rough
		m.metallic = metal
		if emit != Color.BLACK:
			m.emission_enabled = true
			m.emission = emit
			m.emission_energy_multiplier = emit_e
		return m

	func box(size: Vector3, pos: Vector3, m: Material, solid := true, yaw := 0.0) -> MeshInstance3D:
		var mi := MeshInstance3D.new()
		var bm := BoxMesh.new()
		bm.size = size
		mi.mesh = bm
		mi.material_override = m
		mi.position = pos
		mi.rotation.y = yaw
		mi.visibility_range_end = 700.0
		n.add_child(mi)
		if solid or size.y < 0.4:
			var cs := CollisionShape3D.new()
			var bx := BoxShape3D.new()
			bx.size = size
			cs.shape = bx
			cs.position = pos
			cs.rotation.y = yaw
			body.add_child(cs)
		return mi

	func cyl(r: float, h: float, pos: Vector3, m: Material, solid := true) -> void:
		var mi := MeshInstance3D.new()
		var cm := CylinderMesh.new()
		cm.top_radius = r
		cm.bottom_radius = r
		cm.height = h
		cm.radial_segments = 32 if r > 2.0 else 12
		mi.mesh = cm
		mi.material_override = m
		mi.position = pos
		mi.visibility_range_end = 700.0
		n.add_child(mi)
		if solid:
			var cs := CollisionShape3D.new()
			var cy := CylinderShape3D.new()
			cy.radius = r
			cy.height = h
			cs.shape = cy
			cs.position = pos
			body.add_child(cs)

	func text(t: String, pos: Vector3, size: int, col: Color, px: float, bg: Material = null, flip := false) -> void:
		var l := Label3D.new()
		l.text = t
		l.font = load("res://assets/fonts/DejaVuSans-Bold.ttf")
		l.font_size = size
		l.pixel_size = px
		l.modulate = col
		l.outline_size = 0
		l.position = pos
		l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		l.visibility_range_end = 260.0
		if flip:
			l.rotation.y = PI
		n.add_child(l)
		if bg:
			box(Vector3(px * size * t.length() * 0.62 + 0.3, px * size * 1.5, 0.05), pos - Vector3(0, 0, 0.04), bg, false)

	## wrought-iron fence a -> b: posts every 2.4 m, rails, bars every 0.15 m with gold tips (MultiMesh)
	func fence(a: Vector3, b: Vector3, iron: Material, gold: Material) -> void:
		var d := b - a
		var ln := d.length()
		var dirv := d / ln
		var yaw := atan2(dirv.x, dirv.z)
		var mid := (a + b) * 0.5
		for y in [0.3, 1.75]:
			var r := box(Vector3(0.05, 0.06, ln), mid + Vector3(0, y, 0), iron, false)
			r.rotation.y = yaw
		var cs := CollisionShape3D.new()
		var bx := BoxShape3D.new()
		bx.size = Vector3(0.12, 2.0, ln)
		cs.shape = bx
		cs.position = mid + Vector3(0, 1.0, 0)
		cs.rotation.y = yaw
		body.add_child(cs)
		var bars := int(ln / 0.15)
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		var bm := BoxMesh.new()
		bm.size = Vector3(0.025, 1.9, 0.025)
		bm.material = iron
		mm.mesh = bm
		mm.instance_count = bars
		var tips := MultiMesh.new()
		tips.transform_format = MultiMesh.TRANSFORM_3D
		var pm := PrismMesh.new()
		pm.size = Vector3(0.06, 0.12, 0.03)
		pm.material = gold
		tips.mesh = pm
		tips.instance_count = bars
		for i in bars:
			var p := a + dirv * (i + 0.5) * 0.15
			mm.set_instance_transform(i, Transform3D(Basis(Vector3.UP, yaw), p + Vector3(0, 0.95, 0)))
			tips.set_instance_transform(i, Transform3D(Basis(Vector3.UP, yaw), p + Vector3(0, 1.96, 0)))
		for m2 in [mm, tips]:
			var mmi := MultiMeshInstance3D.new()
			mmi.multimesh = m2
			mmi.visibility_range_end = 220.0
			n.add_child(mmi)
		var posts := int(ln / 2.4) + 1
		for i in posts + 1:
			var p := a + dirv * minf(i * 2.4, ln)
			box(Vector3(0.1, 2.1, 0.1), p + Vector3(0, 1.05, 0), iron, false)
