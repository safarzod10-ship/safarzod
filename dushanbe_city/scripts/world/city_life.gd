class_name CityLife
extends Node3D
## 0.25: city traffic and pedestrians, pooled near the camera (mobile budget).
##  Traffic: cars from the owner's pack (W123, E30, R12, GLS - visual models, no physics simulation)
##  drive in the right-hand lane of avenues / streets along the road polylines at 30 .. 55 km/h; each has
##  a kinematic body (the player's car hits it), brakes for the player, his car and the car ahead,
##  disappears at the end of its road or far away and is spawned again elsewhere near the camera.
##  Pedestrians: the city's character model walking (mocap walk) along the sidewalks, turning back at
##  the end of a street. Counts follow the graphics quality (Settings.quality).

const CAR_MODELS := [["res://assets/models/cars/w123.glb", Vector3(1.8, 1.4, 4.8), "w123"],
	["res://assets/models/cars/e30.glb", Vector3(1.7, 1.35, 4.4), "e30"],
	["res://assets/models/cars/r12.glb", Vector3(1.65, 1.4, 4.4), "r12"],
	["res://assets/models/cars/gls.glb", Vector3(2.0, 1.8, 5.2), "gls"]]
const NPC_SKINS := 8
const MAX_STOLEN := 2
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
var max_parked := 6
var cars: Array = []        ## {node, body, road, s, dir, v, vmax, lane, len}
var peds: Array = []        ## {node, road, s, dir, v, ap}
var _roads: Array = []      ## {p: PackedVector3Array, s: PackedFloat32Array, hw, cls}
var _rng := RandomNumberGenerator.new()
var _scenes := {}
var _t := 0.0
static var instance: CityLife
signal crime(level: int, at: Vector3)     ## the player's crimes (stolen car 2, assault 1, murder 3) -> police
var stolen: Array = []      ## VehicleCar taken from the traffic (oldest freed beyond MAX_STOLEN)
var _skins: Array = []      ## NPC clothing albedo variants (assets/characters/npc)
var _bodies := {}           ## collider instance id -> ped dict
var _steal_n := 0


func _ready() -> void:
	instance = self
	_rng.randomize()
	for k in NPC_SKINS:
		var tp := "res://assets/characters/npc/npc_%d.jpg" % k
		if ResourceLoader.exists(tp):
			_skins.append(load(tp))
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
		var bb := AABB(P[0], Vector3.ZERO)
		for q2 in P:
			bb = bb.expand(q2)
		_roads.append({"p": P, "s": S, "hw": float(r["w"]) * 0.5, "cls": cls, "bb": bb})
	_apply_quality()
	Settings.quality_changed.connect(func(_q: int) -> void: _apply_quality())


func _apply_quality() -> void:
	var q := int(Settings.quality)
	max_cars = [2, 4, 7, 9][clampi(q, 0, 3)]
	max_peds = [3, 5, 8, 10][clampi(q, 0, 3)]
	max_parked = [2, 4, 6, 8][clampi(q, 0, 3)]


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
	_tick_cash(delta)
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
		var done: bool = not c.get("parked", false) and ((c["dir"] > 0 and c["s"] > L - 2.0) or (c["dir"] < 0 and c["s"] < 2.0))
		if done or (c["node"] as Node3D).global_position.distance_to(f) > (260.0 if c.get("parked", false) else CAR_FAR):
			(c["node"] as Node).queue_free()
			cars.erase(c)
	for p in peds.duplicate():
		var gone: bool = p["state"] == "dead" and float(p["t"]) > 25.0
		if gone or (p["node"] as Node3D).global_position.distance_to(f) > PED_FAR + 20.0:
			_bodies.erase((p["body"] as Node).get_instance_id())
			(p["node"] as Node).queue_free()
			peds.erase(p)
	for v in stolen.duplicate():
		if not is_instance_valid(v):
			stolen.erase(v)
	var tries := 0
	var moving := cars.filter(func(c: Dictionary) -> bool: return not c.get("parked", false)).size()
	while moving < max_cars and tries < 6:
		tries += 1
		var n0 := cars.size()
		_spawn_car(f)
		moving += cars.size() - n0
	# 0.26: parked cars along the side streets (stealable like the traffic)
	var parked := cars.size() - moving
	tries = 0
	while parked < max_parked and tries < 6:
		tries += 1
		var n1 := cars.size()
		_spawn_car(f, true)
		parked += cars.size() - n1
	tries = 0
	while peds.size() < max_peds and tries < 6:
		tries += 1
		_spawn_ped(f)


