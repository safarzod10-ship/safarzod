extends Node
## Global graphics settings (Low / Medium / High). Persisted in user://settings.cfg.
## Systems listen to `quality_changed` and read the values they need from `get_value()`.

signal quality_changed(level: int)

enum Quality { LOW, MEDIUM, HIGH }

const PRESETS := {
	Quality.LOW: {
		"render_scale": 0.7, "msaa": 0, "shadows": true, "shadow_distance": 60.0, "shadow_size": 1024,
		"grass_radius": 14.0, "grass_density": 0.45, "tree_lod0_dist": 45.0, "tree_draw_dist": 260.0,
		"detail_dist": 50.0, "prop_dist": 70.0, "building_detail_dist": 70.0, "fog": true, "glow": false,
		"fxaa": true, "sky_radiance": 64,
	},
	Quality.MEDIUM: {
		"render_scale": 0.85, "msaa": 0, "shadows": true, "shadow_distance": 90.0, "shadow_size": 2048,
		"grass_radius": 22.0, "grass_density": 0.7, "tree_lod0_dist": 70.0, "tree_draw_dist": 400.0,
		"detail_dist": 80.0, "prop_dist": 110.0, "building_detail_dist": 110.0, "fog": true, "glow": true,
		"fxaa": true, "sky_radiance": 128,
	},
	Quality.HIGH: {
		"render_scale": 1.0, "msaa": 2, "shadows": true, "shadow_distance": 140.0, "shadow_size": 4096,
		"grass_radius": 32.0, "grass_density": 1.0, "tree_lod0_dist": 110.0, "tree_draw_dist": 700.0,
		"detail_dist": 130.0, "prop_dist": 170.0, "building_detail_dist": 170.0, "fog": true, "glow": true,
		"fxaa": false, "sky_radiance": 256,
	},
}

const CFG_PATH := "user://settings.cfg"
var quality: int = Quality.MEDIUM


func _ready() -> void:
	var cfg := ConfigFile.new()
	if cfg.load(CFG_PATH) == OK:
		quality = clampi(int(cfg.get_value("graphics", "quality", Quality.MEDIUM)), 0, 2)
	else:
		quality = Quality.MEDIUM if OS.has_feature("mobile") else Quality.HIGH
	for a in OS.get_cmdline_user_args():
		if a.begins_with("quality="):
			quality = ["low", "medium", "high"].find(a.substr(8).to_lower())
			quality = maxi(quality, 0)
	_apply_viewport()


func get_value(key: String) -> Variant:
	return PRESETS[quality][key]


func set_quality(q: int) -> void:
	quality = clampi(q, 0, 2)
	var cfg := ConfigFile.new()
	cfg.set_value("graphics", "quality", quality)
	cfg.save(CFG_PATH)
	_apply_viewport()
	quality_changed.emit(quality)


func quality_name() -> String:
	return ["Low", "Medium", "High"][quality]


func _apply_viewport() -> void:
	var vp := get_tree().root
	vp.scaling_3d_scale = get_value("render_scale")
	vp.msaa_3d = [Viewport.MSAA_DISABLED, Viewport.MSAA_2X, Viewport.MSAA_4X][int(get_value("msaa")) / 2]
	vp.screen_space_aa = Viewport.SCREEN_SPACE_AA_FXAA if get_value("fxaa") else Viewport.SCREEN_SPACE_AA_DISABLED
	RenderingServer.directional_shadow_atlas_set_size(int(get_value("shadow_size")), true)
