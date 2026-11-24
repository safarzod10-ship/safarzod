class_name Combatant
extends CharacterBody3D
## Shared body for the player and bots: rig, weapon in hands, animation layers,
## health, shooting, grenades, death -> ragdoll.

signal died(who: Combatant, killer: Node)
signal damaged(amount: float, zone: String, attacker: Node)
signal ammo_changed
signal fired

const WALK_SPEED := 2.4
const RUN_SPEED := 5.6
const CROUCH_SPEED := 1.5
const JUMP_SPEED := 4.8
const GRAVITY := 13.0
const LAYER_WORLD := 1
const LAYER_CHAR := 2
const LAYER_RAGDOLL := 4
const HIT_MASK := LAYER_WORLD | LAYER_CHAR | LAYER_RAGDOLL
const LOCO := ["ready", "walk", "run", "crouch_idle", "crouch_walk", "jump"]
const UPPER := ["ready", "shoot", "reload"]

var char_id := "swat"
var weapon_id := "aks74"
var team := 0
var damage_scale := 1.0

var rig: CharacterRig
var weapon: WeaponModel
var tree: AnimationTree
var aim: AimModifier
var ragdoll: Ragdoll

var max_health := 100.0
var health := 100.0
var dead := false
var ammo := 30
var reserve := 150
var reloading := false
var grenades: Dictionary = {}
var grenade_id := "frag"
var burn_left := 0.0

var aim_pitch := 0.0
var aiming := false
var crouching := false
var spread_bloom := 0.0

var _fire_cd := 0.0
var _reload_left := 0.0
var _since_fire := 10.0
var _grenade_cd := 0.0
var _loco := ""
var _upper := ""
var _upper_w := 1.0
var _was_on_floor := true
var _fall_speed := 0.0
var _shape: CapsuleShape3D
var _col: CollisionShape3D
var _wdef: Dictionary
var _burn_fx: Node3D
var _burn_tick := 0.0
var _burn_src: Node
var _step_phase := 0.0
var _last_hit_dir := Vector3.ZERO


func _ready() -> void:
	add_to_group(&"combatants")
	collision_layer = LAYER_CHAR
	collision_mask = LAYER_WORLD | LAYER_CHAR
	floor_snap_length = 0.25
	_shape = CapsuleShape3D.new()
	_shape.radius = 0.32
	_shape.height = 1.8
	_col = CollisionShape3D.new()
	_col.shape = _shape
	_col.position.y = 0.9
	add_child(_col)
	rig = CharacterRig.create(char_id)
	add_child(rig)
	_wdef = WeaponCatalog.weapon(weapon_id)
	ammo = _wdef["mag"]
	reserve = _wdef["reserve"]
	for g in WeaponCatalog.GRENADES:
		grenades[g["id"]] = g["count"]
	_make_ready_anim()
	aim = AimModifier.new()
	aim.name = "AimModifier"
	rig.skeleton.add_child(aim)
	aim.setup(rig)
	ragdoll = Ragdoll.new()
	ragdoll.name = "Ragdoll"
	rig.skeleton.add_child(ragdoll)
	ragdoll.setup(rig)
	_attach_weapon()
	_build_tree()


# ------------------------------------------------------------------ setup

func _make_ready_anim() -> void:
	var lib := rig.anim.get_animation_library(&"")
	if lib.has_animation(&"ready"):
		return
	var src := lib.get_animation(&"shoot")
	var a := Animation.new()
	a.length = 1.0
	a.loop_mode = Animation.LOOP_LINEAR
	for t in src.get_track_count():
		var nt := a.add_track(src.track_get_type(t))
		a.track_set_path(nt, src.track_get_path(t))
		if src.track_get_type(t) == Animation.TYPE_ROTATION_3D:
			a.rotation_track_insert_key(nt, 0.0, src.track_get_key_value(t, 0))
		else:
			a.position_track_insert_key(nt, 0.0, src.track_get_key_value(t, 0))
	lib.add_animation(&"ready", a)


