// DUSHANBE bark: tapered branch tubes. Same wind as foliage.gdshader so leaves stay on their twigs.
// Optional Soviet-style lime whitewash of the trunk base (per-instance chance).
shader_type spatial;
render_mode cull_back, diffuse_burley, specular_schlick_ggx;

#include "res://assets/shaders/vegetation_common.gdshaderinc"

group_uniforms textures;
uniform sampler2D albedo_tex : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D normal_tex : hint_normal, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D orm_tex : hint_default_white, filter_linear_mipmap, repeat_enable;
uniform vec2 uv_scale = vec2(1.0, 1.0);
uniform float normal_strength : hint_range(0.0, 2.0) = 1.0;
group_uniforms colour;
uniform vec4 tint : source_color = vec4(1.0);
uniform float hue_variation : hint_range(0.0, 0.5) = 0.04;
uniform float brightness_variation : hint_range(0.0, 0.5) = 0.08;
uniform float ao_strength : hint_range(0.0, 1.0) = 0.8;
uniform float roughness_scale : hint_range(0.0, 2.0) = 1.0;
group_uniforms whitewash;
// fraction of instances (by world-position hash) whose trunk base is lime-whitewashed (0 = never)
uniform float whitewash_chance : hint_range(0.0, 1.0) = 0.0;
uniform float whitewash_height = 1.2;
uniform vec4 whitewash_color : source_color = vec4(0.86, 0.87, 0.84, 1.0);
group_uniforms wind;
uniform float sway_height = 20.0;
uniform float sway_amount = 0.30;
uniform float branch_amount = 0.22;
uniform bool use_instance_custom = false;

varying vec2 v_seed;
varying float v_ao;
varying float v_y;
varying float v_ww;

void vertex() {
	vec3 opos = MODEL_MATRIX[3].xyz;
	float ih = veg_hash12(opos.xz * 0.713 + 11.0);
	v_seed = vec2(ih, veg_hash12(opos.zx * 1.37 + 3.0));
	// INSTANCE_CUSTOM is NOT used: on the GLES3 (Compatibility) fallback renderer used by many Android
	// devices it arrives undefined and pushed leaf colours far outside [0,1] (grey/white crowns).
	// The world-position hash gives the same per-tree variation on every renderer.
	v_y = VERTEX.y;
	v_ww = step(veg_hash12(opos.xz * 0.37 + 5.0), whitewash_chance);
	VERTEX += veg_tree_wind(VERTEX, NORMAL, COLOR, MODEL_MATRIX, TIME * veg_wind_speed, ih,
			sway_height, sway_amount, branch_amount, 0.0);
	v_ao = COLOR.r;
}

void fragment() {
	vec2 uv = UV * uv_scale;
	vec3 alb = texture(albedo_tex, uv).rgb;
	vec3 orm = texture(orm_tex, uv).rgb;
	vec3 col = alb * tint.rgb;
	col = veg_variation(col, v_seed.x, v_seed.y, hue_variation, brightness_variation);
	float ao = mix(1.0, v_ao, ao_strength) * orm.r;
	float rough = clamp(orm.g * roughness_scale, 0.0, 1.0);
	float nstr = normal_strength;
	if (v_ww > 0.5) {
		float lum = dot(alb, vec3(0.333));
		float edge = whitewash_height + (lum - 0.35) * 0.25 + sin(uv.x * 25.0) * 0.02;
		float m = 1.0 - smoothstep(edge - 0.015, edge + 0.015, v_y);
		col = mix(col, whitewash_color.rgb * (0.82 + 0.4 * lum), m);
		rough = mix(rough, 0.95, m);
		nstr = mix(nstr, nstr * 0.6, m);
	}
	ALBEDO = col * ao;
	ROUGHNESS = rough;
	NORMAL_MAP = texture(normal_tex, uv).rgb;
	NORMAL_MAP_DEPTH = nstr;
	AO = orm.r;
	AO_LIGHT_AFFECT = 0.3;
}