func _pick(f: Vector3, rmin: float, rmax: float) -> Array:
	## a random road point at rmin..rmax from f: [road index, s] (only roads passing near f)
	var near: Array[int] = []
	for i in _roads.size():
		var bb: AABB = _roads[i]["bb"]
		var g := bb.grow(rmax)
		if f.x > g.position.x and f.x < g.end.x and f.z > g.position.z and f.z < g.end.z:
			near.append(i)
	if near.is_empty():
		return []
	for attempt in 24:
		var ri: int = near[_rng.randi() % near.size()]
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


func _spawn_car(f: Vector3, parked := false) -> void:
	var pk := _pick(f, 40.0 if parked else CAR_NEAR, 200.0 if parked else CAR_FAR - 60.0)
	if pk.is_empty():
		return
	var R: Dictionary = _roads[pk[0]]
	if parked and R["cls"] != "street":
		return                                       # parking along the side streets only
	var dir := 1 if _rng.randf() < 0.5 else -1
	var lane := float(R["hw"]) * (0.55 if R["cls"] == "avenue" else 0.5)
	if parked:
		lane = float(R["hw"]) - 1.15                 # at the kerb
	var at := _at(R, pk[1], dir, lane)
	if parked and TrafficSignals.instance:
		for j in TrafficSignals.instance.junctions:
			if Vector2(j["c"].x - at[0].x, j["c"].z - at[0].z).length() < 28.0:
				return                               # never on a junction / crossing
	# keep a gap to the other traffic cars
	for c in cars:
		if (c["node"] as Node3D).global_position.distance_to(at[0]) < (7.0 if parked else 18.0):
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
	var st := _StealSpot.new()
	st.life = self
	st.position = Vector3(-1.1, 0, -0.35)            # driver's door (left, car frame faces -Z)
	n.add_child(st)
	cars.append({"node": n, "road": pk[0], "s": pk[1], "dir": dir, "v": 0.0 if parked else vmax * 0.7, "vmax": vmax, "lane": lane, "preset": m[2], "spot": st, "parked": parked})
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
		if c.get("parked", false):
			continue
		var n: Node3D = c["node"]
		var fwd := -n.global_basis.z
		var want: float = c["vmax"]
		if TrafficSignals.instance:
			var sd := TrafficSignals.instance.stop_distance(n.global_position, fwd)
			if sd < INF:
				want = minf(want, maxf(0.0, (sd - 15.0) * 0.7))
		if session and not session.driving and session.player:
			var pr := (session.player as Node3D).global_position - n.global_position
			if pr.length() < 3.6:
				want = 0.0
		var blocked_by_player := false
		for o in obstacles:
			var rel := o - n.global_position
			var ahead := rel.dot(fwd)
			if ahead > 0.0 and ahead < 22.0 and absf(rel.dot(n.global_basis.x)) < 2.4:
				want = minf(want, maxf(0.0, (ahead - 7.0) * 0.8))
				if ahead < 12.0:
					blocked_by_player = true
		# like GTA: a driver held up by the player honks (after 2 s, now and then)
		c["wait"] = float(c.get("wait", 0.0)) + delta if blocked_by_player and float(c["v"]) < 1.0 else 0.0
		if float(c["wait"]) > 2.0 and randf() < delta * 0.5:
			_honk(n.global_position)
		for o2 in cars:
			if o2 == c or o2.get("parked", false):
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