func _pose_from(anim_name: StringName) -> void:
	var a := rig.anim.get_animation(anim_name)
	var skel := rig.skeleton
	for t in a.get_track_count():
		var bone_name := String(a.track_get_path(t)).get_slice(":", 1)
		var b := skel.find_bone(bone_name)
		if b < 0:
			continue
		if a.track_get_type(t) == Animation.TYPE_ROTATION_3D:
			skel.set_bone_pose_rotation(b, a.track_get_key_value(t, 0))
		else:
			skel.set_bone_pose_position(b, a.track_get_key_value(t, 0))


func _palm(side: String) -> Vector3:
	var h := rig.bone_xform(side + "Hand").origin
	if rig.bone(side + "HandMiddle1") >= 0:
		return h.lerp(rig.bone_xform(side + "HandMiddle1").origin, 0.8)
	return h


## Places the weapon in the right hand so that, in the shouldered pose, the
## barrel runs from the right palm through the left palm; measures how far that
## is from straight ahead so the aim layer can correct it.
func _attach_weapon() -> void:
	weapon = WeaponModel.create_weapon(weapon_id)
	_pose_from(&"ready")
	var rp := _palm("Right")
	var lp := _palm("Left")
	var dir := (lp - rp).normalized()
	# The handguard sits above the grip->palm line: tilt the barrel down by that angle.
	var side := dir.cross(Vector3.UP).normalized()
	dir = dir.rotated(side, -atan2(weapon.support.y, -weapon.support.z))
	var hand := AnimRetarget.rel_xform(rig.skeleton, rig) * rig.skeleton.get_bone_global_pose(rig.bone("RightHand"))
	var w := Transform3D(Basis.looking_at(dir, Vector3.UP), rp + Vector3.UP * 0.02)
	var att := BoneAttachment3D.new()
	att.name = "WeaponSocket"
	rig.skeleton.add_child(att)
	att.bone_idx = rig.bone("RightHand")
	att.add_child(weapon)
	weapon.transform = hand.affine_inverse() * w
	aim.weapon = weapon
	aim.support_local = weapon.support
	aim.yaw_fix = -atan2(-dir.x, -dir.z)
	aim.pitch_fix = -asin(clampf(dir.y, -1.0, 1.0))
	rig.skeleton.reset_bone_poses()


func _build_tree() -> void:
	var bt := AnimationNodeBlendTree.new()
	var loco := AnimationNodeTransition.new()
	loco.xfade_time = 0.18
	loco.input_count = LOCO.size()
	bt.add_node(&"loco", loco)
	for i in LOCO.size():
		loco.set_input_name(i, LOCO[i])
		loco.set_input_reset(i, LOCO[i] == "jump")
		var an := AnimationNodeAnimation.new()
		an.animation = LOCO[i]
		bt.add_node("l_" + LOCO[i], an)
		bt.connect_node(&"loco", i, "l_" + LOCO[i])
	bt.add_node(&"loco_ts", AnimationNodeTimeScale.new())
	bt.connect_node(&"loco_ts", 0, &"loco")
	var upper := AnimationNodeTransition.new()
	upper.xfade_time = 0.12
	upper.input_count = UPPER.size()
	bt.add_node(&"upper", upper)
	for i in UPPER.size():
		upper.set_input_name(i, UPPER[i])
		upper.set_input_reset(i, UPPER[i] == "reload")
		var an := AnimationNodeAnimation.new()
		an.animation = UPPER[i]
		bt.add_node("u_" + UPPER[i], an)
		bt.connect_node(&"upper", i, "u_" + UPPER[i])
	var blend := AnimationNodeBlend2.new()
	blend.filter_enabled = true
	var skel := rig.skeleton
	var spine := rig.bone("Spine")
	for b in skel.get_bone_count():
		var p := b
		while p >= 0 and p != spine:
			p = skel.get_bone_parent(p)
		if p == spine:
			blend.set_filter_path(NodePath("%s:%s" % [skel.name, skel.get_bone_name(b)]), true)
	bt.add_node(&"blend", blend)
	bt.connect_node(&"blend", 0, &"loco_ts")
	bt.connect_node(&"blend", 1, &"upper")
	bt.connect_node(&"output", 0, &"blend")
	tree = AnimationTree.new()
	tree.name = "AnimTree"
	tree.tree_root = bt
	rig.skeleton.get_parent().add_child(tree)
	tree.root_node = NodePath("..")
	tree.anim_player = tree.get_path_to(rig.anim)
	tree.active = true
	_set_loco("ready")
	_set_upper("ready")
	tree.set(&"parameters/blend/blend_amount", 1.0)


