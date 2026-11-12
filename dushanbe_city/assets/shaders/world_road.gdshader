// DUSHANBE-X roads: asphalt with lane markings computed from UVs (no textures per road).
// UV.x = lateral position (m, 0 = centre line), UV.y = distance along the road (m).
// UV2.x = half width of the carriageway (m), UV2.y = lanes in total (1, 2, 4, 6); 0 = dirt.
// Dirt roads: packed earth / gravel with two worn wheel tracks.
shader_type spatial;
render_mode blend_mix, depth_draw_opaque, cull_back, diffuse_burley, specular_schlick_ggx;

global uniform float city_wetness;
uniform sampler2D asphalt_alb : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D dirt_alb : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D gravel_alb : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D macro_tex : hint_default_white, filter_linear_mipmap, repeat_enable;

varying vec3 wp;

void vertex() {
	wp = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

float band(float x, float c, float w) {
	float aa = fwidth(x) * 0.8;
	return smoothstep(c - w - aa, c - w + aa, x) * (1.0 - smoothstep(c + w - aa, c + w + aa, x));
}

void fragment() {
	float x = UV.x;
	float s = UV.y;
	float hw = UV2.x;
	float lanes = UV2.y;
	float m = texture(macro_tex, wp.xz * 0.013).r;
	vec3 alb;
	float rough;
	if (lanes < 0.5) {
		vec3 d = texture(dirt_alb, wp.xz / 3.0).rgb;
		vec3 g = texture(gravel_alb, wp.xz / 2.0).rgb;
		float tracks = band(abs(x), 0.85, 0.35);
		alb = mix(d, g * 0.9, 0.35 + 0.3 * m) * mix(1.0, 0.82, tracks);
		float edge = smoothstep(hw - 1.2, hw, abs(x));
		alb = mix(alb, d * vec3(0.8, 0.9, 0.7), edge * 0.5);
		rough = 0.95;
	} else {
		alb = texture(asphalt_alb, wp.xz / 6.0).rgb * vec3(0.58, 0.6, 0.66) * (0.85 + 0.3 * m);
		rough = 0.85;
		float paint = 0.0;
		float ax = abs(x);
		// edge lines
		paint += band(ax, hw - 0.35, 0.08);
		if (lanes >= 3.5) {
			// divided: double solid centre line
			paint += band(ax, 0.18, 0.07);
			float lw = (hw - 0.5) / (lanes * 0.5);
			for (float k = 1.0; k < lanes * 0.5; k += 1.0) {
				paint += band(ax, 0.3 + lw * k, 0.07) * step(0.5, fract(s / 12.0));     // dashed lane lines
			}
		} else if (lanes >= 1.5) {
			paint += band(ax, 0.0, 0.07) * step(0.55, fract(s / 9.0));            // dashed centre
		}
		paint = clamp(paint, 0.0, 1.0) * (0.75 + 0.25 * m);
		alb = mix(alb, vec3(0.86, 0.86, 0.82), paint);
		rough = mix(rough, 0.6, paint);
	}
	float wet = city_wetness;
	alb *= mix(1.0, 0.55, wet);
	rough = mix(rough, 0.12, wet * 0.9);
	ALBEDO = alb;
	ROUGHNESS = rough;
	SPECULAR = 0.4;
}
