class_name PlotPatches
extends Node3D
## 0.24: fine ground under the car parks of AMID supermarkets and malls. The world terrain is an 8 m
## grid, too coarse for a car park edge or a 6 m driveway (it left the car park on a step and the
## driveway on a 1 m embankment). Here a 2 m mesh with the terrain's own material (splat by world
## position, so it matches) lies over the coarse ground: level just under the car park asphalt, an even
## slope down the driveway's profile to the street, and blended into the coarse terrain at its edges.
## It has its own collision (walk / drive on it) and a visibility range (mobile).

const STEP := 2.0
const SIDE := 7.0                  ## beyond the plot sides
const BLEND := 7.0                 ## m to fade into the coarse terrain
const PARK := 30.0                 ## the car park's depth (from the front edge into the plot)

var wd: WorldData
var mat: Material
var count := 0


func build(world: WorldData, terrain_mat: Material) -> void:
	wd = world
	mat = terrain_mat
	var drives: Array = []
	for r in wd.roads:
		if String(r.get("id", "")).begins_with("drive"):
			drives.append(r)
	for b in wd.buildings:
		if String(b[0]) in ["amid_m", "mall_m"]:
			_patch(b, drives)


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
	# the driveway that starts at this front: its height profile by distance
	var prof_s: Array[float] = []
	var prof_h: Array[float] = []
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
			break
	var apron := maxf(0.0, (prof_s[-1] - 6.0) if not prof_s.is_empty() else 0.0)
	var f0 := D * 0.5 - PARK
	var f1 := D * 0.5 + apron + BLEND
	var nx := int(ceil((L + 2.0 * (SIDE + BLEND)) / STEP)) + 1
	var nz := int(ceil((f1 - f0) / STEP)) + 1
	var V := PackedVector3Array()
	V.resize(nx * nz)
	for j in nz:
		var fz := f0 + j * STEP
		for i in nx:
			var lx := -L * 0.5 - SIDE - BLEND + i * STEP
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
	var I := PackedInt32Array()
	for j in nz - 1:
		for i in nx - 1:
			var a := j * nx + i
			# the grid axes (right, front) are mirrored against the terrain's (x, z): this winding faces up
			I.append_array([a, a + nx, a + 1, a + 1, a + nx, a + nx + 1])
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	for v in V:
		st.add_vertex(v)
	for q in I:
		st.add_index(q)
	st.generate_normals()
	var mesh := st.commit()
	var mi := MeshInstance3D.new()
	mi.name = "PlotPatch%d" % count
	mi.mesh = mesh
	mi.material_override = mat
	mi.visibility_range_end = 900.0
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mi)
	var body := StaticBody3D.new()
	var cs := CollisionShape3D.new()
	cs.shape = mesh.create_trimesh_shape()
	body.add_child(cs)
	mi.add_child(body)
	count += 1


static func _interp(xs: Array[float], ys: Array[float], x: float) -> float:
	if x <= xs[0]:
		return ys[0]
	for k in range(1, xs.size()):
		if x <= xs[k]:
			var t := (x - xs[k - 1]) / maxf(xs[k] - xs[k - 1], 0.001)
			return lerpf(ys[k - 1], ys[k], t)
	return ys[-1]
