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
		"grass_density": 0.35,         # fraction of grass instances drawn (MultiMesh.visible_instance_count)
		"grass_distance": 22.0,        # grass visibility range end, m
		"shrub_distance": 60.0,
		"tree_detail_distance": 70.0,  # full-detail tree LOD range end (then low-poly LOD)
		"tree_distance": 260.0,        # trees hidden beyond
		"terrain_far_lod": true,
		"sky_radiance_size": Sky.RADIANCE_SIZE_64,
		"rain_particles": 700,
		"cloud_quality": 0,
		"render_scale": 0.7,           # 3D internal resolution (UI stays native)
		"scaling_mode": Viewport.SCALING_3D_MODE_BILINEAR,
		"msaa_3d": Viewport.MSAA_DISABLED,
		"fxaa": true,                  # cheap AA to compensate for MSAA off
		"shadows_enabled": true,
		"directional_shadow_size": 1024,
		"shadow_max_distance": 40.0,
		"shadow_split_mode": DirectionalLight3D.SHADOW_ORTHOGONAL,
		"soft_shadow_quality": RenderingServer.SHADOW_QUALITY_HARD,
		"view_distance": 260.0,       # world objects (trees, chunks detail); mountains always visible
		"lod_threshold_px": 4.0,       # higher = more aggressive mesh LOD
		"glow": false,
		"anisotropic": 0,
		"fps_target": 30,
	},
	Quality.MEDIUM: {
		"grass_density": 0.65,
		"grass_distance": 35.0,
		"shrub_distance": 100.0,
		"tree_detail_distance": 120.0,
		"tree_distance": 450.0,
		"terrain_far_lod": true,
		"sky_radiance_size": Sky.RADIANCE_SIZE_128,
		"rain_particles": 1600,
		"cloud_quality": 1,
		"render_scale": 0.85,
		"scaling_mode": Viewport.SCALING_3D_MODE_BILINEAR,
		"msaa_3d": Viewport.MSAA_2X,
		"fxaa": false,
		"shadows_enabled": true,
		"directional_shadow_size": 2048,
		"shadow_max_distance": 80.0,
		"shadow_split_mode": DirectionalLight3D.SHADOW_PARALLEL_2_SPLITS,
		"soft_shadow_quality": RenderingServer.SHADOW_QUALITY_SOFT_LOW,
		"view_distance": 450.0,
		"lod_threshold_px": 2.0,
		"glow": true,
		"anisotropic": 2,
		"fps_target": 30,
	},
	Quality.ULTRA: {
		"grass_density": 1.0,
		"grass_distance": 60.0,
		"shrub_distance": 160.0,
		"tree_detail_distance": 200.0,
		"tree_distance": 900.0,
		"terrain_far_lod": false,
		"sky_radiance_size": Sky.RADIANCE_SIZE_256,
		"rain_particles": 3500,
		"cloud_quality": 2,
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