var _horn_s: AudioStream


func _honk(at: Vector3) -> void:
	if _horn_s == null:
		var hp := "res://assets/audio/city/amb_horn.ogg"
		if not ResourceLoader.exists(hp):
			return
		_horn_s = load(hp)
	var a := AudioStreamPlayer3D.new()
	a.stream = _horn_s
	a.unit_size = 10.0
	a.max_distance = 120.0
	a.pitch_scale = randf_range(0.9, 1.15)
	add_child(a)
	a.global_position = at
	a.play()
	a.finished.connect(a.queue_free)


func _spawn_ped(f: Vector3) -> Variant:
	var pk := _pick(f, PED_NEAR, PED_FAR - 30.0)
	if pk.is_empty():
		return null
	return _make_ped(pk[0], pk[1])


func _make_ped(road: int, s0: float) -> Variant:
	var pk := [road, s0]
	var ps := _scene(PED_MODEL)
	if ps == null:
		return null
	var R: Dictionary = _roads[pk[0]]
	var dir := 1 if _rng.randf() < 0.5 else -1
	var side := (float(R["hw"]) + 1.6 + _rng.randf_range(-0.4, 0.6)) * (1.0 if _rng.randf() < 0.5 else -1.0)
	var n: Node3D = ps.instantiate()
	n.name = "Pedestrian"
	add_child(n)
	n.scale = Vector3.ONE * _rng.randf_range(0.93, 1.04)
	var skin: Texture2D = _skins[_rng.randi() % _skins.size()] if not _skins.is_empty() else null
	for mi in n.find_children("*", "MeshInstance3D", true, false):
		var m3 := mi as MeshInstance3D
		m3.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		m3.visibility_range_end = PED_FAR
		if skin and m3.mesh:
			var base := m3.get_active_material(0) as StandardMaterial3D
			if base:
				var mm := base.duplicate() as StandardMaterial3D
				mm.albedo_texture = skin
				m3.material_override = mm
	var body := StaticBody3D.new()
	body.collision_layer = 1 << 3                   # layer 4: rays / shape queries hit it, nothing collides
	body.collision_mask = 0
	var cs := CollisionShape3D.new()
	var cap := CapsuleShape3D.new()
	cap.radius = 0.32
	cap.height = 1.75
	cs.shape = cap
	cs.position.y = 0.9
	body.add_child(cs)
	n.add_child(body)
	var ap: AnimationPlayer = n.find_child("AnimationPlayer", true, false)
	var v := _rng.randf_range(1.1, 1.45)
	if ap and ResourceLoader.exists(MOCAP):
		if not ap.has_animation_library(&"m"):
			ap.add_animation_library(&"m", load(MOCAP))
		if ap.has_animation(&"m/walk"):
			ap.play(&"m/walk")
			ap.speed_scale = v / 0.983
			ap.seek(_rng.randf() * 1.0, true)
	var pd := {"node": n, "road": pk[0], "s": pk[1], "dir": dir, "v": v, "v0": v, "side": side, "ap": ap,
			"state": "walk", "t": 0.0, "hp": 100.0, "body": body}
	_bodies[body.get_instance_id()] = pd
	peds.append(pd)
	_place_ped(pd)
	return pd


func _place_ped(p: Dictionary) -> void:
	var R: Dictionary = _roads[p["road"]]
	var at := _at(R, p["s"], p["dir"], float(p["side"]) * float(p["dir"]))
	var n: Node3D = p["node"]
	var pos: Vector3 = at[0]
	pos.y += 0.17
	var d: Vector3 = at[1]
	n.global_position = pos
	n.rotation = Vector3(0, atan2(d.x, d.z), 0)    # the character model faces +Z (scale kept)


