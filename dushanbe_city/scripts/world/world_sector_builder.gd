class_name WorldSectorBuilder
extends RefCounted
## Builds the content of one 512 m sector of the open world as plain arrays (runs on a worker
## thread; only reads WorldData). The main thread turns the result into meshes / bodies.
##   terrain      grid mesh (8 m LOD0 / 16 m LOD1) with skirts, + heights for the collision
##   roads        carriageway ribbons (asphalt with markings / dirt), sidewalks + curbs in the city,
##                bridge decks, parapets, slabs, piers, tunnel shells and portals, + collision faces
##   water        river ribbons
##   buildings    procedural facades (world_building.gdshader), roofs, yard walls, + collision boxes
##   trees        per species transforms (forest, orchards, poplar rows, riverside trees, gardens)
##   signs        town plates, direction signs, km posts, fuel stations, landmarks, street lights

const SECTOR := 512.0

var wd: WorldData
var road_frames: Array = []          ## per road: {"p": PackedVector3Array, "r": PackedVector2Array, "s": PackedFloat32Array}
var sector_segs := {}                ## Vector2i -> Array of [road index, k0, k1]
var sector_buildings := {}           ## Vector2i -> Array of building indices
var sector_items := {}               ## Vector2i -> Array of [kind, dict]
var bridge_mask: Array = []          ## per road: PackedByteArray (1 bridge, 2 tunnel) per point
var _hash := {}                      ## Vector2i (16 m cell) -> Array of [road index, point index]
var sector_guard := {}               ## Vector2i -> Array of [a: Vector3, b: Vector3, side]
var sector_fillets := {}             ## Vector2i -> Array of fillet dicts (rounded junction corners)
var sector_cross := {}               ## Vector2i -> Array of zebra crossing dicts
var _fillet_hash := {}               ## Vector2i (64 m cell) -> Array of fillet dicts (sidewalk skipping)


func _init(data: WorldData) -> void:
	wd = data
	_prepare_roads()
	for i in wd.buildings.size():
		var b: Array = wd.buildings[i]
		_bucket(sector_buildings, _sec(float(b[1]), float(b[2]))).append(i)
	for s in wd.signs:
		_bucket(sector_items, _sec(float(s["x"]), float(s["z"]))).append(["sign", s])
	for s in wd.kmposts:
		_bucket(sector_items, _sec(float(s["x"]), float(s["z"]))).append(["km", s])
	for s in wd.fuel:
		_bucket(sector_items, _sec(float(s["x"]), float(s["z"]))).append(["fuel", s])
	for s in wd.landmarks:
		_bucket(sector_items, _sec(float(s["x"]), float(s["z"]))).append(["landmark", s])
	for i in wd.billboards.size():
		var bb: Dictionary = (wd.billboards[i] as Dictionary).duplicate()
		bb["variant"] = i % WorldModels.ADS.size()
		_bucket(sector_items, _sec(float(bb["x"]), float(bb["z"]))).append(["billboard", bb])
	for g in wd.guardrails:
		var pts: Array = g["p"]
		for k in pts.size() - 1:
			var a := Vector3(pts[k][0], pts[k][1], pts[k][2])
			var b := Vector3(pts[k + 1][0], pts[k + 1][1], pts[k + 1][2])
			var m := (a + b) * 0.5
			_bucket(sector_guard, _sec(m.x, m.z)).append([a, b, int(g["s"])])
	for fl in wd.fillets:
		_bucket(sector_fillets, _sec(float(fl["c"][0]), float(fl["c"][2]))).append(fl)
		var hc := Vector2i(floori(float(fl["c"][0]) / 64.0), floori(float(fl["c"][2]) / 64.0))
		for dj in range(-1, 2):
			for di in range(-1, 2):
				_bucket(_fillet_hash, hc + Vector2i(di, dj)).append(fl)
	for cr in wd.crossings:
		_bucket(sector_cross, _sec(float(cr["x"]), float(cr["z"]))).append(cr)


func _sec(x: float, z: float) -> Vector2i:
	return Vector2i(floori((x - wd.origin.x) / SECTOR), floori((z - wd.origin.y) / SECTOR))


static func _bucket(d: Dictionary, k: Vector2i) -> Array:
	if not d.has(k):
		d[k] = []
	return d[k]


func sectors_x() -> int:
	return int(ceil(wd.size / SECTOR))


func _prepare_roads() -> void:
	for ri in wd.roads.size():
		var r: Dictionary = wd.roads[ri]
		var pts: Array = r["pts"]
		var cls: String = r["cls"]
		var lift: float = {"avenue": 0.07, "highway": 0.06, "street": 0.05, "road": 0.05, "mountain": 0.05, "lane": 0.04, "dirt": 0.03}.get(cls, 0.05)
		var P := PackedVector3Array()
		for p in pts:
			P.append(Vector3(p[0], float(p[1]) + lift, p[2]))
		var R := PackedVector2Array()
		var S := PackedFloat32Array()
		var acc := 0.0
		for k in P.size():
			var a := P[maxi(k - 1, 0)]
			var b := P[mini(k + 1, P.size() - 1)]
			var t := Vector2(b.x - a.x, b.z - a.z).normalized()
			R.append(Vector2(-t.y, t.x))           # right-hand normal (x, z)
			if k > 0:
				acc += Vector2(P[k].x - P[k - 1].x, P[k].z - P[k - 1].z).length()
			S.append(acc)
		road_frames.append({"p": P, "r": R, "s": S})
		for k in P.size():
			var hc := Vector2i(floori(P[k].x / 16.0), floori(P[k].z / 16.0))
			if not _hash.has(hc):
				_hash[hc] = []
			_hash[hc].append([ri, k])
		var mask := PackedByteArray()
		mask.resize(P.size())
		for br in r.get("bridges", []):
			for k in range(int(br[0]), int(br[1]) + 1):
				mask[k] = 1
		for tu in r.get("tunnels", []):
			for k in range(int(tu[0]), int(tu[1]) + 1):
				mask[k] = 2
		bridge_mask.append(mask)
		# segments per sector (by segment midpoint) -> contiguous ranges
		var cur := Vector2i(-999, -999)
		var k0 := 0
		for k in P.size() - 1:
			var m := (P[k] + P[k + 1]) * 0.5
			var sc := _sec(m.x, m.z)
			if sc != cur:
				if cur.x != -999:
					_bucket(sector_segs, cur).append([ri, k0, k])
				cur = sc
				k0 = k
		if cur.x != -999:
			_bucket(sector_segs, cur).append([ri, k0, P.size() - 1])


# ================================================================================================
func build(sc: Vector2i, lod: int) -> Dictionary:
	var out := {"sc": sc, "lod": lod}
	var x0 := wd.origin.x + sc.x * SECTOR
	var z0 := wd.origin.y + sc.y * SECTOR
	out["terrain"] = _terrain(x0, z0, 1 if lod == 0 else 2)
	if lod == 0:
		out["hm"] = _heightmap(x0, z0)
		if int(out["terrain"]["holes"]) > 0:
			# tunnel portals in this sector: trimesh collision of the terrain with the same holes
			var T: Dictionary = out["terrain"]
			var faces := PackedVector3Array()
			var Vt: PackedVector3Array = T["v"]
			var It: PackedInt32Array = T["i"]
			var cells := int(SECTOR / wd.step)
			var main_tris := cells * cells * 2 - int(T["holes"])
			for q in main_tris * 3:
				faces.append(Vt[It[q]])
			out["terrain_faces"] = faces
	out["roads"] = _roads(sc, lod)
	out["water"] = _water(x0, z0)
	out["buildings"] = _buildings(sc, lod)
	out["trees"] = _trees(sc, x0, z0, lod)
	var rv: Dictionary = (out["roads"] as Dictionary).get("veg", {})
	for id in rv:
		if not (out["trees"] as Dictionary).has(id):
			out["trees"][id] = []
		(out["trees"][id] as Array).append_array(rv[id])
	out["items"] = sector_items.get(sc, [])
	out["guard"] = _guardrails(sc)
	return out


## guardrail segments: model transforms (10 m segment scaled to each 4 m piece) + collision boxes
func _guardrails(sc: Vector2i) -> Dictionary:
	var xfs: Array = []
	var boxes: Array = []
	for g in sector_guard.get(sc, []):
		var a: Vector3 = g[0]
		var b: Vector3 = g[1]
		var side: int = g[2]
		var d := b - a
		var L := Vector2(d.x, d.z).length()
		if L < 0.3:
			continue
		var z := d.normalized()
		# perpendicular towards the road (the beam faces the traffic)
		var inward := Vector3(d.z, 0, -d.x).normalized() * float(side)
		var x := inward
		var y := z.cross(x).normalized()
		if y.y < 0.0:
			x = -x
			y = -y
		var basis := Basis(x, y * 0.62, z * (L / 10.04 * 1.03))
		var o := (a + b) * 0.5 + Vector3(0, -0.32, 0)
		xfs.append(Transform3D(basis, o))
		boxes.append([o + Vector3(0, 0.5, 0), Vector3(0.35, 1.0, L + 0.1), atan2(z.x, z.z)])
	return {"xfs": xfs, "boxes": boxes}


