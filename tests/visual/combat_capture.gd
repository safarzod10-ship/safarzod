extends Node
## Scripted combat scenarios rendered with the real renderer.
## combat_capture.tscn -- <scenario> <out_prefix> [char] [weapon]   (run with --fixed-fps 30)
var arena: Arena
var player: Player
var prefix := ""
var frame_no := 0


func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	var scenario := args[0]
	prefix = args[1]
	if args.size() > 2: CombatState.char_id = args[2]
	if args.size() > 3: CombatState.weapon_id = args[3]
	Arena.demo_mode = true
	arena = (load("res://scenes/combat/arena.tscn") as PackedScene).instantiate() as Arena
	get_tree().root.add_child.call_deferred(arena)
	await get_tree().process_frame
	await get_tree().process_frame
	get_tree().current_scene = arena
	player = arena.player
	player.input_enabled = false
	await wait(0.6)
	await call(scenario)
	print("DONE")
	get_tree().quit()


func wait(sec: float) -> void:
	for i in int(sec * 60.0):
		await get_tree().physics_frame
	await get_tree().process_frame


func shot(tag: String) -> void:
	await RenderingServer.frame_post_draw
	var path := "%s_%s.png" % [prefix, tag]
	get_viewport().get_texture().get_image().save_png(path)
	print("CAPTURED ", path)


func free_cam(offset: Vector3, look_h := 1.2, fov := 40.0) -> void:
	var cam := Camera3D.new(); arena.add_child(cam)
	cam.look_at_from_position(player.global_position + offset, player.global_position + Vector3.UP * look_h)
	cam.fov = fov; cam.make_current()


func hold() -> void:
	arena.hud.visible = false
	await shot("tps")
	free_cam(Vector3(-1.6, 1.5, -2.2))
	await wait(0.2)
	await shot("front_l")
	free_cam(Vector3(2.4, 1.4, -0.6))
	await wait(0.1)
	await shot("side_r")
	free_cam(Vector3(-2.4, 1.4, -0.6))
	await wait(0.1)
	await shot("side_l")
	player.cam_pitch = 0.6
	await wait(0.4)
	await shot("up")
	player.cam_pitch = -0.6
	await wait(0.4)
	await shot("down")


func fire() -> void:
	arena.spawn_bot(Vector3(1.0, 0, 6), "soldier").set_physics_process(false)
	await wait(0.4)
	player.auto_fire = true
	for i in 5:
		await get_tree().physics_frame
		await shot("fire%d" % i)
	player.auto_fire = false


func frag() -> void:
	arena.hud.visible = false
	var b := arena.spawn_bot(Vector3(0.5, 0, 7), "soldier")
	var b2 := arena.spawn_bot(Vector3(-2.0, 0, 5), "frank")
	b.set_physics_process(false); b2.set_physics_process(false)
	player.cam_pitch = 0.05
	await wait(0.3)
	var g := player.throw_selected()
	g.linear_velocity = Vector3(0, 3.0, -9.0)
	await wait(1.2)
	await shot("frag_fly")
	g._fuse = 0.0
	await get_tree().physics_frame
	await get_tree().physics_frame
	await shot("frag_t0")
	await wait(0.15)
	await shot("frag_t1")
	await wait(0.4)
	await shot("frag_t2")
	await wait(1.2)
	await shot("frag_t3")
	await wait(2.5)
	await shot("frag_t4")


func fire_pool() -> void:
	arena.hud.visible = false
	var b := arena.spawn_bot(Vector3(1.5, 0, 8), "frank")
	b.set_physics_process(false)
	player.grenade_id = CombatState.touch.get("gid", "incendiary")
	if OS.get_cmdline_user_args().size() > 4: player.grenade_id = OS.get_cmdline_user_args()[4]
	await wait(0.3)
	var g := player.throw_selected()
	g.linear_velocity = Vector3(0, 3.0, -8.0)
	await wait(2.6)
	await shot("pool_t0")
	await wait(1.0)
	await shot("pool_t1")
	await wait(2.5)
	await shot("pool_t2")
	var cam := Camera3D.new(); arena.add_child(cam)
	cam.look_at_from_position(Vector3(3.5, 1.3, 13.5), Vector3(0, 0.7, 9.0)); cam.fov = 55; cam.make_current()
	await wait(0.3)
	await shot("pool_close")
	await wait(9.0)
	await shot("pool_end")


