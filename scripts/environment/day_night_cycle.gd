class_name DayNightCycle
extends Node
## Single time-of-day system for the whole world.
##
## * Sun position: simplified solar geometry for Dushanbe (lat 38.57 N);
##   game clock = local solar time (solar noon at 12:00, documented assumption).
## * Light / sky / ambient / exposure are functions of the SUN ELEVATION
##   (keys below), so any date gives consistent results. Default date 30 April:
##   06:00 and 18:00 ~ 9 deg sun (morning/evening), 12:00 ~ 66 deg, 00:00 night.
## * Weather (WeatherManager) feeds multiplicative modifiers via set_weather().
## * Heavy work (sky/environment uniforms) is applied at most APPLY_HZ times per
##   second; the light direction is updated every frame (cheap).

signal time_changed(hour: float)

const APPLY_HZ := 10.0
const LATITUDE_DEG := 38.57

## Keys by sun elevation (degrees). Colours sRGB, energies in Godot units.
## Calibrated with scenes/testing/lighting_calibration.tscn (docs/DAY_NIGHT_SYSTEM.md).
const KEYS := [
	{"el": -18.0, "amb_color": Color(0.24, 0.28, 0.38), "zenith": Color(0.010, 0.014, 0.032), "horizon": Color(0.028, 0.036, 0.062), "ground": Color(0.012, 0.012, 0.014),
	 "sun": Color(1, 1, 1), "sun_energy": 0.0, "ambient": 1.0, "exposure": 3.6, "stars": 1.0, "fog": Color(0.035, 0.045, 0.07),
	 "cloud_lit": Color(0.06, 0.07, 0.10), "cloud_shade": Color(0.025, 0.03, 0.045)},
	{"el": -6.0, "amb_color": Color(0.30, 0.30, 0.38), "zenith": Color(0.050, 0.075, 0.17), "horizon": Color(0.36, 0.30, 0.34), "ground": Color(0.05, 0.045, 0.045),
	 "sun": Color(1.0, 0.45, 0.25), "sun_energy": 0.0, "ambient": 1.0, "exposure": 2.0, "stars": 0.25, "fog": Color(0.22, 0.20, 0.24),
	 "cloud_lit": Color(0.45, 0.32, 0.34), "cloud_shade": Color(0.12, 0.12, 0.17)},
	{"el": 0.0, "amb_color": Color(0.60, 0.52, 0.50), "zenith": Color(0.20, 0.32, 0.55), "horizon": Color(0.96, 0.64, 0.44), "ground": Color(0.16, 0.13, 0.11),
	 "sun": Color(1.0, 0.50, 0.25), "sun_energy": 0.35, "ambient": 1.0, "exposure": 2.0, "stars": 0.0, "fog": Color(0.80, 0.62, 0.50),
	 "cloud_lit": Color(1.0, 0.66, 0.46), "cloud_shade": Color(0.42, 0.36, 0.42)},
	{"el": 6.0, "amb_color": Color(0.66, 0.64, 0.66), "zenith": Color(0.24, 0.42, 0.70), "horizon": Color(0.92, 0.78, 0.64), "ground": Color(0.24, 0.21, 0.18),
	 "sun": Color(1.0, 0.74, 0.52), "sun_energy": 1.25, "ambient": 1.0, "exposure": 1.9, "stars": 0.0, "fog": Color(0.85, 0.78, 0.70),
	 "cloud_lit": Color(1.0, 0.86, 0.72), "cloud_shade": Color(0.55, 0.54, 0.58)},
	{"el": 15.0, "amb_color": Color(0.64, 0.66, 0.70), "zenith": Color(0.22, 0.44, 0.76), "horizon": Color(0.78, 0.82, 0.86), "ground": Color(0.28, 0.25, 0.22),
	 "sun": Color(1.0, 0.88, 0.75), "sun_energy": 2.0, "ambient": 1.0, "exposure": 1.35, "stars": 0.0, "fog": Color(0.76, 0.80, 0.84),
	 "cloud_lit": Color(1.0, 0.97, 0.92), "cloud_shade": Color(0.60, 0.63, 0.68)},
	{"el": 35.0, "amb_color": Color(0.64, 0.67, 0.72), "zenith": Color(0.18, 0.42, 0.79), "horizon": Color(0.70, 0.80, 0.90), "ground": Color(0.30, 0.27, 0.24),
	 "sun": Color(1.0, 0.95, 0.88), "sun_energy": 2.6, "ambient": 1.0, "exposure": 1.0, "stars": 0.0, "fog": Color(0.72, 0.79, 0.87),
	 "cloud_lit": Color(1.0, 1.0, 0.98), "cloud_shade": Color(0.62, 0.66, 0.72)},
	{"el": 70.0, "amb_color": Color(0.64, 0.67, 0.72), "zenith": Color(0.16, 0.40, 0.78), "horizon": Color(0.68, 0.79, 0.90), "ground": Color(0.30, 0.27, 0.24),
	 "sun": Color(1.0, 0.97, 0.93), "sun_energy": 2.8, "ambient": 1.0, "exposure": 1.0, "stars": 0.0, "fog": Color(0.72, 0.79, 0.88),
	 "cloud_lit": Color(1.0, 1.0, 1.0), "cloud_shade": Color(0.64, 0.68, 0.74)},
]
## Compatibility renderer: its 3D buffer clips at 1.0 AFTER exposure (measured: white caps at
## tonemap(1.0) = 213 Filmic / 231 ACES regardless of exposure), so a shoulder tonemapper only
## dulls whites. It uses the Linear tonemapper with an exposure that keeps a white (0.79 albedo)
## surface in full sun at ~0.9 instead.
const COMPAT_TONEMAP := Environment.TONE_MAPPER_LINEAR
const COMPAT_EXPOSURE_SCALE := 0.26
## Sky background brightness compensation for the Linear tonemapper (measured: without it
## the Compatibility sky renders ~2x darker than the Filmic-mapped Mobile sky).
const COMPAT_SKY_BOOST := 1.5
const MOON_COLOR := Color(0.66, 0.74, 0.92)
const MOON_ENERGY := 0.16

