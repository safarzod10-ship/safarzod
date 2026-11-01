class_name GraphicsApplier
extends Node
## Applies scene-level parts of the active graphics preset: sun shadows, glow,
## sky radiance resolution. Vegetation / terrain read the preset themselves
## (SettingsManager.graphics_applied). The camera far plane is NOT tied to the
## preset: distant mountains must stay visible on every preset; world detail
## distance is controlled with per-object visibility ranges instead.

@export var sun: DirectionalLight3D
@export var camera: Camera3D
@export var world_environment: WorldEnvironment

const CAMERA_FAR := 16000.0


func _ready() -> void:
	SettingsManager.graphics_applied.connect(_apply)
	_apply(SettingsManager.quality, SettingsManager.current_preset())


func _apply(_quality: int, p: Dictionary) -> void:
	if sun:
		sun.shadow_enabled = p["shadows_enabled"]
		sun.directional_shadow_max_distance = p["shadow_max_distance"]
		sun.directional_shadow_mode = p["shadow_split_mode"]
	if camera:
		camera.far = CAMERA_FAR
	if world_environment and world_environment.environment:
		var env := world_environment.environment
		env.glow_enabled = p["glow"]
		if env.sky:
			env.sky.radiance_size = p["sky_radiance_size"]
