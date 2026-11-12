class_name VehicleFX
extends Node
## Tyre smoke, skid marks and dust of the Prado, all driven by the REAL slip of each tyre
## (VehiclePrado wheel "slip_speed" = sliding speed of the contact patch, m/s):
## * SMOKE (asphalt) - wheelspin / hard launch, drift (lateral slide), locked rear wheels
##   (handbrake), grip loss; emission ∝ sliding speed, soft lit billboards that grow, rise and fade
##   (CPUParticles3D: no GPU compute, works on the GLES3 fallback; <= 44 puffs alive per wheel;
##   density via puff opacity / spread).
## * SKID MARKS - dark tyre-width strips laid while a tyre slides on asphalt (earth-coloured ruts on
##   the terrain), opacity ∝ slip; one MultiMesh ring buffer (MAX_MARKS segments, 1 draw call).
## * DUST - on unpaved ground (terrain collider): kicked up by speed and slip, sandy colour.
## * WATER - wheels in the sea (contact below the sea level): splashes ∝ speed and depth, entry
##   splash sound (CC0 sea recordings); on wet roads (rain) a thin spray behind the tyres ∝ speed.

const MAX_MARKS := 900
const MARK_STEP := 0.30          ## m between mark segments
const MARK_WIDTH := 0.25         ## m (265 mm tyre)

var car: VehiclePrado
var _smoke: Array[CPUParticles3D] = []
var _dust: Array[CPUParticles3D] = []
var _last: Array = []            ## last mark point per wheel (Vector3 or null)
var _mm: MultiMesh
var _next_mark := 0
var marks_laid := 0              ## total segments laid (tests)
var smoke_level := 0.0           ## 0..1 strongest smoke emitter this frame (tests / debug)
var dust_level := 0.0
var water_level := 0.0           ## 0..1 strongest water splash (tests)
var _water: Array[CPUParticles3D] = []
var _wsfx: AudioStreamPlayer3D
var _in_water := false
var _wstep := 0.0


func _ready() -> void:
	var puff := _puff_texture()
	for i in car.wheels.size():
		_smoke.append(_emitter(puff, Color(0.8, 0.8, 0.8), 44, 2.4, 0.5, 3.6, -0.35))
		_dust.append(_emitter(puff, Color(0.6, 0.53, 0.41), 36, 1.8, 0.6, 3.0, 0.4))
		var wp := _emitter(puff, Color(0.86, 0.92, 0.97), 40, 0.9, 0.25, 1.1, 9.8)
		wp.direction = Vector3(0, 1, 0)
		wp.spread = 35.0
		_water.append(wp)
		_last.append(null)
	_wsfx = AudioStreamPlayer3D.new()
	_wsfx.unit_size = 8.0
	_wsfx.bus = &"Vehicle"
	add_child(_wsfx)
	_mm = MultiMesh.new()
	_mm.transform_format = MultiMesh.TRANSFORM_3D
	_mm.use_colors = true
	var q := QuadMesh.new()
	q.size = Vector2(1, 1)
	q.orientation = PlaneMesh.FACE_Y
	_mm.mesh = q
	_mm.instance_count = MAX_MARKS
	_mm.visible_instance_count = 0
	var m := StandardMaterial3D.new()
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.vertex_color_use_as_albedo = true
	m.albedo_color = Color(1, 1, 1)
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED     # rubber deposit: just darkens the road
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	m.render_priority = -1
	q.material = m
	var mmi := MultiMeshInstance3D.new()
	mmi.name = "SkidMarks"
	mmi.multimesh = _mm
	mmi.top_level = true
	mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mmi.custom_aabb = AABB(Vector3(-5000, -100, -5000), Vector3(10000, 400, 10000))
	add_child(mmi)