# ------------------------------------------------------------------------------------------ terrain
func _terrain(x0: float, z0: float, stride: int) -> Dictionary:
	var cells := int(SECTOR / wd.step) / stride
	var st := wd.step * stride
	var i0 := int(round((x0 - wd.origin.x) / wd.step))
	var j0 := int(round((z0 - wd.origin.y) / wd.step))
	var nv := cells + 1
	var V := PackedVector3Array()
	var N := PackedVector3Array()
	V.resize(nv * nv)
	N.resize(nv * nv)
	for j in nv:
		for i in nv:
			var gi := i0 + i * stride
			var gj := j0 + j * stride
			var h := wd.h_grid(gi, gj)
			V[j * nv + i] = Vector3(x0 + i * st, h, z0 + j * st)
			var hx := wd.h_grid(gi + stride, gj) - wd.h_grid(gi - stride, gj)
			var hz := wd.h_grid(gi, gj + stride) - wd.h_grid(gi, gj - stride)
			N[j * nv + i] = Vector3(-hx, 2.0 * st, -hz).normalized()
	var I := PackedInt32Array()
	var holes := 0
	var tun_near := _tunnels_near(x0, z0)
	for j in cells:
		for i in cells:
			var a := j * nv + i
			for tri in [[a, a + 1, a + nv], [a + 1, a + nv + 1, a + nv]]:
				if not tun_near.is_empty():
					var cc: Vector3 = (V[tri[0]] + V[tri[1]] + V[tri[2]]) / 3.0
					if _cuts_tunnel(cc, V[tri[0]], V[tri[1]], V[tri[2]], tun_near):
						holes += 1
						continue
				I.append_array(tri)
	# skirts (hide cracks between sectors of different resolution)
	var edges := [[], [], [], []]
	for i in nv:
		edges[0].append(i)
		edges[1].append((nv - 1) * nv + i)
		edges[2].append(i * nv)
		edges[3].append(i * nv + nv - 1)
	for e in 4:
		var line: Array = edges[e]
		var base := V.size()
		for idx in line:
			V.append(V[idx] - Vector3(0, 4.0, 0))
			N.append(N[idx])
		for q in line.size() - 1:
			var a: int = line[q]
			var b: int = line[q + 1]
			var c := base + q
			var d := base + q + 1
			# both windings (skirts seen from either side)
			I.append_array([a, b, c, b, d, c, a, c, b, b, c, d])
	return {"v": V, "n": N, "i": I, "holes": holes}


## tunnel tube samples near a sector: [position (road surface), half width + walkways]
func _tunnels_near(x0: float, z0: float) -> Array:
	var out := []
	var rect := Rect2(x0 - 40, z0 - 40, SECTOR + 80, SECTOR + 80)
	for ri in wd.roads.size():
		var mask: PackedByteArray = bridge_mask[ri]
		var P: PackedVector3Array = road_frames[ri]["p"]
		for k in P.size():
			if mask[k] == 2 and rect.has_point(Vector2(P[k].x, P[k].z)):
				out.append([P[k], float(wd.roads[ri]["w"]) * 0.5 + 2.5])
	return out


## does a terrain triangle cut through a tunnel tube (between the road and the vault)?
func _cuts_tunnel(cc: Vector3, a: Vector3, b: Vector3, c: Vector3, tun: Array) -> bool:
	var lo := minf(minf(a.y, b.y), c.y)
	var hi := maxf(maxf(a.y, b.y), c.y)
	for t in tun:
		var p: Vector3 = t[0]
		var r: float = t[1] + 6.0                    # triangle size margin (8 m grid)
		if absf(cc.x - p.x) > r or absf(cc.z - p.z) > r:
			continue
		if Vector2(cc.x - p.x, cc.z - p.z).length() < r and hi > p.y - 1.0 and lo < p.y + 7.5:
			return true
	return false


func _heightmap(x0: float, z0: float) -> PackedFloat32Array:
	var cells := int(SECTOR / wd.step)
	var i0 := int(round((x0 - wd.origin.x) / wd.step))
	var j0 := int(round((z0 - wd.origin.y) / wd.step))
	var H := PackedFloat32Array()
	H.resize((cells + 1) * (cells + 1))
	for j in cells + 1:
		for i in cells + 1:
			H[j * (cells + 1) + i] = wd.h_grid(i0 + i, j0 + j)
	return H


