class_name CombatFX
extends RefCounted
## All combat visual effects, built in code: muzzle flash, tracers, impacts,
## blood, shell casings, explosion, ground fire.

const FIRE_SHADER := preload("res://assets/shaders/combat/fire.gdshader")
const PUFF_SHADER := preload("res://assets/shaders/combat/puff.gdshader")
const FLASH_SHADER := preload("res://assets/shaders/combat/flash.gdshader")
const MAX_DECALS := 48
const MAX_SHELLS := 40

static var _noise: NoiseTexture2D
static var _spot: ImageTexture
static var _hole: ImageTexture
static var _decals: Array[Node] = []
static var _shells: Array[Node] = []
static var _quad: QuadMesh


static func noise() -> NoiseTexture2D:
	if _noise == null:
		var n := FastNoiseLite.new()
		n.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
		n.frequency = 0.012
		n.fractal_octaves = 4
		_noise = NoiseTexture2D.new()
		_noise.width = 256
		_noise.height = 256
		_noise.seamless = true
		_noise.noise = n
	return _noise


## Soft radial blob (alpha) used for scorch marks.
static func spot_texture() -> ImageTexture:
	if _spot == null:
		_spot = _radial(128, 0.15, 1.0, 1.6)
	return _spot


static func hole_texture() -> ImageTexture:
	if _hole == null:
		_hole = _radial(48, 0.3, 0.9, 1.0)
	return _hole


static func _radial(size: int, inner: float, outer: float, power: float) -> ImageTexture:
	var img := Image.create(size, size, false, Image.FORMAT_RGBA8)
	var rng := RandomNumberGenerator.new()
	rng.seed = 7
	for y in size:
		for x in size:
			var d := Vector2(x + 0.5, y + 0.5).distance_to(Vector2(size, size) * 0.5) / (size * 0.5)
			var a := pow(1.0 - smoothstep(inner, outer, d + rng.randf_range(-0.06, 0.06)), power)
			img.set_pixel(x, y, Color(0.03, 0.028, 0.025, a))
	return ImageTexture.create_from_image(img)


static var _dot: ImageTexture


## White soft dot for spark / debris billboards.
static func dot_texture() -> ImageTexture:
	if _dot == null:
		var size := 32
		var img := Image.create(size, size, false, Image.FORMAT_RGBA8)
		for y in size:
			for x in size:
				var d := Vector2(x + 0.5, y + 0.5).distance_to(Vector2(size, size) * 0.5) / (size * 0.5)
				img.set_pixel(x, y, Color(1, 1, 1, 1.0 - smoothstep(0.45, 1.0, d)))
		_dot = ImageTexture.create_from_image(img)
	return _dot


static func quad() -> QuadMesh:
	if _quad == null:
		_quad = QuadMesh.new()
	return _quad


static func _flash_mat(mode: int, tint: Color, power: float) -> ShaderMaterial:
	var m := ShaderMaterial.new()
	m.shader = FLASH_SHADER
	m.set_shader_parameter(&"mode", mode)
	m.set_shader_parameter(&"tint", Vector3(tint.r, tint.g, tint.b))
	m.set_shader_parameter(&"power", power)
	m.set_shader_parameter(&"seed", randf())
	return m


static func _puff_mat(hot: float, density: float, color := Color(0.09, 0.085, 0.08)) -> ShaderMaterial:
	var m := ShaderMaterial.new()
	m.shader = PUFF_SHADER
	m.set_shader_parameter(&"noise_tex", noise())
	m.set_shader_parameter(&"hot", hot)
	m.set_shader_parameter(&"density", density)
	m.set_shader_parameter(&"smoke_color", Vector3(color.r, color.g, color.b))
	return m


static func _curve(points: Array) -> CurveTexture:
	var c := Curve.new()
	for p: Vector2 in points:
		c.add_point(p)
	var t := CurveTexture.new()
	t.curve = c
	return t


static func _gradient(colors: Array, offsets: Array) -> GradientTexture1D:
	var g := Gradient.new()
	g.colors = PackedColorArray(colors)
	g.offsets = PackedFloat32Array(offsets)
	var t := GradientTexture1D.new()
	t.gradient = g
	return t


