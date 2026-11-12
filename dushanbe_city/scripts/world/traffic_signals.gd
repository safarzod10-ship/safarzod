class_name TrafficSignals
extends Node3D
## Working traffic lights at the city junctions (the corner poles placed by WorldSectorBuilder from the
## kerb fillets). Each junction runs a 2-phase cycle (axis A green 10 s, yellow 2 s, axis B green 10 s,
## yellow 2 s), offset per junction. Signal heads with red / yellow / green lamps are built only near the
## camera (mobile). CityLife's traffic stops at red and yellow (stop_distance()).

const CYCLE := 24.0
const BUILD_R := 170.0

static var instance: TrafficSignals
var junctions: Array = []      ## {c: Vector3, axis: Vector3, poles: [{p, dv}], off, node, lamps: []}
var _t := 0.0
var _clock := 0.0             ## game time (s)
var _mats := {}


func _ready() -> void:
	instance = self
	var wd := WorldData.get_instance()
	if wd == null or not wd.ok:
		return
	for f in wd.fillets:
		var C := Vector3(f["c"][0], float(f["c"][1]), f["c"][2])
		var O := Vector3(f["o"][0], C.y, f["o"][1])
		var dv := C - O
		if dv.length() < 0.5 or float(f["r"]) <= 4.0:
			continue
		dv = dv.normalized()
		var pole := O + dv * (float(f["r"]) - 1.4)
		pole.y = C.y + 0.15
		var j: Dictionary = {}
		for g in junctions:
			if Vector2(g["c"].x - C.x, g["c"].z - C.z).length() < 30.0:
				j = g
				break
		if j.is_empty():
			j = {"c": C, "sum": Vector3.ZERO, "n": 0, "poles": [], "node": null, "lamps": []}
			junctions.append(j)
		j["sum"] = (j["sum"] as Vector3) + C
		j["n"] = int(j["n"]) + 1
		(j["poles"] as Array).append({"p": pole, "dv": dv})
	for j in junctions:
		j["c"] = (j["sum"] as Vector3) / float(j["n"])
		j["axis"] = _axis_at(wd, j["c"])
		j["off"] = fposmod(j["c"].x * 0.37 + j["c"].z * 0.61, CYCLE)
		# poles: alternate A / B round the centre
		var poles: Array = j["poles"]
		var c: Vector3 = j["c"]
		poles.sort_custom(func(a: Dictionary, b: Dictionary) -> bool:
			return atan2(a["p"].x - c.x, a["p"].z - c.z) < atan2(b["p"].x - c.x, b["p"].z - c.z))
		for k in poles.size():
			poles[k]["ax"] = k % 2
	for nm in ["red", "yellow", "green"]:
		var col: Color = {"red": Color(1, 0.08, 0.05), "yellow": Color(1, 0.7, 0.05), "green": Color(0.1, 1, 0.3)}[nm]
		var on := StandardMaterial3D.new()
		on.albedo_color = col
		on.emission_enabled = true
		on.emission = col
		on.emission_energy_multiplier = 3.5
		var off := StandardMaterial3D.new()
		off.albedo_color = col.darkened(0.82)
		_mats[nm] = [off, on]
	_mats["body"] = StandardMaterial3D.new()
	(_mats["body"] as StandardMaterial3D).albedo_color = Color(0.06, 0.06, 0.07)


func _axis_at(wd: WorldData, c: Vector3) -> Vector3:
	var best := INF
	var ax := Vector3.FORWARD
	for r in wd.roads:
		var pts: Array = r["pts"]
		for k in range(1, pts.size()):
			var q := Vector3(pts[k][0], 0, pts[k][2])
			var d := Vector2(q.x - c.x, q.z - c.z).length()
			if d < best:
				best = d
				var q0 := Vector3(pts[k - 1][0], 0, pts[k - 1][2])
				ax = (q - q0).normalized()
	return ax


## "green" / "yellow" / "red" for axis 0 (A) or 1 (B) of a junction
func state(j: Dictionary, ax: int) -> String:
	var t := fposmod(_clock + float(j["off"]), CYCLE)
	if ax == 1:
		t = fposmod(t - CYCLE * 0.5, CYCLE)
	if t < 10.0:
		return "green"
	if t < 12.0:
		return "yellow"
	return "red"


## distance to the junction ahead of a car if it must stop there (red / yellow), else INF
func stop_distance(pos: Vector3, fwd: Vector3) -> float:
	for j in junctions:
		var rel: Vector3 = j["c"] - pos
		rel.y = 0.0
		var ahead := rel.dot(fwd)
		if ahead < 9.0 or ahead > 45.0 or absf(rel.dot(fwd.cross(Vector3.UP))) > 14.0:
			continue
		var ax := 0 if absf(fwd.dot(j["axis"])) > 0.7 else 1
		if state(j, ax) != "green":
			return ahead
	return INF


func _process(delta: float) -> void:
	_clock += delta
	_t -= delta
	if _t > 0.0:
		return
	_t = 0.25
	var cam := get_viewport().get_camera_3d()
	if cam == null:
		return
	var f := cam.global_position
	for j in junctions:
		var d := Vector2(j["c"].x - f.x, j["c"].z - f.z).length()
		if d < BUILD_R and j["node"] == null:
			_build(j)
		elif d > BUILD_R + 40.0 and j["node"] != null:
			(j["node"] as Node).queue_free()
			j["node"] = null
			j["lamps"] = []
		if j["node"] != null:
			for L in j["lamps"]:
				var st := state(j, int(L["ax"]))
				for nm in ["red", "yellow", "green"]:
					(L[nm] as MeshInstance3D).material_override = _mats[nm][1 if st == nm else 0]


## a signal head on every corner pole: black box with the three lamps on both faces
func _build(j: Dictionary) -> void:
	var root := Node3D.new()
	root.name = "Signals"
	add_child(root)
	j["node"] = root
	var lamps: Array = []
	var bm := BoxMesh.new()
	bm.size = Vector3(0.38, 1.0, 0.3)
	var sm := SphereMesh.new()
	sm.radius = 0.11
	sm.height = 0.22
	sm.radial_segments = 10
	sm.rings = 5
	for P in j["poles"]:
		var head := Node3D.new()
		root.add_child(head)
		var dv: Vector3 = P["dv"]
		head.global_transform = Transform3D(Basis.looking_at(dv, Vector3.UP), (P["p"] as Vector3) + Vector3(0, 3.05, 0) - dv * 0.05)
		var box := MeshInstance3D.new()
		box.mesh = bm
		box.material_override = _mats["body"]
		box.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		head.add_child(box)
		var L := {"ax": P["ax"]}
		for side in [-1.0, 1.0]:
			for k in 3:
				var nm: String = ["red", "yellow", "green"][k]
				var lm := MeshInstance3D.new()
				lm.mesh = sm
				lm.position = Vector3(0, 0.3 - k * 0.3, side * 0.15)
				lm.scale = Vector3(1, 1, 0.45)
				lm.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
				head.add_child(lm)
				if side > 0:
					L[nm] = lm
				else:
					L[nm + "_b"] = lm
		lamps.append(L)
		# the back face mirrors the front lamps
		var L2 := {"ax": P["ax"], "red": L["red_b"], "yellow": L["yellow_b"], "green": L["green_b"]}
		lamps.append(L2)
	j["lamps"] = lamps
