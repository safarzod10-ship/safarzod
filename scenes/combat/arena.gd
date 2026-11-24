class_name Arena
extends Node3D
## Combat proving ground (not part of the city map): flat range with cover,
## physics props, a tower for fall damage and waves of bots.

const MENU_SCENE := "res://scenes/combat/main_menu.tscn"
const SPAWNS: Array[Vector3] = [
	Vector3(-14, 0, -26), Vector3(0, 0, -32), Vector3(13, 0, -27), Vector3(-24, 0, -12),
	Vector3(24, 0, -14), Vector3(-6, 0, -40), Vector3(8, 0, -42), Vector3(-30, 0, -30), Vector3(30, 0, -32),
]

static var demo_mode := false   ## capture scripts: no waves, no mouse capture

var player: Player
var hud: CombatHUD
var wave := 0
var kills := 0
var _alive := 0
var _next_wave := -1.0


func _ready() -> void:
	GameManager.set_state(GameManager.State.PLAYING)
	_build_environment()
	_build_level()
	CombatFX.noise()  # start generating before the first effect needs it
	player = Player.new()
	player.char_id = CombatState.char_id
	player.weapon_id = CombatState.weapon_id
	player.position = Vector3(0, 0.05, 18)
	add_child(player)
	hud = CombatHUD.new()
	add_child(hud)
	hud.player = player
	hud.restart_requested.connect(func() -> void: get_tree().reload_current_scene())
	hud.menu_requested.connect(func() -> void: SceneLoader.change_scene(MENU_SCENE))
	player.died.connect(_on_player_died)
	player.damaged.connect(func(amount: float, _z: String, _a: Node) -> void: hud.hurt(amount))
	if not demo_mode:
		_next_wave = 1.5


func _physics_process(delta: float) -> void:
	if _next_wave > 0.0:
		_next_wave -= delta
		if _next_wave <= 0.0:
			_start_wave()
	hud.set_info("Волна %d   Убито: %d   Врагов: %d" % [wave, kills, _alive])


func _start_wave() -> void:
	wave += 1
	hud.banner("ВОЛНА %d" % wave)
	var n := mini(2 + wave, 8)
	var order := SPAWNS.duplicate()
	order.shuffle()
	for i in n:
		var ids: Array = []
		for c in CharacterCatalog.CHARACTERS:
			if c["id"] != player.char_id:
				ids.append(c["id"])
		spawn_bot(order[i % order.size()], ids.pick_random(), ["aks74", "m4"].pick_random())
	CombatState.best_wave = maxi(CombatState.best_wave, wave)


func spawn_bot(pos: Vector3, char_id: String, weapon_id := "aks74") -> Bot:
	var b := Bot.new()
	b.char_id = char_id
	b.weapon_id = weapon_id
	b.position = pos + Vector3.UP * 0.05
	b.rotation.y = PI
	b.accuracy_deg = maxf(3.2 - wave * 0.2, 1.6)
	add_child(b)
	_alive += 1
	b.died.connect(_on_bot_died)
	b.damaged.connect(func(_a: float, _z: String, attacker: Node) -> void:
		if attacker == player:
			hud.hit_marker(b.health <= 0.0))
	return b


func _on_bot_died(_who: Combatant, killer: Node) -> void:
	_alive -= 1
	if killer == player:
		kills += 1
		CombatState.kills += 1
	if _alive <= 0 and not demo_mode and not player.dead:
		hud.banner("ЧИСТО", 2.0)
		_next_wave = 4.0
		# resupply between waves
		player.reserve = maxi(player.reserve, 120)
		for g in WeaponCatalog.GRENADES:
			player.grenades[g["id"]] = maxi(int(player.grenades[g["id"]]), int(g["count"]))


func _on_player_died(_who: Combatant, _killer: Node) -> void:
	CombatState.save()
	await get_tree().create_timer(2.2).timeout
	hud.show_death()


