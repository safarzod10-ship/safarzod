class_name WeaponFX
extends RefCounted
## Effects of weapons and explosions, all short-lived nodes under the current scene: muzzle flash
## (additive star + flash light), bullet tracer, impact sparks / dust + bullet hole decal, smoke and
## fire emitters for burning vehicles, the explosion (fireball, light, debris, smoke) and 3D sounds
## (assets/audio/weapons/*.wav, synthesised for the project).

static var _mats := {}
static var _sounds := {}
static var _holes: Array = []
static var _hole_tex: Texture2D
static var _soft: Texture2D


## a soft round puff (radial gradient) for smoke / fire / flashes / dust
static func soft_tex() -> Texture2D:
	if _soft == null:
		var g := Gradient.new()
		g.set_color(0, Color(1, 1, 1, 1))
		g.add_point(0.45, Color(1, 1, 1, 0.55))
		g.set_color(g.get_point_count() - 1, Color(1, 1, 1, 0))
		var t := GradientTexture2D.new()
		t.gradient = g
		t.fill = GradientTexture2D.FILL_RADIAL
		t.fill_from = Vector2(0.5, 0.5)
		t.fill_to = Vector2(1.0, 0.5)
		t.width = 64
		t.height = 64
		_soft = t
	return _soft

const MAX_HOLES := 40


static func _add(tree: SceneTree, n: Node, life: float) -> void:
	tree.current_scene.add_child(n)
	tree.create_timer(life, false).timeout.connect(func() -> void: if is_instance_valid(n): n.queue_free())


static func _glow_mat(col: Color, key: String) -> StandardMaterial3D:
	if _mats.has(key):
		return _mats[key]
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	m.albedo_color = col
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	m.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED if key.ends_with("_bb") else BaseMaterial3D.BILLBOARD_DISABLED
	if key.ends_with("_bb"):
		m.albedo_texture = soft_tex()
	_mats[key] = m
	return m


static func sound(tree: SceneTree, name: String, pos: Vector3, db := 0.0, max_dist := 160.0) -> void:
	if not _sounds.has(name):
		var p := "res://assets/audio/weapons/%s.wav" % name
		_sounds[name] = load(p) if ResourceLoader.exists(p) else null
	if _sounds[name] == null or tree.current_scene == null:
		return
	var a := AudioStreamPlayer3D.new()
	a.stream = _sounds[name]
	a.volume_db = db
	a.max_distance = max_dist
	a.unit_size = 12.0
	a.pitch_scale = randf_range(0.94, 1.06)
	tree.current_scene.add_child(a)
	a.global_position = pos
	a.play()
	a.finished.connect(a.queue_free)


static func muzzle_flash(tree: SceneTree, pos: Vector3, dir: Vector3, big := false) -> void:
	var root := Node3D.new()
	_add(tree, root, 0.06)
	root.global_position = pos
	var q := QuadMesh.new()
	q.size = Vector2.ONE * (0.42 if big else 0.28) * randf_range(0.8, 1.2)
	var mi := MeshInstance3D.new()
	mi.mesh = q
	mi.material_override = _glow_mat(Color(1.0, 0.72, 0.3, 0.95), "flash_bb")
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	root.add_child(mi)
	# a short cone of flame along the barrel
	var cone := MeshInstance3D.new()
	var cm := CylinderMesh.new()
	cm.top_radius = 0.0
	cm.bottom_radius = 0.05 if big else 0.035
	cm.height = 0.3 if big else 0.18
	cone.mesh = cm
	cone.material_override = _glow_mat(Color(1.0, 0.6, 0.2, 0.8), "cone")
	root.add_child(cone)
	cone.look_at_from_position(pos + dir * cm.height * 0.5, pos + dir * 2.0, Vector3.UP if absf(dir.y) < 0.95 else Vector3.RIGHT)
	cone.rotate_object_local(Vector3.RIGHT, -PI * 0.5)
	var l := OmniLight3D.new()
	l.light_color = Color(1.0, 0.75, 0.4)
	l.light_energy = 3.5
	l.omni_range = 6.0
	root.add_child(l)


