class_name CityLife
extends Node3D
## 0.25: city traffic and pedestrians, pooled near the camera (mobile budget).
##  Traffic: cars from the owner's pack (W123, E30, R12, GLS - visual models, no physics simulation)
##  drive in the right-hand lane of avenues / streets along the road polylines at 30 .. 55 km/h; each has
##  a kinematic body (the player's car hits it), brakes for the player, his car and the car ahead,
##  disappears at the end of its road or far away and is spawned again elsewhere near the camera.
##  Pedestrians: the city's character model walking (mocap walk) along the sidewalks, turning back at
##  the end of a street. Counts follow the graphics quality (Settings.quality).

const CAR_MODELS := [["res://assets/models/cars/w123.glb", Vector3(1.8, 1.4, 4.8)],
	["res://assets/models/cars/e30.glb", Vector3(1.7, 1.35, 4.4)],
	["res://assets/models/cars/r12.glb", Vector3(1.65, 1.4, 4.4)],
	["res://assets/models/cars/gls.glb", Vector3(2.0, 1.8, 5.2)]]
const PED_MODEL := "res://assets/characters/player/player.glb"
const MOCAP := "res://assets/characters/animations/player_mocap.res"
const CAR_NEAR := 110.0
const CAR_FAR := 300.0
const PED_NEAR := 25.0
const PED_FAR := 120.0

var wd: WorldData
var session: CarSession
var enabled := true
var max_cars := 8
var max_peds := 6
var cars: Array = []        ## {node, body, road, s, dir, v, vmax, lane, len}
var peds: Array = []        ## {node, road, s, dir, v, ap}
var _roads: Array = []      ## {p: PackedVector3Array, s: PackedFloat32Array, hw, cls}
var _rng := RandomNumberGenerator.new()
var _scenes := {}
var _t := 0.0


func _ready() -> void:
	_rng.randomize()
	wd = WorldData.get_instance()
	if wd == null or not wd.ok:
		return
	for r in wd.roads:
		var cls := String(r["cls"])
		var id := String(r.get("id", ""))
		if not cls in ["avenue", "street"] or id.begins_with("drive"):
			continue
		var P := PackedVector3Array()
		var S := PackedFloat32Array()
		var acc := 0.0
		for q in r["pts"]:
			var v := Vector3(float(q[0]), float(q[1]), float(q[2]))
			if not P.is_empty():
				acc += v.distance_to(P[P.size() - 1])
			P.append(v)
			S.append(acc)
		if acc < 120.0:
			continue
		_roads.append({"p": P, "s": S, "hw": float(r["w"]) * 0.5, "cls": cls})
	_apply_quality()
	Settings.quality_changed.connect(func(_q: int) -> void: _apply_quality())


func _apply_quality() -> void:
	var q := int(Settings.quality)
	max_cars = [2, 4, 7, 9][clampi(q, 0, 3)]
	max_peds = [3, 5, 8, 10][clampi(q, 0, 3)]


func _focus() -> Vector3:
	var cam := get_viewport().get_camera_3d()
	return cam.global_position if cam else Vector3.ZERO


## position and direction on a road polyline at distance s, offset sideways (right of travel)
func _at(R: Dictionary, s: float, dir: int, side: float) -> Array:
	var P: PackedVector3Array = R["p"]
	var S: PackedFloat32Array = R["s"]
	s = clampf(s, 0.0, S[S.size() - 1])
	var lo := 0
	var hi := S.size() - 1
	while hi - lo > 1:
		var mid := (lo + hi) >> 1
		if S[mid] <= s:
			lo = mid
		else:
			hi = mid
	var t := (s - S[lo]) / maxf(S[hi] - S[lo], 0.001)
	var p := P[lo].lerp(P[hi], t)
	var d := (P[hi] - P[lo])
	d.y = 0.0
	d = d.normalized() * float(dir)
	if d == Vector3.ZERO:
		d = Vector3.FORWARD
	var right := d.cross(Vector3.UP)
	return [p + right * side, d]


