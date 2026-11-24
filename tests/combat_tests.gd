extends Node
## Headless combat checks:  godot --headless res://tests/combat_tests.tscn   (exit 0 = all passed)
var _fail := 0
var _pass := 0
var arena: Arena


func _check(name: String, ok: bool, detail: Variant = "") -> void:
	print("TEST %s %s %s" % ["PASS" if ok else "FAIL", name, str(detail)])
	if ok: _pass += 1
	else: _fail += 1


func _wait(sec: float) -> void:
	for i in int(sec * 60.0):
		await get_tree().physics_frame


func _ready() -> void:
	# --- assets
	for c in CharacterCatalog.CHARACTERS:
		var rig := CharacterRig.create(c["id"])
		add_child(rig)
		var missing: Array = []
		for a: String in ["shoot", "walk", "run", "reload", "crouch_idle", "crouch_walk", "jump"]:
			if not rig.anim.has_animation(a): missing.append(a)
		_check("rig_anims_" + c["id"], missing.is_empty(), missing)
		var needed := true
		for b: String in ["Hips", "Spine", "Head", "LeftHand", "RightHand", "LeftFoot", "RightFoot"]:
			needed = needed and rig.bone(b) >= 0
		_check("rig_bones_" + c["id"], needed)
		var head_y := rig.bone_xform("Head").origin.y
		_check("rig_height_" + c["id"], head_y > 1.45 and head_y < 1.75, head_y)
		rig.queue_free()
	for w in WeaponCatalog.WEAPONS:
		var wm := WeaponModel.create_weapon(w["id"])
		_check("weapon_length_" + w["id"], absf(wm.bounds.size.z - float(w["length"])) < 0.01 and wm.muzzle.z < -0.3, wm.bounds.size)
		wm.free()
	# --- arena
	Arena.demo_mode = true
	arena = (load("res://scenes/combat/arena.tscn") as PackedScene).instantiate() as Arena
	get_tree().root.add_child.call_deferred(arena)
	await get_tree().process_frame
	await get_tree().process_frame
	get_tree().current_scene = arena
	var player := arena.player
	player.input_enabled = false
	await _wait(0.5)
	_check("player_on_ground", player.is_on_floor() and absf(player.global_position.y) < 0.1, player.global_position.y)
	# body / head damage through the real shooting path
	var bot := arena.spawn_bot(Vector3(0, 0, 8), "soldier")
	bot.set_physics_process(false)
	await _wait(0.3)
	bot.max_health = 1000.0; bot.health = 1000.0
	player._wdef = player._wdef.duplicate(); player._wdef["spread"] = 0.0
	var before := bot.health
	_check("shot_fired", player.try_fire(bot.chest_position()), "")
	var body_dmg := before - bot.health
	_check("body_damage", is_equal_approx(body_dmg, 34.0), body_dmg)
	await _wait(0.2)
	before = bot.health
	player.spread_bloom = 0.0
	player.try_fire(bot.head_position())
	_check("headshot_x3", is_equal_approx(before - bot.health, 102.0), before - bot.health)
	_check("ammo_spent", player.ammo == 28, player.ammo)
	player.start_reload()
	await _wait(2.8)
	_check("reload", player.ammo == 30 and player.reserve == 148 and not player.reloading, [player.ammo, player.reserve])
	# death -> ragdoll falls and rests on the ground
	bot.take_damage(5000, player, bot.chest_position(), Vector3(0, 0, -1), "body")
	_check("death_starts_ragdoll", bot.dead and bot.ragdoll.is_running() and bot.ragdoll.bodies.size() == 11, bot.ragdoll.bodies.size())
	_check("kill_counted", arena.kills == 1, arena.kills)
	await _wait(2.5)
	var hy := bot.ragdoll.hips_position().y
	_check("ragdoll_lies_on_ground", hy > 0.02 and hy < 0.45, hy)
	_check("ragdoll_stays_near", bot.ragdoll.hips_position().distance_to(Vector3(0, 0, 8)) < 4.0, bot.ragdoll.hips_position())
	# frag: open ground kills, cover protects
	var near := arena.spawn_bot(Vector3(20, 0, 30), "frank")
	var covered := arena.spawn_bot(Vector3(26, 0, 30), "soldier")
	near.set_physics_process(false); covered.set_physics_process(false)
	arena._static_box(Vector3(24.5, 1.5, 30), Vector3(0.4, 3, 4), arena._mat(Color.GRAY))
	await _wait(0.3)
	Grenade.blast_damage(arena, Vector3(22, 0.1, 30), 9.0, 160.0, player)
	_check("frag_kills_in_open", near.dead, near.health)
	_check("frag_blocked_by_cover", not covered.dead and covered.health == 100.0, covered.health)
	# thrown grenade explodes after the fuse
	player.grenade_id = "frag"
	var g := player.throw_grenade(Vector3(0, 0.2, -1), 12.0)
	_check("grenade_thrown", g != null and int(player.grenades["frag"]) == 3)
	await _wait(3.6)
	_check("grenade_detonated", not is_instance_valid(g) or g.is_queued_for_deletion())
	# fire pool burns and ignites
	var burner := arena.spawn_bot(Vector3(-20, 0, 30), "soldier")
	burner.set_physics_process(false)
	var pool := FirePool.new()
	pool.def = WeaponCatalog.grenade("incendiary")
	pool.thrower = player
	pool.position = Vector3(-20, 0.05, 30)
	arena.add_child(pool)
	await _wait(1.5)
	burner.set_physics_process(true)
	await _wait(0.2)
	_check("fire_damages", burner.health < 100.0 and burner.burn_left > 0.0, burner.health)
	_check("fire_spreads", pool._patches.size() > 6, pool._patches.size())
	# fall damage
	player.health = 100.0
	player._regen_wait = 99.0
	player.global_position = Vector3(40, 9.0, 40)
	player.velocity = Vector3.ZERO
	await _wait(2.0)
	_check("fall_damage", player.health < 95.0 and player.health > 0.0, player.health)
	player.take_damage(9999, null, player.chest_position(), Vector3.FORWARD, "body")
	_check("player_death", player.dead and player.ragdoll.is_running())
	print("TEST_SUMMARY passed=%d failed=%d" % [_pass, _fail])
	get_tree().quit(1 if _fail > 0 else 0)
