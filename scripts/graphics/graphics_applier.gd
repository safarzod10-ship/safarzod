class_name GraphicsApplier
extends Node
## Applies scene-level parts of the active graphics preset: sun shadows,
## camera far plane and glow. Place one in every 3D scene and assign targets.

@export var sun: DirectionalLight3D
@export var camera: Camera3D
@export var world_environment: WorldEnvironment


func _ready() -> void:
	SettingsManager.graphics_applied.connect(_apply)
	_apply(SettingsManager.quality, SettingsManager.current_preset())


func _apply(_quality: int, p: Dictionary) -> void:
	if sun:
		sun.shadow_enabled = p["shadows_enabled"]
		sun.directional_shadow_max_distance = p["shadow_max_distance"]
		sun.directional_shadow_mode = p["shadow_split_mode"]
	if camera:
		camera.far = p["view_distance"]
	if world_environment and world_environment.environment:
		world_environment.environment.glow_enabled = p["glow"]
		var env := world_environment.environment
		env.fog_enabled = true
		env.fog_mode = Environment.FOG_MODE_DEPTH  # hides the far-plane cut-off
		env.fog_depth_begin = p["view_distance"] * 0.6
		env.fog_depth_end = p["view_distance"]
