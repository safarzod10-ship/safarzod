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
	for id in ["police", "city_park", "shop_street"]:
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
			if id == "shop_street" and k % 2 == 1:
				continue                  # the long street axis stays along local Z (an end faces the road)
			var fz := Vector3(sin(yaw + k * PI * 0.5), 0, cos(yaw + k * PI * 0.5))
			var d := fz.dot(Vector3(to.x, 0, to.z).normalized())
			if d > bd:
				bd = d
				best = k
		var b := Basis(Vector3.UP, yaw + best * PI * 0.5)
		sites.append({"id": id, "xf": Transform3D(b, c), "node": null, "L": float(lm["L"]), "D": float(lm["D"]) if best % 2 == 0 else float(lm["L"])})
	# the two-arch bridge over the Varzob (avenue ew2400) with the embankment
	for r in wd.roads:
		if String(r.get("id", "")) == "ew2400" and not (r.get("bridges", []) as Array).is_empty():
			var bb: Array = r["bridges"][0]
			var pa := Vector3(r["pts"][bb[0]][0], r["pts"][bb[0]][1], r["pts"][bb[0]][2])
			var pb := Vector3(r["pts"][bb[1]][0], r["pts"][bb[1]][1], r["pts"][bb[1]][2])
			sites.append({"id": "river_bridge", "xf": Transform3D(Basis.IDENTITY, (pa + pb) * 0.5), "node": null,
					"a": pa, "b": pb, "w": float(r["w"])})


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
	if s.has("D") and s["id"] != "river_bridge":
		_apron(n, body, s)
	if s["id"] == "police":
		_police(B, n)
	elif s["id"] == "shop_street":
		_shop_street(B, n)
	elif s["id"] == "river_bridge":
		_bridge(B, n, s)
	else:
		_park(B, n)


# ------------------------------------------------------------------------------------------ apron
## a paved ramp from the plot's front edge (local +Z) to the outer edge of the street's sidewalk, so the
## plaza meets the sidewalk at one level (no grass strip, no step); collision included
func _apron(n: Node3D, body: StaticBody3D, s: Dictionary) -> void:
	var xf: Transform3D = s["xf"]
	var half_d := float(s["D"]) * 0.5
	var w := minf(float(s["L"]), 30.0)
	var front := xf * Vector3(0, 0.08, half_d)
	var fwd := xf.basis.z
	fwd.y = 0.0
	fwd = fwd.normalized()
	# the street in front: march out from the plot until the road's sidewalk
	var best := INF
	var rp := Vector3.ZERO
	var rhw := 6.0
	for r in wd.roads:
		if String(r["cls"]) in ["dirt", "lane"] or String(r.get("id", "")).begins_with("drive"):
			continue
		for q in r["pts"]:
			var qv := Vector3(float(q[0]), float(q[1]), float(q[2]))
			var rel := qv - front
			rel.y = 0.0
			var along := rel.dot(fwd)
			if along < 0.0 or along > 60.0 or absf(rel.dot(fwd.cross(Vector3.UP))) > 30.0:
				continue
			if along < best:
				best = along
				rp = qv
				rhw = float(r["w"]) * 0.5
	if best == INF:
		return
	var dist := best - rhw - 3.5                     # to the outer edge of the sidewalk
	if dist < 0.3:
		return
	var y_end := rp.y + 0.07 + 0.15                   # road lift + sidewalk kerb
	var side := fwd.cross(Vector3.UP)
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var faces := PackedVector3Array()
	var steps := maxi(2, int(dist / 2.0))
	var inv := n.global_transform.affine_inverse()
	for k in steps:
		var t0 := float(k) / steps
		var t1 := float(k + 1) / steps
		var p0 := front + fwd * (dist * t0 - 0.3)
		var p1 := front + fwd * (dist * t1 + (0.6 if k == steps - 1 else 0.0))
		p0.y = lerpf(front.y, y_end, t0) + 0.02
		p1.y = lerpf(front.y, y_end, t1) + 0.02
		var a := inv * (p0 - side * w * 0.5)
		var b := inv * (p0 + side * w * 0.5)
		var c := inv * (p1 + side * w * 0.5)
		var d := inv * (p1 - side * w * 0.5)
		for tri in [[a, c, b], [a, d, c]]:
			for v in tri:
				st.add_vertex(v)
				faces.append(v)
	st.generate_normals()
	var mi := MeshInstance3D.new()
	mi.name = "Apron"
	mi.mesh = st.commit()
	mi.material_override = PlotPatches.paving_material()
	mi.visibility_range_end = 600.0
	n.add_child(mi)
	var cs := CollisionShape3D.new()
	var sh := ConcavePolygonShape3D.new()
	sh.set_faces(faces)
	cs.shape = sh
	body.add_child(cs)