static func _particles(parent: Node, pos: Vector3, amount: int, lifetime: float, one_shot: bool, mat: Material, size: Vector2) -> GPUParticles3D:
	var p := GPUParticles3D.new()
	p.amount = amount
	p.lifetime = lifetime
	p.one_shot = one_shot
	p.explosiveness = 0.95 if one_shot else 0.0
	p.randomness = 0.4
	var q := QuadMesh.new()
	q.size = size
	q.material = mat
	p.draw_pass_1 = q
	p.process_material = ParticleProcessMaterial.new()
	p.visibility_aabb = AABB(Vector3(-12, -4, -12), Vector3(24, 20, 24))
	parent.add_child(p)
	p.global_position = pos
	if one_shot:
		p.emitting = true
		p.get_tree().create_timer(lifetime + 0.6).timeout.connect(p.queue_free)
	return p


static func _billboard_mat(color: Color, emission := 0.0, additive := false) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.albedo_color = color * (1.0 + emission) if emission > 0.0 else color
	m.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	m.vertex_color_use_as_albedo = true
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.albedo_texture = dot_texture()
	if additive:
		m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	return m


static func _light(parent: Node, pos: Vector3, color: Color, energy: float, light_range: float, time: float) -> OmniLight3D:
	var l := OmniLight3D.new()
	l.light_color = color
	l.light_energy = energy
	l.omni_range = light_range
	l.shadow_enabled = false
	parent.add_child(l)
	l.global_position = pos
	if time > 0.0:
		var tw := l.create_tween()
		tw.tween_property(l, "light_energy", 0.0, time).set_ease(Tween.EASE_OUT).set_trans(Tween.TRANS_CUBIC)
		tw.tween_callback(l.queue_free)
	return l


static func _decal(parent: Node, pos: Vector3, normal: Vector3, size: float, tex: Texture2D, life: float, alpha := 1.0) -> void:
	var d := Decal.new()
	d.texture_albedo = tex
	d.size = Vector3(size, 0.5, size)
	d.modulate = Color(1, 1, 1, alpha)
	d.cull_mask = 1
	parent.add_child(d)
	var up := normal.normalized()
	var side := up.cross(Vector3.RIGHT)
	if side.length_squared() < 0.01:
		side = up.cross(Vector3.FORWARD)
	side = side.normalized()
	d.global_transform = Transform3D(Basis(side.cross(up), up, side).rotated(up, randf() * TAU), pos)
	_decals.append(d)
	while _decals.size() > MAX_DECALS:
		var old: Node = _decals.pop_front()
		if is_instance_valid(old):
			old.queue_free()
	if life > 0.0:
		var tw := d.create_tween()
		tw.tween_interval(life * 0.7)
		tw.tween_property(d, "modulate:a", 0.0, life * 0.3)
		tw.tween_callback(func() -> void:
			_decals.erase(d)
			d.queue_free())


# ---------------------------------------------------------------- weapons

static func muzzle_flash(weapon: Node3D, local_pos: Vector3) -> void:
	var root := Node3D.new()
	weapon.add_child(root)
	root.position = local_pos
	var s := randf_range(0.22, 0.34)
	for i in 3:  # two crossed planes along the barrel + one facing down the barrel
		var mi := MeshInstance3D.new()
		mi.mesh = quad()
		mi.material_override = _flash_mat(0, Color(1.0, 0.72, 0.32), 5.0)
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		root.add_child(mi)
		if i == 2:
			mi.scale = Vector3.ONE * s
			mi.position.z = -0.02
		else:
			mi.rotation = Vector3(0.0, PI * 0.5, randf() * 0.6 + i * PI * 0.5)
			mi.scale = Vector3(s * 1.7, s * 0.7, 1.0)
			mi.position.z = -s * 0.55
	_light(root, root.global_position + Vector3.UP * 0.05, Color(1.0, 0.75, 0.4), 3.5, 7.0, 0.07)
	root.get_tree().create_timer(0.045).timeout.connect(root.queue_free)
	# thin smoke wisp left in the world
	var world := weapon.get_tree().current_scene
	var p := _particles(world, root.global_position, 3, 0.7, true, _puff_mat(0.0, 0.35, Color(0.5, 0.5, 0.5)), Vector2(0.35, 0.35))
	var pm := p.process_material as ParticleProcessMaterial
	pm.direction = -weapon.global_transform.basis.z
	pm.spread = 12.0
	pm.initial_velocity_min = 0.6
	pm.initial_velocity_max = 1.6
	pm.gravity = Vector3(0, 0.6, 0)
	pm.damping_min = 2.0
	pm.damping_max = 3.0
	pm.scale_min = 0.5
	pm.scale_max = 1.0
	pm.scale_curve = _curve([Vector2(0, 0.3), Vector2(1, 1.6)])