# ------------------------------------------------------------------------------------------ roads
func _roads(sc: Vector2i, lod: int) -> Dictionary:
	var asph := _Mesh.new()
	var dirt := _Mesh.new()
	var side := _Mesh.new()          # sidewalks / curbs (paved)
	var verge := _Mesh.new()         # 0.26: the slope from the sidewalk down to the ground (grass, terrain shader)
	var conc := _Mesh.new()          # bridges, tunnel shells, portals
	var lamps := _Mesh.new()         # tunnel light strips (emissive)
	var col := PackedVector3Array()
	var lights: Array = []
	var props := {}                  ## prop id -> Array of Transform3D
	var bedveg := {}                 ## 0.26: vegetation of the avenue median beds (real flowers, hedges)
	var pboxes: Array = []           ## collision boxes of the props
	for seg in sector_segs.get(sc, []):
		var ri: int = seg[0]
		var k0: int = seg[1]
		var k1: int = seg[2]
		var r: Dictionary = wd.roads[ri]
		var F: Dictionary = road_frames[ri]
		var P: PackedVector3Array = F["p"]
		var R: PackedVector2Array = F["r"]
		var S: PackedFloat32Array = F["s"]
		var mask: PackedByteArray = bridge_mask[ri]
		var hw := float(r["w"]) * 0.5
		var dirt_road: bool = r["surf"] == "dirt"
		var lanes := 0.0 if dirt_road else float(r["lanes"])
		var city := _in_city(P[k0])
		# 0.24: every paved city road has sidewalks with curbs (no gravel / earth verges in town)
		var walks: bool = city and r["cls"] != "lane" and not dirt_road
		var m := dirt if dirt_road else asph
		for k in range(k0, k1):
			var a := P[k]
			var b := P[k + 1]
			var ra := Vector3(R[k].x, 0, R[k].y)
			var rb := Vector3(R[k + 1].x, 0, R[k + 1].y)
			var al := a - ra * hw
			var ar := a + ra * hw
			var bl := b - rb * hw
			var br := b + rb * hw
			# carriageway: UV.x lateral (m), UV.y distance; UV2 = (half width, lanes); not where a more
			# important road's surface already is (junctions)
			# junctions: where this surface lies on a more important road it is tucked 4 cm under it
			# (continuous, no gap, no z-fighting, no step)
			al = _tuck(al, ri)
			ar = _tuck(ar, ri)
			bl = _tuck(bl, ri)
			br = _tuck(br, ri)
			m.quad(al, ar, br, bl, Vector2(-hw, S[k]), Vector2(hw, S[k]), Vector2(hw, S[k + 1]), Vector2(-hw, S[k + 1]), Vector2(hw, lanes))
			col.append_array([al, ar, br, al, br, bl])
			var bridge: bool = mask[k] == 1 or mask[k + 1] == 1
			var tunnel: bool = mask[k] == 2 or mask[k + 1] == 2
			if walks and not bridge and not tunnel:
				# sidewalks 3.5 m (+0.15 m) with curbs on both sides (not across other roads)
				for sgn: float in [-1.0, 1.0]:
					var mid_w := (a + b) * 0.5 + (ra + rb) * 0.5 * (hw + 1.75) * sgn
					if _on_other_road(mid_w, ri, 2.5) or _in_fillet(mid_w):
						continue
					var a0 := a + ra * hw * sgn
					var b0 := b + rb * hw * sgn
					var a1 := a + ra * (hw + 3.5) * sgn + Vector3(0, 0.15, 0)
					var b1 := b + rb * (hw + 3.5) * sgn + Vector3(0, 0.15, 0)
					var a0u := a0 + Vector3(0, 0.15, 0)
					var b0u := b0 + Vector3(0, 0.15, 0)
					# behind the sidewalk a gentle slope down to the ground (no ledge to get stuck on)
					var af := _foot(a1, ra * sgn)
					var bf := _foot(b1, rb * sgn)
					var ramp := not _on_other_road((af + bf) * 0.5, ri, 0.5) and not _in_fillet((af + bf) * 0.5)
					if sgn > 0:
						side.quad_flat(a0, a0u, b0u, b0)
						side.quad_flat(a0u, a1, b1, b0u)
						col.append_array([a0u, a1, b1, a0u, b1, b0u])
						if ramp:
							verge.quad_flat(a1, af, bf, b1)
							col.append_array([a1, af, bf, a1, bf, b1])
					else:
						side.quad_flat(b0, b0u, a0u, a0)
						side.quad_flat(b0u, b1, a1, a0u)
						col.append_array([b0u, b1, a1, b0u, a1, a0u])
						if ramp:
							verge.quad_flat(b1, bf, af, a1)
							col.append_array([b1, bf, af, b1, af, a1])
				if int(S[k] / 32.0) != int(S[k + 1] / 32.0):
					for sgn2: float in [-1.0, 1.0]:
						if r["cls"] == "street" and sgn2 < 0:
							continue
						var lp := a + ra * (hw + 0.8) * sgn2 + Vector3(0, 0.15, 0)
						if not _on_other_road(lp, ri, 2.0):
							lights.append(lp + Vector3(0, 8.6, 0) - ra * sgn2 * 2.0)
							# lamp arm over the carriageway
							if r["cls"] in ["avenue", "highway"]:
								# Dushanbe boulevards: white ornate lamps with two lanterns (assets/models/city)
								_prop(props, "lamp_ornate", lp, atan2(ra.x * sgn2, ra.z * sgn2) + PI * 0.5)
							elif r["cls"] == "street" or int(S[k] / 32.0) % 3 == 1:
								# modular city road pack lamp (x3.2), arm over the carriageway
								_prop(props, "rp_lamp_a", lp, atan2(ra.x * sgn2, ra.z * sgn2) + PI * 0.5)
							else:
								_prop(props, "light_street_single", lp, atan2(ra.x * sgn2, ra.z * sgn2) + PI)
							pboxes.append([lp + Vector3(0, 4.5, 0), Vector3(0.26, 9.0, 0.26), 0.0])
				# avenues: a planted median (curb, hedges, flowers) with ornate lamps and national flags,
				# like Rudaki / Ismoili Somoni avenues; gaps at junctions and crossings
				if r["cls"] == "avenue" and int(S[k] / 10.0) != int(S[k + 1] / 10.0):
					var mc := a + Vector3(0, 0.02, 0)
					if not _on_other_road(mc, ri, 6.0) and not _in_fillet(mc):
						var dy := atan2((b - a).x, (b - a).z)
						_prop(props, "median_bed", mc, dy)
						_median_plants(bedveg, mc, dy, int(S[k] / 10.0))
						pboxes.append([mc + Vector3(0, 0.2, 0), Vector3(2.8, 0.4, 10.0), dy])
						var slot := int(S[k] / 10.0) % 4
						if slot == 0:
							_prop(props, "lamp_ornate", mc + Vector3(0, 0.25, 0), dy + PI * 0.5)
							pboxes.append([mc + Vector3(0, 4.5, 0), Vector3(0.3, 9.0, 0.3), 0.0])
							lights.append(mc + Vector3(0, 7.4, 0))
						elif slot == 2:
							_prop(props, "flagpole", mc + Vector3(0, 0.25, 0), dy + PI * 0.5)
							pboxes.append([mc + Vector3(0, 4.5, 0), Vector3(0.2, 9.0, 0.2), 0.0])
				# benches / bins on the sidewalks now and then
				if int(S[k] / 70.0) != int(S[k + 1] / 70.0) and r["cls"] != "highway":
					var bp := a + ra * (hw + 2.9) + Vector3(0, 0.15, 0)
					if not _on_other_road(bp, ri, 2.0):
						var bk := int(S[k] / 70.0) % 3
						_prop(props, ["bench_park_soviet", "container_trash_green", "rp_bench"][bk], bp, atan2(ra.x, ra.z) + (PI * 0.5 if bk == 2 else 0.0))
				# 0.25: steel bins on the other sidewalk, manholes in the lanes, storm grates at the kerb
				if int((S[k] + 35.0) / 70.0) != int((S[k + 1] + 35.0) / 70.0) and r["cls"] != "highway":
					var bnp := a - ra * (hw + 2.6) + Vector3(0, 0.15, 0)
					if not _on_other_road(bnp, ri, 2.0) and not _in_fillet(bnp):
						_prop(props, "bin_modern_steel", bnp, atan2(-ra.x, -ra.z))
						pboxes.append([bnp + Vector3(0, 0.45, 0), Vector3(0.4, 0.9, 0.4), 0.0])
				if int(S[k] / 55.0) != int(S[k + 1] / 55.0):
					var lane := 1.0 if int(S[k] / 55.0) % 2 == 0 else -1.0
					var mh := a + ra * (hw * 0.45 * lane) + Vector3(0, 0.012, 0)
					if not _on_other_road(mh, ri, 1.0):
						_prop(props, "manhole_cover", mh, atan2(ra.x, ra.z))
				if int(S[k] / 40.0) != int(S[k + 1] / 40.0):
					for sg: float in [-1.0, 1.0]:
						var gp := a + ra * (hw - 0.45) * sg + Vector3(0, 0.012, 0)
						if not _on_other_road(gp, ri, 1.5) and not _in_fillet(gp):
							_prop(props, "storm_grate", gp, atan2(ra.x, ra.z) + PI * 0.5)
			elif not tunnel and not bridge and r["cls"] in ["road", "highway", "mountain", "lane"]:
				# country road: concrete utility poles on one side, bus stops in villages
				if int(S[k] / 45.0) != int(S[k + 1] / 45.0):
					var pp := a + ra * (hw + 3.2)
					pp.y = wd.height_at(pp.x, pp.z)
					if not _on_other_road(pp, ri, 2.0):
						_prop(props, "utility_pole_concrete", pp, atan2(ra.x, ra.z))
						pboxes.append([pp + Vector3(0, 4.8, 0), Vector3(0.26, 9.6, 0.26), 0.0])
				if int(S[k] / 260.0) != int(S[k + 1] / 260.0) and not wd.place_at(a.x, a.z).is_empty():
					var bs := a + ra * (hw + 3.0)
					bs.y = maxf(wd.height_at(bs.x, bs.z), a.y)
					if not _on_other_road(bs, ri, 3.0):
						_prop(props, "bus_stop_shelter", bs, atan2(ra.x, ra.z) + PI)
						pboxes.append([bs + Vector3(0, 1.3, 0), Vector3(4.9, 2.6, 1.7), atan2(ra.x, ra.z)])
			if bridge:
				var d := Vector3(0, -1.2, 0)
				conc.quad_flat(ar, ar + d + ra * 0.6, br + d + rb * 0.6, br)
				conc.quad_flat(bl, bl + d - rb * 0.6, al + d - ra * 0.6, al)
			elif not walks and not tunnel and not (city and r["cls"] == "lane"):
				# gravel shoulders (1.5 m, sloping 0.35 m down) - part of the drivable surface - then a
				# skirt down into the ground (the 8 m terrain may lie lower on steep stretches)
				var sw := 1.5
				var sd := Vector3(0, -0.35, 0)
				var arO := ar + ra * sw + sd
				var brO := br + rb * sw + sd
				var alO := al - ra * sw + sd
				var blO := bl - rb * sw + sd
				var u2 := Vector2(hw + sw, 0.0)
				# at junctions the shoulder / embankment of this road would lie over the other road's
				# carriageway (a gravel band across the asphalt): left out there, per side
				var okR := not _on_other_road((arO + brO) * 0.5, ri, 1.0) and not _on_other_road((ar + br) * 0.5, ri, 0.3)
				var okL := not _on_other_road((alO + blO) * 0.5, ri, 1.0) and not _on_other_road((al + bl) * 0.5, ri, 0.3)
				# embankment: a gentle drivable slope (<= 1:4) from the shoulder edge down to (a bit
				# under) the terrain - part of the collision, so a car that left the road climbs back
				# on instead of hitting a step
				if okR:
					dirt.quad(ar, arO, brO, br, Vector2(hw, S[k]), Vector2(hw + sw, S[k]), Vector2(hw + sw, S[k + 1]), Vector2(hw, S[k + 1]), u2)
					col.append_array([ar, arO, brO, ar, brO, br])
					var afR := _foot(arO, ra)
					var bfR := _foot(brO, rb)
					if not _on_other_road((afR + bfR) * 0.5, ri, 0.5):
						dirt.quad(arO, afR, bfR, brO, Vector2(hw + sw, S[k]), Vector2(hw + sw + 3.0, S[k]), Vector2(hw + sw + 3.0, S[k + 1]), Vector2(hw + sw, S[k + 1]), u2)
						col.append_array([arO, afR, bfR, arO, bfR, brO])
				if okL:
					dirt.quad(alO, al, bl, blO, Vector2(-hw - sw, S[k]), Vector2(-hw, S[k]), Vector2(-hw, S[k + 1]), Vector2(-hw - sw, S[k + 1]), u2)
					col.append_array([alO, al, bl, alO, bl, blO])
					var afL := _foot(alO, -ra)
					var bfL := _foot(blO, -rb)
					if not _on_other_road((afL + bfL) * 0.5, ri, 0.5):
						dirt.quad(afL, alO, blO, bfL, Vector2(-hw - sw - 3.0, S[k]), Vector2(-hw - sw, S[k]), Vector2(-hw - sw, S[k + 1]), Vector2(-hw - sw - 3.0, S[k + 1]), u2)
						col.append_array([afL, alO, blO, afL, blO, bfL])
			if bridge:
				_bridge_segment(conc, col, a, b, ra, rb, hw, k, S, ri)
			if tunnel and mask[k] == 2 and mask[k + 1] == 2:
				_tunnel_segment(conc, lamps, col, a, b, ra, rb, hw)
			# tunnel portals at the tunnel ends
			if k > 0 and mask[k] == 2 and mask[k - 1] != 2:
				_portal(conc, col, a, ra, hw, (b - a).normalized())
			if mask[k + 1] == 2 and k + 2 < P.size() and mask[k + 2] != 2:
				_portal(conc, col, b, rb, hw, (a - b).normalized())
	for fl in sector_fillets.get(sc, []):
		_fillet(fl, asph, side, col)
		# 0.25: a traffic light on every kerb corner of a city junction, facing the junction
		var C := Vector3(fl["c"][0], float(fl["c"][1]) + 0.2, fl["c"][2])
		var O := Vector3(fl["o"][0], C.y, fl["o"][1])
		var dv := C - O
		if dv.length() > 0.5 and float(fl["r"]) > 4.0:
			dv = dv.normalized()
			var tp := O + dv * (float(fl["r"]) - 1.4)
			tp.y = C.y - 0.05
			_prop(props, "traffic_light_pole", tp, atan2(dv.x, dv.z))
			pboxes.append([tp + Vector3(0, 1.8, 0), Vector3(0.26, 3.6, 0.26), 0.0])
	var zebra := _Mesh.new()
	for cr in sector_cross.get(sc, []):
		_crossing(cr, zebra)
	return {"asphalt": asph.arrays(), "dirt": dirt.arrays(), "side": side.arrays(), "verge": verge.arrays(), "conc": conc.arrays(),
			"lamps": lamps.arrays(), "col": col, "lights": lights, "props": props, "pboxes": pboxes, "zebra": zebra.arrays(), "veg": bedveg}


