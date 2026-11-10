// 0.25 snowfall on the open cylinders around the camera (same rig as rain): soft round flakes drifting
// down at ~1.2 m/s with a sideways sway, density from the Weather node. Unshaded, cheap on mobile.
shader_type spatial;
render_mode unshaded, blend_mix, depth_draw_never, cull_disabled, shadows_disabled, fog_disabled;
uniform float intensity = 0.0;
uniform float columns = 90.0;
uniform float light = 1.0;
float hash(float x) { return fract(sin(x * 127.1) * 43758.5453); }
void fragment() {
	float col = floor(UV.x * columns);
	float r = hash(col);
	float r2 = hash(col + 31.0);
	float y = UV.y * (6.0 + r * 4.0) + TIME * (0.12 + r2 * 0.08) + r * 10.0;
	float cell = floor(y);
	float fy = fract(y);
	float sway = sin(TIME * (0.8 + r) + cell * 3.1) * 0.25;
	float fx = fract(UV.x * columns) - 0.5 - sway * 0.6;
	float d = length(vec2(fx * 1.0, (fy - 0.5) * 0.35));
	float flake = 1.0 - smoothstep(0.08, 0.2, d);
	float on = step(1.0 - intensity * 0.9, hash(col * 3.0 + cell));
	ALBEDO = vec3(0.96, 0.97, 1.0) * light;
	ALPHA = flake * on * 0.85 * smoothstep(0.0, 0.12, UV.y) * (1.0 - smoothstep(0.88, 1.0, UV.y));
}
