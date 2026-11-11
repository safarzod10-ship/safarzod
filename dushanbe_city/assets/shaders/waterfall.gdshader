// Falling water: streaks that run down (UV.y grows downwards), white foam at the top lip and the
// bottom, a light shimmer; transparent, both sides.
shader_type spatial;
render_mode blend_mix, cull_disabled, depth_draw_opaque, diffuse_burley;
uniform float speed = 1.6;
uniform vec3 deep : source_color = vec3(0.30, 0.62, 0.82);
uniform vec3 foam : source_color = vec3(0.92, 0.97, 1.0);

float h(float x) { return fract(sin(x * 127.1) * 43758.5453); }

void fragment() {
	float x = UV.x * 22.0;
	float col = floor(x);
	float off = h(col) * 7.0;
	float sp = speed * (0.75 + 0.5 * h(col + 3.1));
	float s = fract(UV.y * 2.2 - TIME * sp + off);
	float streak = smoothstep(0.0, 0.25, s) * (1.0 - smoothstep(0.35, 0.9, s));
	float edge = abs(fract(x) - 0.5) * 2.0;
	streak *= 1.0 - edge * 0.6;
	float top = 1.0 - smoothstep(0.0, 0.12, UV.y);
	float bottom = smoothstep(0.8, 1.0, UV.y);
	float f = clamp(streak * 0.8 + top + bottom, 0.0, 1.0);
	ALBEDO = mix(deep, foam, f);
	ALPHA = clamp(0.55 + 0.4 * f, 0.0, 0.95);
	ROUGHNESS = 0.1;
	SPECULAR = 0.6;
	EMISSION = foam * f * 0.25;
}
