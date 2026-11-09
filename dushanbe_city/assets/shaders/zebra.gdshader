// Zebra crossing paint (UV.x across the road in m, UV.y 0..4 along): 0.5 m white bars, worn by
// traffic (macro noise), alpha-scissored so it costs no blending; lies 2 cm above the asphalt.
shader_type spatial;
render_mode cull_disabled, depth_draw_opaque, diffuse_burley;
global uniform float city_wetness;
uniform sampler2D macro_tex : hint_default_white, filter_linear_mipmap, repeat_enable;
varying vec3 wp;
void vertex() {
	wp = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}
void fragment() {
	float bar = step(0.5, fract(UV.x / 1.0 + 0.25));
	float wear = texture(macro_tex, wp.xz * 0.35).r * 0.6 + texture(macro_tex, wp.xz * 1.7).r * 0.4;
	float edge = step(0.25, UV.y) * step(UV.y, 3.75);
	ALPHA = bar * edge * step(0.32, wear);
	ALPHA_SCISSOR_THRESHOLD = 0.5;
	ALBEDO = vec3(0.86, 0.86, 0.82) * mix(1.0, 0.6, city_wetness);
	ROUGHNESS = mix(0.6, 0.15, city_wetness);
}
