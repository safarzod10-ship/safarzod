class_name Grenade
extends RigidBody3D
## Thrown grenade: frag (timed blast) or fire (timed / on impact -> FirePool).

var def: Dictionary = {}
var thrower: Node
var _fuse := 3.0
var _done := false
var _bounce_cd := 0.0


func _ready() -> void:
	add_to_group(&"grenades")
	mass = 0.4
	collision_layer = 8
	collision_mask = 1
	continuous_cd = true
	contact_monitor = true
	max_contacts_reported = 2
	angular_damp = 1.2
	var pm := PhysicsMaterial.new()
	pm.bounce = 0.32
	pm.friction = 0.9
	physics_material_override = pm
	var cs := CollisionShape3D.new()
	var s := SphereShape3D.new()
	s.radius = 0.05
	cs.shape = s
	add_child(cs)
	add_child(WeaponModel.create_prop(def["scene"], def["size"]))
	_fuse = def["fuse"]
	body_entered.connect(_on_hit)


func _on_hit(_body: Node) -> void:
	if _done:
		return
	if def.get("impact", false):
		detonate()
	elif _bounce_cd <= 0.0 and linear_velocity.length() > 1.2:
		_bounce_cd = 0.15
		CombatAudio.play(get_tree().current_scene, "bounce", global_position, -6.0, 1.0, 40.0)


func _physics_process(delta: float) -> void:
	_bounce_cd -= delta
	if def.get("impact", false):
		if global_position.y < -30.0:
			queue_free()
		return
	_fuse -= delta
	if _fuse <= 0.0:
		detonate()


func detonate() -> void:
	if _done:
		return
	_done = true
	var world := get_tree().current_scene
	var pos := global_position
	if def["kind"] == "frag":
		CombatFX.explosion(world, pos, def["radius"])
		blast_damage(world, pos, def["radius"], def["damage"], thrower)
	else:
		var pool := FirePool.new()
		pool.def = def
		pool.thrower = thrower
		pool.position = pos   # before _ready: the pool spreads from its position
		world.add_child(pool)
	queue_free()


static func blast_damage(world: Node, pos: Vector3, radius: float, damage: float, source: Node) -> void:
	var space := (world as Node3D).get_world_3d().direct_space_state
	var origin := pos + Vector3.UP * 0.4
	for n in world.get_tree().get_nodes_in_group(&"combatants"):
		var c := n as Combatant
		var target := c.chest_position()
		var d := origin.distance_to(target)
		if d > radius:
			continue
		var q := PhysicsRayQueryParameters3D.create(origin, target, 1)
		if not space.intersect_ray(q).is_empty():
			continue  # behind cover
		var f := pow(1.0 - d / radius, 1.25)
		c.take_damage(damage * f, source, target, (target - origin).normalized(), "blast")
	for n in world.get_tree().get_nodes_in_group(&"corpses"):
		var c := n as Combatant
		if c.ragdoll and c.ragdoll.hips_position().distance_to(pos) < radius:
			c.ragdoll.apply_blast(pos, 45.0)
	for n in world.get_tree().get_nodes_in_group(&"physics_props"):
		var rb := n as RigidBody3D
		var d := rb.global_position - pos
		if d.length() < radius:
			rb.apply_central_impulse((d.normalized() + Vector3.UP * 0.6) * rb.mass * 14.0 * (1.0 - d.length() / radius))
	for n in world.get_tree().get_nodes_in_group(&"player"):
		if n.has_method("shake"):
			var dist := (n as Node3D).global_position.distance_to(pos)
			n.call("shake", clampf(1.4 - dist / 30.0, 0.0, 1.0))
