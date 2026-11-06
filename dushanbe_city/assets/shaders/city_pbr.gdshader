// DUSHANBE city surfaces: PBR (albedo / normal / ORM) with vertex-colour tint + baked AO,
// world-space macro variation to break tiling, optional wetness. Mobile-renderer friendly.
shader_type spatial;
render_mode blend_mix, depth_draw_opaque, cull_back, diffuse_burley, specular_schlick_ggx;

global uniform float city_wetness;
global uniform float city_macro_detail;   // 0 on Low: skip the two macro-noise fetches

uniform sampler2D albedo_tex : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D normal_tex : hint_normal, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D orm_tex : hint_default_white, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D macro_tex : hint_default_white, filter_linear_mipmap, repeat_enable;
uniform vec2 uv_scale = vec2(0.5);
uniform vec3 tint : source_color = vec3(1.0);
uniform float roughness_mul = 1.0;
uniform float roughness_add = 0.0;
uniform float metallic_value = -1.0;   // <0: use ORM.b
uniform float normal_strength = 1.0;
uniform float ao_strength = 1.0;
uniform float macro_strength = 0.18;
uniform float macro_scale = 0.021;
uniform bool use_vertex_color = true;
uniform float wet_receptive = 0.0;     // 1 for horizontal ground surfaces

varying vec3 wpos;
varying vec3 wnrm;

void vertex() {
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	wnrm = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
}

void fragment() {
	vec2 uv = UV * uv_scale;
	vec3 alb = texture(albedo_tex, uv).rgb * tint;
	vec3 orm = texture(orm_tex, uv).rgb;
	// macro variation: two octaves of a tileable noise in world space
	vec2 mp = abs(wnrm.y) > 0.5 ? wpos.xz : vec2(wpos.x + wpos.z, wpos.y);
	float m = 0.5;
	if (city_macro_detail > 0.5) {
		m = texture(macro_tex, mp * macro_scale).r * 0.65 + texture(macro_tex, mp * macro_scale * 4.3).r * 0.35;
		alb *= mix(1.0, 0.75 + 0.5 * m, macro_strength * 2.0);
	}
	if (use_vertex_color) {
		alb *= COLOR.rgb;
	}
	float rough = clamp(orm.g * roughness_mul + roughness_add, 0.03, 1.0);
	float wet = city_wetness * wet_receptive * smoothstep(0.35, 0.75, m + 0.2);
	alb *= mix(1.0, 0.55, wet);
	rough = mix(rough, 0.08, wet);
	ALBEDO = alb;
	ROUGHNESS = rough;
	METALLIC = metallic_value < 0.0 ? orm.b : metallic_value;
	AO = mix(1.0, orm.r, ao_strength);
	AO_LIGHT_AFFECT = 0.4;
	NORMAL_MAP = texture(normal_tex, uv).rgb;
	NORMAL_MAP_DEPTH = normal_strength * (1.0 - wet * 0.7);
}