func _walk(delta: float) -> void:
	var car: VehiclePrado = session.car if session and session.driving else null
	for p in peds:
		p["t"] = float(p["t"]) + delta
		var st: String = p["state"]
		if st == "down" or st == "dead":
			if st == "down" and float(p["t"]) > 2.6:
				_get_up(p)
			continue
		if st == "flee" and float(p["t"]) > 9.0:
			p["state"] = "walk"
			p["v"] = p["v0"]
			_anim(p, "walk")
		var R: Dictionary = _roads[p["road"]]
		var L: float = (R["s"] as PackedFloat32Array)[-1]
		p["s"] = float(p["s"]) + float(p["v"]) * delta * float(p["dir"])
		if float(p["s"]) > L - 3.0 or float(p["s"]) < 3.0:
			p["dir"] = -int(p["dir"])
			p["s"] = clampf(float(p["s"]), 3.0, L - 3.0)
		_place_ped(p)
		# the player's car hits a pedestrian
		if car and car.speed_kmh > 12.0:
			var rel: Vector3 = car.global_transform.affine_inverse() * (p["node"] as Node3D).global_position
			if absf(rel.x) < 1.25 and absf(rel.z) < 2.7 and rel.y > -1.5 and rel.y < 2.0:
				hit(p, car.speed_kmh * 2.2, car.linear_velocity.normalized() + Vector3.UP * 0.3, true)
				car.weapon_hit(0.6)


## a weapon / punch / car hit on a ped collider: true if it was a pedestrian
## anyone (alive) within r of p who would see / hear it? (a gunshot in public -> the police are called)
func witnesses(p: Vector3, r: float) -> int:
	var n := 0
	for q in peds:
		if is_instance_valid(q["node"]) and q["state"] != "dead" and (q["node"] as Node3D).global_position.distance_to(p) < r:
			n += 1
	for c in cars:
		if is_instance_valid(c["node"]) and not c.get("parked", false) and (c["node"] as Node3D).global_position.distance_to(p) < r:
			n += 1
	return n


func hit_body(col: Object, dmg: float, dir: Vector3, knock := true) -> bool:
	if col == null:
		return false
	var p: Variant = _bodies.get(col.get_instance_id())
	if p == null:
		return false
	hit(p, dmg, dir, knock)
	return true


var cash: Array = []           ## dropped money: {node, amount, t}


## like GTA: a killed pedestrian drops their money (a green bundle; walk / drive over it to take it)
func _drop_cash(at: Vector3) -> void:
	var amt := randi_range(5, 80)
	var n := Node3D.new()
	n.name = "Cash"
	add_child(n)
	n.global_position = at + Vector3(randf_range(-0.6, 0.6), 0.15, randf_range(-0.6, 0.6))
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = Vector3(0.32, 0.12, 0.16)
	mi.mesh = bm
	var m := StandardMaterial3D.new()
	m.albedo_color = Color(0.25, 0.75, 0.3)
	m.emission_enabled = true
	m.emission = Color(0.2, 0.9, 0.3)
	m.emission_energy_multiplier = 0.8
	mi.material_override = m
	n.add_child(mi)
	var l := Label3D.new()
	l.text = "%d смн" % amt
	l.font = load("res://assets/fonts/game_font.tres")
	l.font_size = 40
	l.pixel_size = 0.006
	l.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	l.modulate = Color(0.4, 1.0, 0.45)
	l.outline_size = 8
	l.position.y = 0.45
	l.no_depth_test = true
	n.add_child(l)
	cash.append({"node": n, "amount": amt, "t": 60.0})


func _tick_cash(delta: float) -> void:
	if cash.is_empty():
		return
	var pl := get_tree().get_nodes_in_group(&"player")
	var pp: Vector3 = (pl[0] as Node3D).global_position if not pl.is_empty() else Vector3.INF
	for c in cash.duplicate():
		var n: Node3D = c["node"]
		c["t"] = float(c["t"]) - delta
		n.rotation.y += delta * 2.0
		var got := pp != Vector3.INF and Vector2(pp.x - n.global_position.x, pp.z - n.global_position.z).length() < 1.6 and absf(pp.y - n.global_position.y) < 2.5
		# driving over it picks it up too
		if not got:
			var s2: Node = get_tree().root.find_child("Main", true, false)
			var sess: Variant = s2.get("car_session") if s2 else null
			if sess and sess.driving and sess.car:
				var cp: Vector3 = sess.car.global_position
				got = Vector2(cp.x - n.global_position.x, cp.z - n.global_position.z).length() < 2.8
		if got:
			Wallet.earn(int(c["amount"]))
			WeaponFX.sound(get_tree(), "pickup", n.global_position, -4.0)
			n.queue_free()
			cash.erase(c)
		elif float(c["t"]) <= 0.0:
			n.queue_free()
			cash.erase(c)


