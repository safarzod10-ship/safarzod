// DUSHANBE coast terrain: grass base + sand / rock / earth / asphalt blended by vertex colour
// (R sand, G rock, B earth, A asphalt; grass = 1 - sum). World-space UVs, wet sand near the sea,
// macro variation against tiling. Layers are only sampled where their weight is non-zero.
// Low preset (city_macro_detail = 0): albedo blending + one shared normal map; Medium+: per-layer
// normals and macro noise.
shader_type spatial;
render_mode blend_mix, depth_draw_opaque, cull_back, diffuse_burley, specular_schlick_ggx;

global uniform float city_macro_detail;
global uniform float city_wetness;
#include "res://assets/shaders/grass_palette.gdshaderinc"

uniform sampler2D grass_alb : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D grass_nrm : hint_normal, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D sand_alb : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D sand_nrm : hint_normal, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D rock_alb : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D rock_nrm : hint_normal, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D earth_alb : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D asphalt_alb : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D macro_tex : hint_default_white, filter_linear_mipmap, repeat_enable;
uniform float sea_level = -1.6;
uniform vec3 grass_tint : source_color = vec3(0.80, 0.98, 0.70);
uniform vec3 dry_tint : source_color = vec3(0.98, 0.95, 0.74);

varying vec3 wp;
varying vec3 wn;

void vertex() {
	wp = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	wn = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
}

void fragment() {
	vec4 w = clamp(COLOR, 0.0, 1.0);
	float wg = clamp(1.0 - w.r - w.g - w.b - w.a, 0.0, 1.0);
	// sharpen the weights (power 3, renormalised): blending happens in LINEAR colour, where a small
	// share of bright grass would otherwise wash out dark asphalt or wet sand; transitions stay smooth
	vec4 w3 = w * w * w;
	float g3 = wg * wg * wg;
	float tot = max(g3 + w3.r + w3.g + w3.b + w3.a, 1e-5);
	w = w3 / tot;
	wg = g3 / tot;
	vec2 p = wp.xz;
	// rock: blend planar projections by the normal on steep faces (no stretching on cliffs)
	vec2 rock_uv = abs(wn.y) > 0.75 ? p / 6.0 : (abs(wn.x) > abs(wn.z) ? wp.zy : wp.xy) / 6.0;
	// layers are fetched only where they have weight (weights are spatially coherent -> cheap branches;
	// most of the terrain is grass-only and costs one albedo fetch)
	vec3 g = wg > 0.003 ? grass_palette(p, macro_tex, city_macro_detail) * grass_detail(grass_alb, p / 3.0) : vec3(0.0);
	vec3 s = w.r > 0.003 ? texture(sand_alb, p / 4.0).rgb : vec3(0.0);
	vec3 r = w.g > 0.003 ? texture(rock_alb, rock_uv).rgb : vec3(0.0);
	vec3 e = w.b > 0.003 ? texture(earth_alb, p / 3.0).rgb : vec3(0.0);
	vec3 a = w.a > 0.003 ? texture(asphalt_alb, p / 6.0).rgb * vec3(0.58, 0.6, 0.66) : vec3(0.0);   // matched to the city road
	float m = 0.5;
	if (city_macro_detail > 0.5) {
		m = texture(macro_tex, p * 0.004).r * 0.6 + texture(macro_tex, p * 0.019).r * 0.4;
	}
	// grass: lush/dry variation, darker in hollows
	// (grass colour: natural palette, see grass_palette.gdshaderinc)
	// wet sand band at the waterline
	float wet = 1.0 - smoothstep(sea_level + 0.05, sea_level + 0.9, wp.y);
	s *= mix(1.0, 0.62, wet);
	vec3 alb = g * wg + s * w.r + r * w.g + e * w.b + a * w.a;
	alb *= mix(1.0, 0.82 + 0.36 * m, 0.5 * city_macro_detail * (1.0 - wg));
	// seabed seen through the clear shallows: wet, darker, blue-green with depth
	float uw = smoothstep(sea_level + 0.05, sea_level - 2.5, wp.y);
	alb *= mix(vec3(1.0), vec3(0.55, 0.72, 0.70), uw);
	float rough = 0.92 - 0.55 * wet * w.r - 0.1 * w.a;
	float wet_rain = city_wetness * (w.a + w.g * 0.6 + w.b * 0.4);
	alb *= mix(1.0, 0.6, wet_rain);
	rough = mix(rough, 0.15, wet_rain);
	vec3 n;
	if (city_macro_detail > 0.5) {
		n = texture(grass_nrm, p / 3.0).rgb * (wg + w.b + w.a);
		if (w.r > 0.003) { n += texture(sand_nrm, p / 4.0).rgb * w.r; }
		if (w.g > 0.003) { n += texture(rock_nrm, rock_uv).rgb * w.g; }
	} else {
		n = texture(grass_nrm, p / 3.0).rgb;
	}
	ALBEDO = alb;
	ROUGHNESS = rough;
	SPECULAR = 0.35;
	NORMAL_MAP = n;
	NORMAL_MAP_DEPTH = 0.8;
}
