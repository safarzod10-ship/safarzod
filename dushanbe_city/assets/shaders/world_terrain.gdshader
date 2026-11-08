// DUSHANBE-X open world terrain (WorldTerrain sectors + the far mesh).
// Weights from the baked splat map (R rock, G snow, B earth / dirt tracks, A sand; grass = rest),
// plus slope (steep -> rock, planar projections on cliffs) and height (alpine meadow tint, snow).
// The far mesh discards the square of loaded near sectors (near_rect) so they never overlap.
shader_type spatial;
render_mode blend_mix, depth_draw_opaque, cull_back, diffuse_burley, specular_schlick_ggx;

global uniform float city_macro_detail;
global uniform float city_wetness;

uniform sampler2D splat_tex : filter_linear, repeat_disable;
uniform vec4 world_rect = vec4(-5120.0, -11040.0, 10240.0, 10240.0);   // x0, z0, size x, size z
uniform sampler2D grass_alb : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D grass_nrm : hint_normal, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D sand_alb : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D rock_alb : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D rock_nrm : hint_normal, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D earth_alb : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D macro_tex : hint_default_white, filter_linear_mipmap, repeat_enable;
uniform vec3 grass_tint : source_color = vec3(0.62, 0.76, 0.50);
uniform vec3 dry_tint : source_color = vec3(0.80, 0.76, 0.56);
uniform vec3 alpine_tint : source_color = vec3(0.60, 0.66, 0.48);
uniform bool is_far = false;
uniform vec4 near_rect = vec4(0.0);      // x0, z0, x1, z1 of the loaded near square (far mesh only)
uniform float far_drop = 0.0;

varying vec3 wp;
varying vec3 wn;

void vertex() {
	wp = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	wn = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
	if (is_far) {
		VERTEX.y -= far_drop;
	}
}

void fragment() {
	if (is_far && wp.x > near_rect.x && wp.x < near_rect.z && wp.z > near_rect.y && wp.z < near_rect.w) {
		discard;
	}
	vec2 suv = (wp.xz - world_rect.xy) / world_rect.zw;
	vec4 w = texture(splat_tex, suv);
	float steep = 1.0 - clamp(wn.y, 0.0, 1.0);
	float rk = max(w.r, smoothstep(0.32, 0.5, steep));
	float sn = w.g * (1.0 - smoothstep(0.55, 0.75, steep));
	float ea = w.b * (1.0 - rk);
	float sa = w.a * (1.0 - rk);
	float gr = clamp(1.0 - rk - sn - ea - sa, 0.0, 1.0);
	vec2 p = wp.xz;
	float dist = length(wp - CAMERA_POSITION_WORLD);
	// far away: one fetch per layer at a coarse scale (less shimmer, cheaper)
	float sc = dist > 600.0 ? 6.0 : (dist > 120.0 ? 2.5 : 1.0);
	vec2 rock_uv = abs(wn.y) > 0.7 ? p / 7.0 : (abs(wn.x) > abs(wn.z) ? wp.zy : wp.xy) / 7.0;
	vec3 g = gr > 0.003 ? texture(grass_alb, p / (3.0 * sc)).rgb : vec3(0.0);
	vec3 r = rk > 0.003 ? texture(rock_alb, rock_uv / sc).rgb : vec3(0.0);
	vec3 e = ea > 0.003 ? texture(earth_alb, p / (3.0 * sc)).rgb : vec3(0.0);
	vec3 s = sa > 0.003 ? texture(sand_alb, p / (4.0 * sc)).rgb : vec3(0.0);
	float m = texture(macro_tex, p * 0.0021).r * 0.6 + texture(macro_tex, p * 0.011).r * 0.4;
	vec3 gt = mix(grass_tint, dry_tint, smoothstep(0.5, 0.85, m) * 0.85);
	gt = mix(gt, alpine_tint, smoothstep(350.0, 750.0, wp.y));
	g *= gt;
	// snow: bright, slightly blue in the shade of the normal, sparkle-free
	vec3 snow = vec3(0.92, 0.94, 0.97) * (0.9 + 0.1 * m);
	// rock: large-scale colour variation (warm brown / grey strata), darker scree in the gullies
	float strata = 0.5 + 0.5 * sin(wp.y * 0.09 + texture(macro_tex, p * 0.0007).r * 9.0);
	r *= mix(vec3(0.72, 0.64, 0.56), vec3(1.05, 1.0, 0.94), clamp(m * 0.8 + strata * 0.35, 0.0, 1.0));
	vec3 alb = g * gr + r * rk + e * ea + s * sa + snow * sn;
	// patches of greener / drier ground at two scales (no uniform lawn look)
	float patch = texture(macro_tex, p * 0.0045 + 0.37).r;
	alb *= 0.74 + 0.5 * m * (0.6 + 0.4 * patch);
	alb = mix(alb, alb * vec3(0.86, 1.0, 0.82), smoothstep(0.55, 0.8, patch) * gr * 0.6);
	float rough = 0.93 - 0.35 * sn;
	float wet = city_wetness * (1.0 - sn) * (0.4 + 0.6 * (rk + ea));
	alb *= mix(1.0, 0.65, wet);
	rough = mix(rough, 0.25, wet);
	vec3 n = vec3(0.5, 0.5, 1.0);
	if (city_macro_detail > 0.5 && dist < 300.0) {
		n = texture(grass_nrm, p / 3.0).rgb * (gr + ea + sa + sn * 0.3);
		if (rk > 0.003) { n += texture(rock_nrm, rock_uv).rgb * rk; }
		n /= max(gr + ea + sa + sn * 0.3 + rk, 1e-3);
	}
	ALBEDO = alb;
	ROUGHNESS = rough;
	SPECULAR = 0.3 + 0.2 * sn;
	NORMAL_MAP = n;
	NORMAL_MAP_DEPTH = 0.8;
}
