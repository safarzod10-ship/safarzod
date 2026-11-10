class_name PlotPatches
extends Node3D
## 0.24: fine ground under the car parks of AMID supermarkets and malls, and their front plazas.
## The world terrain is an 8 m grid, too coarse for a car park edge or a 6 m driveway (it left the car
## park on a step and the driveway on a 1 m embankment). Here a 2 m mesh lies over the coarse ground:
## level just under the car park asphalt, an even slope down the driveway's profile to the street,
## blended into the coarse terrain at its edges. Two surfaces: the terrain's own material (grass, splat
## by world position, so it matches) and PAVING over the plaza between the car park and the street.
## Own collision (walk / drive on it), visibility range (mobile). PlazaDecor furnishes the plazas.

const STEP := 2.0
const SIDE := 7.0                  ## beyond the plot sides
const BLEND := 7.0                 ## m to fade into the coarse terrain
const PARK := 30.0                 ## the car park's depth (from the front edge into the plot)

var wd: WorldData
var mat: Material
var paving: Material
var count := 0
var plots: Array = []              ## per plot: {b, c, rt, f, L, D, base, f0, lx0, nx, nz, V, kerb, drive_len}


func build(world: WorldData, terrain_mat: Material) -> void:
	wd = world
	mat = terrain_mat
	paving = paving_material()
	var drives: Array = []
	for r in wd.roads:
		if String(r.get("id", "")).begins_with("drive"):
			drives.append(r)
	for b in wd.buildings:
		if String(b[0]) in ["amid_m", "mall_m"]:
			_patch(b, drives)


## world height of the patch surface at (x, z) (NAN outside every patch)
func surface(x: float, z: float) -> float:
	for P: Dictionary in plots:
		var d := Vector2(x, z) - (P["c"] as Vector2)
		var lx := d.dot(P["rt"])
		var fz := d.dot(P["f"])
		var fi := (lx - float(P["lx0"])) / STEP
		var fj := (fz - float(P["f0"])) / STEP
		var nx: int = P["nx"]
		var nz: int = P["nz"]
		if fi < 0.0 or fj < 0.0 or fi > nx - 1.001 or fj > nz - 1.001:
			continue
		var i := int(fi)
		var j := int(fj)
		var u := fi - i
		var v := fj - j
		var V: PackedVector3Array = P["V"]
		var a := V[j * nx + i].y
		var b2 := V[j * nx + i + 1].y
		var c := V[(j + 1) * nx + i].y
		var e := V[(j + 1) * nx + i + 1].y
		return lerpf(lerpf(a, b2, u), lerpf(c, e, u), v)
	return NAN


