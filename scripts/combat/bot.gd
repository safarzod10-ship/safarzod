class_name Bot
extends Combatant
## Enemy AI: patrols, spots the player, strafes and fires bursts, flees fire and
## live grenades, reloads.

var home := Vector3.ZERO
var accuracy_deg := 2.6
var _target: Combatant
var _alert := 0.0
var _react := 0.0
var _burst := 0
var _burst_pause := 0.0
var _strafe := 1.0
var _strafe_t := 0.0
var _goal := Vector3.ZERO
var _goal_t := 0.0
var _think := 0.0
var _sees := false
var _wish := Vector3.ZERO
var _sprint := false
var _corpse_time := 0.0


func _ready() -> void:
	team = 2
	damage_scale = 0.3
	super()
	home = global_position
	_goal = home
	died.connect(func(_w: Combatant, _k: Node) -> void: _corpse_time = 30.0)


func _physics_process(delta: float) -> void:
	super(delta)
	if dead:
		_corpse_time -= delta
		if _corpse_time <= 0.0:
			queue_free()
		return
	_think -= delta
	if _think <= 0.0:
		_think = 0.12
		_decide()
	_alert = maxf(_alert - delta, 0.0)
	_burst_pause = maxf(_burst_pause - delta, 0.0)
	_react = maxf(_react - delta, 0.0)
	_strafe_t -= delta
	var fwd := -global_transform.basis.z
	if _alert > 0.0 and is_instance_valid(_target) and not _target.dead:
		var to := _target.chest_position() - chest_position()
		var yaw := atan2(-to.x, -to.z)
		rotation.y = lerp_angle(rotation.y, yaw, clampf(delta * 7.0, 0.0, 1.0))
		aim_pitch = atan2(to.y, Vector2(to.x, to.z).length())
		aiming = true
		var facing := fwd.dot(to.normalized()) > 0.93
		if _sees and facing and _react <= 0.0 and _burst_pause <= 0.0:
			var err := accuracy_deg + Vector2(velocity.x, velocity.z).length() * 0.5 + to.length() * 0.02
			if try_fire(_target.chest_position() + Vector3.UP * randf_range(-0.2, 0.3), err):
				_burst -= 1
				if _burst <= 0:
					_burst = randi_range(3, 7)
					_burst_pause = randf_range(0.5, 1.3)
	else:
		aiming = false
		aim_pitch = 0.0
		if _wish.length() > 0.1:
			rotation.y = lerp_angle(rotation.y, atan2(-_wish.x, -_wish.z), clampf(delta * 5.0, 0.0, 1.0))
	step_movement(delta, _wish, _sprint, false)


func _decide() -> void:
	_wish = Vector3.ZERO
	_sprint = false
	var players := get_tree().get_nodes_in_group(&"player")
	_target = players[0] as Combatant if not players.is_empty() else null
	_sees = false
	# danger first
	for g in get_tree().get_nodes_in_group(&"grenades"):
		var d := global_position - (g as Node3D).global_position
		if d.length() < 7.0:
			_wish = Vector3(d.x, 0, d.z).normalized()
			_sprint = true
			return
	for f in get_tree().get_nodes_in_group(&"fire_pools"):
		var pool := f as FirePool
		if pool.covers(global_position, 1.5):
			var d := global_position - pool.global_position
			_wish = Vector3(d.x, 0, d.z).normalized() if d.length() > 0.1 else Vector3.RIGHT
			_sprint = true
			return
	if is_instance_valid(_target) and not _target.dead:
		var to := _target.chest_position() - head_position()
		var dist := to.length()
		if dist < 55.0:
			var in_fov := (-global_transform.basis.z).dot(to.normalized()) > 0.3 or dist < 9.0 or _alert > 0.0
			if in_fov:
				var q := PhysicsRayQueryParameters3D.create(head_position(), _target.chest_position(), LAYER_WORLD)
				_sees = get_world_3d().direct_space_state.intersect_ray(q).is_empty()
		if _sees:
			if _alert <= 0.0:
				_react = randf_range(0.45, 0.9)
				_burst = randi_range(3, 6)
			_alert = 7.0
		if _alert > 0.0:
			var flat := Vector3(to.x, 0, to.z).normalized()
			var side := flat.cross(Vector3.UP)
			if _strafe_t <= 0.0:
				_strafe_t = randf_range(1.2, 3.0)
				_strafe = [-1.0, 1.0, 0.0].pick_random()
				set_crouch(randf() < 0.25 and dist > 10.0)
			if not _sees:
				_wish = flat  # push to regain sight
				_sprint = dist > 25.0
			elif dist > 24.0:
				_wish = (flat + side * _strafe * 0.4).normalized()
			elif dist < 8.0:
				_wish = (-flat + side * _strafe * 0.6).normalized()
			else:
				_wish = side * _strafe * 0.7
			if ammo <= 0:
				start_reload()
			if crouching and _wish.length() > 0.1 and not _sees:
				set_crouch(false)
			return
	# patrol
	set_crouch(false)
	_goal_t -= 0.12
	if _goal_t <= 0.0 or global_position.distance_to(_goal) < 1.0:
		_goal_t = randf_range(3.0, 7.0)
		_goal = home + Vector3(randf_range(-9, 9), 0, randf_range(-9, 9))
	var d := _goal - global_position
	d.y = 0.0
	if d.length() > 1.0:
		_wish = d.normalized() * 0.75