## the foot of a road embankment that starts at the edge point e and goes outwards (dir, unit,
## horizontal): run = 4 x the drop to the terrain (1:4, 14 degrees; 0.8 .. 10 m), ending 6 cm
## under the ground
func _foot(e: Vector3, dir: Vector3) -> Vector3:
	var g := wd.height_at(e.x, e.z)
	var run := clampf((e.y - g) * 4.0, 0.8, 10.0)
	var f := e + dir * run
	# the ground falling away under the foot: lengthen once more so the slope stays ~1:4
	g = wd.height_at(f.x, f.z)
	run = clampf((e.y - g) * 4.0, 0.8, 10.0)
	f = e + dir * run
	f.y = minf(wd.height_at(f.x, f.z), e.y + 0.4) - 0.06
	return f


## rounded kerb corner (curb return) at a junction: asphalt between the corner C of the two
## carriageway edges and the tangent arc (radius r, centre O), a 3.5 m raised sidewalk following the
## arc on its inner side, and the curb face; all of it is drivable / walkable collision
func _fillet(fl: Dictionary, asph: _Mesh, side: _Mesh, col: PackedVector3Array) -> void:
	var y := float(fl["c"][1]) + 0.045
	var C := Vector3(fl["c"][0], y, fl["c"][2])
	var O := Vector3(fl["o"][0], y, fl["o"][1])
	var T1 := Vector3(fl["t1"][0], y, fl["t1"][1])
	var T2 := Vector3(fl["t2"][0], y, fl["t2"][1])
	var R := float(fl["r"])
	var a1 := atan2(T1.z - O.z, T1.x - O.x)
	var a2 := atan2(T2.z - O.z, T2.x - O.x)
	var da := wrapf(a2 - a1, -PI, PI)
	var n := maxi(4, int(absf(da) * R / 1.5))
	var arc: Array[Vector3] = []
	for k in n + 1:
		var a := a1 + da * k / n
		arc.append(O + Vector3(cos(a), 0, sin(a)) * R)
	var u2 := Vector2(100.0, 2.0)            # no lane paint on the corner (road shader)
	for k in n:
		_tri_up(asph, C, arc[k], arc[k + 1], Vector2(50.0, 0.0), u2)
		col.append_array([C, arc[k], arc[k + 1]])
	# sidewalk on the arc (between R - 3.5 and R from the centre), 0.15 m up, + curb face
	var up := Vector3(0, 0.15, 0)
	for k in n:
		var p0: Vector3 = arc[k]
		var p1: Vector3 = arc[k + 1]
		var q0 := O + (p0 - O) * ((R - 3.5) / R)
		var q1 := O + (p1 - O) * ((R - 3.5) / R)
		_tri_up(side, p0 + up, q0 + up, q1 + up, Vector2.ZERO, Vector2.ZERO)
		_tri_up(side, p0 + up, q1 + up, p1 + up, Vector2.ZERO, Vector2.ZERO)
		col.append_array([p0 + up, q0 + up, q1 + up, p0 + up, q1 + up, p1 + up])
		side.quad_flat(p0, p1, p1 + up, p0 + up)
		col.append_array([p0, p1, p1 + up, p0, p1 + up, p0 + up])


## triangle with an upward normal (consistent winding) and constant UVs
func _tri_up(m: _Mesh, a: Vector3, b: Vector3, c: Vector3, uv: Vector2, u2: Vector2) -> void:
	if (c - a).cross(b - a).y < 0.0:
		var t := b
		b = c
		c = t
	var s0 := m.v.size()
	m.v.append_array([a, b, c])
	m.n.append_array([Vector3.UP, Vector3.UP, Vector3.UP])
	m.uv.append_array([uv, uv, uv])
	m.uv2.append_array([u2, u2, u2])
	m.c.append_array([m.tint, m.tint, m.tint])
	m.i.append_array([s0, s0 + 1, s0 + 2])


## zebra crossing: a 4 m band across the carriageway, 2 cm above the asphalt (UV.x across in m)
func _crossing(cr: Dictionary, m: _Mesh) -> void:
	var p := Vector3(cr["x"], 0.0, cr["z"])
	var yaw := float(cr["yaw"])
	var along := Vector3(sin(yaw), 0, cos(yaw))
	var across := Vector3(along.z, 0, -along.x)
	var w := float(cr["w"]) * 0.5
	var corners: Array[Vector3] = []
	for c in [[-w, -2.0], [w, -2.0], [w, 2.0], [-w, 2.0]]:
		var q := p + across * float(c[0]) + along * float(c[1])
		q.y = _road_y(q, float(cr["y"])) + 0.022
		corners.append(q)
	m.quad(corners[0], corners[1], corners[2], corners[3], Vector2(-w, 0), Vector2(w, 0), Vector2(w, 4), Vector2(-w, 4), Vector2(w, 0))


## height of the road surface under p (nearest road sample at about the expected level)
func _road_y(p: Vector3, near_y: float) -> float:
	var c := Vector2i(floori(p.x / 16.0), floori(p.z / 16.0))
	var best := INF
	var y := near_y
	for dj in range(-1, 2):
		for di in range(-1, 2):
			for e in _hash.get(c + Vector2i(di, dj), []):
				var q: Vector3 = (road_frames[e[0]]["p"] as PackedVector3Array)[e[1]]
				if absf(q.y - near_y) > 2.0:
					continue
				var d := Vector2(q.x - p.x, q.z - p.z).length()
				if d < best:
					best = d
					y = q.y
	return y


## inside the kite (C, T1, O, T2) of a rounded junction corner?
## a 10 m median bed (kerb 2.8 m wide): clipped privet hedges along both kerbs, three rows of
## flowers between them in colour blocks (petunia / salvia / marigold), dense like a city bed
func _median_plants(veg: Dictionary, c: Vector3, yaw: float, seed: int) -> void:
	var b := Basis(Vector3.UP, yaw)
	var rng := RandomNumberGenerator.new()
	rng.seed = seed * 7919 + 13
	var y := c.y + 0.31
	for sx in [-0.88, 0.88]:
		for k in 9:
			var p := c + b * Vector3(sx, 0, -4.4 + k * 1.1)
			_veg_add(veg, "hedge_privet", Transform3D(Basis(Vector3.UP, yaw + rng.randf_range(-0.2, 0.2)).scaled(Vector3(0.55, 0.5, 0.75)), Vector3(p.x, y, p.z)))
	var kinds := ["flowers_petunia", "flowers_salvia", "flowers_marigold"]
	for i in 22:
		var block := (i / 4 + seed) % 3
		for j in 3:
			var p := c + b * Vector3(-0.42 + j * 0.42 + rng.randf_range(-0.05, 0.05), 0, -4.5 + i * 0.43 + rng.randf_range(-0.05, 0.05))
			var sc := rng.randf_range(1.15, 1.45)
			_veg_add(veg, kinds[(block + (1 if j == 1 else 0)) % 3], Transform3D(Basis(Vector3.UP, rng.randf() * TAU).scaled(Vector3.ONE * sc), Vector3(p.x, y, p.z)))


static func _veg_add(veg: Dictionary, id: String, xf: Transform3D) -> void:
	if not veg.has(id):
		veg[id] = []
	(veg[id] as Array).append(xf)


func _near_corner(p: Vector3, r: float) -> bool:
	for fl in _fillet_hash.get(Vector2i(floori(p.x / 64.0), floori(p.z / 64.0)), []):
		if Vector2(float(fl["c"][0]) - p.x, float(fl["c"][2]) - p.z).length() < r:
			return true
	return false


func _in_fillet(p: Vector3) -> bool:
	for fl in _fillet_hash.get(Vector2i(floori(p.x / 64.0), floori(p.z / 64.0)), []):
		if absf(float(fl["c"][1]) - p.y) > 3.0:
			continue
		var poly := [Vector2(fl["c"][0], fl["c"][2]), Vector2(fl["t1"][0], fl["t1"][1]), Vector2(fl["o"][0], fl["o"][1]), Vector2(fl["t2"][0], fl["t2"][1])]
		var q := Vector2(p.x, p.z)
		var pos := 0
		var neg := 0
		for k in 4:
			var a: Vector2 = poly[k]
			var b: Vector2 = poly[(k + 1) % 4]
			var cr := (b - a).cross(q - a)
			if cr > 0.0:
				pos += 1
			elif cr < 0.0:
				neg += 1
		if pos == 0 or neg == 0:
			return true
	return false


