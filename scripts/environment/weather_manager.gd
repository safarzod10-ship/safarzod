class_name WeatherManager
extends Node3D
## Weather states with smooth transitions. Parameters are fed to the
## DayNightCycle (light, ambient, sky clouds, fog, wetness) and to the rain
## particles (camera-following box emitter, count limited by graphics preset).
## GPUParticles3D on Vulkan (Mobile), CPUParticles3D on Compatibility.

signal state_changed(state: String)

const STATES := {
	"Clear": {"cloud_coverage": 0.18, "overcast": 0.0, "light_mult": 1.0, "ambient_mult": 1.0, "sky_mult": 1.0,
		"fog_density": 0.00010, "fog_tint": Color(1, 1, 1), "wetness": 0.0, "rain": 0.0, "wind": 0.25, "desaturate": 0.0},
	"Cloudy": {"cloud_coverage": 0.55, "overcast": 0.15, "light_mult": 0.75, "ambient_mult": 1.05, "sky_mult": 0.95,
		"fog_density": 0.00014, "fog_tint": Color(0.96, 0.97, 1.0), "wetness": 0.0, "rain": 0.0, "wind": 0.45, "desaturate": 0.05},
	"Overcast": {"cloud_coverage": 0.95, "overcast": 0.75, "light_mult": 0.22, "ambient_mult": 1.35, "sky_mult": 0.75,
		"fog_density": 0.00022, "fog_tint": Color(0.9, 0.92, 0.95), "wetness": 0.05, "rain": 0.0, "wind": 0.5, "desaturate": 0.18},
	"LightRain": {"cloud_coverage": 0.95, "overcast": 0.85, "light_mult": 0.15, "ambient_mult": 1.2, "sky_mult": 0.62,
		"fog_density": 0.0006, "fog_tint": Color(0.82, 0.85, 0.9), "wetness": 0.55, "rain": 0.4, "wind": 0.6, "desaturate": 0.22},
	"Rain": {"cloud_coverage": 1.0, "overcast": 1.0, "light_mult": 0.08, "ambient_mult": 1.0, "sky_mult": 0.48,
		"fog_density": 0.0016, "fog_tint": Color(0.72, 0.76, 0.82), "wetness": 1.0, "rain": 1.0, "wind": 0.9, "desaturate": 0.3},
	"Fog": {"cloud_coverage": 0.7, "overcast": 0.6, "light_mult": 0.35, "ambient_mult": 1.3, "sky_mult": 0.8,
		"fog_density": 0.012, "fog_tint": Color(1.05, 1.05, 1.06), "wetness": 0.15, "rain": 0.0, "wind": 0.1, "desaturate": 0.25},
}

@export var day_night: DayNightCycle
@export var state := "Clear"
@export var transition_seconds := 12.0

var current: Dictionary = STATES["Clear"].duplicate()
var target: Dictionary = STATES["Clear"].duplicate()
var progress := 1.0

var _from: Dictionary = {}
var _rain: Node3D
var _rain_max := 1600
var _wind := Vector2(0.6, 0.2)


func _ready() -> void:
	add_to_group(&"weather")
	_build_rain()
	SettingsManager.graphics_applied.connect(_on_graphics)
	_on_graphics(SettingsManager.quality, SettingsManager.current_preset())
	set_state_immediate(state)


func set_state(new_state: String, seconds := -1.0) -> void:
	if not STATES.has(new_state):
		push_error("WeatherManager: unknown state " + new_state)
		return
	state = new_state
	_from = current.duplicate()
	target = STATES[new_state].duplicate()
	transition_seconds = seconds if seconds >= 0.0 else transition_seconds
	progress = 0.0 if transition_seconds > 0.0 else 1.0
	state_changed.emit(new_state)
	if progress >= 1.0:
		_apply(target)


func set_state_immediate(new_state: String) -> void:
	set_state(new_state, 0.0)


func _process(delta: float) -> void:
	if progress < 1.0:
		progress = minf(1.0, progress + delta / maxf(transition_seconds, 0.01))
		var t := smoothstep(0.0, 1.0, progress)
		var mix := {}
		for k: String in target:
			var a: Variant = _from[k]
			mix[k] = a.lerp(target[k], t) if a is Color else lerpf(a, target[k], t)
		_apply(mix)
	if _rain:
		var cam := get_viewport().get_camera_3d()
		if cam:
			_rain.global_position = cam.global_position + Vector3(0, 12, 0)


func _apply(p: Dictionary) -> void:
	current = p
	if day_night:
		day_night.set_weather(p)
	_wind = Vector2(0.6, 0.25).normalized() * (0.3 + float(p["wind"]))
	RenderingServer.global_shader_parameter_set(&"env_wind", _wind)
	_set_rain(float(p["rain"]))


func _on_graphics(_q: int, preset: Dictionary) -> void:
	_rain_max = int(preset["rain_particles"])
	if _rain:
		_rain.set("amount", _rain_max)
		_set_rain(float(current.get("rain", 0.0)))


func _set_rain(intensity: float) -> void:
	if _rain == null:
		return
	_rain.visible = intensity > 0.01
	_rain.set("emitting", intensity > 0.01)
	if _rain is GPUParticles3D:
		(_rain as GPUParticles3D).amount_ratio = clampf(intensity, 0.0, 1.0)
	elif _rain is CPUParticles3D:
		(_rain as CPUParticles3D).amount = maxi(1, int(_rain_max * clampf(intensity, 0.05, 1.0)))


func rain_node() -> Node3D:
	return _rain


func _build_rain() -> void:
	var drop := QuadMesh.new()
	drop.size = Vector2(0.012, 0.55)
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.albedo_color = Color(0.78, 0.82, 0.9, 0.38)
	m.billboard_mode = BaseMaterial3D.BILLBOARD_FIXED_Y
	m.billboard_keep_scale = true
	m.disable_receive_shadows = true
	drop.material = m
	if RenderingServer.get_current_rendering_method() == "gl_compatibility":
		var c := CPUParticles3D.new()
		c.mesh = drop
		c.amount = 600
		c.lifetime = 0.9
		c.emission_shape = CPUParticles3D.EMISSION_SHAPE_BOX
		c.emission_box_extents = Vector3(22, 1, 22)
		c.direction = Vector3(0.08, -1, 0.03)
		c.spread = 2.0
		c.initial_velocity_min = 16.0
		c.initial_velocity_max = 19.0
		c.gravity = Vector3(0, -6, 0)
		c.local_coords = false
		_rain = c
	else:
		var g := GPUParticles3D.new()
		var pm := ParticleProcessMaterial.new()
		pm.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_BOX
		pm.emission_box_extents = Vector3(22, 1, 22)
		pm.direction = Vector3(0.08, -1, 0.03)
		pm.spread = 2.0
		pm.initial_velocity_min = 16.0
		pm.initial_velocity_max = 19.0
		pm.gravity = Vector3(0, -6, 0)
		g.process_material = pm
		g.draw_pass_1 = drop
		g.amount = 1600
		g.lifetime = 0.9
		g.visibility_aabb = AABB(Vector3(-25, -25, -25), Vector3(50, 30, 50))
		g.local_coords = false
		_rain = g
	_rain.name = "Rain"
	(_rain as GeometryInstance3D).cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(_rain)