@export_range(0.0, 24.0, 0.01) var time_of_day := 12.0:
	set(v):
		time_of_day = fposmod(v, 24.0)
		if not _advancing:   # external change -> apply at once; clock ticks use the APPLY_HZ throttle
			_dirty = true
var _advancing := false
@export var day_of_year := 120
## Game seconds per real second (60 = one game minute per real second).
@export var time_scale := 60.0
@export var paused := false
@export var sun: DirectionalLight3D
@export var world_environment: WorldEnvironment

var sun_elevation_deg := 0.0
var sun_azimuth_deg := 0.0
var weather := {"light_mult": 1.0, "ambient_mult": 1.0, "sky_mult": 1.0, "cloud_coverage": 0.25,
	"overcast": 0.0, "fog_density": 0.00012, "fog_tint": Color(1, 1, 1), "wetness": 0.0, "desaturate": 0.0}
## Global multipliers (tuned per renderer, see _ready). radiance_scale scales ALL scene
## radiance (sun, ambient, sky) and exposure is divided by it: the image is unchanged
## except that values stay below 1.0 before tonemapping, which the Compatibility
## renderer's LDR 3D buffer requires (measured clipping at tonemap(1.0)).
var exposure_scale := 0.55
var radiance_scale := 1.0
var light_scale := 1.0
var ambient_scale := 0.9
var sky_scale := 1.0
var current: Dictionary = {}

var _dirty := true
var _accum := 0.0
var _sky_mat: ShaderMaterial
var _cloud_offset := Vector2.ZERO


func _ready() -> void:
	add_to_group(&"day_night")
	if world_environment and world_environment.environment and world_environment.environment.sky:
		_sky_mat = world_environment.environment.sky.sky_material as ShaderMaterial
	if RenderingServer.get_current_rendering_method() == "gl_compatibility":
		exposure_scale = COMPAT_EXPOSURE_SCALE
		sky_scale = COMPAT_SKY_BOOST
		if world_environment and world_environment.environment:
			world_environment.environment.tonemap_mode = COMPAT_TONEMAP
	apply_now()


func _process(delta: float) -> void:
	if not paused and time_scale != 0.0:
		_advancing = true   # (bug fix) the setter marked every tick dirty -> apply_now() ran every frame
		time_of_day += delta * time_scale / 3600.0
		_advancing = false
		time_changed.emit(time_of_day)
	_cloud_offset += Vector2(0.0018, 0.0007) * delta * (1.0 + weather.get("wind", 0.0) * 2.0)
	_accum += delta
	if _dirty or _accum >= 1.0 / APPLY_HZ:
		_accum = 0.0
		apply_now()


func set_time(hour: float) -> void:
	time_of_day = hour
	time_changed.emit(time_of_day)
	apply_now()


func set_weather(params: Dictionary) -> void:
	weather.merge(params, true)
	_dirty = true


## Sun direction (unit vector pointing TO the sun) in world space:
## +X east, -Z north, +Y up.
func sun_direction() -> Vector3:
	var el := deg_to_rad(sun_elevation_deg)
	var az := deg_to_rad(sun_azimuth_deg)
	return Vector3(sin(az) * cos(el), sin(el), -cos(az) * cos(el))


