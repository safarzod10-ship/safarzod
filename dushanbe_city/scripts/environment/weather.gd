class_name Weather
extends Node3D
## Weather: CLEAR / CLOUDY / RAIN with smooth transitions (about 25 s), optionally cycling on its own.
## Drives: cloud layer (coverage, darkness), sun strength (TimeOfDay.overcast -> weaker direct light,
## softer contrast), sky colours (desaturated grey under overcast), fog density, rain streaks around
## the camera + rain sound (CC0), and the `city_wetness` shader global (roads, sidewalks, roofs and the
## terrain get darker and glossy while it rains, then dry slowly).
## Android: one cloud dome draw, two rain cylinders, no particles, no sky radiance re-bakes per frame.

enum State { CLEAR, CLOUDY, RAIN, SNOW }
const PRESET := {
	State.CLEAR: {"cover": 0.22, "dark": 0.0, "overcast": 0.0, "fog": 1.0, "rain": 0.0, "snow": 0.0},
	State.CLOUDY: {"cover": 0.72, "dark": 0.15, "overcast": 0.6, "fog": 1.6, "rain": 0.0, "snow": 0.0},
	State.RAIN: {"cover": 0.97, "dark": 0.75, "overcast": 0.88, "fog": 3.6, "rain": 1.0, "snow": 0.0},
	State.SNOW: {"cover": 0.95, "dark": 0.3, "overcast": 0.85, "fog": 4.2, "rain": 0.0, "snow": 1.0},
}

@export var auto_cycle := true
var state := State.CLEAR
var tod: TimeOfDay
var env: Environment
var sky_mat: ProceduralSkyMaterial
var cur := {"cover": 0.22, "dark": 0.0, "overcast": 0.0, "fog": 1.0, "rain": 0.0, "snow": 0.0}
var wetness := 0.0
var snow_cover := 0.0                     ## 0.25: snow lying on the ground (builds ~1 min, melts ~4 min)
var _snow: Array[MeshInstance3D] = []
var _smat: ShaderMaterial
var _timer := 240.0
var _clouds: MeshInstance3D
var _cmat: ShaderMaterial
var _rain: Array[MeshInstance3D] = []
var _rmat: ShaderMaterial
var _rain_snd: AudioStreamPlayer
var _sky_top := Color(0.25, 0.45, 0.78)
var _sky_hor := Color(0.68, 0.76, 0.86)
var _fog0 := 0.00035
var _sky_t := 0.0


func _ready() -> void:
	add_to_group(&"weather")
	if sky_mat:
		_sky_top = sky_mat.sky_top_color
		_sky_hor = sky_mat.sky_horizon_color
	if env:
		_fog0 = env.fog_density
	var dome := SphereMesh.new()
	dome.radius = 4000.0
	dome.height = 1600.0
	dome.radial_segments = 24
	dome.rings = 10
	dome.is_hemisphere = true
	_cmat = ShaderMaterial.new()
	_cmat.shader = load("res://assets/shaders/clouds.gdshader")
	_cmat.set_shader_parameter("noise_tex", load("res://assets/textures/noise_macro.png"))
	_cmat.render_priority = -10
	_clouds = MeshInstance3D.new()
	_clouds.name = "Clouds"
	_clouds.mesh = dome
	_clouds.material_override = _cmat
	_clouds.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_clouds.extra_cull_margin = 16384.0
	add_child(_clouds)
	_rmat = ShaderMaterial.new()
	_rmat.shader = load("res://assets/shaders/rain.gdshader")
	for r in [3.5, 9.0]:
		var cyl := CylinderMesh.new()
		cyl.top_radius = r
		cyl.bottom_radius = r
		cyl.height = 14.0
		cyl.cap_top = false
		cyl.cap_bottom = false
		cyl.radial_segments = 16
		var mi := MeshInstance3D.new()
		mi.mesh = cyl
		mi.material_override = _rmat
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		mi.visible = false
		add_child(mi)
		_rain.append(mi)
	_smat = ShaderMaterial.new()
	_smat.shader = load("res://assets/shaders/snow.gdshader")
	for r in [4.0, 10.0]:
		var cyl2 := CylinderMesh.new()
		cyl2.top_radius = r
		cyl2.bottom_radius = r
		cyl2.height = 14.0
		cyl2.cap_top = false
		cyl2.cap_bottom = false
		cyl2.radial_segments = 16
		var ms := MeshInstance3D.new()
		ms.mesh = cyl2
		ms.material_override = _smat
		ms.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		ms.visible = false
		add_child(ms)
		_snow.append(ms)
	_rain_snd = AudioStreamPlayer.new()
	var rs: AudioStream = load("res://assets/audio/sea/rain_loop.ogg") if ResourceLoader.exists("res://assets/audio/sea/rain_loop.ogg") else null
	if rs is AudioStreamOggVorbis:
		(rs as AudioStreamOggVorbis).loop = true
	_rain_snd.stream = rs
	_rain_snd.volume_db = -80.0
	add_child(_rain_snd)
	set_state(state, true)