func _process(delta: float) -> void:
	if not enabled or _roads.is_empty():
		return
	var f := _focus()
	_t -= delta
	if _t <= 0.0:
		_t = 0.5
		_manage(f)
	_drive(delta, f)
	_walk(delta)


func _manage(f: Vector3) -> void:
	# despawn far / finished, then spawn up to the budget
	for c in cars.duplicate():
		var R: Dictionary = _roads[c["road"]]
		var L: float = (R["s"] as PackedFloat32Array)[-1]
		var done: bool = (c["dir"] > 0 and c["s"] > L - 2.0) or (c["dir"] < 0 and c["s"] < 2.0)
		if done or (c["node"] as Node3D).global_position.distance_to(f) > CAR_FAR:
			(c["node"] as Node).queue_free()
			cars.erase(c)
	for p in peds.duplicate():
		if (p["node"] as Node3D).global_position.distance_to(f) > PED_FAR + 20.0:
			(p["node"] as Node).queue_free()
			peds.erase(p)
	var tries := 0
	while cars.size() < max_cars and tries < 6:
		tries += 1
		_spawn_car(f)
	tries = 0
	while peds.size() < max_peds and tries < 6:
		tries += 1
		_spawn_ped(f)


func _pick(f: Vector3, rmin: float, rmax: float) -> Array:
	## a random road point at rmin..rmax from f: [road index, s]
	for attempt in 24:
		var ri := _rng.randi() % _roads.size()
		var R: Dictionary = _roads[ri]
		var P: PackedVector3Array = R["p"]
		var k := _rng.randi() % P.size()
		var d := Vector2(P[k].x - f.x, P[k].z - f.z).length()
		if d < rmin or d > rmax:
			continue
		if wd.in_plaza(P[k].x, P[k].z):
			continue
		return [ri, float((R["s"] as PackedFloat32Array)[k])]
	return []


func _scene(path: String) -> PackedScene:
	if not _scenes.has(path):
		_scenes[path] = load(path) if ResourceLoader.exists(path) else null
	return _scenes[path]


func _spawn_car(f: Vector3) -> void:
	var pk := _pick(f, CAR_NEAR, CAR_FAR - 60.0)
	if pk.is_empty():
		return
	var R: Dictionary = _roads[pk[0]]
	var dir := 1 if _rng.randf() < 0.5 else -1
	var lane := float(R["hw"]) * (0.55 if R["cls"] == "avenue" else 0.5)
	var at := _at(R, pk[1], dir, lane)
	# keep a gap to the other traffic cars
	for c in cars:
		if (c["node"] as Node3D).global_position.distance_to(at[0]) < 18.0:
			return
	var m: Array = CAR_MODELS[_rng.randi() % CAR_MODELS.size()]
	var ps := _scene(m[0])
	if ps == null:
		return
	var n := Node3D.new()
	n.name = "TrafficCar"
	add_child(n)
	var model: Node3D = ps.instantiate()
	model.rotation.y = PI                    # the pack models face +Z; the car frame faces -Z
	n.add_child(model)
	for mi in model.find_children("*", "MeshInstance3D", true, false):
		(mi as MeshInstance3D).cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		(mi as MeshInstance3D).visibility_range_end = CAR_FAR
	var body := AnimatableBody3D.new()
	body.sync_to_physics = false
	var cs := CollisionShape3D.new()
	var bx := BoxShape3D.new()
	bx.size = m[1]
	cs.shape = bx
	cs.position = Vector3(0, (m[1] as Vector3).y * 0.5 + 0.1, 0)
	body.add_child(cs)
	n.add_child(body)
	var vmax := _rng.randf_range(30.0, 55.0) / 3.6 if R["cls"] == "street" else _rng.randf_range(40.0, 60.0) / 3.6
	cars.append({"node": n, "road": pk[0], "s": pk[1], "dir": dir, "v": vmax * 0.7, "vmax": vmax, "lane": lane})
	_place_car(cars[-1])


