class_name TimeOfDay
extends Node
## Daylight rig for Dushanbe (lat 38.56 N). Drives the sun direction/colour/energy, sky,
## fog and the `city_night` shader global (lit windows, lamps, signs). Prepared for a full
## day/night cycle: set `hour` or call set_hour(); `speed` > 0 makes time flow (game hours
## per real second).

@export var hour := 15.5
@export var speed := 0.0
@export var day_of_year := 140          ## late May
@export var sun_path: NodePath
@export var env_path: NodePath
@export var moon_path: NodePath

const LAT := deg_to_rad(38.56)
const NORTH_YAW := 0.0   ## world -Z is north

var _sun: DirectionalLight3D
var _env: Environment
var night := 0.0


func _ready() -> void:
	add_to_group(&"time_of_day")
	_sun = get_node_or_null(sun_path)
	var we := get_node_or_null(env_path) as WorldEnvironment
	if we:
		_env = we.environment
	apply()


func set_hour(h: float) -> void:
	hour = fposmod(h, 24.0)
	apply()


func _process(delta: float) -> void:
	if speed > 0.0:
		hour = fposmod(hour + speed * delta, 24.0)
		apply()


## Solar elevation/azimuth (simple astronomical model, local solar time).
func sun_angles() -> Vector2:
	var decl := deg_to_rad(23.44) * sin(TAU * (284.0 + day_of_year) / 365.0)
	var ha := deg_to_rad(15.0 * (hour - 12.0))
	var el := asin(sin(LAT) * sin(decl) + cos(LAT) * cos(decl) * cos(ha))
	var az := atan2(sin(ha), cos(ha) * sin(LAT) - tan(decl) * cos(LAT))  # from south, +west
	return Vector2(el, az)


func apply() -> void:
	if _sun == null:
		return
	var a := sun_angles()
	var el := a.x
	var az := a.y
	# direction the light travels: from sun towards ground
	var up_el := maxf(el, deg_to_rad(-12.0))
	var dir := Vector3(-sin(az) * cos(up_el), sin(up_el), cos(az) * cos(up_el))
	_sun.look_at_from_position(Vector3.ZERO, -dir, Vector3.UP if absf(dir.y) < 0.99 else Vector3.FORWARD)
	var e := sin(el)
	var moon := get_node_or_null(moon_path) as DirectionalLight3D
	var day := smoothstep(-0.06, 0.12, e)
	night = 1.0 - smoothstep(-0.10, 0.02, e)
	# warm low sun, neutral high sun
	var warm := 1.0 - smoothstep(0.05, 0.45, e)
	_sun.light_color = Color(1.0, 0.96, 0.90).lerp(Color(1.0, 0.68, 0.42), warm)
	_sun.light_energy = 3.0 * day
	_sun.visible = day > 0.001
	_sun.shadow_enabled = day > 0.05 and Settings.get_value("shadows")
	if _env:
		_env.background_energy_multiplier = lerpf(0.06, 1.0, day)
		_env.ambient_light_energy = lerpf(0.22, 0.75, day)
		_env.fog_light_color = Color(0.70, 0.76, 0.84).lerp(Color(0.86, 0.72, 0.60), warm * day).lerp(Color(0.06, 0.07, 0.10), night)
	if moon:
		moon.light_energy = 0.22 * night
		moon.visible = night > 0.01
	RenderingServer.global_shader_parameter_set(&"city_night", night)
	for m in ["lamp_emissive", "sign"]:
		var mat := CityMaterials.get_material(m) as StandardMaterial3D
		if mat:
			mat.emission_energy_multiplier = night * (3.0 if m == "lamp_emissive" else 0.9)