func hit(p: Dictionary, dmg: float, dir: Vector3, knock: bool) -> void:
	if p["state"] == "dead":
		return
	p["hp"] = float(p["hp"]) - dmg
	var n: Node3D = p["node"]
	panic(n.global_position, 28.0)
	if float(p["hp"]) <= 0.0:
		crime.emit(3, n.global_position)
		_fall(p, dir, true)
		_drop_cash(n.global_position)
	elif knock:
		crime.emit(1, n.global_position)
		_fall(p, dir, false)
	else:
		crime.emit(2, n.global_position)        # wounded by a shot: armed assault (2 stars, like GTA)
		_flee(p, n.global_position - dir)


## everybody near p runs away from it (gunshot, fight, crash)
func panic(at: Vector3, radius: float) -> void:
	for q in peds:
		if q["state"] in ["walk", "flee"] and (q["node"] as Node3D).global_position.distance_to(at) < radius:
			_flee(q, at)
	for c in cars:
		if (c["node"] as Node3D).global_position.distance_to(at) < radius:
			c["vmax"] = maxf(float(c["vmax"]), 70.0 / 3.6)      # drivers floor it


func _flee(p: Dictionary, from: Vector3) -> void:
	var n: Node3D = p["node"]
	var R: Dictionary = _roads[p["road"]]
	var at := _at(R, p["s"], 1, 0.0)
	var along: Vector3 = at[1]
	p["dir"] = 1 if along.dot(n.global_position - from) >= 0.0 else -1
	p["state"] = "flee"
	p["t"] = 0.0
	p["v"] = _rng.randf_range(3.6, 4.6)
	_anim(p, "run")


func _fall(p: Dictionary, dir: Vector3, dead: bool) -> void:
	var n: Node3D = p["node"]
	p["state"] = "dead" if dead else "down"
	p["t"] = 0.0
	var ap: AnimationPlayer = p.get("ap")
	if ap:
		ap.pause()
	var hd := Vector3(dir.x, 0, dir.z)
	if hd.length() < 0.01:
		hd = -n.global_basis.z
	hd = hd.normalized()
	var axis := Vector3.UP.cross(hd).normalized()
	var start := n.global_transform
	var sc := n.scale
	var b0 := start.basis.orthonormalized()
	var end_basis := Basis(axis, PI * 0.5) * Basis(Vector3.UP, n.rotation.y)
	var end_pos := start.origin + hd * 1.4 + Vector3(0, 0.12, 0)
	var tw := n.create_tween()                 # dies with the pedestrian (no freed lambda captures)
	tw.tween_method(func(k: float) -> void:
		if is_instance_valid(n):
			n.global_transform = Transform3D(b0.slerp(end_basis, k).scaled_local(sc), start.origin.lerp(end_pos, k) + Vector3.UP * sin(k * PI) * 0.35),
		0.0, 1.0, 0.45).set_ease(Tween.EASE_IN)
	(p["body"] as CollisionObject3D).collision_layer = 0 if dead else 1 << 3


func _get_up(p: Dictionary) -> void:
	var n: Node3D = p["node"]
	# back onto the sidewalk line at the nearest point, then run away
	_place_ped(p)
	var ap: AnimationPlayer = p.get("ap")
	if ap:
		ap.play()
	_flee(p, n.global_position + Vector3(_rng.randf_range(-1, 1), 0, _rng.randf_range(-1, 1)))