# ------------------------------------------------------------------ world

func _build_environment() -> void:
	var sky_mat := ProceduralSkyMaterial.new()
	sky_mat.sky_top_color = Color(0.22, 0.38, 0.62)
	sky_mat.sky_horizon_color = Color(0.66, 0.72, 0.78)
	sky_mat.ground_bottom_color = Color(0.2, 0.19, 0.17)
	sky_mat.ground_horizon_color = Color(0.62, 0.66, 0.7)
	sky_mat.sun_angle_max = 12.0
	var sky := Sky.new()
	sky.sky_material = sky_mat
	var env := Environment.new()
	env.background_mode = Environment.BG_SKY
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.66, 0.68, 0.72)
	env.ambient_light_energy = 0.85
	env.tonemap_exposure = 1.25
	env.fog_sky_affect = 0.0
	env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	env.tonemap_white = 5.0
	env.glow_enabled = true
	env.glow_intensity = 0.55
	env.glow_bloom = 0.05
	env.glow_hdr_threshold = 1.1
	env.fog_enabled = true
	env.fog_light_color = Color(0.68, 0.72, 0.78)
	env.fog_density = 0.0016
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-48, 145, 0)
	sun.light_energy = 2.6
	sun.light_color = Color(1.0, 0.95, 0.86)
	sun.shadow_enabled = true
	sun.directional_shadow_max_distance = 90.0
	sun.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_2_SPLITS
	add_child(sun)


func _mat(color: Color, rough := 0.9, metal := 0.0, tex := "", uv := 1.0) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = color
	m.roughness = rough
	m.metallic = metal
	if tex != "":
		m.albedo_texture = load("res://assets/textures/terrain/%s_albedo_rough.png" % tex)
		m.normal_enabled = true
		m.normal_texture = load("res://assets/textures/terrain/%s_normal.png" % tex)
		m.uv1_triplanar = true
		m.uv1_world_triplanar = true
		m.uv1_scale = Vector3.ONE * uv
	return m


func _static_box(pos: Vector3, size: Vector3, mat: Material, rot_y := 0.0, rot_x := 0.0) -> StaticBody3D:
	var body := StaticBody3D.new()
	body.collision_layer = 1
	body.collision_mask = 0
	var cs := CollisionShape3D.new()
	var shape := BoxShape3D.new()
	shape.size = size
	cs.shape = shape
	body.add_child(cs)
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = size
	bm.material = mat
	mi.mesh = bm
	body.add_child(mi)
	add_child(body)
	body.position = pos
	body.rotation = Vector3(rot_x, rot_y, 0)
	return body


func _prop(pos: Vector3, size: Vector3, mat: Material, mass: float, cylinder := false) -> RigidBody3D:
	var rb := RigidBody3D.new()
	rb.mass = mass
	rb.collision_layer = 1
	rb.collision_mask = 1 | 2
	rb.add_to_group(&"physics_props")
	var cs := CollisionShape3D.new()
	var mi := MeshInstance3D.new()
	if cylinder:
		var cyl := CylinderShape3D.new()
		cyl.radius = size.x * 0.5
		cyl.height = size.y
		cs.shape = cyl
		var cm := CylinderMesh.new()
		cm.top_radius = size.x * 0.5
		cm.bottom_radius = size.x * 0.5
		cm.height = size.y
		cm.radial_segments = 16
		cm.material = mat
		mi.mesh = cm
	else:
		var shape := BoxShape3D.new()
		shape.size = size
		cs.shape = shape
		var bm := BoxMesh.new()
		bm.size = size
		bm.material = mat
		mi.mesh = bm
	rb.add_child(cs)
	rb.add_child(mi)
	add_child(rb)
	rb.position = pos
	return rb