static func tracer(world: Node, from: Vector3, to: Vector3) -> void:
	var dist := from.distance_to(to)
	if dist < 3.0:
		return
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = Vector3(0.018, 0.018, 1.0)
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.albedo_color = Color(3.0, 2.2, 1.0)
	m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	bm.material = m
	mi.mesh = bm
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	world.add_child(mi)
	var length := minf(6.0, dist * 0.4)
	var dir := (to - from).normalized()
	mi.look_at_from_position(from + dir * length * 0.5, to, Vector3.UP if absf(dir.y) < 0.99 else Vector3.RIGHT)
	mi.scale.z = length
	var tw := mi.create_tween()
	tw.tween_property(mi, "global_position", to - dir * length * 0.5, dist / 380.0)
	tw.tween_callback(mi.queue_free)


static func shell(world: Node, xform: Transform3D, velocity: Vector3) -> void:
	var rb := RigidBody3D.new()
	rb.mass = 0.012
	rb.collision_layer = 0
	rb.collision_mask = 1
	var cs := CollisionShape3D.new()
	var cap := CapsuleShape3D.new()
	cap.radius = 0.006
	cap.height = 0.04
	cs.shape = cap
	rb.add_child(cs)
	var mi := MeshInstance3D.new()
	var cm := CylinderMesh.new()
	cm.top_radius = 0.0045
	cm.bottom_radius = 0.0055
	cm.height = 0.04
	cm.radial_segments = 6
	cm.rings = 1
	var m := StandardMaterial3D.new()
	m.albedo_color = Color(0.78, 0.6, 0.25)
	m.metallic = 1.0
	m.roughness = 0.35
	cm.material = m
	mi.mesh = cm
	rb.add_child(mi)
	world.add_child(rb)
	rb.global_transform = xform
	rb.linear_velocity = velocity
	rb.angular_velocity = Vector3(randf_range(-20, 20), randf_range(-20, 20), randf_range(-20, 20))
	_shells.append(rb)
	while _shells.size() > MAX_SHELLS:
		var old: Node = _shells.pop_front()
		if is_instance_valid(old):
			old.queue_free()


static func impact(world: Node, pos: Vector3, normal: Vector3) -> void:
	_decal(world, pos, normal, 0.11, hole_texture(), 40.0)
	var dust := _particles(world, pos + normal * 0.03, 6, 0.9, true, _puff_mat(0.0, 0.5, Color(0.55, 0.5, 0.43)), Vector2(0.4, 0.4))
	var pm := dust.process_material as ParticleProcessMaterial
	pm.direction = normal
	pm.spread = 35.0
	pm.initial_velocity_min = 0.8
	pm.initial_velocity_max = 2.6
	pm.damping_min = 3.0
	pm.damping_max = 5.0
	pm.gravity = Vector3(0, -0.6, 0)
	pm.scale_min = 0.4
	pm.scale_max = 1.0
	pm.scale_curve = _curve([Vector2(0, 0.3), Vector2(1, 1.5)])
	var sparks := _particles(world, pos + normal * 0.02, 10, 0.35, true, _billboard_mat(Color(1.0, 0.8, 0.4), 3.0, true), Vector2(0.025, 0.025))
	var sm := sparks.process_material as ParticleProcessMaterial
	sm.direction = normal
	sm.spread = 55.0
	sm.initial_velocity_min = 3.0
	sm.initial_velocity_max = 9.0
	sm.gravity = Vector3(0, -9.8, 0)
	sm.scale_curve = _curve([Vector2(0, 1.0), Vector2(1, 0.0)])
	CombatAudio.play(world, "impact", pos, -8.0, 1.0, 60.0)