func _anim(p: Dictionary, kind: String) -> void:
	var ap: AnimationPlayer = p.get("ap")
	if ap == null:
		return
	var nm := StringName("m/" + kind)
	if not ap.has_animation(nm):
		nm = &"m/walk"
	ap.play(nm, 0.2)
	ap.speed_scale = float(p["v"]) / (0.983 if kind == "walk" else 3.077)


# ------------------------------------------------------------------------------------------ stealing
## GTA-style: pull the driver out of a traffic car and drive away in a real car of that model
func steal(spot: Node) -> void:
	var c: Dictionary = {}
	for x in cars:
		if x["spot"] == spot:
			c = x
	if c.is_empty() or session == null or session.driving or session.busy:
		return
	var n: Node3D = c["node"]
	var xf := n.global_transform
	cars.erase(c)
	n.queue_free()
	_steal_n += 1
	var v := VehicleCar.new()
	v.configure(String(c["preset"]))
	v.name = "Stolen%d" % _steal_n
	v.collision_layer = 1
	v.collision_mask = 1
	get_parent().add_child(v)
	await get_tree().physics_frame
	v.place(xf.origin + Vector3(0, 0.4, 0), xf.basis.get_euler().y)
	session.add_vehicle(v)
	stolen.append(v)
	while stolen.size() > MAX_STOLEN:
		var old: VehiclePrado = stolen.pop_front()
		if is_instance_valid(old) and not (session.driving and session.car == old):
			session.vehicles.erase(old)
			old.queue_free()
	# the driver jumps out and runs (a parked car is empty: only the alarm)
	var pk := _nearest_road_s(xf.origin) if not c.get("parked", false) else []
	if not pk.is_empty():
		var pd: Variant = _make_ped(pk[0], pk[1])
		if pd:
			(pd["node"] as Node3D).global_position = xf * Vector3(-1.6, 0.0, 0.0)
			_flee(pd, session.player.global_position)
			# the driver shouts as he is thrown out (a speech line over his head for 3 s)
			var shout := Label3D.new()
			shout.text = ["Эй! Это моя машина!", "Помогите! Угон!", "Вызовите полицию!", "Ты что делаешь?!"][_rng.randi() % 4]
			shout.font = load("res://assets/fonts/game_font.tres")
			shout.font_size = 44
			shout.pixel_size = 0.006
			shout.outline_size = 10
			shout.billboard = BaseMaterial3D.BILLBOARD_ENABLED
			shout.modulate = Color(1, 1, 1)
			shout.position.y = 2.2
			(pd["node"] as Node3D).add_child(shout)
			get_tree().create_timer(3.0).timeout.connect(shout.queue_free)
	panic(xf.origin, 20.0)
	crime.emit(2, xf.origin)
	await get_tree().physics_frame
	await get_tree().physics_frame
	# the player at the driver's door (he was there: the car rolled a little while stopping)
	if not session.can_enter(v):
		session.player.teleport(v.driver_door_point(0.7), v.global_rotation.y)
		for i in 6:
			await get_tree().physics_frame
	session.enter_vehicle(v)


func _nearest_road_s(p: Vector3) -> Array:
	var best := INF
	var out: Array = []
	for ri in _roads.size():
		var P: PackedVector3Array = _roads[ri]["p"]
		for k in range(0, P.size(), 2):
			var d := Vector2(P[k].x - p.x, P[k].z - p.z).length()
			if d < best:
				best = d
				out = [ri, float((_roads[ri]["s"] as PackedFloat32Array)[k])]
	return out


class _StealSpot:
	extends Node3D
	var life: CityLife

	func _ready() -> void:
		add_to_group(&"interactable")

	func interaction_label(_player: Node) -> String:
		return "УГНАТЬ"

	func interaction_point(_player: Node) -> Vector3:
		return global_position

	func can_interact(_player: Node) -> bool:
		return life != null and life.session != null and not life.session.driving

	func interact(_player: Node) -> void:
		life.steal(self)