## Switch weather; `instant` skips the transition (tests, screenshots, loading a save).
func set_state(s: State, instant := false) -> void:
	state = s
	_timer = randf_range(180.0, 420.0)
	if instant:
		cur = (PRESET[s] as Dictionary).duplicate()
		wetness = 1.0 if s == State.RAIN else 0.0
		snow_cover = 1.0 if s == State.SNOW else 0.0
		_apply(0.0)


func _process(delta: float) -> void:
	if auto_cycle:
		_timer -= delta
		if _timer <= 0.0:
			var next: State = {State.CLEAR: State.CLOUDY, State.CLOUDY: [State.CLEAR, State.RAIN, State.CLEAR, State.SNOW][randi() % 4], State.RAIN: State.CLOUDY, State.SNOW: State.CLOUDY}[state]
			set_state(next)
	var target: Dictionary = PRESET[state]
	var k := 1.0 - exp(-delta / 8.0)                        # ~25 s to settle
	for key in cur:
		cur[key] = lerpf(cur[key], target[key], k)
	# wet while raining (~20 s to soak), dries slowly (~3 min)
	wetness = move_toward(wetness, 1.0 if cur["rain"] > 0.3 else 0.0, delta * (0.05 if cur["rain"] > 0.3 else 0.006))
	snow_cover = move_toward(snow_cover, 1.0 if cur["snow"] > 0.3 else 0.0, delta * (0.018 if cur["snow"] > 0.3 else 0.004))
	_apply(delta)


func _apply(delta: float) -> void:
	var cam := get_viewport().get_camera_3d() if is_inside_tree() else null
	if cam:
		var cp := cam.global_position
		_clouds.global_position = Vector3(cp.x, -200.0, cp.z)
		for mi in _rain + _snow:
			mi.global_position = cp + Vector3(0, 3.0, 0)
	var day := 1.0 - (tod.night if tod else 0.0)
	if tod:
		tod.overcast = cur["overcast"]
		if delta == 0.0 or Engine.get_process_frames() % 10 == 0:
			tod.apply()
		var sun := tod.get_node_or_null(tod.sun_path) as DirectionalLight3D
		if sun:
			_cmat.set_shader_parameter("sun_dir", -sun.global_transform.basis.z * -1.0)
			_cmat.set_shader_parameter("sun_color", sun.light_color)
	_cmat.set_shader_parameter("coverage", cur["cover"])
	_cmat.set_shader_parameter("darkness", cur["dark"])
	_cmat.set_shader_parameter("day", day)
	var rain: float = cur["rain"]
	for mi in _rain:
		mi.visible = rain > 0.03
	_rmat.set_shader_parameter("intensity", rain)
	_rmat.set_shader_parameter("light", lerpf(0.15, 1.0, day))
	if _rain_snd.stream:
		if rain > 0.03 and not _rain_snd.playing:
			_rain_snd.play()
		elif rain <= 0.03 and _rain_snd.playing:
			_rain_snd.stop()
		_rain_snd.volume_db = linear_to_db(maxf(rain, 1e-4)) - 4.0
	RenderingServer.global_shader_parameter_set(&"city_wetness", wetness)
	RenderingServer.global_shader_parameter_set(&"city_snow", snow_cover)
	var snow: float = cur["snow"]
	for ms in _snow:
		ms.visible = snow > 0.03
	_smat.set_shader_parameter("intensity", snow)
	_smat.set_shader_parameter("light", lerpf(0.2, 1.0, day))
	if env:
		env.fog_density = _fog0 * float(cur["fog"])
	# sky: re-filtered radiance is the costly part -> update colours only when they changed noticeably
	_sky_t -= delta
	if sky_mat and (_sky_t <= 0.0 or delta == 0.0):
		_sky_t = 2.0
		var o: float = cur["overcast"]
		var grey := Color(0.56, 0.59, 0.63)
		sky_mat.sky_top_color = _sky_top.lerp(grey * 0.85, o)
		sky_mat.sky_horizon_color = _sky_hor.lerp(grey, o)
