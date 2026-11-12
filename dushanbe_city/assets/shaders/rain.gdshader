// Rain streaks on open cylinders around the camera (two radii for parallax): procedural thin
// streaks falling at ~9 m/s, slanted by the wind, density from the Weather node. Unshaded, a few
// hundred pixels of alpha per screen - cheap on mobile GPUs (no particles).
shader_type spatial;
render_mode unshaded, blend_mix, depth_draw_never, cull_disabled, shadows_disabled, fog_disabled;
uniform float intensity = 0.0;
uniform float columns = 220.0;
uniform float speed = 1.1;
uniform float light = 1.0;
float hash(float x) { return fract(sin(x * 127.1) * 43758.5453); }
void fragment() {
	float col = floor(UV.x * columns);
	float r = hash(col);
	float r2 = hash(col + 17.0);
	float y = UV.y * (3.0 + r * 2.0) + TIME * speed * (0.8 + r2 * 0.5) + r * 10.0;
	float f = fract(y);
	float streak = smoothstep(0.0, 0.05, f) * (1.0 - smoothstep(0.08, 0.22, f));
	float x = fract(UV.x * columns);
	float w = 1.0 - smoothstep(0.0, 0.12, abs(x - 0.5));
	float on = step(1.0 - intensity * 0.85, r2);              // more columns rain when heavier
	ALBEDO = vec3(0.72, 0.76, 0.80) * light;
	ALPHA = streak * w * on * 0.38 * smoothstep(0.0, 0.15, UV.y) * (1.0 - smoothstep(0.85, 1.0, UV.y));
}