func _emitter(tex: Texture2D, col: Color, amount: int, life: float, s0: float, s1: float, grav_y: float) -> CPUParticles3D:
	var p := CPUParticles3D.new()
	p.amount = amount
	p.lifetime = life
	p.local_coords = false
	p.emitting = false
	p.direction = Vector3(0, 1, 0)
	p.spread = 60.0
	p.initial_velocity_min = 0.3
	p.initial_velocity_max = 1.4
	p.gravity = Vector3(0.25, -grav_y, 0.1)       # smoke rises slowly, dust settles; light breeze
	p.damping_min = 0.6
	p.damping_max = 1.4
	p.emission_shape = CPUParticles3D.EMISSION_SHAPE_SPHERE
	p.emission_sphere_radius = 0.25
	p.angle_min = 0.0
	p.angle_max = 360.0
	p.angular_velocity_min = -25.0
	p.angular_velocity_max = 25.0
	var c := Curve.new()
	c.add_point(Vector2(0.0, s0 / s1))
	c.add_point(Vector2(1.0, 1.0))
	p.scale_amount_min = s1 * 0.8
	p.scale_amount_max = s1
	p.scale_amount_curve = c
	var g := Gradient.new()
	g.set_color(0, Color(col.r, col.g, col.b, 0.0))
	g.add_point(0.08, Color(col.r, col.g, col.b, 0.5))
	g.set_color(g.get_point_count() - 1, Color(col.r, col.g, col.b, 0.0))
	p.color_ramp = g
	var q := QuadMesh.new()
	q.size = Vector2(1, 1)
	var m := StandardMaterial3D.new()
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	m.vertex_color_use_as_albedo = true
	m.albedo_texture = tex
	# unshaded: lit smoke in the car's own shadow turned into black blobs around the wheels
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.roughness = 1.0
	m.specular_mode = BaseMaterial3D.SPECULAR_DISABLED
	m.disable_receive_shadows = true
	m.proximity_fade_enabled = false
	q.material = m
	p.mesh = q
	p.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(p)
	return p


static func _puff_texture() -> Texture2D:
	## soft round puff with a little noise (generated, no external asset)
	var n := FastNoiseLite.new()
	n.frequency = 0.09
	var S := 64
	var img := Image.create(S, S, false, Image.FORMAT_RGBA8)
	for y in S:
		for x in S:
			var d := Vector2(x - S * 0.5 + 0.5, y - S * 0.5 + 0.5).length() / (S * 0.5)
			var a := clampf(1.0 - d, 0.0, 1.0)
			a = a * a * (3.0 - 2.0 * a) * (0.65 + 0.35 * (n.get_noise_2d(x, y) * 0.5 + 0.5))
			img.set_pixel(x, y, Color(1, 1, 1, a))
	img.generate_mipmaps()
	return ImageTexture.create_from_image(img)


func _physics_process(_delta: float) -> void:
	if car == null:
		return
	smoke_level = 0.0
	dust_level = 0.0
	water_level = 0.0
	var spd := car.linear_velocity.length()
	for i in car.wheels.size():
		var w: Dictionary = car.wheels[i]
		var contact: bool = w["contact"]
		var ss: float = w.get("slip_speed", 0.0) if contact else 0.0
		var surf: int = w.get("surface", CityWorld.Surface.PAVED)
		var paved := surf == CityWorld.Surface.ASPHALT or surf == CityWorld.Surface.PAVED
		var terrain := contact and not paved
		var cp: Vector3 = w.get("contact_point", Vector3.ZERO)
		# smoke: hard surfaces only (rubber burning), from ~1.5 m/s of sliding
		var sm := 0.0 if terrain else clampf((ss - 1.5) / 7.0, 0.0, 1.0)
		_drive(_smoke[i], sm, cp + Vector3.UP * 0.25)
		smoke_level = maxf(smoke_level, sm)
		# dust by surface: dry earth / sand a lot, rock a little, grass hardly (only when sliding)
		var du := 0.0
		if terrain:
			var k: float = {CityWorld.Surface.EARTH: 1.0, CityWorld.Surface.SAND: 0.9, CityWorld.Surface.ROCK: 0.45, CityWorld.Surface.GRASS: 0.0}.get(surf, 0.5)
			var base := clampf(spd / 22.0, 0.0, 1.0) * k if spd > 2.0 else 0.0
			du = clampf(base + ss / 6.0 * maxf(k, 0.35), 0.0, 1.0)
		_drive(_dust[i], du, cp + Vector3.UP * 0.2)
		dust_level = maxf(dust_level, du)
		# water: depth of the sea at the tyre (hub below the surface counts even without ground contact)
		var hub: Vector3 = (w["node"] as Node3D).global_position
		var depth := PlayerWater.SEA_LEVEL - (hub.y - 0.4)
		var wa := 0.0
		if depth > 0.03:
			wa = clampf(spd / 10.0, 0.0, 1.0) * clampf(0.35 + depth * 1.5, 0.0, 1.0)
			_water[i].initial_velocity_min = 1.0 + spd * 0.25
			_water[i].initial_velocity_max = 2.0 + spd * 0.45
			_drive(_water[i], wa, Vector3(hub.x, PlayerWater.SEA_LEVEL + 0.05, hub.z))
		elif contact and paved and car.wetness > 0.3 and spd > 8.0 and not w["front"]:
			wa = clampf((spd - 8.0) / 25.0, 0.0, 1.0) * car.wetness * 0.45     # road spray in the rain
			_water[i].initial_velocity_min = 0.8
			_water[i].initial_velocity_max = 2.0
			_drive(_water[i], wa, cp + Vector3.UP * 0.15)
		else:
			_drive(_water[i], 0.0, cp)
		water_level = maxf(water_level, wa if depth > 0.03 else 0.0)
		# skid marks
		if contact and ss > 2.0:
			var nrm: Vector3 = w["normal"]
			var p := cp + nrm * 0.012
			var last: Variant = _last[i]
			if last == null:
				_last[i] = p
			elif (p - (last as Vector3)).length() >= MARK_STEP:
				_mark(last as Vector3, p, nrm, clampf((ss - 2.0) / 8.0, 0.15, 0.85), surf)
				_last[i] = p
		else:
			_last[i] = null