func _set_loco(state: String) -> void:
	if state != _loco:
		_loco = state
		tree.set(&"parameters/loco/transition_request", state)


func _set_upper(state: String) -> void:
	if state != _upper:
		_upper = state
		tree.set(&"parameters/upper/transition_request", state)


# ------------------------------------------------------------------ movement

func eye_height() -> float:
	return 1.18 if crouching else 1.62


func chest_position() -> Vector3:
	return global_position + Vector3.UP * (0.8 if crouching else 1.25)


func head_position() -> Vector3:
	if rig and rig.bone("Head") >= 0:
		return rig.skeleton.global_transform * rig.skeleton.get_bone_global_pose(rig.bone("Head")).origin + Vector3.UP * 0.08
	return global_position + Vector3.UP * eye_height()


func set_crouch(value: bool) -> void:
	if value == crouching or dead:
		return
	if not value:  # need head room to stand
		var q := PhysicsRayQueryParameters3D.create(global_position + Vector3.UP * 1.0, global_position + Vector3.UP * 1.9, LAYER_WORLD)
		if not get_world_3d().direct_space_state.intersect_ray(q).is_empty():
			return
	crouching = value
	_shape.height = 1.25 if value else 1.8
	_col.position.y = _shape.height * 0.5


## `wish` is a world-space horizontal direction (length 0..1).
func step_movement(delta: float, wish: Vector3, sprint: bool, jump: bool) -> void:
	if dead:
		return
	var firing := _since_fire < 0.3
	var can_run := sprint and not crouching and not aiming and wish.dot(-global_transform.basis.z) > 0.3
	var speed := CROUCH_SPEED if crouching else (RUN_SPEED if can_run else WALK_SPEED)
	if aiming and not crouching:
		speed = WALK_SPEED * 0.8
	var on_floor := is_on_floor()
	var target := wish * speed
	var accel := 16.0 if on_floor else 3.0
	velocity.x = move_toward(velocity.x, target.x, accel * delta)
	velocity.z = move_toward(velocity.z, target.z, accel * delta)
	if on_floor:
		if jump and not crouching:
			velocity.y = JUMP_SPEED
	else:
		velocity.y -= GRAVITY * delta
		_fall_speed = maxf(_fall_speed, -velocity.y)
	move_and_slide()
	# fall damage
	var now_floor := is_on_floor()
	if now_floor and not _was_on_floor:
		if _fall_speed > 9.5:
			take_damage((_fall_speed - 9.5) * 11.0, null, global_position, Vector3.DOWN, "fall")
		_fall_speed = 0.0
	_was_on_floor = now_floor
	if global_position.y < -40.0:
		take_damage(9999.0, null, global_position, Vector3.DOWN, "fall")

	# --- animation state
	var hv := Vector3(velocity.x, 0, velocity.z)
	var hs := hv.length()
	var state := "ready"
	var ts := 1.0
	var back := hv.dot(-global_transform.basis.z) < -0.4
	if not now_floor and absf(velocity.y) > 1.5:
		state = "jump"
	elif crouching:
		state = "crouch_walk" if hs > 0.25 else "crouch_idle"
		ts = clampf(hs / 1.3, 0.5, 1.5) if hs > 0.25 else 1.0
	elif hs > 3.6:
		state = "run"
		ts = clampf(hs / RUN_SPEED, 0.7, 1.2)
	elif hs > 0.25:
		state = "walk"
		ts = clampf(hs / 1.9, 0.5, 1.6)
	_set_loco(state)
	tree.set(&"parameters/loco_ts/scale", -ts if back and state != "jump" else ts)
	# upper body: weapon up unless sprinting or airborne with nothing to do
	var busy := firing or reloading
	var want_w := 0.0 if (state == "run" or state == "jump") and not busy else 1.0
	_upper_w = move_toward(_upper_w, want_w, delta * 7.0)
	tree.set(&"parameters/blend/blend_amount", _upper_w)
	_set_upper("reload" if reloading else ("shoot" if _since_fire < 0.14 else "ready"))
	aim.weight = _upper_w * (0.35 if reloading else 1.0)
	aim.ik_weight = move_toward(aim.ik_weight, 0.0 if reloading else 1.0, delta * 6.0)
	aim.pitch = lerp_angle(aim.pitch, aim_pitch, clampf(delta * 18.0, 0.0, 1.0))
	# footsteps
	if now_floor and hs > 1.0:
		_step_phase += hs * delta
		if _step_phase > (1.9 if state == "run" else 1.35):
			_step_phase = 0.0
			CombatAudio.play(self, "step", global_position, -16.0 if crouching else -9.0, 1.0, 30.0)


