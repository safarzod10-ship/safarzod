class_name PlayerWater
extends Node3D
## The character and the sea: depth classification + all water effects.
## Modes (from the water depth at the feet and the sea floor under the body):
##   DRY     - on land;
##   SHALLOW - feet in water up to ~0.45 m: normal walking/running, splashes and water steps;
##   MEDIUM  - 0.45 .. ~1.2 m: slower (water drag grows with depth), running disabled from 0.7 m;
##   SWIM    - the floor is deeper than SWIM_ENTER below the surface: swimming at the surface
##             (no walking on the sea bed, no hovering), strokes splash, ripples around the body.
## Effects: splash particles (CPUParticles3D bursts: cheap, also on the GLES3 fallback), water step /
## stroke / entry sounds (CC0, assets/audio/sea), and the global shader parameter `water_player`
## that draws the wake / ripples in sea.gdshader.

enum Mode { DRY, SHALLOW, MEDIUM, SWIM }
const SEA_LEVEL := -1.6
const SWIM_ENTER := 1.38      ## floor this far below the surface -> swim
const SWIM_EXIT := 1.22       ## floor rises above this (feet touch) -> back to wading
const SWIM_BODY := 1.30       ## feet this far below the surface while swimming (shoulders at the surface)

var mode := Mode.DRY
var depth := 0.0              ## water depth at the feet (m, 0 on land)
var floor_depth := 0.0        ## sea floor below the surface under the body (m)
var _splash: CPUParticles3D
var _sfx: AudioStreamPlayer3D
var _swim_loop: AudioStreamPlayer3D
var _steps: Array[AudioStream] = []
var _entry: AudioStream
var _big: AudioStream
var _step_t := 0.0
var _stroke_t := 0.0


func _ready() -> void:
	_splash = CPUParticles3D.new()
	_splash.name = "Splash"
	_splash.emitting = false
	_splash.one_shot = true
	_splash.amount = 28
	_splash.lifetime = 0.75
	_splash.explosiveness = 0.9
	_splash.direction = Vector3.UP
	_splash.spread = 38.0
	_splash.initial_velocity_min = 1.4
	_splash.initial_velocity_max = 3.0
	_splash.gravity = Vector3(0, -9.8, 0)
	_splash.emission_shape = CPUParticles3D.EMISSION_SHAPE_SPHERE
	_splash.emission_sphere_radius = 0.18
	_splash.scale_amount_min = 0.5
	_splash.scale_amount_max = 1.2
	var c := Curve.new()
	c.add_point(Vector2(0, 0.6))
	c.add_point(Vector2(0.3, 1.0))
	c.add_point(Vector2(1, 0.15))
	_splash.scale_amount_curve = c
	var g := Gradient.new()
	g.set_color(0, Color(1, 1, 1, 0.85))
	g.set_color(1, Color(0.85, 0.95, 1.0, 0.0))
	_splash.color_ramp = g
	var q := QuadMesh.new()
	q.size = Vector2(0.09, 0.09)
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	m.vertex_color_use_as_albedo = true
	m.albedo_texture = _drop_texture()
	q.material = m
	_splash.mesh = q
	_splash.local_coords = false
	add_child(_splash)
	_sfx = AudioStreamPlayer3D.new()
	_sfx.unit_size = 6.0
	_sfx.max_polyphony = 3
	add_child(_sfx)
	_swim_loop = AudioStreamPlayer3D.new()
	_swim_loop.unit_size = 6.0
	_swim_loop.volume_db = -6.0
	var sl: AudioStream = _load("res://assets/audio/sea/swim_loop.ogg")
	if sl is AudioStreamOggVorbis:
		(sl as AudioStreamOggVorbis).loop = true
	_swim_loop.stream = sl
	add_child(_swim_loop)
	for i in 3:
		var s: AudioStream = _load("res://assets/audio/sea/step_water_%d.ogg" % (i + 1))
		if s:
			_steps.append(s)
	_entry = _load("res://assets/audio/sea/splash_entry.ogg")
	_big = _load("res://assets/audio/sea/splash_big.ogg")


## Sea surface at (x, z): Vector3(slope_x, height, slope_z) of the same 5 Gerstner waves as
## sea.gdshader (vertical part, shoaling by depth); used to float the swimmer on the swell.
static func wave_at(x: float, z: float, depth: float) -> Vector3:
	const W := [[0.15, -1.0, 60.0, 0.32], [-0.45, -0.9, 37.0, 0.20], [0.6, -0.8, 23.0, 0.12], [-0.1, -1.0, 14.5, 0.07], [0.85, -0.5, 9.0, 0.04]]
	var t := Time.get_ticks_msec() * 0.001
	var sh := lerpf(0.25, 1.0, smoothstep(0.3, 4.0, depth)) * wave_scale
	var h := 0.0
	var sx := 0.0
	var sz := 0.0
	for w in W:
		var d := Vector2(w[0], w[1]).normalized()
		var k := TAU / float(w[2])
		var c := sqrt(9.81 / k)
		var f := k * (d.x * x + d.y * z - c * t)
		var a := float(w[3]) * sh
		h += a * sin(f)
		sx += a * k * d.x * cos(f)
		sz += a * k * d.y * cos(f)
	return Vector3(sx, h, sz)