# ------------------------------------------------------------------------------------------ bridge
## two white steel arches over the bridge (one each side of the deck), hangers down to the deck edges,
## braces across the top, LED strips (lit at night); the river embankment both sides 160 m up and
## down: paving, a wrought railing on the water side, lamps, benches, plane trees
func _bridge(B: _Builder, n: Node3D, st: Dictionary) -> void:
	var c: Vector3 = (st["xf"] as Transform3D).origin
	var a: Vector3 = st["a"] - c
	var b: Vector3 = st["b"] - c
	var along := (b - a)
	along.y = 0.0
	var span := along.length()
	along = along.normalized()
	var side := along.cross(Vector3.UP)
	var hw := float(st["w"]) * 0.5 + 0.9
	var white := B.mat(Color(0.93, 0.94, 0.95), 0.35, 0.4)
	var led := B.mat(Color(0.6, 0.85, 1.0), 0.4, 0.0, Color(0.4, 0.75, 1.0), 2.0)
	var cable := B.mat(Color(0.75, 0.76, 0.78), 0.3, 0.8)
	var rise := 16.0
	var segs := 28
	for sd: float in [-1.0, 1.0]:
		var prev := Vector3.INF
		for i in segs + 1:
			var u := float(i) / segs
			var p := a.lerp(b, u) + side * hw * sd + Vector3.UP * (4.0 * rise * u * (1.0 - u) + 0.2)
			if prev != Vector3.INF:
				var mid := (p + prev) * 0.5
				var dv := p - prev
				var seg := MeshInstance3D.new()
				var bm := BoxMesh.new()
				bm.size = Vector3(0.7, 0.9, dv.length() + 0.08)
				seg.mesh = bm
				seg.material_override = white
				seg.transform = Transform3D(Basis.looking_at(dv.normalized(), Vector3.UP), mid)
				seg.visibility_range_end = 900.0
				n.add_child(seg)
				var strip := MeshInstance3D.new()
				var sm := BoxMesh.new()
				sm.size = Vector3(0.12, 0.12, dv.length())
				strip.mesh = sm
				strip.material_override = led
				strip.transform = Transform3D(Basis.looking_at(dv.normalized(), Vector3.UP), mid + side * sd * 0.38)
				n.add_child(strip)
			prev = p
		# hangers every 3 m
		for k in range(1, int(span / 3.0)):
			var u2 := float(k) * 3.0 / span
			if u2 >= 0.97:
				break
			var top := a.lerp(b, u2) + side * hw * sd + Vector3.UP * (4.0 * rise * u2 * (1.0 - u2))
			var bot := a.lerp(b, u2) + side * hw * sd + Vector3.UP * 0.3
			var hl := top.y - bot.y
			if hl < 0.6:
				continue
			var h := MeshInstance3D.new()
			var cm := CylinderMesh.new()
			cm.top_radius = 0.05
			cm.bottom_radius = 0.05
			cm.height = hl
			cm.radial_segments = 6
			h.mesh = cm
			h.material_override = cable
			h.position = (top + bot) * 0.5
			n.add_child(h)
		# arch feet: concrete plinths at both ends
		for e in [a, b]:
			B.box(Vector3(1.6, 1.4, 1.6), (e as Vector3) + side * hw * sd + Vector3(0, 0.5, 0), B.mat(Color(0.7, 0.7, 0.68), 0.7))
	# braces across the crown
	for u3: float in [0.35, 0.5, 0.65]:
		var mid2 := a.lerp(b, u3) + Vector3.UP * (4.0 * rise * u3 * (1.0 - u3))
		var br := MeshInstance3D.new()
		var bm2 := BoxMesh.new()
		bm2.size = Vector3(hw * 2.0, 0.4, 0.4)
		br.mesh = bm2
		br.material_override = white
		br.transform = Transform3D(Basis.looking_at(along, Vector3.UP), mid2)
		n.add_child(br)
	# the embankment along the river
	var rv: Dictionary = {}
	for r in wd.rivers:
		if String(r.get("id", "")) == "varzob":
			rv = r
	if rv.is_empty():
		return
	var pts: Array = rv["pts"]
	var rw := float(rv["w"]) * 0.5
	var bi := 0
	var bd := INF
	for i in pts.size():
		var d := Vector2(float(pts[i][0]) - c.x, float(pts[i][2]) - c.z).length()
		if d < bd:
			bd = d
			bi = i
	var iron := B.mat(Color(0.05, 0.05, 0.06), 0.4, 0.7)
	var gold := B.mat(Color(0.8, 0.62, 0.2), 0.3, 0.9)
	var paving := PlotPatches.paving_material()
	var props := {"light_park_4m": [], "bench_park_soviet": [], "bin_modern_steel": []}
	var trees := {"chinar_middle": []}
	for sd2: float in [-1.0, 1.0]:
		var prevp := Vector3.INF
		for i in range(maxi(1, bi - 40), mini(pts.size() - 1, bi + 40)):
			var q := Vector3(float(pts[i][0]), 0, float(pts[i][2]))
			var q1 := Vector3(float(pts[i + 1][0]), 0, float(pts[i + 1][2]))
			var dir := (q1 - q).normalized()
			var nrm := dir.cross(Vector3.UP) * sd2
			var edge := q + nrm * (rw + 1.0)
			# keep the road and its sidewalks free: nothing within (half width + 8 m) of the road's axis
			var rel2 := Vector3(edge.x - c.x, 0, edge.z - c.z)
			var walk_rel := rel2 + nrm * 7.0
			if absf(rel2.dot(side)) < hw + 8.0 or absf(walk_rel.dot(side)) < hw + 8.0:
				prevp = Vector3.INF
				continue
			edge.y = wd.height_at(edge.x, edge.z) + 0.05
			var walk := edge + nrm * 2.5
			walk.y = wd.height_at(walk.x, walk.z) + 0.05
			if prevp != Vector3.INF and prevp.distance_to(edge) < 12.0:
				var lp := prevp - c
				var le := edge - c
				B.fence(lp, le, iron, gold)
				var mid3 := (lp + le) * 0.5 + nrm * 2.5
				var pv := MeshInstance3D.new()
				var pm := BoxMesh.new()
				pm.size = Vector3(5.0, 0.2, lp.distance_to(le) + 0.3)
				pm.material = paving
				pv.mesh = pm
				pv.transform = Transform3D(Basis.looking_at((le - lp).normalized(), Vector3.UP), mid3 + Vector3(0, -0.02, 0))
				pv.visibility_range_end = 500.0
				n.add_child(pv)
			prevp = edge
			if i % 3 == 0:
				props["light_park_4m"].append(Transform3D(Basis.IDENTITY, walk + nrm * 2.2))
			if i % 5 == 1:
				props["bench_park_soviet"].append(Transform3D(Basis(Vector3.UP, atan2(-nrm.x, -nrm.z)), walk + nrm * 1.6))
			if i % 7 == 3:
				props["bin_modern_steel"].append(Transform3D(Basis.IDENTITY, walk + nrm * 1.8 + dir * 1.2))
			if i % 2 == 0:
				trees["chinar_middle"].append(Transform3D(Basis(Vector3.UP, float(i)).scaled(Vector3.ONE * 0.8), walk + nrm * 4.5))
	if OpenWorld.instance:
		var holder := Node3D.new()
		holder.name = "BridgeProps"
		add_child(holder)
		n.tree_exiting.connect(holder.queue_free)
		OpenWorld.instance._place_props(holder, props)
		OpenWorld.instance._trees(holder, trees, 0)