static func tracer(tree: SceneTree, a: Vector3, b: Vector3) -> void:
	var d := b - a
	var L := d.length()
	if L < 0.5:
		return
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = Vector3(0.018, 0.018, minf(L, 14.0))
	mi.mesh = bm
	mi.material_override = _glow_mat(Color(1.0, 0.85, 0.5, 0.75), "tracer")
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_add(tree, mi, 0.05)
	var mid := a + d.normalized() * minf(L, 14.0) * 0.5 + d.normalized() * maxf(L - 14.0, 0.0) * 0.3
	mi.look_at_from_position(mid, mid + d, Vector3.UP if absf(d.normalized().y) < 0.95 else Vector3.RIGHT)


## sparks (metal) or dust (anything else) where a bullet hit, + a bullet hole
static func impact(tree: SceneTree, pos: Vector3, normal: Vector3, metal: bool, hole := true) -> void:
	var p := CPUParticles3D.new()
	p.one_shot = true
	p.emitting = true
	p.amount = 14 if metal else 10
	p.lifetime = 0.35 if metal else 0.6
	p.explosiveness = 1.0
	p.direction = normal
	p.spread = 35.0
	p.initial_velocity_min = 2.5 if metal else 0.8
	p.initial_velocity_max = 6.0 if metal else 2.0
	p.gravity = Vector3(0, -9.8, 0) if metal else Vector3(0, -1.0, 0)
	p.scale_amount_min = 0.5
	p.scale_amount_max = 1.2
	var q := QuadMesh.new()
	q.size = Vector2.ONE * (0.03 if metal else 0.12)
	p.mesh = q
	p.material_override = _glow_mat(Color(1.0, 0.75, 0.35, 1.0), "spark_bb") if metal else _dust_mat()
	_add(tree, p, 1.0)
	p.global_position = pos + normal * 0.03
	sound(tree, "metal_hit" if metal else "impact", pos, -6.0, 60.0)
	if hole:
		_bullet_hole(tree, pos, normal)


static func _dust_mat() -> StandardMaterial3D:
	if _mats.has("dust"):
		return _mats["dust"]
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.albedo_color = Color(0.55, 0.5, 0.45, 0.55)
	m.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	m.albedo_texture = soft_tex()
	_mats["dust"] = m
	return m


static func _bullet_hole(tree: SceneTree, pos: Vector3, normal: Vector3) -> void:
	if _hole_tex == null:
		var img := Image.create(32, 32, false, Image.FORMAT_RGBA8)
		for y in 32:
			for x in 32:
				var r := Vector2(x - 15.5, y - 15.5).length() / 16.0
				var a := clampf(1.0 - r, 0.0, 1.0)
				img.set_pixel(x, y, Color(0.03, 0.03, 0.03, clampf(a * 3.0, 0.0, 1.0) * (0.9 if r < 0.35 else 0.55)))
		_hole_tex = ImageTexture.create_from_image(img)
	var d := Decal.new()
	d.texture_albedo = _hole_tex
	d.size = Vector3(0.09, 0.12, 0.09)
	tree.current_scene.add_child(d)
	d.global_position = pos
	var up := normal.normalized()
	var side := up.cross(Vector3.FORWARD if absf(up.z) < 0.9 else Vector3.RIGHT).normalized()
	d.global_basis = Basis(side, up, side.cross(up))
	_holes.append(d)
	while _holes.size() > MAX_HOLES:
		var o: Node = _holes.pop_front()
		if is_instance_valid(o):
			o.queue_free()


