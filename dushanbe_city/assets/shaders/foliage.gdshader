// DUSHANBE foliage: leaf-cluster cards, flower cards, impostor cards.
// Two-sided, alpha cut-out via discard (ALPHA_SCISSOR rendered black on lavapipe/Mobile),
// mip-aware alpha to keep crowns dense at distance, wind (global), per-instance hue/brightness
// variation (world-position hash), cheap translucency via BACKLIGHT.
shader_type spatial;
render_mode cull_disabled, depth_draw_opaque, diffuse_burley, specular_schlick_ggx;

#include "res://assets/shaders/vegetation_common.gdshaderinc"
global uniform float veg_unshadowed;   // 1 when tree shadow maps are off: fake crown self-shadowing

group_uniforms textures;
uniform sampler2D albedo_tex : source_color, filter_linear_mipmap, repeat_disable;
uniform sampler2D normal_tex : hint_normal, filter_linear_mipmap, repeat_disable;
uniform float normal_strength : hint_range(0.0, 2.0) = 0.6;
uniform float tex_size = 1024.0;
group_uniforms alpha;
uniform float alpha_cutoff : hint_range(0.0, 1.0) = 0.42;
// alpha *= 1 + mip * alpha_mip_scale : compensates coverage loss in lower mips
uniform float alpha_mip_scale : hint_range(0.0, 1.0) = 0.25;
group_uniforms colour;
uniform vec4 tint : source_color = vec4(1.0);
uniform float hue_variation : hint_range(0.0, 0.5) = 0.07;
uniform float brightness_variation : hint_range(0.0, 0.5) = 0.10;
uniform float branch_variation : hint_range(0.0, 0.5) = 0.08;
uniform float ao_strength : hint_range(0.0, 1.0) = 0.85;
uniform float roughness : hint_range(0.0, 1.0) = 0.72;
uniform float specular : hint_range(0.0, 1.0) = 0.3;
uniform float translucency : hint_range(0.0, 2.0) = 0.55;
uniform vec4 translucency_color : source_color = vec4(0.82, 0.95, 0.45, 1.0);
// 1 = use the mesh's "volume" normals on both faces (crowns shade like a volume),
// 0 = classic two-sided: flip the normal on back faces.
uniform float volume_normals : hint_range(0.0, 1.0) = 1.0;
// read per-instance variation from MultiMesh custom data (r = hue seed, g = brightness seed)
uniform bool use_instance_custom = false;
group_uniforms wind;
uniform float sway_height = 20.0;   // ~ asset height (m): reference for trunk bending
uniform float sway_amount = 0.30;   // trunk tip displacement (m) at wind strength 1
uniform float branch_amount = 0.22; // secondary branch displacement (m)
uniform float flutter_amount = 0.05; // leaf flutter (m)

varying vec2 v_seed;
varying float v_ao;
varying float v_branch;
varying vec3 v_vnormal;

void vertex() {
	vec3 opos = MODEL_MATRIX[3].xyz;
	float ih = veg_hash12(opos.xz * 0.713 + 11.0);
	v_seed = vec2(ih, veg_hash12(opos.zx * 1.37 + 3.0));
	// INSTANCE_CUSTOM is NOT used: on the GLES3 (Compatibility) fallback renderer used by many Android
	// devices it arrives undefined and pushed leaf colours far outside [0,1] (grey/white crowns).
	// The world-position hash gives the same per-tree variation on every renderer.
	VERTEX += veg_tree_wind(VERTEX, NORMAL, COLOR, MODEL_MATRIX, TIME * veg_wind_speed, ih,
			sway_height, sway_amount, branch_amount, flutter_amount);
	v_ao = COLOR.r;
	v_branch = COLOR.b;
	v_vnormal = normalize((MODELVIEW_MATRIX * vec4(NORMAL, 0.0)).xyz);
}

void fragment() {
	vec4 tex = texture(albedo_tex, UV);
	vec2 dx = dFdx(UV * tex_size);
	vec2 dy = dFdy(UV * tex_size);
	float mip = max(0.0, 0.5 * log2(max(dot(dx, dx), dot(dy, dy))));
	if (tex.a * (1.0 + mip * alpha_mip_scale) < alpha_cutoff) {
		discard;
	}
	vec3 col = tex.rgb * tint.rgb;
	col = veg_variation(col, v_seed.x, v_seed.y, hue_variation, brightness_variation);
	col *= 1.0 + (v_branch - 0.5) * 2.0 * branch_variation;
	col *= mix(1.0, v_ao, ao_strength);
	col *= mix(1.0, 0.58, veg_unshadowed);
	ALBEDO = col;
	vec3 vn = normalize(v_vnormal);
	vec3 facing = FRONT_FACING ? vn : -vn;
	// never normalise a zero vector (back face with volume_normals = 0.5 gave NaN -> white)
	NORMAL = normalize(mix(facing, vn, volume_normals) + vn * 0.001);
	NORMAL_MAP = texture(normal_tex, UV).rgb;
	NORMAL_MAP_DEPTH = normal_strength;
	ROUGHNESS = roughness;
	SPECULAR = specular;
	BACKLIGHT = translucency_color.rgb * col * translucency * (1.0 - 0.6 * veg_unshadowed);
}