func _build_level() -> void:
	var ground := _mat(Color(1.0, 0.98, 0.95), 0.95, 0.0, "soil_loess", 0.2)
	_static_box(Vector3(0, -0.5, 0), Vector3(180, 1, 180), ground)
	var concrete := _mat(Color(0.62, 0.62, 0.6), 0.9, 0.0, "rock_grey", 0.35)
	var dark := _mat(Color(0.33, 0.34, 0.35), 0.85)
	var wood := _mat(Color(0.5, 0.36, 0.2), 0.8)
	var metal_g := _mat(Color(0.2, 0.33, 0.24), 0.55, 0.6)
	var metal_r := _mat(Color(0.5, 0.16, 0.12), 0.55, 0.6)
	var metal_b := _mat(Color(0.15, 0.25, 0.42), 0.55, 0.6)
	# perimeter
	for s: float in [-1.0, 1.0]:
		_static_box(Vector3(s * 60, 2, 0), Vector3(1, 4, 121), concrete)
		_static_box(Vector3(0, 2, s * 60), Vector3(121, 4, 1), concrete)
	# low walls / jersey barriers
	for p: Array in [[-6, 8, 0.0], [7, 6, 0.3], [-14, -4, 1.2], [15, -6, -0.4], [0, -10, 0.0], [-9, -18, 0.6], [10, -19, -0.5], [-22, 4, 1.57], [22, 2, 1.57]]:
		_static_box(Vector3(p[0], 0.55, p[1]), Vector3(4.2, 1.1, 0.5), concrete, p[2])
	# tall walls
	for p: Array in [[-18, -14, 0.2], [18, -16, -0.2], [0, -24, 0.0], [-30, -20, 1.2], [30, -22, -1.2]]:
		_static_box(Vector3(p[0], 1.4, p[1]), Vector3(6.0, 2.8, 0.4), dark, p[2])
	# shipping containers
	_static_box(Vector3(-26, 1.3, -2), Vector3(6.1, 2.6, 2.44), metal_g, 0.25)
	_static_box(Vector3(27, 1.3, -6), Vector3(6.1, 2.6, 2.44), metal_r, -0.35)
	_static_box(Vector3(-4, 1.3, -34), Vector3(6.1, 2.6, 2.44), metal_b, 1.4)
	_static_box(Vector3(12, 1.3, -36), Vector3(6.1, 2.6, 2.44), metal_g, 0.1)
	# tower with a ramp (fall damage)
	_static_box(Vector3(-36, 3.0, 14), Vector3(7, 6.0, 7), concrete)
	_static_box(Vector3(-26.5, 2.75, 14), Vector3(13.2, 0.4, 3.0), dark, 0.0, 0.0).rotation.z = -atan2(6.0, 12.0)
	_static_box(Vector3(36, 1.25, 14), Vector3(8, 2.5, 8), concrete)
	_static_box(Vector3(29.5, 1.0, 14), Vector3(5.8, 0.4, 3.0), dark).rotation.z = atan2(2.5, 5.0)
	# loose crates and barrels
	for p: Array in [[-3, 4], [-2.2, 4.3], [4, -2], [5.1, -2.2], [4.5, -2.1], [-11, -9], [12, -12], [-1, -16], [1.2, -15.6], [20, 6], [-19, -2]]:
		_prop(Vector3(p[0], 0.5, p[1]), Vector3(1, 1, 1), wood, 35.0)
	_prop(Vector3(4.5, 1.5, -2.1), Vector3(0.9, 0.9, 0.9), wood, 28.0)
	_prop(Vector3(-2.6, 1.5, 4.1), Vector3(0.9, 0.9, 0.9), wood, 28.0)
	for p: Array in [[8, 9], [8.8, 9.3], [-16, 6], [16, -2], [-8, -22], [9, -24], [-25, -9]]:
		_prop(Vector3(p[0], 0.45, p[1]), Vector3(0.58, 0.9, 0.58), metal_r if int(p[0]) % 2 == 0 else metal_b, 22.0, true)