func _physics_process(delta: float) -> void:
	_fire_cd = maxf(_fire_cd - delta, 0.0)
	_grenade_cd = maxf(_grenade_cd - delta, 0.0)
	_since_fire += delta
	spread_bloom = move_toward(spread_bloom, 0.0, delta * 3.5)
	if aim:
		aim.recoil = move_toward(aim.recoil, 0.0, delta * (0.5 + absf(aim.recoil) * 14.0))
		aim.flinch = aim.flinch.move_toward(Vector2.ZERO, delta * 1.8)
	if dead:
		return
	if reloading:
		_reload_left -= delta
		if _reload_left <= 0.0:
			_finish_reload()
	if burn_left > 0.0:
		burn_left -= delta
		_burn_tick += delta
		if _burn_tick >= 0.5:
			_burn_tick = 0.0
			take_damage(4.0, _burn_src, chest_position(), Vector3.ZERO, "fire")
		if burn_left <= 0.0 and _burn_fx:
			CombatFX.fire_stop(_burn_fx, 1.0)
			_burn_fx = null


# ------------------------------------------------------------------ weapon

func muzzle_position() -> Vector3:
	return weapon.to_global(weapon.muzzle)


func current_spread() -> float:
	var s: float = _wdef["spread"]
	var hs := Vector2(velocity.x, velocity.z).length()
	s += hs * 0.35 + spread_bloom
	if not is_on_floor():
		s += 2.5
	if crouching:
		s *= 0.6
	if aiming:
		s *= 0.45
	return s