# ------------------------------------------------------------------------------------------ shop street
## own shop names (no real brands): bakery, tea house, pharmacy, flowers, gold, national dress, shoes,
## phones, books, sweets, plov, atlas silk, souvenirs, cafe, fruit, optics
const SHOPS := [["НОНВОЙХОНА", "нон · самбуса", Color(0.85, 0.55, 0.2)], ["ЧОЙХОНАИ РОҲАТ", "чой · ош", Color(0.1, 0.45, 0.35)],
	["ДОРУХОНА", "аптека 24/7", Color(0.1, 0.6, 0.3)], ["ГУЛФУРӮШӢ", "цветы", Color(0.85, 0.3, 0.5)],
	["ТИЛЛО", "золото · ювелирные", Color(0.7, 0.55, 0.15)], ["ЛИБОСИ МИЛЛӢ", "атлас · адрас", Color(0.55, 0.15, 0.45)],
	["ПОЙАФЗОЛ", "обувь", Color(0.35, 0.25, 0.2)], ["МОБАЙЛ СИТИ", "телефоны", Color(0.15, 0.35, 0.8)],
	["КИТОБ", "книги", Color(0.45, 0.3, 0.15)], ["ШИРИНӢ", "сладости", Color(0.9, 0.35, 0.35)],
	["ОШХОНА", "плов · лагман", Color(0.75, 0.3, 0.1)], ["АТЛАС", "ткани", Color(0.2, 0.3, 0.7)],
	["СУВЕНИР", "подарки", Color(0.6, 0.45, 0.2)], ["КАФЕ ПОМИР", "кофе · десерты", Color(0.3, 0.2, 0.15)],
	["МЕВА", "фрукты", Color(0.4, 0.65, 0.15)], ["ОПТИКА", "очки", Color(0.25, 0.4, 0.55)]]


