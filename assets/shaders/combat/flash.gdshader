shader_type spatial;
// Muzzle flash / spark / shockwave: additive radial shapes on a quad.
render_mode blend_add, unshaded, cull_disabled, depth_draw_never, shadows_disabled;

uniform int mode = 0;             // 0 star flash, 1 soft glow, 2 ring
uniform vec3 tint : source_color = vec3(1.0, 0.75, 0.35);
uniform float power = 4.0;
uniform float alpha = 1.0;
uniform float seed = 0.0;

void fragment() {
	vec2 c = (UV - 0.5) * 2.0;
	float r = length(c);
	float a = atan(c.y, c.x);
	float v = 0.0;
	if (mode == 0) {
		float spikes = pow(abs(sin(a * 2.5 + seed * 6.0)), 6.0) * 0.8 + pow(abs(sin(a * 4.0 + seed * 11.0)), 10.0) * 0.5;
		v = (1.0 - smoothstep(0.0, 0.35 + spikes * 0.65, r)) + (1.0 - smoothstep(0.0, 0.25, r)) * 2.0;
	} else if (mode == 1) {
		v = pow(max(1.0 - r, 0.0), 2.0);
	} else {
		v = smoothstep(0.62, 0.82, r) * (1.0 - smoothstep(0.86, 1.0, r));
	}
	ALBEDO = tint * power * v * alpha;
	ALPHA = clamp(v * alpha, 0.0, 1.0);
}