static func blood(world: Node, pos: Vector3, dir: Vector3) -> void:
	var p := _particles(world, pos, 10, 0.5, true, _puff_mat(0.0, 0.9, Color(0.35, 0.02, 0.02)), Vector2(0.16, 0.16))
	var pm := p.process_material as ParticleProcessMaterial
	pm.direction = dir
	pm.spread = 30.0
	pm.initial_velocity_min = 1.0
	pm.initial_velocity_max = 4.0
	pm.gravity = Vector3(0, -6.0, 0)
	pm.damping_min = 2.0
	pm.damping_max = 4.0
	pm.scale_min = 0.5
	pm.scale_max = 1.3
	pm.scale_curve = _curve([Vector2(0, 0.4), Vector2(1, 1.3)])
	CombatAudio.play(world, "flesh", pos, -6.0, 1.0, 50.0)


# ---------------------------------------------------------------- explosion

static func explosion(world: Node, pos: Vector3, radius: float) -> void:
	var c := pos + Vector3.UP * 0.4
	# flash
	_light(world, c + Vector3.UP * 0.8, Color(1.0, 0.7, 0.35), 22.0, radius * 3.0, 0.5)
	var flash := MeshInstance3D.new()
	flash.mesh = quad()
	var fm := _flash_mat(1, Color(1.0, 0.8, 0.5), 3.5)
	flash.material_override = fm
	world.add_child(flash)
	flash.global_position = c
	flash.scale = Vector3.ONE * 2.0
	var ftw := flash.create_tween().set_parallel()
	ftw.tween_property(flash, "scale", Vector3.ONE * radius * 0.8, 0.12)
	ftw.tween_method(func(a: float) -> void: fm.set_shader_parameter(&"alpha", a), 1.0, 0.0, 0.14)
	ftw.chain().tween_callback(flash.queue_free)
	var cam := world.get_viewport().get_camera_3d()
	if cam:
		flash.look_at(cam.global_position, Vector3.UP)
	# ground shockwave ring
	var ring := MeshInstance3D.new()
	ring.mesh = quad()
	var rm := _flash_mat(2, Color(1.0, 0.9, 0.8), 1.2)
	ring.material_override = rm
	world.add_child(ring)
	ring.global_position = pos + Vector3.UP * 0.08
	ring.rotation.x = -PI * 0.5
	var rtw := ring.create_tween().set_parallel()
	rtw.tween_property(ring, "scale", Vector3.ONE * radius * 2.6, 0.35).from(Vector3.ONE * 0.5).set_ease(Tween.EASE_OUT).set_trans(Tween.TRANS_QUAD)
	rtw.tween_method(func(a: float) -> void: rm.set_shader_parameter(&"alpha", a), 0.9, 0.0, 0.35)
	rtw.chain().tween_callback(ring.queue_free)
	# fireball that cools into black smoke
	var fb := _particles(world, c, 18, 1.5, true, _puff_mat(1.0, 1.0), Vector2(1.6, 1.6))
	var pm := fb.process_material as ParticleProcessMaterial
	pm.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_SPHERE
	pm.emission_sphere_radius = 0.35
	pm.direction = Vector3.UP
	pm.spread = 80.0
	pm.initial_velocity_min = 3.0
	pm.initial_velocity_max = 9.0
	pm.damping_min = 6.0
	pm.damping_max = 9.0
	pm.gravity = Vector3(0, 1.6, 0)
	pm.scale_min = 0.7
	pm.scale_max = 1.5
	pm.scale_curve = _curve([Vector2(0, 0.25), Vector2(0.15, 1.0), Vector2(1, 1.7)])
	# lingering smoke column
	var smoke := _particles(world, c + Vector3.UP * 0.5, 22, 4.5, true, _puff_mat(0.0, 0.75, Color(0.12, 0.11, 0.1)), Vector2(2.2, 2.2))
	smoke.explosiveness = 0.75
	var sm := smoke.process_material as ParticleProcessMaterial
	sm.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_SPHERE
	sm.emission_sphere_radius = 0.9
	sm.direction = Vector3.UP
	sm.spread = 50.0
	sm.initial_velocity_min = 1.0
	sm.initial_velocity_max = 4.5
	sm.damping_min = 1.2
	sm.damping_max = 2.2
	sm.gravity = Vector3(0.4, 0.9, 0.1)
	sm.scale_min = 0.6
	sm.scale_max = 1.4
	sm.scale_curve = _curve([Vector2(0, 0.4), Vector2(1, 2.2)])
	# dust skirt along the ground
	var dust := _particles(world, pos + Vector3.UP * 0.25, 16, 2.4, true, _puff_mat(0.0, 0.55, Color(0.42, 0.38, 0.32)), Vector2(1.8, 1.8))
	var dm := dust.process_material as ParticleProcessMaterial
	dm.direction = Vector3.UP
	dm.spread = 88.0
	dm.flatness = 0.9
	dm.initial_velocity_min = 5.0
	dm.initial_velocity_max = 11.0
	dm.damping_min = 5.0
	dm.damping_max = 8.0
	dm.gravity = Vector3(0, 0.3, 0)
	dm.scale_curve = _curve([Vector2(0, 0.4), Vector2(1, 2.0)])
	# sparks and dirt clods
	var sparks := _particles(world, c, 70, 1.3, true, _billboard_mat(Color(1.0, 0.75, 0.3), 4.0, true), Vector2(0.07, 0.07))
	var spm := sparks.process_material as ParticleProcessMaterial
	spm.direction = Vector3.UP
	spm.spread = 75.0
	spm.initial_velocity_min = 8.0
	spm.initial_velocity_max = 24.0
	spm.gravity = Vector3(0, -12.0, 0)
	spm.damping_min = 1.0
	spm.damping_max = 3.0
	spm.scale_min = 0.5
	spm.scale_max = 1.5
	spm.scale_curve = _curve([Vector2(0, 1.0), Vector2(1, 0.0)])
	var dirt := _particles(world, c, 45, 1.8, true, _billboard_mat(Color(0.12, 0.1, 0.08)), Vector2(0.14, 0.14))
	var dtm := dirt.process_material as ParticleProcessMaterial
	dtm.direction = Vector3.UP
	dtm.spread = 60.0
	dtm.initial_velocity_min = 6.0
	dtm.initial_velocity_max = 16.0
	dtm.gravity = Vector3(0, -14.0, 0)
	dtm.scale_min = 0.4
	dtm.scale_max = 1.6
	_decal(world, pos + Vector3.UP * 0.2, Vector3.UP, radius * 0.75, spot_texture(), 90.0, 0.95)
	CombatAudio.play(world, "explosion", pos, 8.0, 1.0, 400.0)


