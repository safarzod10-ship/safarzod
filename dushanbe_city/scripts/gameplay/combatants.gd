class_name Combatants
extends Node3D
## Armed people on foot (GTA rules):
##  * police officers: when a police car gets close to a wanted player (25 m) two officers jump out,
##    run at the player and shoot (from 2 stars; with 1 star they come to arrest). Killing an officer
##    is a crime (+1 star, at least 3). They leave when the stars go out.
##  * gangs: three districts of Dushanbe belong to gangs. Their men hang about the streets there; they
##    turn on you if you hang around them (3 s within 10 m), attack one of them or shoot nearby, and
##    then the whole group fights. A dead gang member drops money.
## Units use the city's character model with their own clothes colour, the mocap run / idle clips and a
## pistol (muzzle flash, tracer, sound); a wall between them and you stops the bullets.

const MODEL := "res://assets/characters/player/player.glb"
const MOCAP := "res://assets/characters/animations/player_mocap.res"
const GANGS := [
	{"name": "Банда «Шохмансур»", "c": Vector2(900.0, -2400.0), "r": 160.0, "col": Color(0.55, 0.08, 0.08)},
	{"name": "Банда «Сино»", "c": Vector2(-1300.0, -3700.0), "r": 170.0, "col": Color(0.1, 0.35, 0.15)},
	{"name": "Банда «Фирдавси»", "c": Vector2(-1500.0, -2100.0), "r": 150.0, "col": Color(0.25, 0.12, 0.45)},
]

static var instance: Combatants

var session: CarSession
var police: Police
var units: Array = []          ## {node, body, ap, hp, kind, gang, hostile, gun, t, near_t, dead_t}
var _bodies := {}
var _rng := RandomNumberGenerator.new()
var _scene: PackedScene
var _gang_spawned := {}        ## gang index -> true while its men are spawned
var _cop_mat: StandardMaterial3D
var _msg_t := 0.0


func _ready() -> void:
	instance = self
	_rng.randomize()
	if ResourceLoader.exists(MODEL):
		_scene = load(MODEL)
	_cop_mat = StandardMaterial3D.new()
	_cop_mat.albedo_color = Color(0.1, 0.16, 0.32)
	_cop_mat.roughness = 0.7


func _player_pos() -> Vector3:
	if session == null:
		return Vector3.INF
	if session.driving and session.car:
		return session.car.global_position
	return (session.player as Node3D).global_position if session.player else Vector3.INF


# ------------------------------------------------------------------------------------------ spawning
func _make(kind: String, at: Vector3, col: Color, gang := -1) -> Dictionary:
	var n: Node3D = _scene.instantiate()
	n.name = "Cop" if kind == "cop" else "Gangster"
	add_child(n)
	var wd := WorldData.get_instance()
	if wd and wd.ok:
		at.y = wd.height_at(at.x, at.z) + 0.05
	n.global_position = at
	var tint := StandardMaterial3D.new()
	for mi in n.find_children("*", "MeshInstance3D", true, false):
		var m3 := mi as MeshInstance3D
		m3.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		var base := m3.get_active_material(0) as StandardMaterial3D
		if base:
			tint = base.duplicate() as StandardMaterial3D
			tint.albedo_color = col
			m3.material_override = tint
	# a pistol in the right hand (a small dark box)
	var gun := MeshInstance3D.new()
	var gb := BoxMesh.new()
	gb.size = Vector3(0.05, 0.12, 0.22)
	gun.mesh = gb
	var gm := StandardMaterial3D.new()
	gm.albedo_color = Color(0.05, 0.05, 0.06)
	gun.material_override = gm
	gun.position = Vector3(-0.25, 1.15, 0.35)
	n.add_child(gun)
	var body := StaticBody3D.new()
	body.collision_layer = 1 << 3
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
	if ap and ResourceLoader.exists(MOCAP):
		if not ap.has_animation_library(&"m"):
			ap.add_animation_library(&"m", load(MOCAP))
		ap.play(&"m/idle")
	var u := {"node": n, "body": body, "ap": ap, "hp": 100.0, "kind": kind, "gang": gang, "hostile": kind == "cop",
			"gun": _rng.randf_range(0.5, 1.5), "t": 0.0, "near_t": 0.0, "dead_t": 0.0, "anim": "idle"}
	_bodies[body.get_instance_id()] = u
	units.append(u)
	return u