## a persistent emitter (smoke / fire) parented to `parent` at local `at`
static func emitter(parent: Node3D, at: Vector3, fire: bool) -> CPUParticles3D:
	var p := CPUParticles3D.new()
	p.amount = 26 if fire else 22
	p.lifetime = 0.9 if fire else 2.6
	p.local_coords = false
	p.direction = Vector3.UP
	p.spread = 18.0 if fire else 25.0
	p.initial_velocity_min = 1.2 if fire else 0.8
	p.initial_velocity_max = 2.6 if fire else 1.8
	p.gravity = Vector3(0, 1.5 if fire else 0.6, 0)
	p.scale_amount_min = 0.6
	p.scale_amount_max = 1.4
	var curve := Curve.new()
	curve.add_point(Vector2(0, 0.4))
	curve.add_point(Vector2(0.4, 1.0))
	curve.add_point(Vector2(1, 0.0 if fire else 1.6))
	p.scale_amount_curve = curve
	var q := QuadMesh.new()
	q.size = Vector2.ONE * (0.7 if fire else 1.1)
	p.mesh = q
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	m.vertex_color_use_as_albedo = true
	m.albedo_texture = soft_tex()
	if fire:
		m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	p.material_override = m
	var g := Gradient.new()
	if fire:
		g.set_color(0, Color(1.0, 0.85, 0.4, 0.9))
		g.set_color(1, Color(0.9, 0.2, 0.05, 0.0))
	else:
		g.set_color(0, Color(0.25, 0.24, 0.23, 0.55))
		g.set_color(1, Color(0.12, 0.12, 0.12, 0.0))
	p.color_ramp = g
	parent.add_child(p)
	p.position = at
	p.emitting = true
	return p


## the explosion of a vehicle: fireball, flash light, debris, rising smoke, the boom
static func explosion(tree: SceneTree, pos: Vector3) -> void:
	var root := Node3D.new()
	_add(tree, root, 6.0)
	root.global_position = pos
	var fb := CPUParticles3D.new()
	fb.one_shot = true
	fb.explosiveness = 0.95
	fb.amount = 40
	fb.lifetime = 1.1
	fb.direction = Vector3.UP
	fb.spread = 180.0
	fb.initial_velocity_min = 3.0
	fb.initial_velocity_max = 9.0
	fb.gravity = Vector3(0, 3.0, 0)
	fb.damping_min = 4.0
	fb.damping_max = 6.0
	var q := QuadMesh.new()
	q.size = Vector2.ONE * 3.2
	fb.mesh = q
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	m.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	m.vertex_color_use_as_albedo = true
	m.albedo_texture = soft_tex()
	fb.material_override = m
	var g := Gradient.new()
	g.set_color(0, Color(1.0, 0.95, 0.7, 1.0))
	g.add_point(0.3, Color(1.0, 0.55, 0.15, 0.9))
	g.set_color(g.get_point_count() - 1, Color(0.3, 0.08, 0.02, 0.0))
	fb.color_ramp = g
	var curve := Curve.new()
	curve.add_point(Vector2(0, 0.5))
	curve.add_point(Vector2(0.3, 1.4))
	curve.add_point(Vector2(1, 0.6))
	fb.scale_amount_curve = curve
	root.add_child(fb)
	fb.emitting = true
	# debris
	var db := CPUParticles3D.new()
	db.one_shot = true
	db.explosiveness = 1.0
	db.amount = 30
	db.lifetime = 2.2
	db.direction = Vector3.UP
	db.spread = 70.0
	db.initial_velocity_min = 6.0
	db.initial_velocity_max = 15.0
	var bm := BoxMesh.new()
	bm.size = Vector3(0.15, 0.06, 0.2)
	db.mesh = bm
	var dm := StandardMaterial3D.new()
	dm.albedo_color = Color(0.08, 0.08, 0.08)
	db.material_override = dm
	root.add_child(db)
	db.emitting = true
	# smoke column
	var sm := emitter(root, Vector3(0, 1.0, 0), false)
	sm.amount = 40
	sm.lifetime = 4.0
	var sg := Gradient.new()
	sg.set_color(0, Color(0.42, 0.4, 0.38, 0.0))
	sg.add_point(0.15, Color(0.36, 0.34, 0.32, 0.45))
	sg.set_color(sg.get_point_count() - 1, Color(0.5, 0.5, 0.5, 0.0))
	sm.color_ramp = sg
	sm.one_shot = true
	sm.explosiveness = 0.3
	(sm.mesh as QuadMesh).size = Vector2.ONE * 3.0
	# flash
	var l := OmniLight3D.new()
	l.light_color = Color(1.0, 0.65, 0.3)
	l.light_energy = 14.0
	l.omni_range = 30.0
	root.add_child(l)
	var tw := root.create_tween()
	tw.tween_property(l, "light_energy", 0.0, 1.2)
	sound(tree, "explosion", pos, 6.0, 400.0)