func _shop_street(B: _Builder, n: Node3D) -> void:
	## a pedestrian street 14 m wide along local Z (front end +Z at the road), two rows of two-storey
	## shops (10 m units): plaster facades in warm colours, a full-width lit shop window, a name board,
	## a striped awning, upper windows with balconies; down the middle planters with plane trees,
	## benches, ornate lamps; strings of lights across; a gate arch «СОМОН» at both ends
	var paving := PlotPatches.paving_material()
	var stone := B.mat(Color(0.88, 0.84, 0.76), 0.6)
	var dark := B.mat(Color(0.15, 0.14, 0.13), 0.6)
	var glass := B.mat(Color(0.2, 0.28, 0.32, 0.35), 0.05, 0.4)
	glass.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	var lit := B.mat(Color(1.0, 0.92, 0.75), 0.8, 0.0, Color(1.0, 0.85, 0.6), 0.9)
	var shelf := B.mat(Color(0.35, 0.25, 0.18), 0.7)
	var roofing := B.mat(Color(0.32, 0.3, 0.29), 0.9)
	var metal := B.mat(Color(0.75, 0.77, 0.8), 0.4, 0.6)
	var win := B.mat(Color(0.25, 0.35, 0.45), 0.1, 0.3)
	var Lh := 85.0
	B.box(Vector3(44, 0.24, 170), Vector3(0, -0.04, 0), paving, false)
	var walls := [Color(0.93, 0.86, 0.72), Color(0.86, 0.78, 0.66), Color(0.95, 0.9, 0.82), Color(0.82, 0.74, 0.62), Color(0.9, 0.8, 0.7)]
	var font: Font = load("res://assets/fonts/game_font.tres")
	var k := 0
	for side: float in [-1.0, 1.0]:
		for i in 15:
			var z := -Lh + 8.0 + i * 10.6
			var sh: Array = SHOPS[k % SHOPS.size()]
			k += 1
			var fx := side * 7.0                           # the shop front line
			var bx := side * 13.0                          # building centre (12 m deep)
			var wall := B.mat(walls[(i + (2 if side > 0 else 0)) % walls.size()], 0.85)
			var h := 8.0 if i % 3 != 1 else 9.5
			# upper floors on top of an open ground floor: the shop is a real room behind the glass
			B.box(Vector3(12.0, h - 3.4, 10.0), Vector3(bx, (h + 3.4) * 0.5, z), wall)
			# roof: dark roofing, parapet, AC units, a water tank / dish now and then (outside detail)
			B.box(Vector3(12.0, 0.08, 10.0), Vector3(bx, h + 0.04, z), roofing, false)
			for e: Array in [[Vector3(12.2, 0.6, 0.25), Vector3(0, 0, 5.0)], [Vector3(12.2, 0.6, 0.25), Vector3(0, 0, -5.0)],
					[Vector3(0.25, 0.6, 10.2), Vector3(6.0, 0, 0)], [Vector3(0.25, 0.6, 10.2), Vector3(-6.0, 0, 0)]]:
				B.box(e[0], Vector3(bx, h + 0.3, z) + (e[1] as Vector3), stone, false)
			for ac in 2:
				B.box(Vector3(0.9, 0.6, 0.7), Vector3(bx + side * (1.5 + ac * 2.5), h + 0.35, z - 2.0 + ac * 3.0), metal, false)
				B.box(Vector3(0.6, 0.05, 0.6), Vector3(bx + side * (1.5 + ac * 2.5), h + 0.66, z - 2.0 + ac * 3.0), dark, false)
			if i % 3 == 0:
				B.cyl(0.7, 1.4, Vector3(bx + side * 3.5, h + 0.9, z + 2.5), metal, false)
			elif i % 3 == 2:
				var dish := MeshInstance3D.new()
				var dm := SphereMesh.new()
				dm.radius = 0.45
				dm.height = 0.3
				dish.mesh = dm
				dish.material_override = stone
				dish.position = Vector3(bx - side * 2.0, h + 0.75, z)
				dish.rotation.z = side * 0.6
				n.add_child(dish)
			# the end buildings show their side to the street ends: windows, a cornice band and a vertical sign
			if i == 0 or i == 14:
				var ez := z + (5.02 if i == 14 else -5.02)
				var ef := 1.0 if i == 14 else -1.0
				for wy in [5.0, 7.0]:
					if wy > h - 0.5:
						continue
					for wx in 3:
						B.box(Vector3(1.4, 1.3, 0.06), Vector3(bx + side * (-3.5 + wx * 3.5), wy, ez), win, false)
						B.box(Vector3(1.6, 0.1, 0.25), Vector3(bx + side * (-3.5 + wx * 3.5), wy - 0.72, ez + ef * 0.1), stone, false)
				B.box(Vector3(12.1, 0.3, 0.12), Vector3(bx, 3.6, ez + ef * 0.03), stone, false)
				var vs := B.box(Vector3(0.9, 3.6, 0.25), Vector3(bx + side * 5.0, 5.4, ez + ef * 0.2), B.mat(sh[2], 0.5), false)
				vs.name = "VSign"
				var vl := Label3D.new()
				vl.text = "\n".join(String(sh[0]).split(" ")[0].substr(0, 7).split(""))
				vl.font = font
				vl.font_size = 64
				vl.pixel_size = 0.0055
				vl.outline_size = 0
				vl.modulate = Color(1, 0.97, 0.9)
				vl.position = Vector3(bx + side * 5.0, 5.4, ez + ef * 0.34)
				vl.rotation.y = 0.0 if ef > 0 else PI
				n.add_child(vl)
				# and the ground floor: a lit corner display window
				B.box(Vector3(9.0, 2.6, 0.06), Vector3(bx + side * 0.5, 1.6, ez), lit, false)
				B.box(Vector3(9.2, 0.15, 0.2), Vector3(bx + side * 0.5, 2.95, ez + ef * 0.08), dark, false)
			B.box(Vector3(9.0, 3.4, 10.0), Vector3(bx + side * 1.5, 1.7, z), wall)          # back rooms
			for pz in [-4.8, 4.8]:
				B.box(Vector3(3.0, 3.4, 0.4), Vector3(fx + side * 1.5, 1.7, z + pz), wall)    # piers
			B.box(Vector3(2.9, 0.1, 9.2), Vector3(fx + side * 1.5, 0.05, z), B.mat(Color(0.75, 0.72, 0.68), 0.3), false)  # floor
			B.box(Vector3(0.05, 3.2, 9.2), Vector3(fx + side * 2.97, 1.7, z), lit, false)  # bright back wall
			B.box(Vector3(2.9, 0.06, 9.2), Vector3(fx + side * 1.5, 3.37, z), lit, false)  # ceiling light
			B.box(Vector3(0.05, 3.2, 8.6), Vector3(fx + side * 0.05, 1.65, z - 0.3), glass, false)
			for fz in [-4.55, -0.3, 3.95, 4.55]:
				B.box(Vector3(0.12, 3.3, 0.12), Vector3(fx + side * 0.05, 1.65, z + fz), dark, false)  # mullions
			B.box(Vector3(0.14, 0.12, 9.4), Vector3(fx + side * 0.05, 3.25, z), dark, false)
			for q in 3:
				B.box(Vector3(0.45, 0.06, 7.6), Vector3(fx + side * 2.6, 0.8 + q * 0.75, z), shelf, false)
				for g in 6:
					var gm := B.mat(Color.from_hsv(fmod(float(i * 7 + q * 3 + g) * 0.13, 1.0), 0.55, 0.85), 0.6)
					B.box(Vector3(0.3, 0.32, 0.5), Vector3(fx + side * 2.6, 0.99 + q * 0.75, z - 3.2 + g * 1.25), gm, false)
			B.box(Vector3(0.8, 0.95, 2.0), Vector3(fx + side * 1.3, 0.48, z - 1.5), shelf, false)   # counter
			B.box(Vector3(0.06, 2.4, 0.04), Vector3(fx + side * 0.06, 1.2, z + 3.95), dark, false)   # door handle bar
			# name board with the shop's colour, two faces of text on the street side
			var bc: Color = sh[2]
			B.box(Vector3(0.2, 0.9, 9.0), Vector3(fx - side * 0.1, 3.9, z), B.mat(bc, 0.5), false)
			var nm := Label3D.new()
			nm.text = String(sh[0])
			nm.font = font
			nm.font_size = 96
			nm.pixel_size = 0.0055
			nm.outline_size = 0
			nm.modulate = Color(1, 0.97, 0.9)
			nm.position = Vector3(fx - side * 0.22, 3.98, z)
			nm.rotation.y = -side * PI * 0.5
			nm.visibility_range_end = 160.0
			n.add_child(nm)
			var sub := nm.duplicate() as Label3D
			sub.text = String(sh[1])
			sub.font_size = 44
			sub.position.y = 3.62
			sub.modulate = Color(1, 0.9, 0.6)
			n.add_child(sub)
			# striped awning
			var aw := MeshInstance3D.new()
			var am := PrismMesh.new()
			am.size = Vector3(1.8, 0.5, 8.8)
			am.left_to_right = 0.0 if side > 0 else 1.0
			aw.mesh = am
			var amat := StandardMaterial3D.new()
			amat.albedo_color = bc.lightened(0.15)
			aw.material_override = amat
			aw.position = Vector3(fx - side * 0.9, 3.15, z)
			n.add_child(aw)
			# upper floor: windows with frames, a small balcony now and then
			for wj in 3:
				var wz := z - 3.0 + wj * 3.0
				B.box(Vector3(0.08, 1.6, 1.3), Vector3(fx - side * 0.02, 6.0, wz), B.mat(Color(0.25, 0.35, 0.45), 0.1, 0.3), false)
				B.box(Vector3(0.12, 0.12, 1.5), Vector3(fx - side * 0.06, 5.15, wz), stone, false)
				if (i + wj) % 4 == 0:
					B.box(Vector3(0.8, 0.12, 1.8), Vector3(fx - side * 0.4, 5.1, wz), stone, false)
					B.box(Vector3(0.05, 0.9, 1.8), Vector3(fx - side * 0.8, 5.6, wz), dark, false)
	# strings of lights across the street every 12 m (warm bulbs)
	var bulb := B.mat(Color(1, 0.85, 0.5), 0.5, 0.0, Color(1, 0.8, 0.45), 2.5)
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	var sm := SphereMesh.new()
	sm.radius = 0.07
	sm.height = 0.14
	sm.radial_segments = 8
	sm.rings = 4
	sm.material = bulb
	mm.mesh = sm
	var xs: Array = []
	for zi in 14:
		var z2 := -Lh + 6.0 + zi * 12.0
		for t in 22:
			var u := float(t) / 21.0
			xs.append(Transform3D(Basis.IDENTITY, Vector3(lerpf(-6.8, 6.8, u), 6.2 - sin(u * PI) * 0.9, z2)))
	mm.instance_count = xs.size()
	for q in xs.size():
		mm.set_instance_transform(q, xs[q])
	var mmi := MultiMeshInstance3D.new()
	mmi.multimesh = mm
	mmi.visibility_range_end = 220.0
	n.add_child(mmi)
	# gate arches at both ends with the street's name
	for end: float in [1.0, -1.0]:
		var gz := end * (Lh - 1.0)
		for sx in [-6.4, 6.4]:
			B.box(Vector3(1.0, 7.5, 1.0), Vector3(sx, 3.75, gz), stone)
		B.box(Vector3(14.0, 1.4, 1.0), Vector3(0, 7.2, gz), stone, false)
		B.box(Vector3(9.0, 0.9, 0.06), Vector3(0, 7.2, gz + end * 0.52), B.mat(Color(0.1, 0.32, 0.55), 0.4), false)
		B.text("СОМОН", Vector3(0, 7.22, gz + end * 0.56), 120, Color(1.0, 0.85, 0.35), 0.0075, null, end < 0)
	if OpenWorld.instance:
		var g := n.global_transform
		var props := {"bench_park_soviet": [], "lamp_ornate": [], "bin_modern_steel": []}
		var trees := {"chinar_middle": [], "flowers_petunia": [], "flowers_salvia": []}
		for zi in 12:
			var z3 := -Lh + 12.0 + zi * 14.0
			B.box(Vector3(2.2, 0.5, 2.2), Vector3(0, 0.25, z3), stone)
			B.box(Vector3(1.9, 0.06, 1.9), Vector3(0, 0.51, z3), B.mat(Color(0.2, 0.14, 0.09), 0.95), false)
			trees["chinar_middle"].append(g * Transform3D(Basis(Vector3.UP, zi * 1.7).scaled(Vector3.ONE * 0.75), Vector3(0, 0.5, z3)))
			for f in 8:
				var a := f * TAU / 8.0
				trees["flowers_petunia" if f % 2 == 0 else "flowers_salvia"].append(g * Transform3D(Basis.IDENTITY.scaled(Vector3.ONE * 1.2), Vector3(sin(a) * 0.75, 0.5, z3 + cos(a) * 0.75)))
			for sx: float in [-1.0, 1.0]:
				props["bench_park_soviet"].append(g * Transform3D(Basis(Vector3.UP, sx * PI * 0.5), Vector3(sx * 2.4, 0.1, z3)))
			if z3 + 7.0 < Lh - 8.0:
				props["lamp_ornate"].append(g * Transform3D(Basis.IDENTITY, Vector3(0, 0.1, z3 + 7.0)))
			props["bin_modern_steel"].append(g * Transform3D(Basis.IDENTITY, Vector3(1.6, 0.1, z3 + 2.0)))
		var holder := Node3D.new()
		holder.name = "ShopProps"
		add_child(holder)
		n.tree_exiting.connect(holder.queue_free)
		OpenWorld.instance._place_props(holder, props)
		OpenWorld.instance._trees(holder, trees, 0)


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
	var soil := B.mat(Color(0.2, 0.14, 0.09), 0.95)
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
				# a real bed: 1.6 x 5 m, stone kerb, dark soil, flowers 0.3 m apart in colour bands
				B.box(Vector3(1.9, 0.22, 5.3), Vector3(sx * 7.6, 0.06, z - 1.0), stone, false)
				B.box(Vector3(1.6, 0.06, 5.0), Vector3(sx * 7.6, 0.2, z - 1.0), soil, false)
				for fi in 5:
					for fj in 16:
						var fl: String = ["flowers_petunia", "flowers_salvia", "flowers_marigold"][(fj / 4 + k + (1 if fi == 2 else 0)) % 3]
						var fp := Vector3(sx * (6.95 + fi * 0.32), 0.22, z - 3.3 + fj * 0.31)
						trees[fl].append(g * Transform3D(Basis(Vector3.UP, float(fi * 7 + fj) * 1.3).scaled(Vector3.ONE * 1.3), fp))
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
	m.albedo_color = Color(0.85, 0.93, 1.0, 0.6)
	# round soft droplets (a radial gradient), not square quads
	var gt := GradientTexture2D.new()
	gt.width = 32
	gt.height = 32
	gt.fill = GradientTexture2D.FILL_RADIAL
	gt.fill_from = Vector2(0.5, 0.5)
	gt.fill_to = Vector2(1.0, 0.5)
	var gr := Gradient.new()
	gr.set_color(0, Color(1, 1, 1, 1))
	gr.set_color(1, Color(1, 1, 1, 0))
	gt.gradient = gr
	m.albedo_texture = gt
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
		l.font = load("res://assets/fonts/game_font.tres")
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