static func _prop(d: Dictionary, id: String, p: Vector3, yaw: float) -> void:
	if not d.has(id):
		d[id] = []
	d[id].append(Transform3D(Basis(Vector3.UP, yaw), p))


const PRIO := {"avenue": 0, "highway": 1, "street": 2, "road": 2, "mountain": 2, "lane": 3, "dirt": 4}


## does p lie on the carriageway of a MORE IMPORTANT road at about the same level? Then the minor
## road's surface stops there (junctions: one surface, no overlapping decks / steps)
func _on_major_road(p: Vector3, ri: int) -> bool:
	var my: int = PRIO.get(wd.roads[ri]["cls"], 2)
	var c := Vector2i(floori(p.x / 16.0), floori(p.z / 16.0))
	for dj in range(-1, 2):
		for di in range(-1, 2):
			for e in _hash.get(c + Vector2i(di, dj), []):
				var oi: int = e[0]
				if oi == ri:
					continue
				var op: int = PRIO.get(wd.roads[oi]["cls"], 2)
				if op > my or (op == my and oi > ri):
					continue
				var q: Vector3 = (road_frames[oi]["p"] as PackedVector3Array)[e[1]]
				var hw := float(wd.roads[oi]["w"]) * 0.5
				if absf(q.y - p.y) < 2.5 and Vector2(q.x - p.x, q.z - p.z).length() < hw - 0.3:
					return true
	return false


func _tuck(v: Vector3, ri: int) -> Vector3:
	var my: int = PRIO.get(wd.roads[ri]["cls"], 2)
	var c := Vector2i(floori(v.x / 16.0), floori(v.z / 16.0))
	var best := INF
	var bh := v.y
	for dj in range(-1, 2):
		for di in range(-1, 2):
			for e in _hash.get(c + Vector2i(di, dj), []):
				var oi: int = e[0]
				if oi == ri:
					continue
				var op: int = PRIO.get(wd.roads[oi]["cls"], 2)
				if op > my or (op == my and oi > ri):
					continue
				var q: Vector3 = (road_frames[oi]["p"] as PackedVector3Array)[e[1]]
				var d := Vector2(q.x - v.x, q.z - v.z).length()
				if absf(q.y - v.y) < 2.5 and d < float(wd.roads[oi]["w"]) * 0.5 + 0.5 and d < best:
					best = d
					bh = q.y - 0.04
	return Vector3(v.x, bh, v.z) if best < INF else v


## is p on the carriageway (+ margin) of ANOTHER road at about the same level? (junction areas:
## no sidewalks / curbs / parapets / lamps there)
func _on_other_road(p: Vector3, ri: int, margin: float) -> bool:
	var c := Vector2i(floori(p.x / 16.0), floori(p.z / 16.0))
	for dj in range(-2, 3):
		for di in range(-2, 3):
			for e in _hash.get(c + Vector2i(di, dj), []):
				if e[0] == ri:
					continue
				var q: Vector3 = (road_frames[e[0]]["p"] as PackedVector3Array)[e[1]]
				var hw := float(wd.roads[e[0]]["w"]) * 0.5 + margin
				if absf(q.y - p.y) < 3.0 and Vector2(q.x - p.x, q.z - p.z).length() < hw:
					return true
	return false


func _in_city(p: Vector3) -> bool:
	return absf(p.x) < 2000.0 and p.z < -950.0 and p.z > -4800.0


func _bridge_segment(c: _Mesh, col: PackedVector3Array, a: Vector3, b: Vector3, ra: Vector3, rb: Vector3, hw: float, k: int, S: PackedFloat32Array, ri: int) -> void:
	var w := hw + 0.6
	var up := Vector3(0, 0.95, 0)
	var dn := Vector3(0, -1.3, 0)
	# parapets (both sides) 0.95 m high, 0.3 m thick
	for sgn: float in [-1.0, 1.0]:
		var ao := a + ra * w * sgn
		var bo := b + rb * w * sgn
		if _on_other_road((ao + bo) * 0.5, ri, 3.0):
			continue                               # junction on the bridge: no parapet across the other road
		var ai := a + ra * (w - 0.3) * sgn
		var bi := b + rb * (w - 0.3) * sgn
		if sgn > 0:
			c.quad_flat(ai, ai + up, bi + up, bi)
			c.quad_flat(ai + up, ao + up, bo + up, bi + up)
			c.quad_flat(bo, bo + up, ao + up, ao)
		else:
			c.quad_flat(bi, bi + up, ai + up, ai)
			c.quad_flat(bi + up, bo + up, ao + up, ai + up)
			c.quad_flat(ao, ao + up, bo + up, bo)
		col.append_array([ai, ai + up, bi + up, ai, bi + up, bi])
	# deck slab underside
	var al := a - ra * w + dn
	var ar := a + ra * w + dn
	var bl := b - rb * w + dn
	var br := b + rb * w + dn
	c.quad_flat(ar, al, bl, br)
	# piers every ~24 m down to the ground
	if int(S[k] / 24.0) != int(S[k + 1] / 24.0):
		var g := wd.height_at(a.x, a.z)
		if a.y - g > 3.0:
			for sgn: float in [-0.6, 0.6]:
				var p := a + ra * hw * sgn
				c.box(Vector3(p.x - 0.7, g - 1.0, p.z - 0.7), Vector3(p.x + 0.7, a.y - 1.3, p.z + 0.7))


func _tunnel_segment(c: _Mesh, lamps: _Mesh, col: PackedVector3Array, a: Vector3, b: Vector3, ra: Vector3, rb: Vector3, hw: float) -> void:
	# arched shell: walls 2 m outside the carriageway (service walkways), vault 6.4 m high
	var w := hw + 2.0
	var prof: Array[Vector2] = [Vector2(-w, -0.3), Vector2(-w, 4.0), Vector2(-w * 0.75, 5.6), Vector2(-w * 0.3, 6.4),
		Vector2(w * 0.3, 6.4), Vector2(w * 0.75, 5.6), Vector2(w, 4.0), Vector2(w, -0.3)]
	for q in prof.size() - 1:
		var p0 := prof[q]
		var p1 := prof[q + 1]
		var a0 := a + ra * p0.x + Vector3(0, p0.y, 0)
		var a1 := a + ra * p1.x + Vector3(0, p1.y, 0)
		var b0 := b + rb * p0.x + Vector3(0, p0.y, 0)
		var b1 := b + rb * p1.x + Vector3(0, p1.y, 0)
		c.quad_flat(a1, a0, b0, b1)          # facing inwards
		col.append_array([a1, a0, b0, a1, b0, b1])
	# light strip along the vault
	var l0 := a + Vector3(0, 6.35, 0) - ra * 0.25
	var l1 := a + Vector3(0, 6.35, 0) + ra * 0.25
	var l2 := b + Vector3(0, 6.35, 0) + rb * 0.25
	var l3 := b + Vector3(0, 6.35, 0) - rb * 0.25
	lamps.quad_flat(l1, l0, l3, l2)


func _portal(c: _Mesh, col: PackedVector3Array, p: Vector3, r: Vector3, hw: float, inward: Vector3) -> void:
	# concrete portal frame: two pillars and a lintel, 1.2 m deep
	var w := hw + 2.0
	var d := inward * 1.2
	for sgn: float in [-1.0, 1.0]:
		var o := p + r * (w + 0.6) * sgn
		c.box(o - Vector3(0.6, 0.5, 0.6), o + Vector3(0.6, 7.2, 0.6))
	var lt := p + Vector3(0, 6.6, 0)
	c.quad_flat(lt - r * (w + 1.2), lt + r * (w + 1.2), lt + r * (w + 1.2) + Vector3(0, 1.6, 0), lt - r * (w + 1.2) + Vector3(0, 1.6, 0))
	c.quad_flat(lt + r * (w + 1.2) + d, lt - r * (w + 1.2) + d, lt - r * (w + 1.2) + d + Vector3(0, 1.6, 0), lt + r * (w + 1.2) + d + Vector3(0, 1.6, 0))


# ------------------------------------------------------------------------------------------ water
func _water(x0: float, z0: float) -> Array:
	var m := _Mesh.new()
	var rect := Rect2(x0 - 20, z0 - 20, SECTOR + 40, SECTOR + 40)
	for rv in wd.rivers:
		var pts: Array = rv["pts"]
		var hw := float(rv["w"]) * 0.5
		for k in pts.size() - 1:
			var a := Vector3(pts[k][0], pts[k][1], pts[k][2])
			var b := Vector3(pts[k + 1][0], pts[k + 1][1], pts[k + 1][2])
			var mid := (a + b) * 0.5
			if not rect.has_point(Vector2(mid.x, mid.z)):
				continue
			var t := Vector3(b.x - a.x, 0, b.z - a.z).normalized()
			var rr := Vector3(-t.z, 0, t.x)
			m.quad_flat(a - rr * hw, a + rr * hw, b + rr * hw, b - rr * hw)
	return m.arrays()