func _patch(b: Array, drives: Array) -> void:
	var cx := float(b[1])
	var cz := float(b[2])
	var yaw := float(b[3])
	var L := float(b[4])
	var D := float(b[5])
	var base := float(b[8])
	var f := Vector2(-sin(yaw), -cos(yaw))           # towards the street (the plan's front)
	var rt := Vector2(cos(yaw), -sin(yaw))
	var front := Vector2(cx, cz) + f * (D * 0.5 - 2.0)
	# the driveway that starts at this front: its height profile by distance, the street it joins
	var prof_s: Array[float] = []
	var prof_h: Array[float] = []
	var street_hw := 6.0
	for r in drives:
		var pts: Array = r["pts"]
		var p0 := Vector2(float(pts[0][0]), float(pts[0][2]))
		if p0.distance_to(front) < 6.0:
			var acc := 0.0
			for k in pts.size():
				if k > 0:
					acc += Vector2(float(pts[k][0]), float(pts[k][2])).distance_to(Vector2(float(pts[k - 1][0]), float(pts[k - 1][2])))
				prof_s.append(acc)
				prof_h.append(float(pts[k][1]))
			street_hw = _road_hw_at(Vector2(float(pts[-1][0]), float(pts[-1][2])), String(r["id"]))
			break
	var drive_len: float = prof_s[-1] if not prof_s.is_empty() else 0.0
	var apron := maxf(0.0, drive_len - 6.0)
	# the plaza ends at the street's kerb (the driveway ends on the street's centre line)
	var kerb := D * 0.5 - 2.0 + drive_len - street_hw - 0.4 if drive_len > 0.0 else D * 0.5 + 8.0
	var f0 := D * 0.5 - PARK
	var f1 := D * 0.5 + apron + BLEND
	var lx0 := -L * 0.5 - SIDE - BLEND
	var nx := int(ceil((L + 2.0 * (SIDE + BLEND)) / STEP)) + 1
	var nz := int(ceil((f1 - f0) / STEP)) + 1
	var V := PackedVector3Array()
	V.resize(nx * nz)
	for j in nz:
		var fz := f0 + j * STEP
		for i in nx:
			var lx := lx0 + i * STEP
			var p := Vector2(cx, cz) + rt * lx + f * fz
			var coarse := wd.height_at(p.x, p.y)
			var want := base + 0.1
			if fz > D * 0.5 and not prof_s.is_empty():
				want = _interp(prof_s, prof_h, fz - (D * 0.5 - 2.0)) - 0.12
			# weight 1 on the plot + apron (and SIDE m beyond its sides), fading to 0 over BLEND m
			var ex := maxf(absf(lx) - (L * 0.5 + SIDE), 0.0)
			var ez := maxf(fz - (D * 0.5 + apron), 0.0)
			var w := 1.0 - smoothstep(0.0, BLEND, sqrt(ex * ex + ez * ez))
			var h := lerpf(coarse, want, w)
			V[j * nx + i] = Vector3(p.x, maxf(h, coarse + 0.03), p.y)
	# two surfaces: grass (terrain material) and paving (the plaza in front of the car park)
	var st_g := SurfaceTool.new()
	var st_p := SurfaceTool.new()
	st_g.begin(Mesh.PRIMITIVE_TRIANGLES)
	st_p.begin(Mesh.PRIMITIVE_TRIANGLES)
	var faces := PackedVector3Array()
	for j in nz - 1:
		for i in nx - 1:
			var a := j * nx + i
			# the grid axes (right, front) are mirrored against the terrain's (x, z): this winding faces up
			for tri in [[a, a + nx, a + 1], [a + 1, a + nx, a + nx + 1]]:
				var lxc := lx0 + (i + 0.5) * STEP
				var fzc := f0 + (j + 0.5) * STEP
				var paved := absf(lxc) < L * 0.5 + 1.0 and fzc > D * 0.5 - 1.0 and fzc < kerb
				var stx := st_p if paved else st_g
				for q in tri:
					var v: Vector3 = V[q]
					stx.add_vertex(v + (Vector3(0, 0.02, 0) if paved else Vector3.ZERO))
					faces.append(v)
	var mesh := ArrayMesh.new()
	for pair in [[st_g, mat], [st_p, paving]]:
		var stx: SurfaceTool = pair[0]
		stx.generate_normals()
		var arr := stx.commit_to_arrays()
		if (arr[Mesh.ARRAY_VERTEX] as PackedVector3Array).is_empty():
			continue
		mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
		mesh.surface_set_material(mesh.get_surface_count() - 1, pair[1])
	var mi := MeshInstance3D.new()
	mi.name = "PlotPatch%d" % count
	mi.mesh = mesh
	mi.visibility_range_end = 900.0
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mi)
	var body := StaticBody3D.new()
	var cs := CollisionShape3D.new()
	var sh := ConcavePolygonShape3D.new()
	sh.set_faces(faces)
	cs.shape = sh
	body.add_child(cs)
	mi.add_child(body)
	plots.append({"b": b, "c": Vector2(cx, cz), "rt": rt, "f": f, "L": L, "D": D, "base": base, "f0": f0,
			"lx0": lx0, "nx": nx, "nz": nz, "V": V, "kerb": kerb, "drive_len": drive_len, "yaw": yaw})
	count += 1


func _road_hw_at(p: Vector2, skip_id: String) -> float:
	var best := INF
	var hw := 6.0
	for r in wd.roads:
		if String(r.get("id", "")) == skip_id:
			continue
		for q in r["pts"]:
			var d := Vector2(float(q[0]), float(q[2])).distance_to(p)
			if d < best:
				best = d
				hw = float(r.get("w", 12.0)) * 0.5
	return hw


static func _interp(xs: Array[float], ys: Array[float], x: float) -> float:
	if x <= xs[0]:
		return ys[0]
	for k in range(1, xs.size()):
		if x <= xs[k]:
			var t := (x - xs[k - 1]) / maxf(xs[k] - xs[k - 1], 0.001)
			return lerpf(ys[k - 1], ys[k], t)
	return ys[-1]


## concrete pavers: beige running bond in 1 m squares, terracotta bands every 4 m (generated)
static func paving_material() -> StandardMaterial3D:
	var S := 256
	var img := Image.create(S, S, false, Image.FORMAT_RGB8)
	var n := FastNoiseLite.new()
	n.frequency = 0.2
	for y in S:
		for x in S:
			# 256 px = 4 m: 64 px per metre, bricks 0.2 x 0.1 m (12.8 x 6.4 px)
			var row := y / 6
			var off := 6 if row % 2 == 1 else 0
			var grout := (y % 6 == 0) or ((x + off) % 13 == 0)
			var band := (x < 16 or y < 16)              # 0.25 m terracotta band around each 4 m square
			var col := Color(0.78, 0.72, 0.62) if not band else Color(0.62, 0.34, 0.26)
			if (x / 64 + y / 64) % 2 == 1 and not band:
				col = Color(0.72, 0.66, 0.57)
			var k := 1.0 + n.get_noise_2d(x * 3.0, y * 3.0) * 0.06
			col = Color(col.r * k, col.g * k, col.b * k)
			img.set_pixel(x, y, col.darkened(0.35) if grout else col)
	img.generate_mipmaps()
	var m := StandardMaterial3D.new()
	m.albedo_texture = ImageTexture.create_from_image(img)
	m.uv1_triplanar = true
	m.uv1_world_triplanar = true
	m.uv1_scale = Vector3(0.25, 0.25, 0.25)
	m.roughness = 0.75
	return m