static var wave_scale := 1.0      ## kept equal to the sea material's wave_scale (Sea.apply_quality)


static func _load(p: String) -> AudioStream:
	return load(p) if ResourceLoader.exists(p) else null


static func _drop_texture() -> Texture2D:
	var img := Image.create(16, 16, false, Image.FORMAT_RGBA8)
	for y in 16:
		for x in 16:
			var d := Vector2(x - 7.5, y - 7.5).length() / 7.5
			img.set_pixel(x, y, Color(1, 1, 1, clampf(1.0 - d, 0.0, 1.0)))
	return ImageTexture.create_from_image(img)


## Classify the water state for a body standing/swimming at `feet` (global position of the feet).
## `floor_y` is the sea-floor height under the body (ray), NAN if none.
func update_mode(feet: Vector3, floor_y: float) -> Mode:
	depth = maxf(SEA_LEVEL - feet.y, 0.0)
	floor_depth = SEA_LEVEL - floor_y if not is_nan(floor_y) else 0.0
	var prev := mode
	if mode == Mode.SWIM:
		if floor_depth < SWIM_EXIT:
			mode = Mode.MEDIUM
	elif floor_depth > SWIM_ENTER and depth > SWIM_EXIT - 0.15:
		mode = Mode.SWIM
	if mode != Mode.SWIM:
		mode = Mode.DRY if depth < 0.03 else (Mode.SHALLOW if depth < 0.45 else Mode.MEDIUM)
	if prev != Mode.SWIM and mode == Mode.SWIM:
		_play(_entry, -2.0)
		_burst(Vector3(feet.x, SEA_LEVEL, feet.z), 1.4)
	return mode


## speed multiplier on land/wading (drag of the water on the legs)
func speed_factor() -> float:
	match mode:
		Mode.SHALLOW:
			return lerpf(1.0, 0.8, depth / 0.45)
		Mode.MEDIUM:
			return lerpf(0.75, 0.42, clampf((depth - 0.45) / 0.75, 0.0, 1.0))
	return 1.0


func can_run() -> bool:
	return mode == Mode.DRY or mode == Mode.SHALLOW or (mode == Mode.MEDIUM and depth < 0.7) or mode == Mode.SWIM


## per-frame effects: steps / strokes, swim loop, wake parameter for the sea shader
func effects(delta: float, pos: Vector3, speed: float, stride: float, landed: bool) -> void:
	var w := 0.0
	if mode == Mode.SHALLOW or mode == Mode.MEDIUM:
		w = 1.0
		if landed:
			_play(_big if depth > 0.25 else _entry, -3.0)
			_burst(Vector3(pos.x, SEA_LEVEL, pos.z), 1.2)
		if speed > 0.25:
			_step_t += delta * speed / maxf(stride * 0.5, 0.2)      # one splash per footfall
			if _step_t >= 1.0:
				_step_t = 0.0
				if not _steps.is_empty():
					_play(_steps[randi() % _steps.size()], lerpf(-10.0, -2.0, clampf(speed / 4.0, 0.0, 1.0)))
				_burst(Vector3(pos.x, SEA_LEVEL + 0.02, pos.z), lerpf(0.4, 1.0, clampf(speed / 4.0 + depth, 0.0, 1.0)))
	elif mode == Mode.SWIM:
		w = 2.0
		_stroke_t += delta * (0.75 + speed * 0.6)                   # strokes faster when swimming fast
		if _stroke_t >= 1.0:
			_stroke_t = 0.0
			if speed > 0.2:
				var fwd := -global_transform.basis.z
				_burst(Vector3(pos.x, SEA_LEVEL + 0.05, pos.z) + fwd * 0.6, 0.55)
				if not _steps.is_empty():
					_play(_steps[randi() % _steps.size()], -9.0)
	if mode == Mode.SWIM:
		if not _swim_loop.playing and _swim_loop.stream:
			_swim_loop.play()
		_swim_loop.volume_db = lerpf(-18.0, -5.0, clampf(speed / 1.6, 0.0, 1.0))
	elif _swim_loop.playing:
		_swim_loop.stop()
	RenderingServer.global_shader_parameter_set(&"water_player", Vector4(pos.x, SEA_LEVEL, pos.z, w))


func _burst(at: Vector3, strength: float) -> void:
	_splash.global_position = at
	_splash.initial_velocity_max = 1.6 + 1.8 * strength
	_splash.amount = int(clampf(12.0 + 24.0 * strength, 8.0, 48.0))
	_splash.restart()


func _play(s: AudioStream, db: float) -> void:
	if s == null:
		return
	_sfx.stream = s
	_sfx.volume_db = db
	_sfx.pitch_scale = randf_range(0.9, 1.1)
	_sfx.play()