# ------------------------------------------------------------------------------------------ buildings
const STYLE := {"panel5": 1, "brick5": 2, "panel9": 0, "tower": 0, "office": 3, "admin": 6, "hotel": 7,
	"house": 4, "shop": 5, "school": 6, "cottage": 4, "market": 5, "garage": 0}
const FH := {"panel5": 2.8, "brick5": 2.9, "panel9": 2.8, "tower": 3.0, "office": 3.6, "admin": 3.6, "hotel": 3.1,
	"house": 3.0, "shop": 4.2, "school": 3.6, "cottage": 2.9, "market": 4.5, "garage": 3.2}
const BAY := {"panel5": 3.2, "brick5": 3.0, "panel9": 3.3, "tower": 3.6, "office": 3.6, "admin": 3.6, "hotel": 3.4,
	"house": 3.4, "shop": 3.6, "school": 3.6, "cottage": 3.0, "market": 4.0, "garage": 4.0}
const WW := {"panel5": 1.45, "brick5": 1.35, "panel9": 1.5, "tower": 1.8, "office": 3.4, "admin": 1.8, "hotel": 1.6,
	"house": 1.5, "shop": 3.2, "school": 2.6, "cottage": 1.3, "market": 3.6, "garage": 1.2}
const TINTS := [Color(0.95, 0.91, 0.82), Color(0.93, 0.86, 0.74), Color(0.86, 0.88, 0.86), Color(0.96, 0.94, 0.9),
	Color(0.9, 0.82, 0.72), Color(0.84, 0.86, 0.9), Color(0.97, 0.88, 0.78), Color(0.88, 0.9, 0.82)]
const ROOF_TINTS := [Color(0.25, 0.45, 0.32), Color(0.28, 0.38, 0.55), Color(0.55, 0.22, 0.18), Color(0.55, 0.56, 0.58), Color(0.62, 0.62, 0.6)]


const LUX := ["luxa_m", "luxb_m", "luxc_m", "mall_m", "amid_m"]


func _buildings(sc: Vector2i, lod: int) -> Dictionary:
	var fac := _Mesh.new()
	var roof := _Mesh.new()
	var walls := _Mesh.new()
	var boxes: Array = []
	var occ_v := PackedVector3Array()
	var occ_i := PackedInt32Array()
	var models := {}                       ## model kind -> Array of Transform3D
	for bi in sector_buildings.get(sc, []):
		var b: Array = wd.buildings[bi]
		var kind: String = b[0]
		var x := float(b[1])
		var z := float(b[2])
		var yaw := float(b[3])
		var L := float(b[4])
		var D := float(b[5])
		var floors := int(b[6])
		var seed := int(b[7])
		var y := float(b[8])
		if kind == "sky" or kind.begins_with("villa") or kind.ends_with("_m"):
			# imported models (WorldModels): transform + collision box (+ occluder for the tower)
			var sc2 := 1.0 if kind != "sky" else 0.85 + float(seed % 7) * 0.05
			# the Dushanbe set has its street front on the model's +Z; the plan's street side is -Z
			var myaw := yaw + (PI if kind in LUX else 0.0)
			var xf := Transform3D(Basis(Vector3.UP, myaw).scaled(Vector3.ONE * sc2), Vector3(x, y - 0.3, z))
			if not models.has(kind):
				models[kind] = []
			models[kind].append(xf)
			var hh: float = 114.0 * sc2 if kind == "sky" else {"school_m": 11.5, "hospital_m": 12.3, "luxa_m": 80.0, "luxb_m": 62.0, "luxc_m": 42.0, "mall_m": 18.0, "amid_m": 16.0}.get(kind, 11.0)
			var fw := 22.0 * sc2 if kind == "sky" else L
			var fd := 22.0 * sc2 if kind == "sky" else D
			if kind != "amid_m":                    # AMID: hollow, its walls come with the store (AmidStores)
				boxes.append([Vector3(x, y + hh * 0.5, z), Vector3(fw, hh, fd), yaw])
			if kind == "sky":
				var o1 := occ_v.size()
				var Xo := Vector3(cos(yaw), 0, -sin(yaw)) * (fw * 0.5 - 0.6)
				var Zo := Vector3(sin(yaw), 0, cos(yaw)) * (fd * 0.5 - 0.6)
				for yy in [y, y + hh - 1.0]:
					for corner in [-Xo - Zo, Xo - Zo, Xo + Zo, -Xo + Zo]:
						occ_v.append(Vector3(x, yy, z) + corner)
				for f in [[0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7], [4, 5, 6, 7]]:
					occ_i.append_array([o1 + f[0], o1 + f[1], o1 + f[2], o1 + f[0], o1 + f[2], o1 + f[3]])
			continue
		var rng := RandomNumberGenerator.new()
		rng.seed = seed
		var fh: float = FH.get(kind, 3.0)
		var plinth := 0.9 if kind in ["panel5", "panel9", "brick5"] else (0.5 if kind in ["house", "cottage", "school", "admin"] else 0.3)
		var ground_fh := fh if not kind in ["tower", "hotel", "office"] else 4.2
		var g0 := plinth + ground_fh
		var H := g0 + (floors - 1) * fh
		var bay: float = BAY.get(kind, 3.4)
		var style: int = STYLE.get(kind, 0)
		var tint: Color = TINTS[rng.randi() % TINTS.size()]
		if kind in ["house", "cottage"]:
			tint = [Color(0.95, 0.93, 0.88), Color(0.86, 0.8, 0.7), Color(0.92, 0.88, 0.78), Color(0.8, 0.84, 0.86)][rng.randi() % 4]
		var cs := cos(yaw)
		var sn := sin(yaw)
		var X := Vector3(cs, 0, -sn)
		var Zv := Vector3(sn, 0, cs)
		var c := Vector3(x, y, z)
		var base := y - 2.5                    # walls continue into the ground (slopes)
		var shop_street: bool = kind in ["panel9", "tower", "hotel", "office"] and _in_city(c) and rng.randf() < 0.75
		# four facades: front (-Z side, street), right (+X), back (+Z, courtyard / entrances), left
		var faces := [[-X * L * 0.5 - Zv * D * 0.5, X, L, 2 if shop_street else 0],
			[X * L * 0.5 - Zv * D * 0.5, Zv, D, 0],
			[X * L * 0.5 + Zv * D * 0.5, -X, L, 1],
			[-X * L * 0.5 + Zv * D * 0.5, -Zv, D, 0]]
		if kind in ["house", "cottage", "shop", "school", "admin"]:
			faces[0][3] = (faces[0][3] | 1) if kind != "shop" else 2
		for f in faces:
			var o: Vector3 = c + f[0]
			var dir: Vector3 = f[1]
			var len: float = f[2]
			var nb := maxi(1, int(len / bay))
			var off := (len - nb * bay) * 0.5
			var a := o
			var bb := o + dir * len
			var col := Color(tint.r, tint.g, tint.b, (style + (seed % 997) / 997.0 * 0.9) / 8.0)
			var cu := Color(bay, fh, WW.get(kind, 1.5), float(f[3]))
			fac.facade(Vector3(a.x, base, a.z), Vector3(bb.x, base, bb.z), H + y - base, y - base, off, nb * bay, g0, col, cu)
		# roof
		var top := y + H
		var p0 := c - X * L * 0.5 - Zv * D * 0.5
		var p1 := c + X * L * 0.5 - Zv * D * 0.5
		var p2 := c + X * L * 0.5 + Zv * D * 0.5
		var p3 := c - X * L * 0.5 + Zv * D * 0.5
		if kind in ["house", "cottage"]:
			# hip roof of painted corrugated metal, 0.5 m overhang
			var rt: Color = ROOF_TINTS[rng.randi() % ROOF_TINTS.size()]
			var ov := 0.5
			var q0 := c - X * (L * 0.5 + ov) - Zv * (D * 0.5 + ov)
			var q1 := c + X * (L * 0.5 + ov) - Zv * (D * 0.5 + ov)
			var q2 := c + X * (L * 0.5 + ov) + Zv * (D * 0.5 + ov)
			var q3 := c - X * (L * 0.5 + ov) + Zv * (D * 0.5 + ov)
			var rh := minf(D, L) * 0.28
			var r0 := c - X * maxf(L * 0.5 - D * 0.5, 0.1) + Vector3(0, H + rh, 0)
			var r1 := c + X * maxf(L * 0.5 - D * 0.5, 0.1) + Vector3(0, H + rh, 0)
			q0.y = top - 0.15; q1.y = top - 0.15; q2.y = top - 0.15; q3.y = top - 0.15
			roof.tint = rt
			roof.quad_flat(q0, q1, r1, r0)
			roof.quad_flat(q2, q3, r0, r1)
			roof.tri(q1, q2, r1)
			roof.tri(q3, q0, r0)
			# havli: yard walls behind the house (2.2 m) with a gate gap
			if kind == "house" and lod == 0:
				var yd := 14.0
				var wc := Color(0.86, 0.8, 0.68) if rng.randf() < 0.6 else Color(0.78, 0.5, 0.4)
				var w0 := c - X * (L * 0.5 + 3) + Zv * (D * 0.5)
				var w1 := c + X * (L * 0.5 + 3) + Zv * (D * 0.5)
				var w2 := w1 + Zv * yd
				var w3 := w0 + Zv * yd
				walls.tint = wc
				# yard walls never stand on a road (checked along each wall)
				for seg2 in [[w1, w2, Vector3(0.3, 2.2, yd)], [w3, w0, Vector3(0.3, 2.2, yd)], [w2, w3, Vector3(L + 6, 2.2, 0.3)]]:
					var pa: Vector3 = seg2[0]
					var pb: Vector3 = seg2[1]
					var blocked := false
					for q in 5:
						var pq := pa.lerp(pb, q / 4.0)
						pq.y = y
						if _on_other_road(pq, -1, 2.0):
							blocked = true
							break
					if blocked:
						continue
					walls.wall(pa, pb, y, 2.2)
					boxes.append([(pa + pb) * 0.5 + Vector3(0, 1.1, 0), seg2[2], yaw])
		else:
			roof.tint = Color(0.55, 0.54, 0.52)
			var up := Vector3(0, top, 0)
			roof.quad_flat(Vector3(p0.x, top, p0.z), Vector3(p1.x, top, p1.z), Vector3(p2.x, top, p2.z), Vector3(p3.x, top, p3.z))
			# parapet 0.6 m
			var par := Color(tint.r * 0.9, tint.g * 0.9, tint.b * 0.9, (style + 0.0) / 8.0)
			var cu2 := Color(bay, fh, 1.0, 4.0)
			var pts := [p0, p1, p2, p3, p0]
			for q in 4:
				fac.facade(Vector3(pts[q].x, top, pts[q].z), Vector3(pts[q + 1].x, top, pts[q + 1].z), 0.6, 0.0, 0.0, 0.0, 0.0, par, cu2)
				# inner face of the parapet
				fac.facade(Vector3(pts[q + 1].x, top, pts[q + 1].z) - (pts[q + 1] - c).normalized() * 0.25 * Vector3(1, 0, 1),
					Vector3(pts[q].x, top, pts[q].z) - (pts[q] - c).normalized() * 0.25 * Vector3(1, 0, 1), 0.6, 0.0, 0.0, 0.0, 0.0, par, cu2)
		boxes.append([c + Vector3(0, H * 0.5, 0), Vector3(L, H, D), yaw])
		if H > 10.0 and L > 18.0:
			# occluder: the building box inset by 0.5 m (occlusion culling of what is behind it)
			var o0 := occ_v.size()
			var hx := X * (L * 0.5 - 0.5)
			var hz := Zv * (D * 0.5 - 0.5)
			for yy in [y, y + H - 0.5]:
				for corner in [-hx - hz, hx - hz, hx + hz, -hx + hz]:
					occ_v.append(Vector3(c.x, yy, c.z) + corner)
			for f in [[0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7], [4, 5, 6, 7]]:
				occ_i.append_array([o0 + f[0], o0 + f[1], o0 + f[2], o0 + f[0], o0 + f[2], o0 + f[3]])
	return {"facade": fac.arrays(true), "roof": roof.arrays(), "walls": walls.arrays(), "boxes": boxes, "occ_v": occ_v, "occ_i": occ_i, "models": models}