## Fires one round towards `target` (world). Returns true if a shot left the barrel.
func try_fire(target: Vector3, extra_spread_deg := 0.0) -> bool:
	if dead or reloading or _fire_cd > 0.0:
		return false
	if ammo <= 0:
		_fire_cd = 0.3
		CombatAudio.play(self, "dry", muzzle_position(), -6.0)
		start_reload()
		return false
	ammo -= 1
	_fire_cd = 60.0 / float(_wdef["rpm"])
	_since_fire = 0.0
	var from := muzzle_position()
	var dir := (target - from).normalized()
	var spread := deg_to_rad(current_spread() + extra_spread_deg)
	var side := dir.cross(Vector3.UP).normalized()
	var up := side.cross(dir)
	var ang := randf() * TAU
	var mag := sqrt(randf()) * spread
	dir = (dir + (side * cos(ang) + up * sin(ang)) * tan(mag)).normalized()
	var space := get_world_3d().direct_space_state
	# a muzzle poked through a wall must not shoot past it
	var chest := chest_position()
	var pre := PhysicsRayQueryParameters3D.create(chest, from, LAYER_WORLD)
	var blocked := space.intersect_ray(pre)
	var end := from + dir * float(_wdef["range"])
	var hit: Dictionary = blocked
	if blocked.is_empty():
		var q := PhysicsRayQueryParameters3D.create(from, end, HIT_MASK, [get_rid()])
		hit = space.intersect_ray(q)
	var world := get_tree().current_scene
	if not hit.is_empty():
		end = hit["position"]
		_resolve_hit(hit, from, dir)
	CombatFX.muzzle_flash(weapon, weapon.muzzle)
	CombatFX.tracer(world, from, end)
	var wb := weapon.global_transform.basis
	CombatFX.shell(world, Transform3D(wb, weapon.to_global(weapon.eject)), velocity + wb.x * randf_range(2.0, 3.2) + wb.y * randf_range(1.2, 2.2) - wb.z * randf_range(-0.4, 0.4))
	CombatAudio.play(self, _wdef["sound"], from, 2.0, 1.0, 300.0)
	var rc: float = _wdef["recoil"]
	aim.recoil = minf(aim.recoil + deg_to_rad(1.6) * rc, deg_to_rad(7.0))
	spread_bloom = minf(spread_bloom + 0.32 * rc, 3.0)
	ammo_changed.emit()
	fired.emit()
	return true


func _resolve_hit(hit: Dictionary, from: Vector3, dir: Vector3) -> void:
	var col: Object = hit["collider"]
	var pos: Vector3 = hit["position"]
	var world := get_tree().current_scene
	var dmg: float = float(_wdef["damage"]) * damage_scale
	if col is Combatant:
		var c := col as Combatant
		var zone := "body"
		var mult := 1.0
		var head := c.head_position()
		var along := (head - from).dot(dir)
		var miss := (from + dir * along).distance_to(head)
		if miss < 0.15:
			zone = "head"
			mult = 3.0
			pos = from + dir * along
		elif pos.y - c.global_position.y < (0.5 if c.crouching else 0.85):
			zone = "legs"
			mult = 0.7
		c.take_damage(dmg * mult, self, pos, dir, zone)
	elif col is RigidBody3D:
		var rb := col as RigidBody3D
		rb.freeze = false
		rb.apply_impulse(dir * minf(9.0, rb.mass * 2.5), pos - rb.global_position)
		if rb.has_meta(&"ragdoll_owner"):
			CombatFX.blood(world, pos, -dir)
		else:
			CombatFX.impact(world, pos, hit["normal"])
	else:
		CombatFX.impact(world, pos, hit["normal"])


func start_reload() -> void:
	if dead or reloading or reserve <= 0 or ammo >= int(_wdef["mag"]):
		return
	reloading = true
	_reload_left = 2.6
	CombatAudio.play(self, "reload", muzzle_position(), -2.0, 1.0, 40.0)
	ammo_changed.emit()


func _finish_reload() -> void:
	reloading = false
	var need: int = int(_wdef["mag"]) - ammo
	var take := mini(need, reserve)
	ammo += take
	reserve -= take
	ammo_changed.emit()


# ------------------------------------------------------------------ grenades

func next_grenade() -> void:
	var ids: Array = []
	for g in WeaponCatalog.GRENADES:
		ids.append(g["id"])
	grenade_id = ids[(ids.find(grenade_id) + 1) % ids.size()]
	ammo_changed.emit()