func deploy_officers(at: Vector3) -> void:
	if _scene == null:
		return
	for k in 2:
		_make("cop", at + Vector3(_rng.randf_range(-2.5, 2.5), 0, _rng.randf_range(-2.5, 2.5)), Color(0.12, 0.2, 0.42))


func _spawn_gang(gi: int) -> void:
	var g: Dictionary = GANGS[gi]
	var c: Vector2 = g["c"]
	var wd := WorldData.get_instance()
	for k in 5:
		var a := _rng.randf() * TAU
		var p := Vector3(c.x + cos(a) * _rng.randf_range(10, float(g["r"]) * 0.6), 0, c.y + sin(a) * _rng.randf_range(10, float(g["r"]) * 0.6))
		if wd and wd.ok and wd.road_edge_dist(p.x, p.z) < 0.5:
			p += Vector3(6, 0, 6)
		_make("gang", p, g["col"], gi)
	_gang_spawned[gi] = true


func _free_unit(u: Dictionary) -> void:
	_bodies.erase((u["body"] as Node).get_instance_id())
	if is_instance_valid(u["node"]):
		(u["node"] as Node).queue_free()
	units.erase(u)


# ------------------------------------------------------------------------------------------ damage
func hit_body(col: Object, dmg: float) -> bool:
	if col == null:
		return false
	var u: Variant = _bodies.get(col.get_instance_id())
	if u == null:
		return false
	hit(u, dmg)
	return true


func hit(u: Dictionary, dmg: float) -> void:
	if float(u["hp"]) <= 0.0:
		return
	u["hp"] = float(u["hp"]) - dmg
	var n: Node3D = u["node"]
	if u["kind"] == "gang":
		_anger(int(u["gang"]))
	elif CityLife.instance:
		CityLife.instance.crime.emit(2, n.global_position)          # shooting at the police
	if float(u["hp"]) <= 0.0:
		_die(u)


func _anger(gi: int) -> void:
	for u in units:
		if u["kind"] == "gang" and int(u["gang"]) == gi and float(u["hp"]) > 0.0:
			u["hostile"] = true
	if _msg_t <= 0.0 and CityLife.instance:
		_msg_t = 8.0
		var lj: Node = get_tree().root.find_child("LakLakJob", true, false)
		if lj and lj.has_method("toast"):
			lj.call("toast", "%s напала на вас!" % String(GANGS[gi]["name"]))


func _die(u: Dictionary) -> void:
	var n: Node3D = u["node"]
	u["hp"] = 0.0
	u["dead_t"] = 0.0
	(u["body"] as CollisionObject3D).collision_layer = 0
	var ap: AnimationPlayer = u["ap"]
	if ap:
		ap.pause()
	var tw := n.create_tween()
	var b0 := n.global_transform.basis.orthonormalized()
	var sc := n.scale
	var axis := n.global_basis.x.normalized()
	var p0 := n.global_position
	tw.tween_method(func(k: float) -> void:
		if is_instance_valid(n):
			n.global_transform = Transform3D(b0.slerp(Basis(axis, -PI * 0.5) * b0, k).scaled_local(sc), p0 + Vector3(0, 0.15 * k, 0)),
		0.0, 1.0, 0.4)
	if CityLife.instance:
		if u["kind"] == "cop":
			CityLife.instance.crime.emit(3, n.global_position)
		else:
			CityLife.instance._drop_cash(n.global_position)