# ---------------------------------------------------------------- fire

## One burning patch (flames + embers + smoke). Returns the root; call
## `fire_stop` to let it die down.
static func fire_patch(parent: Node, pos: Vector3, scale := 1.0) -> Node3D:
	var root := Node3D.new()
	parent.add_child(root)
	root.global_position = pos
	var fmat := ShaderMaterial.new()
	fmat.shader = FIRE_SHADER
	fmat.set_shader_parameter(&"noise_tex", noise())
	fmat.set_shader_parameter(&"speed", randf_range(0.85, 1.2))
	var flames := GPUParticles3D.new()
	flames.name = "Flames"
	flames.amount = 9
	flames.lifetime = 1.5
	flames.preprocess = 0.6
	flames.randomness = 0.6
	var q := QuadMesh.new()
	q.size = Vector2(1.15, 1.7) * scale
	q.center_offset = Vector3(0, 0.8 * scale, 0)
	q.material = fmat
	flames.draw_pass_1 = q
	var pm := ParticleProcessMaterial.new()
	pm.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_SPHERE
	pm.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_BOX
	pm.emission_box_extents = Vector3(0.55, 0.02, 0.55) * scale
	pm.direction = Vector3.UP
	pm.spread = 10.0
	pm.initial_velocity_min = 0.05
	pm.initial_velocity_max = 0.3
	pm.gravity = Vector3.ZERO
	pm.scale_min = 0.6
	pm.scale_max = 1.25
	pm.scale_curve = _curve([Vector2(0, 0.55), Vector2(0.35, 1.0), Vector2(1, 0.75)])
	flames.process_material = pm
	flames.visibility_aabb = AABB(Vector3(-3, -1, -3), Vector3(6, 6, 6))
	root.add_child(flames)
	# low carpet of small flames licking the ground between the big tongues
	var low := GPUParticles3D.new()
	low.name = "LowFlames"
	low.amount = 12
	low.lifetime = 0.9
	low.preprocess = 0.5
	low.randomness = 0.7
	var lq := QuadMesh.new()
	lq.size = Vector2(0.7, 0.62) * scale
	lq.center_offset = Vector3(0, 0.28 * scale, 0)
	lq.material = fmat
	low.draw_pass_1 = lq
	var lm := ParticleProcessMaterial.new()
	lm.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_BOX
	lm.emission_box_extents = Vector3(1.0, 0.02, 1.0) * scale
	lm.gravity = Vector3.ZERO
	lm.scale_min = 0.6
	lm.scale_max = 1.3
	lm.scale_curve = _curve([Vector2(0, 0.6), Vector2(0.4, 1.0), Vector2(1, 0.7)])
	low.process_material = lm
	low.visibility_aabb = AABB(Vector3(-3, -1, -3), Vector3(6, 4, 6))
	root.add_child(low)
	# hot glow on the ground
	var glow := MeshInstance3D.new()
	glow.name = "Glow"
	glow.mesh = quad()
	glow.material_override = _flash_mat(1, Color(1.0, 0.38, 0.06), 0.7)
	glow.rotation.x = -PI * 0.5
	glow.position.y = 0.04
	glow.scale = Vector3.ONE * 3.2 * scale
	glow.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	root.add_child(glow)
	var embers := GPUParticles3D.new()
	embers.name = "Embers"
	embers.amount = 10
	embers.lifetime = 1.8
	var eq := QuadMesh.new()
	eq.size = Vector2(0.03, 0.03)
	eq.material = _billboard_mat(Color(1.0, 0.6, 0.2), 4.0, true)
	embers.draw_pass_1 = eq
	var em := ParticleProcessMaterial.new()
	em.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_SPHERE
	em.emission_sphere_radius = 0.4 * scale
	em.direction = Vector3.UP
	em.spread = 25.0
	em.initial_velocity_min = 1.0
	em.initial_velocity_max = 3.2
	em.gravity = Vector3(0.3, 0.8, 0)
	em.turbulence_enabled = true
	em.turbulence_noise_strength = 1.5
	em.scale_curve = _curve([Vector2(0, 1.0), Vector2(1, 0.0)])
	embers.process_material = em
	embers.visibility_aabb = AABB(Vector3(-3, -1, -3), Vector3(6, 8, 6))
	root.add_child(embers)
	var smoke := GPUParticles3D.new()
	smoke.name = "Smoke"
	smoke.amount = 6
	smoke.lifetime = 3.2
	var sq := QuadMesh.new()
	sq.size = Vector2(1.5, 1.5) * scale
	sq.material = _puff_mat(0.0, 0.62, Color(0.06, 0.055, 0.05))
	smoke.draw_pass_1 = sq
	var sm := ParticleProcessMaterial.new()
	sm.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_SPHERE
	sm.emission_sphere_radius = 0.3
	sm.emission_shape_offset = Vector3(0, 1.3 * scale, 0)
	sm.direction = Vector3.UP
	sm.spread = 14.0
	sm.initial_velocity_min = 0.9
	sm.initial_velocity_max = 1.7
	sm.gravity = Vector3(0.35, 0.25, 0.1)
	sm.scale_min = 0.6
	sm.scale_max = 1.1
	sm.scale_curve = _curve([Vector2(0, 0.35), Vector2(1, 1.9)])
	smoke.process_material = sm
	smoke.visibility_aabb = AABB(Vector3(-4, -1, -4), Vector3(8, 12, 8))
	root.add_child(smoke)
	return root


static func fire_stop(patch: Node3D, fade: float) -> void:
	for c in patch.get_children():
		if c is GPUParticles3D:
			(c as GPUParticles3D).emitting = false
		elif c is MeshInstance3D:
			var mat := (c as MeshInstance3D).material_override as ShaderMaterial
			var tw := c.create_tween()
			tw.tween_method(func(a: float) -> void: mat.set_shader_parameter(&"alpha", a), 1.0, 0.0, fade + 1.0)
	patch.get_tree().create_timer(fade + 3.5).timeout.connect(patch.queue_free)


static func scorch(world: Node, pos: Vector3, size: float, life: float) -> void:
	_decal(world, pos + Vector3.UP * 0.2, Vector3.UP, size, spot_texture(), life, 0.9)


static func fire_light(parent: Node3D, pos: Vector3, light_range: float) -> OmniLight3D:
	return _light(parent, pos, Color(1.0, 0.5, 0.15), 4.0, light_range, 0.0)