# ------------------------------------------------------------------------------------------ trees
func _trees(sc: Vector2i, x0: float, z0: float, lod: int) -> Dictionary:
	var rng := RandomNumberGenerator.new()
	rng.seed = sc.x * 7919 + sc.y * 104729 + 17
	var out := {}
	var spacing := 11.0 if lod == 0 else 16.0
	var cells := int(SECTOR / spacing)
	# billboards near this sector: no trees in front of / around them (they must be seen from the road)
	var boards: Array = []
	for bb in wd.billboards:
		var bx := float(bb["x"])
		var bz := float(bb["z"])
		if bx > x0 - 160.0 and bx < x0 + SECTOR + 160.0 and bz > z0 - 160.0 and bz < z0 + SECTOR + 160.0:
			boards.append(Vector2(bx, bz))
	for j in cells:
		for i in cells:
			var x := x0 + (i + rng.randf()) * spacing
			var z := z0 + (j + rng.randf()) * spacing
			var forest := wd.biome_at(x, z, 0)
			var fields := wd.biome_at(x, z, 1)
			var settle := wd.biome_at(x, z, 2)
			var waterp := wd.biome_at(x, z, 3)
			var s := wd.surface_at(x, z)
			if s == 4 or s == 6 or s == 2:
				continue                           # roads, snow, bare rock
			var h := wd.height_at(x, z)
			var nrm := wd.normal_at(x, z)
			if nrm.y < 0.72 or h > 1050.0:
				continue
			var wl := PlayerWater.surface_at(x, z)     # never in a lake / river
			if wl != PlayerWater.SEA_LEVEL and h < wl + 1.0:
				continue
			var r := rng.randf()
			var id := ""
			var sc_ := 1.0
			if forest > 0.15 and r < forest * 0.85:
				# mountain forest: juniper (archa) high up, walnut / maple (elm, chinar) lower
				if h > 450.0:
					id = "thuja_cone"
					sc_ = rng.randf_range(1.6, 2.6)
				else:
					id = ["elm_a", "elm_b", "chinar_middle", "acacia"][rng.randi() % 4]
					sc_ = rng.randf_range(0.8, 1.15)
			elif waterp > 0.35 and r < 0.35:
				id = ["poplar_a", "poplar_b", "acacia", "elm_b"][rng.randi() % 4]          # riverside
				sc_ = rng.randf_range(0.8, 1.1)
			elif fields > 0.4:
				# orchards: rows of fruit trees (mulberry / apricot stand-in), on a regular grid
				if (i % 2 == 0) and r < 0.75:
					id = "mulberry"
					sc_ = rng.randf_range(0.8, 1.1)
					x = x0 + (i + 0.5) * spacing
					z = z0 + (j + 0.5) * spacing
			elif settle > 0.4 and r < 0.18:
				id = ["mulberry", "chinar_middle", "elm_a", "poplar_b", "acacia"][rng.randi() % 5]       # gardens
				sc_ = rng.randf_range(0.7, 1.0)
			elif r < 0.035 and h < 900.0:
				id = ["elm_b", "acacia", "shrub_lilac"][rng.randi() % 3]
				sc_ = rng.randf_range(0.7, 1.1)
			if id == "":
				continue
			if _near_building(x, z, sc) or _near_board(boards, x, z, 55.0) or _in_own_plot(x, z):
				continue
			# never on a road / its shoulder: the coarse surface map misses narrow tracks
			if wd.road_edge_dist(x, z) < 3.5 + sc_ * 1.5:
				continue
			if not out.has(id):
				out[id] = []
			out[id].append(Transform3D(Basis(Vector3.UP, rng.randf() * TAU).scaled(Vector3.ONE * sc_), Vector3(x, wd.height_at(x, z) - 0.1, z)))
	# city streets: rows of trees right behind the sidewalks (avenues: plane trees and cypresses in turn,
	# like Rudaki avenue; streets: elms / acacias / mulberries), never on another road or a plot
	for seg in sector_segs.get(sc, []):
		var r: Dictionary = wd.roads[seg[0]]
		if r["cls"] == "lane" or r["surf"] == "dirt":
			continue
		var F: Dictionary = road_frames[seg[0]]
		var P: PackedVector3Array = F["p"]
		var R: PackedVector2Array = F["r"]
		if not _in_city(P[seg[1]]):
			continue
		var step := 2                     # 0.24: denser rows (~8 m), bigger crowns
		for k in range(seg[1], seg[2], step):
			if bridge_mask[seg[0]][k] != 0 or _in_fillet(P[k]):
				continue
			for sgn: float in [-1.0, 1.0]:
				var q := P[k] + Vector3(R[k].x, 0, R[k].y) * (float(r["w"]) * 0.5 + 4.6) * sgn
				if wd.road_edge_dist(q.x, q.z) < 3.2 or _near_building(q.x, q.z, sc) or _near_board(boards, q.x, q.z, 56.0) or _in_own_plot(q.x, q.z):
					continue
				if _near_corner(q, 16.0):
					continue                  # junction corners stay open: sight lines, the traffic lights
				var idx := int(k / step)
				var id := ""
				var scl := 1.0
				if r["cls"] != "avenue" and r["cls"] != "highway":
					id = ["chinar_middle", "elm_a", "mulberry", "elm_b"][(idx + (1 if sgn > 0 else 0)) % 4]
					scl = rng.randf_range(1.05, 1.3)
				elif idx % 3 == 0:
					id = "thuja_cone"
					scl = rng.randf_range(1.6, 2.0)
				else:
					id = ["chinar_middle", "elm_a"][idx % 2]
					scl = rng.randf_range(1.1, 1.35)
				if not out.has(id):
					out[id] = []
				out[id].append(Transform3D(Basis(Vector3.UP, rng.randf() * TAU).scaled(Vector3.ONE * scl), Vector3(q.x, wd.height_at(q.x, q.z) - 0.1, q.z)))
	# poplar rows along the country roads in the lowlands (typical of the Gissar valley)
	for seg in sector_segs.get(sc, []):
		var r: Dictionary = wd.roads[seg[0]]
		if not r["cls"] in ["highway", "road"] or _in_city((road_frames[seg[0]]["p"] as PackedVector3Array)[seg[1]]):
			continue
		var F: Dictionary = road_frames[seg[0]]
		var P: PackedVector3Array = F["p"]
		var R: PackedVector2Array = F["r"]
		for k in range(seg[1], seg[2], 3):
			if P[k].y > 250.0 or bridge_mask[seg[0]][k] != 0:
				continue
			for sgn: float in [-1.0, 1.0]:
				var q := P[k] + Vector3(R[k].x, 0, R[k].y) * (float(r["w"]) * 0.5 + 5.0) * sgn
				if wd.surface_at(q.x, q.z) == 4 or _near_building(q.x, q.z, sc) or _near_board(boards, q.x, q.z, 150.0) or wd.road_edge_dist(q.x, q.z) < 3.0:
					continue
				if not out.has("poplar_a"):
					out["poplar_a"] = []
				out["poplar_a"].append(Transform3D(Basis(Vector3.UP, rng.randf() * TAU).scaled(Vector3.ONE * rng.randf_range(0.85, 1.1)), Vector3(q.x, wd.height_at(q.x, q.z) - 0.1, q.z)))
	return out