func _process(delta: float) -> void:
	# splash sounds: entering the water, then wading splashes ∝ speed
	if car == null:
		return
	var wet := water_level > 0.02
	var spd := car.linear_velocity.length()
	if wet and not _in_water and spd > 2.0:
		_ws("res://assets/audio/sea/splash_big.ogg" if spd > 6.0 else "res://assets/audio/sea/splash_entry.ogg", lerpf(-8.0, 2.0, clampf(spd / 12.0, 0.0, 1.0)))
	_in_water = wet
	if wet and spd > 1.0:
		_wstep += delta * (0.8 + spd * 0.25)
		if _wstep > 1.0:
			_wstep = 0.0
			_ws("res://assets/audio/sea/step_water_%d.ogg" % (1 + randi() % 3), lerpf(-10.0, 0.0, clampf(spd / 10.0, 0.0, 1.0)))


func _ws(path: String, db: float) -> void:
	if not ResourceLoader.exists(path):
		return
	_wsfx.stream = load(path)
	_wsfx.volume_db = db
	_wsfx.pitch_scale = randf_range(0.8, 0.95)
	_wsfx.play()


func _drive(p: CPUParticles3D, level: float, at: Vector3) -> void:
	p.global_position = at
	if level > 0.02:
		# density ∝ slip: opacity and puff size of the emitted smoke (CPUParticles3D has no rate ratio)
		p.color = Color(1, 1, 1, lerpf(0.25, 1.0, level))
		p.initial_velocity_max = lerpf(0.6, 1.8, level)
		if not p.emitting:
			p.emitting = true
	elif p.emitting:
		p.emitting = false


func _mark(a: Vector3, b: Vector3, n: Vector3, alpha: float, surf: int) -> void:
	var d := b - a
	var L := d.length()
	if L < 0.01 or L > 3.0:
		return
	var x := d / L
	var z := x.cross(n).normalized()
	var basis := Basis(x * (L + 0.04), n, z * MARK_WIDTH)
	_mm.set_instance_transform(_next_mark, Transform3D(basis, (a + b) * 0.5))
	# rubber on hard surfaces; torn grass / ruts in soft ground
	var col: Color = {CityWorld.Surface.GRASS: Color(0.13, 0.12, 0.06, alpha * 0.55), CityWorld.Surface.SAND: Color(0.45, 0.38, 0.27, alpha * 0.5),
		CityWorld.Surface.EARTH: Color(0.22, 0.17, 0.11, alpha * 0.6), CityWorld.Surface.ROCK: Color(0.1, 0.1, 0.1, alpha * 0.4)}.get(surf, Color(0.03, 0.03, 0.03, alpha))
	_mm.set_instance_color(_next_mark, col)
	_next_mark = (_next_mark + 1) % MAX_MARKS
	marks_laid += 1
	_mm.visible_instance_count = mini(marks_laid, MAX_MARKS)