## Throws the selected grenade along `dir` (world, should already include the arc).
func throw_grenade(dir: Vector3, power := 15.0) -> Grenade:
	if dead or _grenade_cd > 0.0 or int(grenades.get(grenade_id, 0)) <= 0:
		return null
	grenades[grenade_id] = int(grenades[grenade_id]) - 1
	_grenade_cd = 1.1
	var g := Grenade.new()
	g.def = WeaponCatalog.grenade(grenade_id)
	g.thrower = self
	var b := global_transform.basis
	var start := global_position + Vector3.UP * (eye_height() - 0.05) - b.x * 0.28 - b.z * 0.45
	get_tree().current_scene.add_child(g)
	g.global_position = start
	g.linear_velocity = dir.normalized() * power + Vector3.UP * 2.6 + velocity * 0.6
	g.angular_velocity = Vector3(randf_range(-6, 6), randf_range(-6, 6), randf_range(-6, 6))
	g.add_collision_exception_with(self)
	aim.flinch.x = -0.22  # shoulders dip into the throw
	CombatAudio.play(self, "pin", start, -4.0, 1.0, 30.0)
	ammo_changed.emit()
	return g


# ------------------------------------------------------------------ damage

func ignite(seconds: float, source: Node) -> void:
	if dead:
		return
	_burn_src = source
	burn_left = maxf(burn_left, seconds)
	if _burn_fx == null:
		_burn_fx = CombatFX.fire_patch(self, global_position + Vector3.UP * 0.5, 0.55)


func take_damage(amount: float, attacker: Node, pos: Vector3, dir: Vector3, zone := "body") -> void:
	if dead or amount <= 0.0:
		return
	health = maxf(health - amount, 0.0)
	_last_hit_dir = dir
	damaged.emit(amount, zone, attacker)
	var world := get_tree().current_scene
	if zone in ["body", "head", "legs"]:
		CombatFX.blood(world, pos, -dir)
		var local := global_transform.basis.inverse() * dir
		aim.flinch += Vector2(randf_range(0.04, 0.12), clampf(local.x, -1.0, 1.0) * 0.14) * clampf(amount / 30.0, 0.4, 1.5)
		aim.flinch = aim.flinch.limit_length(0.4)
	if health <= 0.0:
		# `kick` = velocity added to the whole body, `impulse` = local hit on the nearest limb
		var kick := dir * 0.9
		var impulse := dir * 28.0
		if zone == "blast":
			kick = (dir + Vector3.UP * 0.4).normalized() * clampf(amount / 30.0, 2.5, 6.0)
			impulse = Vector3.ZERO
		elif zone == "head":
			kick = dir * 0.5
			impulse = dir * 16.0
		elif zone in ["fire", "fall"]:
			kick = Vector3.ZERO
			impulse = Vector3.ZERO
		die(attacker, kick, impulse, pos)
	elif zone != "fire" and randf() < 0.6:
		CombatAudio.play(self, "grunt", head_position(), -4.0, 1.0, 40.0)


func die(killer: Node, kick: Vector3, impulse: Vector3, pos: Vector3) -> void:
	if dead:
		return
	dead = true
	health = 0.0
	collision_layer = 0
	collision_mask = 0
	_col.disabled = true
	tree.active = false
	aim.active = false
	remove_from_group(&"combatants")
	add_to_group(&"corpses")
	_drop_weapon()
	ragdoll.start(velocity + kick, impulse, pos)
	CombatAudio.play(self, "death", head_position(), 0.0, 1.0, 50.0)
	died.emit(self, killer)


func _drop_weapon() -> void:
	var x := weapon.global_transform
	var rb := RigidBody3D.new()
	rb.mass = 3.4
	rb.collision_layer = LAYER_RAGDOLL
	rb.collision_mask = LAYER_WORLD
	var cs := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = weapon.bounds.size
	cs.shape = box
	cs.position = weapon.bounds.get_center()
	rb.add_child(cs)
	get_tree().current_scene.add_child(rb)
	rb.global_transform = Transform3D(x.basis.orthonormalized(), x.origin)
	weapon.get_parent().remove_child(weapon)
	rb.add_child(weapon)
	weapon.transform = Transform3D.IDENTITY
	rb.linear_velocity = velocity + Vector3.UP * 1.0
	rb.angular_velocity = Vector3(randf_range(-3, 3), randf_range(-3, 3), randf_range(-3, 3))
	rb.add_collision_exception_with(self)
	tree_exiting.connect(rb.queue_free)
