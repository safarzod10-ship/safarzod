extends Node
## SettingsManager — user settings and graphics presets.
##
## Viewport-level options (render scale, MSAA, FXAA, LOD threshold, shadow
## atlas, anisotropy) are applied here. Scene-level options (light shadows,
## camera far plane, glow) are broadcast via `graphics_applied` and handled by
## a GraphicsApplier node placed in each 3D scene.

signal graphics_applied(quality: int, preset: Dictionary)
signal renderer_change_pending(renderer: String)

const RENDERER_OVERRIDE_PATH := "user://renderer_override.cfg"

var quality: int = GraphicsPresets.Quality.MEDIUM
var renderer: String = "mobile"
var show_diagnostics: bool = true
var master_volume_db: float = 0.0

var _cfg: ConfigFile


func _ready() -> void:
	_cfg = SaveManager.load_settings()
	var default_quality := GraphicsPresets.Quality.MEDIUM
	if active_rendering_method() == "gl_compatibility":
		default_quality = GraphicsPresets.Quality.LOW
	var stored_name: String = _cfg.get_value("graphics", "quality", GraphicsPresets.NAMES[default_quality])
	var q := GraphicsPresets.from_name(stored_name)
	quality = q if q >= 0 else default_quality
	renderer = _cfg.get_value("graphics", "renderer", active_rendering_method())
	if renderer not in GraphicsPresets.RENDERERS:
		renderer = "mobile"
	show_diagnostics = _cfg.get_value("ui", "show_diagnostics", true)
	master_volume_db = _cfg.get_value("audio", "master_volume_db", 0.0)
	apply_graphics()


func set_quality(new_quality: int) -> void:
	if not GraphicsPresets.PRESETS.has(new_quality):
		push_error("SettingsManager: unknown quality %d" % new_quality)
		return
	quality = new_quality
	apply_graphics()
	save()


func quality_name() -> String:
	return GraphicsPresets.NAMES[quality]


func current_preset() -> Dictionary:
	return GraphicsPresets.get_preset(quality)


func apply_graphics() -> void:
	var p := current_preset()
	var vp := get_viewport()
	vp.scaling_3d_mode = p["scaling_mode"]
	vp.scaling_3d_scale = p["render_scale"]
	vp.msaa_3d = p["msaa_3d"]
	vp.screen_space_aa = Viewport.SCREEN_SPACE_AA_FXAA if p["fxaa"] else Viewport.SCREEN_SPACE_AA_DISABLED
	vp.mesh_lod_threshold = p["lod_threshold_px"]
	vp.anisotropic_filtering_level = _aniso_level(p["anisotropic"])
	RenderingServer.directional_shadow_atlas_set_size(p["directional_shadow_size"], true)
	RenderingServer.directional_soft_shadow_filter_set_quality(p["soft_shadow_quality"])
	Engine.max_fps = 0 if OS.has_feature("editor") else int(p["fps_target"])
	graphics_applied.emit(quality, p)


## Renderer switch takes effect after restart (written to the project settings
## override file declared in project.godot).
func set_renderer(new_renderer: String) -> Error:
	if new_renderer not in GraphicsPresets.RENDERERS:
		return ERR_INVALID_PARAMETER
	renderer = new_renderer
	var err := OK
	if new_renderer == "mobile":
		if FileAccess.file_exists(RENDERER_OVERRIDE_PATH):
			err = DirAccess.remove_absolute(RENDERER_OVERRIDE_PATH)
	else:
		var o := ConfigFile.new()
		o.set_value("rendering", "renderer/rendering_method", new_renderer)
		o.set_value("rendering", "renderer/rendering_method.mobile", new_renderer)
		err = o.save(RENDERER_OVERRIDE_PATH)
	save()
	if new_renderer != active_rendering_method():
		renderer_change_pending.emit(new_renderer)
	return err


func active_rendering_method() -> String:
	return RenderingServer.get_current_rendering_method()


## Facts about the running device, for diagnostics and future auto-detection.
func get_capabilities() -> Dictionary:
	return {
		"os": OS.get_name(),
		"model": OS.get_model_name(),
		"cpu_count": OS.get_processor_count(),
		"rendering_method": active_rendering_method(),
		"rendering_driver": RenderingServer.get_current_rendering_driver_name(),
		"adapter": RenderingServer.get_video_adapter_name(),
		"adapter_vendor": RenderingServer.get_video_adapter_vendor(),
		"api_version": RenderingServer.get_video_adapter_api_version(),
		"rendering_device": RenderingServer.get_rendering_device() != null,
		"screen_size": DisplayServer.screen_get_size(),
		"headless": DisplayServer.get_name() == "headless",
	}


func save() -> Error:
	_cfg.set_value("graphics", "quality", quality_name())
	_cfg.set_value("graphics", "renderer", renderer)
	_cfg.set_value("ui", "show_diagnostics", show_diagnostics)
	_cfg.set_value("audio", "master_volume_db", master_volume_db)
	return SaveManager.save_settings(_cfg)


static func _aniso_level(samples: int) -> Viewport.AnisotropicFiltering:
	match samples:
		2:
			return Viewport.ANISOTROPY_2X
		4:
			return Viewport.ANISOTROPY_4X
		8:
			return Viewport.ANISOTROPY_8X
		16:
			return Viewport.ANISOTROPY_16X
	return Viewport.ANISOTROPY_DISABLED