func _place_car(c: Dictionary) -> void:
	var at := _at(_roads[c["road"]], c["s"], c["dir"], c["lane"])
	var n: Node3D = c["node"]
	var d: Vector3 = at[1]
	var target := Basis.looking_at(d, Vector3.UP)
	n.global_transform = Transform3D(n.global_basis.slerp(target, 0.25) if n.is_inside_tree() and n.global_position != Vector3.ZERO else target, at[0] + Vector3(0, 0.07, 0))


func _drive(delta: float, _f: Vector3) -> void:
	var obstacles: Array[Vector3] = []
	if session:
		if session.car:
			obstacles.append(session.car.global_position)
		if session.player and not session.driving:
			obstacles.append((session.player as Node3D).global_position)
	for c in cars:
		var n: Node3D = c["node"]
		var fwd := -n.global_basis.z
		var want: float = c["vmax"]
		for o in obstacles:
			var rel := o - n.global_position
			var ahead := rel.dot(fwd)
			if ahead > 0.0 and ahead < 22.0 and absf(rel.dot(n.global_basis.x)) < 2.4:
				want = minf(want, maxf(0.0, (ahead - 7.0) * 0.8))
		for o2 in cars:
			if o2 == c:
				continue
			var rel2 := (o2["node"] as Node3D).global_position - n.global_position
			var ah2 := rel2.dot(fwd)
			if ah2 > 0.0 and ah2 < 20.0 and absf(rel2.dot(n.global_basis.x)) < 1.8:
				want = minf(want, maxf(0.0, (ah2 - 8.0) * 0.8))
		var v: float = c["v"]
		v = move_toward(v, want, delta * (2.5 if want > v else 7.0))
		c["v"] = v
		c["s"] = float(c["s"]) + v * delta * float(c["dir"])
		_place_car(c)


func _spawn_ped(f: Vector3) -> void:
	var pk := _pick(f, PED_NEAR, PED_FAR - 30.0)
	if pk.is_empty():
		return
	var ps := _scene(PED_MODEL)
	if ps == null:
		return
	var R: Dictionary = _roads[pk[0]]
	var dir := 1 if _rng.randf() < 0.5 else -1
	var side := (float(R["hw"]) + 1.6 + _rng.randf_range(-0.4, 0.6)) * (1.0 if _rng.randf() < 0.5 else -1.0)
	var n: Node3D = ps.instantiate()
	n.name = "Pedestrian"
	add_child(n)
	n.scale = Vector3.ONE * _rng.randf_range(0.93, 1.04)
	for mi in n.find_children("*", "MeshInstance3D", true, false):
		(mi as MeshInstance3D).cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		(mi as MeshInstance3D).visibility_range_end = PED_FAR
	var ap: AnimationPlayer = n.find_child("AnimationPlayer", true, false)
	var v := _rng.randf_range(1.1, 1.45)
	if ap and ResourceLoader.exists(MOCAP):
		if not ap.has_animation_library(&"m"):
			ap.add_animation_library(&"m", load(MOCAP))
		if ap.has_animation(&"m/walk"):
			ap.play(&"m/walk")
			ap.speed_scale = v / 0.983
			ap.seek(_rng.randf() * 1.0, true)
	peds.append({"node": n, "road": pk[0], "s": pk[1], "dir": dir, "v": v, "side": side})
	_place_ped(peds[-1])


func _place_ped(p: Dictionary) -> void:
	var R: Dictionary = _roads[p["road"]]
	var at := _at(R, p["s"], p["dir"], float(p["side"]) * float(p["dir"]))
	var n: Node3D = p["node"]
	var pos: Vector3 = at[0]
	pos.y += 0.17
	var d: Vector3 = at[1]
	n.global_position = pos
	n.rotation.y = atan2(d.x, d.z)              # the character model faces +Z


func _walk(delta: float) -> void:
	for p in peds:
		var R: Dictionary = _roads[p["road"]]
		var L: float = (R["s"] as PackedFloat32Array)[-1]
		p["s"] = float(p["s"]) + float(p["v"]) * delta * float(p["dir"])
		if float(p["s"]) > L - 3.0 or float(p["s"]) < 3.0:
			p["dir"] = -int(p["dir"])
			p["s"] = clampf(float(p["s"]), 3.0, L - 3.0)
		_place_ped(p)
