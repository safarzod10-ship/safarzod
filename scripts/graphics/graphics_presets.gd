class_name GraphicsPresets
extends RefCounted
## Definitions of the LOW / MEDIUM / ULTRA graphics presets.
##
## Only features supported by Godot's Mobile renderer (Vulkan) and, where
## noted, the Compatibility renderer (OpenGL ES 3) are used. SSAO, SSIL, SSR,
## SDFGI and volumetric fog are intentionally absent: the Mobile renderer does
## not implement them. See docs/GRAPHICS_STANDARD.md.

enum Quality { LOW, MEDIUM, ULTRA }

const NAMES := {Quality.LOW: "low", Quality.MEDIUM: "medium", Quality.ULTRA: "ultra"}

const PRESETS := {
	Quality.LOW: {
		"render_scale": 0.7,           # 3D internal resolution (UI stays native)
		"scaling_mode": Viewport.SCALING_3D_MODE_BILINEAR,
		"msaa_3d": Viewport.MSAA_DISABLED,
		"fxaa": true,                  # cheap AA to compensate for MSAA off
		"shadows_enabled": true,
		"directional_shadow_size": 1024,
		"shadow_max_distance": 40.0,
		"shadow_split_mode": DirectionalLight3D.SHADOW_ORTHOGONAL,
		"soft_shadow_quality": RenderingServer.SHADOW_QUALITY_HARD,
		"view_distance": 250.0,
		"lod_threshold_px": 4.0,       # higher = more aggressive mesh LOD
		"glow": false,
		"anisotropic": 0,
		"fps_target": 30,
	},
	Quality.MEDIUM: {
		"render_scale": 0.85,
		"scaling_mode": Viewport.SCALING_3D_MODE_BILINEAR,
		"msaa_3d": Viewport.MSAA_2X,
		"fxaa": false,
		"shadows_enabled": true,
		"directional_shadow_size": 2048,
		"shadow_max_distance": 80.0,
		"shadow_split_mode": DirectionalLight3D.SHADOW_PARALLEL_2_SPLITS,
		"soft_shadow_quality": RenderingServer.SHADOW_QUALITY_SOFT_LOW,
		"view_distance": 500.0,
		"lod_threshold_px": 2.0,
		"glow": true,
		"anisotropic": 2,
		"fps_target": 30,
	},
	Quality.ULTRA: {
		"render_scale": 1.0,
		"scaling_mode": Viewport.SCALING_3D_MODE_BILINEAR,
		"msaa_3d": Viewport.MSAA_4X,
		"fxaa": false,
		"shadows_enabled": true,
		"directional_shadow_size": 4096,
		"shadow_max_distance": 150.0,
		"shadow_split_mode": DirectionalLight3D.SHADOW_PARALLEL_4_SPLITS,
		"soft_shadow_quality": RenderingServer.SHADOW_QUALITY_SOFT_MEDIUM,
		"view_distance": 900.0,
		"lod_threshold_px": 1.0,
		"glow": true,
		"anisotropic": 4,
		"fps_target": 60,
	},
}

## Renderers the user may choose. Changing the renderer requires a restart.
const RENDERERS := ["mobile", "gl_compatibility"]


static func from_name(name: String) -> int:
	for q: int in NAMES:
		if NAMES[q] == name.to_lower():
			return q
	return -1


static func get_preset(quality: int) -> Dictionary:
	return PRESETS.get(quality, PRESETS[Quality.MEDIUM])