static func _near_board(boards: Array, x: float, z: float, r: float) -> bool:
	for b: Vector2 in boards:
		if absf(b.x - x) < r and absf(b.y - z) < r and Vector2(b.x - x, b.y - z).length() < r:
			return true
	return false


## the plots the game builds on itself (hero's home, dealership, gun shop, filling stations, auto
## services): no wild trees there
var _station_cells := {}


func _in_own_plot(x: float, z: float) -> bool:
	if wd.in_plaza(x, z):
		return true
	if _station_cells.is_empty():
		_station_cells["_"] = true
		for f in wd.fuel + wd.services:
			var p := Vector2(float(f.get("ox", f["x"])), float(f.get("oz", f["z"])))
			var q := Vector2(float(f["x"]), float(f["z"]))
			for pt in [p, q, (p + q) * 0.5]:
				var key := Vector2i(floori(pt.x / 64.0), floori(pt.y / 64.0))
				if not _station_cells.has(key):
					_station_cells[key] = []
				(_station_cells[key] as Array).append(pt)
	for di in [-1, 0, 1]:
		for dj in [-1, 0, 1]:
			for pt: Vector2 in _station_cells.get(Vector2i(floori(x / 64.0) + di, floori(z / 64.0) + dj), []):
				if pt.distance_to(Vector2(x, z)) < 30.0:
					return true
	for l in wd.landmarks:
		if not String(l["id"]) in ["hero_home", "dealer", "dealer_mb", "dealer_bmw", "gunshop", "police", "city_park", "shop_street"]:
			continue
		var p := Vector2(x - float(l["x"]), z - float(l["z"])).rotated(-float(l["yaw"]))
		if absf(p.x) < float(l["L"]) * 0.5 + 3.0 and absf(p.y) < float(l["D"]) * 0.5 + 3.0:
			return true
	return false


func _near_building(x: float, z: float, sc: Vector2i) -> bool:
	for bi in sector_buildings.get(sc, []):
		var b: Array = wd.buildings[bi]
		var r := maxf(float(b[4]), float(b[5])) * 0.6 + 3.0
		if absf(float(b[1]) - x) < r and absf(float(b[2]) - z) < r:
			return true
	return false


# ================================================================================================
class _Mesh:
	var v := PackedVector3Array()
	var n := PackedVector3Array()
	var uv := PackedVector2Array()
	var uv2 := PackedVector2Array()
	var c := PackedColorArray()
	var cu := PackedFloat32Array()
	var i := PackedInt32Array()
	var tint := Color.WHITE
	var has_custom := false

	func quad(a: Vector3, b: Vector3, cc: Vector3, d: Vector3, ua: Vector2, ub: Vector2, uc: Vector2, ud: Vector2, u2: Vector2) -> void:
		var nrm := (b - a).cross(d - a).normalized()
		if nrm.y < 0:
			nrm = -nrm
		var s := v.size()
		v.append_array([a, b, cc, d])
		n.append_array([nrm, nrm, nrm, nrm])
		uv.append_array([ua, ub, uc, ud])
		uv2.append_array([u2, u2, u2, u2])
		c.append_array([tint, tint, tint, tint])
		i.append_array([s, s + 2, s + 1, s, s + 3, s + 2])

	func quad_flat(a: Vector3, b: Vector3, cc: Vector3, d: Vector3) -> void:
		var nrm := (cc - a).cross(b - d).normalized()
		var s := v.size()
		v.append_array([a, b, cc, d])
		n.append_array([nrm, nrm, nrm, nrm])
		var t := (b - a).normalized()
		var bt := nrm.cross(t)
		uv.append_array([Vector2(0, 0), Vector2((b - a).length(), 0), Vector2((cc - a).dot(t), (cc - a).dot(bt)), Vector2((d - a).dot(t), (d - a).dot(bt))])
		uv2.append_array([Vector2.ZERO, Vector2.ZERO, Vector2.ZERO, Vector2.ZERO])
		c.append_array([tint, tint, tint, tint])
		i.append_array([s, s + 2, s + 1, s, s + 3, s + 2])

	func tri(a: Vector3, b: Vector3, cc: Vector3) -> void:
		var nrm := (cc - a).cross(b - a).normalized()
		if nrm.y < 0:
			nrm = -nrm
		var s := v.size()
		v.append_array([a, b, cc])
		n.append_array([nrm, nrm, nrm])
		uv.append_array([Vector2(a.x, a.z), Vector2(b.x, b.z), Vector2(cc.x, cc.z)])
		uv2.append_array([Vector2.ZERO, Vector2.ZERO, Vector2.ZERO])
		c.append_array([tint, tint, tint])
		i.append_array([s, s + 1, s + 2])

	func box(lo: Vector3, hi: Vector3) -> void:
		var p := [Vector3(lo.x, lo.y, lo.z), Vector3(hi.x, lo.y, lo.z), Vector3(hi.x, lo.y, hi.z), Vector3(lo.x, lo.y, hi.z),
			Vector3(lo.x, hi.y, lo.z), Vector3(hi.x, hi.y, lo.z), Vector3(hi.x, hi.y, hi.z), Vector3(lo.x, hi.y, hi.z)]
		quad_flat(p[0], p[1], p[5], p[4])
		quad_flat(p[1], p[2], p[6], p[5])
		quad_flat(p[2], p[3], p[7], p[6])
		quad_flat(p[3], p[0], p[4], p[7])
		quad_flat(p[4], p[5], p[6], p[7])

	func wall(a: Vector3, b: Vector3, y: float, h: float) -> void:
		## a free-standing wall (both faces + top), 0.3 m thick
		var d := (b - a).normalized()
		var o := Vector3(-d.z, 0, d.x) * 0.15
		var a0 := Vector3(a.x, y - 1.0, a.z)
		var b0 := Vector3(b.x, y - 1.0, b.z)
		var up := Vector3(0, h + 1.0, 0)
		quad_flat(a0 + o, b0 + o, b0 + o + up, a0 + o + up)
		quad_flat(b0 - o, a0 - o, a0 - o + up, b0 - o + up)
		quad_flat(a0 + o + up, b0 + o + up, b0 - o + up, a0 - o + up)

	func facade(a: Vector3, b: Vector3, height: float, v_base: float, u_off: float, umax: float, g0: float, col: Color, custom: Color) -> void:
		## vertical wall from a to b (bottom points), outward normal = right of a->b ... uses
		## UV (u from the first bay, v above the building base), UV2 (g0, window zone), COLOR, CUSTOM0
		has_custom = true
		var d := b - a
		var len := Vector2(d.x, d.z).length()
		var nrm := Vector3(d.z, 0, -d.x).normalized()
		var s := v.size()
		var up := Vector3(0, height, 0)
		v.append_array([a, b, b + up, a + up])
		n.append_array([nrm, nrm, nrm, nrm])
		uv.append_array([Vector2(-u_off, -v_base), Vector2(len - u_off, -v_base), Vector2(len - u_off, height - v_base), Vector2(-u_off, height - v_base)])
		uv2.append_array([Vector2(g0, umax), Vector2(g0, umax), Vector2(g0, umax), Vector2(g0, umax)])
		c.append_array([col, col, col, col])
		for q in 4:
			cu.append_array([custom.r, custom.g, custom.b, custom.a])
		i.append_array([s, s + 1, s + 2, s, s + 2, s + 3])

	func arrays(custom := false) -> Array:
		if i.is_empty():
			return []
		var arr := []
		arr.resize(Mesh.ARRAY_MAX)
		arr[Mesh.ARRAY_VERTEX] = v
		arr[Mesh.ARRAY_NORMAL] = n
		arr[Mesh.ARRAY_TEX_UV] = uv
		arr[Mesh.ARRAY_TEX_UV2] = uv2
		arr[Mesh.ARRAY_COLOR] = c
		if custom and has_custom:
			arr[Mesh.ARRAY_CUSTOM0] = cu
		arr[Mesh.ARRAY_INDEX] = i
		return arr