func ragdoll() -> void:
	arena.hud.visible = false
	var bots: Array[Bot] = []
	for p: Vector3 in [Vector3(0.8, 0, 12), Vector3(-1.5, 0, 11), Vector3(2.5, 0, 10)]:
		var b := arena.spawn_bot(p, ["soldier", "frank", "swat"][bots.size()])
		b.set_physics_process(false)
		bots.append(b)
	var cam := Camera3D.new(); arena.add_child(cam)
	cam.look_at_from_position(Vector3(4.5, 1.7, 16.5), Vector3(0.5, 0.6, 10.5)); cam.fov = 50; cam.make_current()
	await wait(0.4)
	await shot("rag_before")
	bots[0].take_damage(500, player, bots[0].chest_position(), Vector3(0, 0, -1), "body")
	bots[1].take_damage(500, player, bots[1].head_position(), Vector3(0.3, 0, -1).normalized(), "head")
	bots[2].take_damage(500, player, bots[2].chest_position(), Vector3(1, 0.2, -0.5).normalized(), "blast")
	await wait(0.2)
	await shot("rag_t0")
	await wait(0.3)
	await shot("rag_t1")
	await wait(0.5)
	await shot("rag_t2")
	await wait(3.0)
	await shot("rag_t3")
	cam.look_at_from_position(Vector3(2.5, 1.2, 12.5), bots[0].ragdoll.hips_position()); cam.fov = 45
	await wait(0.2)
	await shot("rag_close")


func battle() -> void:
	Arena.demo_mode = false
	arena._next_wave = 0.1
	player.input_enabled = false
	await wait(4.0)
	await shot("battle0")
	player.auto_fire = true
	await wait(3.0)
	await shot("battle1")
	await wait(6.0)
	await shot("battle2")
	print("player hp ", player.health, " kills ", arena.kills)


func look_at_target(target: Vector3) -> void:
	var d := target - player.camera.global_position
	player.cam_yaw = atan2(-d.x, -d.z)
	player.cam_pitch = atan2(d.y, Vector2(d.x, d.z).length())


func track(target_fn: Callable, sec: float) -> void:
	for i in int(sec * 60.0):
		look_at_target(target_fn.call())
		await get_tree().physics_frame


## Continuous sequence for --write-movie.
func demo() -> void:
	arena.hud.touch_forced = false
	InputManager.touch_mode = false
	var b1 := arena.spawn_bot(Vector3(-2.5, 0, 4), "soldier", "m4")
	var b2 := arena.spawn_bot(Vector3(3.0, 0, 2), "frank")
	var b3 := arena.spawn_bot(Vector3(-0.5, 0, -6), "soldier")
	var b4 := arena.spawn_bot(Vector3(1.6, 0, -7), "frank", "m4")
	for b: Bot in [b1, b2, b3, b4]:
		b.set_physics_process(false)
	await wait(1.0)
	player.script_move = Vector2(0, -1)          # walk forward
	await wait(1.6)
	player.script_sprint = true                  # sprint
	await wait(1.2)
	player.script_sprint = false
	player.script_move = Vector2.ZERO
	await track(func() -> Vector3: return b1.chest_position(), 0.6)
	player.auto_fire = true                      # burst at the chest -> ragdoll
	await track(func() -> Vector3: return b1.chest_position() if not b1.dead else b1.ragdoll.hips_position(), 1.0)
	player.auto_fire = false
	await wait(0.8)
	await track(func() -> Vector3: return b2.head_position(), 0.7)
	player.auto_fire = true                      # headshot
	await track(func() -> Vector3: return b2.head_position() if not b2.dead else b2.ragdoll.hips_position(), 0.5)
	player.auto_fire = false
	await wait(1.0)
	player.script_move = Vector2(-0.6, 0)        # strafe while aiming
	await track(func() -> Vector3: return b3.chest_position() + Vector3.UP * 1.5, 1.0)
	player.script_move = Vector2.ZERO
	player.throw_selected()                      # frag
	await track(func() -> Vector3: return b3.chest_position(), 1.0)
	await wait(4.2)
	player.grenade_id = "molotov"
	look_at_target(Vector3(4, 2.5, -2))
	await wait(0.4)
	player.throw_selected()                      # molotov -> burning ground
	await wait(0.3)
	await track(func() -> Vector3: return Vector3(3.5, 0.5, 0), 0.6)
	await wait(4.5)
	player.set_crouch(true)
	await wait(1.0)
	player.start_reload()
	await wait(3.0)