# ------------------------------------------------------------------------------------------ AI
func _process(delta: float) -> void:
	_msg_t -= delta
	var tp := _player_pos()
	if tp == Vector3.INF:
		return
	# gangs: spawn when the player is near their district, despawn far away
	for gi in GANGS.size():
		var c: Vector2 = GANGS[gi]["c"]
		var d := Vector2(tp.x - c.x, tp.z - c.y).length()
		if d < float(GANGS[gi]["r"]) + 120.0 and not _gang_spawned.has(gi):
			_spawn_gang(gi)
		elif d > float(GANGS[gi]["r"]) + 260.0 and _gang_spawned.has(gi):
			for u in units.duplicate():
				if u["kind"] == "gang" and int(u["gang"]) == gi:
					_free_unit(u)
			_gang_spawned.erase(gi)
	for u in units.duplicate():
		var n: Node3D = u["node"]
		if not is_instance_valid(n):
			units.erase(u)
			continue
		if float(u["hp"]) <= 0.0:
			u["dead_t"] = float(u["dead_t"]) + delta
			if float(u["dead_t"]) > 30.0:
				_free_unit(u)
			continue
		var d := n.global_position.distance_to(tp)
		if u["kind"] == "cop" and (Police.stars == 0 or d > 220.0):
			_free_unit(u)
			continue
		if u["kind"] == "gang" and not u["hostile"]:
			# hanging about: turn on a player who stays close
			u["near_t"] = float(u["near_t"]) + delta if d < 10.0 else 0.0
			if float(u["near_t"]) > 3.0:
				_anger(int(u["gang"]))
			_face(n, tp, delta * 0.5 if d < 14.0 else 0.0)
			_play(u, "idle")
			continue
		if PlayerLife.dead:
			_play(u, "idle")
			continue
		# hostile: close in to ~11 m, then stand and shoot
		_face(n, tp, delta)
		if d > 11.0:
			var dir := Vector3(tp.x - n.global_position.x, 0, tp.z - n.global_position.z).normalized()
			var np := n.global_position + dir * 4.2 * delta
			var wd := WorldData.get_instance()
			if wd and wd.ok:
				np.y = wd.height_at(np.x, np.z) + 0.05
			n.global_position = np
			_play(u, "run")
		else:
			_play(u, "idle")
		if d < 40.0 and (u["kind"] == "gang" or Police.stars >= 2):
			u["gun"] = float(u["gun"]) - delta
			if float(u["gun"]) <= 0.0:
				u["gun"] = _rng.randf_range(0.7, 1.3)
				_shoot(u, tp, d)


func _face(n: Node3D, tp: Vector3, k: float) -> void:
	if k <= 0.0:
		return
	var to := Vector3(tp.x - n.global_position.x, 0, tp.z - n.global_position.z)
	if to.length() < 0.1:
		return
	n.rotation.y = lerp_angle(n.rotation.y, atan2(to.x, to.z), clampf(k * 6.0, 0.0, 1.0))


func _play(u: Dictionary, a: String) -> void:
	if u["anim"] == a:
		return
	u["anim"] = a
	var ap: AnimationPlayer = u["ap"]
	if ap and ap.has_animation(StringName("m/" + a)):
		ap.play(StringName("m/" + a), 0.2)


func _shoot(u: Dictionary, tp: Vector3, d: float) -> void:
	var n: Node3D = u["node"]
	var from := n.global_position + Vector3(0, 1.35, 0) + n.global_basis.z * 0.5
	var aim := tp + Vector3(_rng.randf_range(-0.8, 0.8), 1.0 + _rng.randf_range(-0.3, 0.5), _rng.randf_range(-0.8, 0.8))
	var space := n.get_world_3d().direct_space_state
	var q := PhysicsRayQueryParameters3D.create(from, aim, 1)
	var hit := space.intersect_ray(q)
	var tgt: Node = session.car if session.driving else session.player
	var blocked: bool = not hit.is_empty() and hit.collider != tgt and not (tgt and tgt.is_ancestor_of(hit.collider as Node))
	var end: Vector3 = hit.position if blocked else aim
	WeaponFX.muzzle_flash(get_tree(), from, (end - from).normalized(), false)
	WeaponFX.tracer(get_tree(), from, end)
	WeaponFX.sound(get_tree(), "pistol", from, -3.0, 200.0)
	if blocked or _rng.randf() > clampf(0.6 - d / 70.0, 0.15, 0.6):
		return
	if session.driving and session.car:
		session.car.weapon_hit(4.0)
		if _rng.randf() < 0.25:
			PlayerLife.damage(3.0)
	else:
		PlayerLife.damage(7.0)