func _solar_position() -> void:
	var decl := deg_to_rad(-23.44 * cos(TAU / 365.0 * (day_of_year + 10)))
	var lat := deg_to_rad(LATITUDE_DEG)
	var ha := deg_to_rad((time_of_day - 12.0) * 15.0)
	var sin_el := sin(lat) * sin(decl) + cos(lat) * cos(decl) * cos(ha)
	var el := asin(clampf(sin_el, -1.0, 1.0))
	var cos_az := (sin(decl) - sin(el) * sin(lat)) / maxf(cos(el) * cos(lat), 1e-6)
	var az := acos(clampf(cos_az, -1.0, 1.0))
	if ha > 0.0:
		az = TAU - az
	sun_elevation_deg = rad_to_deg(el)
	sun_azimuth_deg = rad_to_deg(az)


func _sample_keys(el: float) -> Dictionary:
	if el <= KEYS[0]["el"]:
		return KEYS[0].duplicate()
	for i in range(1, KEYS.size()):
		var b: Dictionary = KEYS[i]
		if el <= b["el"]:
			var a: Dictionary = KEYS[i - 1]
			var t := smoothstep(0.0, 1.0, (el - a["el"]) / (b["el"] - a["el"]))
			var out := {}
			for k: String in a:
				var va: Variant = a[k]
				out[k] = va.lerp(b[k], t) if va is Color else lerpf(va, b[k], t)
			return out
	return KEYS[KEYS.size() - 1].duplicate()


func apply_now() -> void:
	_dirty = false
	_solar_position()
	var k := _sample_keys(sun_elevation_deg)
	current = k
	var wl: float = weather["light_mult"]
	var oc: float = weather["overcast"]
	# --- light: sun above ~-2 deg, moon below
	var sun_dir := sun_direction()
	var moon_w := clampf((-sun_elevation_deg - 4.0) / 6.0, 0.0, 1.0)
	var moon_dir := Vector3(-sun_dir.x, 0.0, -sun_dir.z).normalized() * 0.6 + Vector3(0, 0.8, 0)
	moon_dir = moon_dir.normalized()
	if sun:
		var use_moon := moon_w > 0.0
		var dir := moon_dir if use_moon else sun_dir
		if dir.y > 0.02:
			sun.look_at(sun.global_position - dir, Vector3.UP if absf(dir.y) < 0.99 else Vector3.FORWARD)
		if use_moon:
			sun.light_color = MOON_COLOR
			sun.light_energy = MOON_ENERGY * moon_w * wl * light_scale * radiance_scale
		else:
			sun.light_color = k["sun"].lerp(Color(0.9, 0.92, 0.95), oc * 0.6)
			sun.light_energy = k["sun_energy"] * wl * light_scale * radiance_scale
		sun.visible = sun.light_energy > 0.002
	# --- sky
	if _sky_mat:
		var sky_mult: float = weather["sky_mult"]
		_sky_mat.set_shader_parameter("zenith_color", k["zenith"])
		_sky_mat.set_shader_parameter("horizon_color", k["horizon"])
		_sky_mat.set_shader_parameter("ground_color", k["ground"])
		_sky_mat.set_shader_parameter("sky_energy", sky_mult * radiance_scale * sky_scale)
		_sky_mat.set_shader_parameter("star_intensity", k["stars"])
		_sky_mat.set_shader_parameter("moon_dir", moon_dir)
		_sky_mat.set_shader_parameter("moon_visibility", moon_w)
		_sky_mat.set_shader_parameter("cloud_coverage", weather["cloud_coverage"])
		_sky_mat.set_shader_parameter("overcast", oc)
		_sky_mat.set_shader_parameter("cloud_lit_color", k["cloud_lit"])
		_sky_mat.set_shader_parameter("cloud_shade_color", k["cloud_shade"])
		_sky_mat.set_shader_parameter("cloud_offset", _cloud_offset)
		_sky_mat.set_shader_parameter("sun_glow", 0.35 * (1.0 - oc))
	# --- environment
	if world_environment and world_environment.environment:
		var env := world_environment.environment
		env.ambient_light_color = k["amb_color"]
		env.ambient_light_energy = k["ambient"] * weather["ambient_mult"] * ambient_scale * radiance_scale
		env.tonemap_exposure = k["exposure"] * exposure_scale / radiance_scale
		var fog_c: Color = k["fog"] * weather["fog_tint"]
		env.fog_light_color = fog_c
		env.fog_density = weather["fog_density"]
		env.adjustment_saturation = 1.0 - weather["desaturate"]
		RenderingServer.global_shader_parameter_set(&"env_horizon_color", k["horizon"])
	RenderingServer.global_shader_parameter_set(&"env_sun_direction", sun_dir)
	RenderingServer.global_shader_parameter_set(&"env_wetness", weather["wetness"])


func hour_string() -> String:
	var h := int(time_of_day)
	var m := int((time_of_day - h) * 60.0)
	return "%02d:%02d" % [h, m]
