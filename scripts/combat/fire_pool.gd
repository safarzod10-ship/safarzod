class_name FirePool
extends Node3D
## Burning ground left by an incendiary grenade / molotov: flame patches that
## spread outward over the terrain, burn, damage and ignite, then die down.

var def: Dictionary = {}
var thrower: Node
var radius := 3.5
var _patches: Array[Node3D] = []
var _points: PackedVector3Array = []
var _lights: Array[OmniLight3D] = []
var _age := 0.0
var _tick := 0.0
var _burn_time := 10.0
var _dying := false
var _loop: AudioStreamPlayer3D


func _ready() -> void:
	add_to_group(&"fire_pools")
	radius = def.get("radius", 3.5)
	_burn_time = def.get("burn_time", 10.0)
	var world := get_tree().current_scene
	CombatAudio.play(world, "molotov" if def.get("impact", false) else "incendiary", global_position, 4.0, 1.0, 120.0)
	# ignition burst
	CombatFX._light(world, global_position + Vector3.UP, Color(1.0, 0.6, 0.25), 9.0, radius * 3.0, 0.6)
	_add_patch(global_position, 1.25)
	var n := int(radius * radius * 1.5)
	for i in n:
		var a := randf() * TAU
		var r := sqrt(float(i + 1) / n) * radius
		var p := global_position + Vector3(cos(a) * r, 0, sin(a) * r)
		get_tree().create_timer(0.08 + r * 0.22 + randf() * 0.15).timeout.connect(_spread_to.bind(p, r))
	for i in 2:
		var l := CombatFX.fire_light(self, global_position + Vector3(randf_range(-1, 1), 1.0, randf_range(-1, 1)), radius * 3.2)
		_lights.append(l)
	CombatFX.scorch(world, global_position, radius * 2.3, _burn_time + 80.0)
	var s := CombatAudio.stream("fire_loop")
	if s:
		_loop = AudioStreamPlayer3D.new()
		_loop.stream = s
		_loop.unit_size = 10.0
		_loop.max_distance = 80.0
		_loop.volume_db = 2.0
		add_child(_loop)
		_loop.finished.connect(_loop.play)
		_loop.play()


func _spread_to(p: Vector3, r: float) -> void:
	if _dying or not is_inside_tree():
		return
	var q := PhysicsRayQueryParameters3D.create(p + Vector3.UP * 1.6, p + Vector3.DOWN * 4.0, 1)
	var hit := get_world_3d().direct_space_state.intersect_ray(q)
	if hit.is_empty() or (hit["normal"] as Vector3).y < 0.5:
		return
	_add_patch(hit["position"], lerpf(1.15, 0.75, r / radius) * randf_range(0.85, 1.15))


func _add_patch(p: Vector3, s: float) -> void:
	_patches.append(CombatFX.fire_patch(self, p, s))
	_points.append(p)


func covers(pos: Vector3, margin := 0.0) -> bool:
	if absf(pos.y - global_position.y) > 2.5:
		return false
	return Vector2(pos.x - global_position.x, pos.z - global_position.z).length() < radius + margin


func _physics_process(delta: float) -> void:
	_age += delta
	var flick := 0.75 + 0.25 * sin(_age * 17.0) + 0.2 * sin(_age * 31.0 + 1.3)
	var fade := 1.0 if not _dying else clampf(1.0 - (_age - _burn_time) / 3.0, 0.0, 1.0)
	for i in _lights.size():
		_lights[i].light_energy = (3.2 + i) * flick * fade
	if _loop:
		_loop.volume_db = lerpf(-40.0, 2.0, fade)
	if not _dying:
		_tick += delta
		if _tick >= 0.25:
			_tick = 0.0
			_burn()
		if _age >= _burn_time:
			_dying = true
			for p in _patches:
				get_tree().create_timer(randf() * 2.2).timeout.connect(CombatFX.fire_stop.bind(p, 1.0))
	elif _age > _burn_time + 7.0:
		queue_free()


func _burn() -> void:
	var dmg: float = float(def.get("damage", 20.0)) * 0.25
	for n in get_tree().get_nodes_in_group(&"combatants"):
		var c := n as Combatant
		var touching := false
		for p in _points:
			if absf(c.global_position.y - p.y) < 2.0 and Vector2(c.global_position.x - p.x, c.global_position.z - p.z).length() < 1.05:
				touching = true
				break
		if touching:
			c.take_damage(dmg, thrower, c.chest_position(), Vector3.ZERO, "fire")
			c.ignite(2.5, thrower)
