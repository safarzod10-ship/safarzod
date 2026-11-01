// DUSHANBE terrain: 4 PBR layers blended by a 1 m splat map (from real OSM land use),
// height-aware blending, anti-tiling (two rotated samples + macro variation), wetness.
// Outside the detailed area (outskirts) a procedural dry-grass / loess mix is used.
// Works in the Mobile and Compatibility renderers (max 11 samplers).
shader_type spatial;
render_mode cull_back;

uniform sampler2D splat : hint_default_black, filter_linear, repeat_disable;
uniform sampler2D l0_albedo : source_color, filter_linear_mipmap_anisotropic, repeat_enable;  // green grass (A = roughness)
uniform sampler2D l0_normal : hint_normal, filter_linear_mipmap, repeat_enable;
uniform sampler2D l1_albedo : source_color, filter_linear_mipmap_anisotropic, repeat_enable;  // dry grass
uniform sampler2D l1_normal : hint_normal, filter_linear_mipmap, repeat_enable;
uniform sampler2D l2_albedo : source_color, filter_linear_mipmap_anisotropic, repeat_enable;  // loess soil
uniform sampler2D l2_normal : hint_normal, filter_linear_mipmap, repeat_enable;
uniform sampler2D l3_albedo : source_color, filter_linear_mipmap_anisotropic, repeat_enable;  // gravel / compacted
uniform sampler2D l3_normal : hint_normal, filter_linear_mipmap, repeat_enable;
uniform sampler2D macro_noise : filter_linear_mipmap, repeat_enable;
uniform vec4 tile_m = vec4(3.2, 3.6, 4.5, 3.0);
uniform vec2 splat_origin = vec2(-400.0, -400.0);
uniform float splat_size = 800.0;
uniform bool anti_tiling = true;
uniform bool use_normal_maps = true;
uniform float normal_strength = 1.0;
uniform float macro_strength = 0.28;
uniform vec3 lawn_tint : source_color = vec3(1.0);
uniform vec3 dry_tint : source_color = vec3(1.0);
global uniform float env_wetness;

varying vec3 wpos;

void vertex() {
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

// second sample: rotated ~37 deg and scaled, hides the period of the first
vec2 uv_alt(vec2 uv) { return mat2(vec2(0.799, 0.602), vec2(-0.602, 0.799)) * uv * 0.71 + vec2(0.37, 0.11); }
vec4 tex2(sampler2D s, vec2 uv, float blend) {          // albedo textures (source_color)
	vec4 a = texture(s, uv);
	return anti_tiling ? mix(a, texture(s, uv_alt(uv)), blend) : a;
}
vec3 tex2n(sampler2D s, vec2 uv, float blend) {         // normal maps (hint_normal)
	vec3 a = texture(s, uv).rgb;
	return anti_tiling ? mix(a, texture(s, uv_alt(uv)).rgb, blend) : a;
}

void fragment() {
	vec2 suv = (wpos.xz - splat_origin) / splat_size;
	vec4 w = texture(splat, suv);
	float m = texture(macro_noise, wpos.xz / 190.0).r;
	float m2 = texture(macro_noise, wpos.xz / 41.0 + vec2(0.31, 0.77)).r;
	// outskirts: procedural mix, faded in over 40 m beyond the detailed area
	float edge = max(abs(suv.x - 0.5), abs(suv.y - 0.5)) * 2.0;
	float outside = smoothstep(0.97, 1.07, edge);
	// Hisor valley outskirts: patchwork of green fields, dry grass and loess
	float fields = smoothstep(0.45, 0.62, texture(macro_noise, wpos.xz / 520.0 + vec2(0.13, 0.57)).r);
	vec4 w_out = vec4(0.15 + 0.6 * fields * m2, 0.45 + 0.2 * m, 0.30 - 0.2 * m, 0.0);
	w = mix(w, w_out, outside);
	float blend = smoothstep(0.3, 0.7, m2);

	vec3 alb = vec3(0.0); float rough = 0.0; vec3 nrm = vec3(0.0); float wsum = 0.0;
	// height-aware weights: brighter (raised) texels win at transitions
	vec4 ww = w;
	if (w.r > 0.01) { vec4 a = tex2(l0_albedo, wpos.xz / tile_m.x, blend); float hw = w.r * (0.6 + a.g * 0.8);
		alb += a.rgb * lawn_tint * hw; rough += a.a * hw; wsum += hw;
		if (use_normal_maps) nrm += tex2n(l0_normal, wpos.xz / tile_m.x, blend) * hw; }
	if (w.g > 0.01) { vec4 a = tex2(l1_albedo, wpos.xz / tile_m.y, blend); float hw = w.g * (0.6 + a.r * 0.8);
		alb += a.rgb * dry_tint * hw; rough += a.a * hw; wsum += hw;
		if (use_normal_maps) nrm += tex2n(l1_normal, wpos.xz / tile_m.y, blend) * hw; }
	if (w.b > 0.01) { vec4 a = tex2(l2_albedo, wpos.xz / tile_m.z, blend); float hw = w.b * (0.5 + a.r * 0.6);
		alb += a.rgb * hw; rough += a.a * hw; wsum += hw;
		if (use_normal_maps) nrm += tex2n(l2_normal, wpos.xz / tile_m.z, blend) * hw; }
	if (w.a > 0.01) { vec4 a = tex2(l3_albedo, wpos.xz / tile_m.w, blend); float hw = w.a * (0.5 + a.r * 0.6);
		alb += a.rgb * hw; rough += a.a * hw; wsum += hw;
		if (use_normal_maps) nrm += tex2n(l3_normal, wpos.xz / tile_m.w, blend) * hw; }
	wsum = max(wsum, 1e-4);
	alb /= wsum; rough /= wsum;
	// macro colour variation (breaks large-scale repetition)
	alb *= 1.0 + (m - 0.5) * macro_strength + (m2 - 0.5) * macro_strength * 0.5;
	// wetness: darker, glossier (ready for rain)
	float wet = clamp(env_wetness, 0.0, 1.0);
	alb *= mix(1.0, 0.62, wet);
	rough = mix(rough, 0.28, wet * 0.8);
	ALBEDO = alb;
	ROUGHNESS = clamp(rough, 0.05, 1.0);
	SPECULAR = 0.35;
	if (use_normal_maps) {
		NORMAL_MAP = nrm / wsum;
		NORMAL_MAP_DEPTH = normal_strength * (1.0 - outside * 0.6);
	}
}
