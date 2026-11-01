class_name EnvironmentRig
extends Node3D
## Builds the outdoor lighting: physical sky, sun with cascaded shadows, aerial-perspective fog,
## filmic tonemapping, mild glow. Quality preset controls shadow cascades/distance, glow.

var world_env: WorldEnvironment
var sun: DirectionalLight3D
var tod: TimeOfDay


func _ready() -> void:
	var sky_mat := ProceduralSkyMaterial.new()
	sky_mat.sky_top_color = Color(0.25, 0.45, 0.78)
	sky_mat.sky_horizon_color = Color(0.68, 0.76, 0.86)
	sky_mat.sky_curve = 0.11
	sky_mat.sky_energy_multiplier = 1.0
	sky_mat.ground_horizon_color = Color(0.62, 0.63, 0.62)
	sky_mat.ground_bottom_color = Color(0.32, 0.30, 0.27)
	sky_mat.ground_curve = 0.06
	sky_mat.sun_angle_max = 25.0
	sky_mat.sun_curve = 0.12
	sky_mat.use_debanding = true
	var sky := Sky.new()
	sky.sky_material = sky_mat
	sky.radiance_size = Sky.RADIANCE_SIZE_128
	sky.process_mode = Sky.PROCESS_MODE_REALTIME

	var env := Environment.new()
	env.background_mode = Environment.BG_SKY
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	env.ambient_light_sky_contribution = 0.35
	env.ambient_light_color = Color(0.62, 0.60, 0.56)
	env.ambient_light_energy = 0.75
	env.reflected_light_source = Environment.REFLECTION_SOURCE_SKY
	env.tonemap_mode = Environment.TONE_MAPPER_AGX
	env.tonemap_exposure = 1.0
	env.tonemap_white = 6.0
	env.fog_enabled = true
	env.fog_mode = Environment.FOG_MODE_EXPONENTIAL
	env.fog_density = 0.0007
	env.fog_light_color = Color(0.70, 0.76, 0.84)
	env.fog_sun_scatter = 0.22
	env.fog_aerial_perspective = 0.35
	env.fog_sky_affect = 0.0
	env.fog_height = 60.0
	env.fog_height_density = 0.004
	env.glow_enabled = true
	env.glow_intensity = 0.35
	env.glow_bloom = 0.02
	env.glow_hdr_threshold = 1.2
	env.adjustment_enabled = true
	env.adjustment_saturation = 1.04
	env.adjustment_contrast = 1.03
	world_env = WorldEnvironment.new()
	world_env.environment = env
	add_child(world_env)

	sun = DirectionalLight3D.new()
	sun.name = "Sun"
	sun.shadow_enabled = true
	sun.shadow_bias = 0.08
	sun.shadow_normal_bias = 2.0
	sun.shadow_blur = 1.2
	sun.directional_shadow_blend_splits = true
	sun.light_angular_distance = 0.53
	add_child(sun)

	tod = TimeOfDay.new()
	tod.name = "TimeOfDay"
	add_child(tod)
	tod.sun_path = tod.get_path_to(sun)
	tod.env_path = tod.get_path_to(world_env)
	tod._ready()
	Settings.quality_changed.connect(func(_q: int) -> void: apply_quality())
	apply_quality()


func apply_quality() -> void:
	var q := Settings.quality
	sun.directional_shadow_mode = [DirectionalLight3D.SHADOW_PARALLEL_2_SPLITS, DirectionalLight3D.SHADOW_PARALLEL_4_SPLITS, DirectionalLight3D.SHADOW_PARALLEL_4_SPLITS][q]
	sun.directional_shadow_max_distance = Settings.get_value("shadow_distance")
	sun.directional_shadow_split_1 = 0.08 if q > 0 else 0.2
	sun.directional_shadow_split_2 = 0.22
	sun.directional_shadow_split_3 = 0.5
	var env := world_env.environment
	env.glow_enabled = Settings.get_value("glow")
	env.sky.radiance_size = {64: Sky.RADIANCE_SIZE_64, 128: Sky.RADIANCE_SIZE_128, 256: Sky.RADIANCE_SIZE_256}[int(Settings.get_value("sky_radiance"))]
	tod.apply()
