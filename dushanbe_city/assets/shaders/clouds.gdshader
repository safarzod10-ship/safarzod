// Cloud layer: a flattened dome that follows the camera, clouds projected on a virtual plane
// (direction.xz / direction.y), two noise octaves drifting with the wind; coverage / darkness from
// the Weather node, lit by the sun colour (warm at sunrise/sunset, grey under overcast, dark at night).
// One transparent draw, no sky-radiance re-filtering (cheap on mobile).
shader_type spatial;
render_mode unshaded, blend_mix, depth_draw_never, cull_front, fog_disabled, shadows_disabled;
uniform sampler2D noise_tex : hint_default_white, filter_linear_mipmap, repeat_enable;
uniform float coverage = 0.3;           // 0 clear .. 1 overcast
uniform float darkness = 0.0;           // rain clouds
uniform vec3 sun_color : source_color = vec3(1.0);
uniform vec3 sun_dir = vec3(0.0, 1.0, 0.0);
uniform float day = 1.0;
uniform vec2 wind = vec2(0.004, 0.0015);
varying vec3 dir;
void vertex() {
	dir = normalize(VERTEX);
}
void fragment() {
	float h = max(dir.y, 0.02);
	vec2 p = dir.xz / h * 0.35;
	float t = TIME;
	float n = texture(noise_tex, p * 0.18 + wind * t).r * 0.62
		+ texture(noise_tex, p * 0.55 - wind * t * 1.7).r * 0.28
		+ texture(noise_tex, p * 1.6 + wind.yx * t * 2.5).r * 0.10;
	float th = mix(0.78, 0.18, coverage);
	float d = smoothstep(th, th + 0.22, n);
	// thicker clouds are darker underneath; overcast/rain greys them out
	float thick = smoothstep(th, th + 0.5, n);
	float sunlit = clamp(dot(normalize(sun_dir), vec3(0.0, 1.0, 0.0)) * 0.6 + 0.5, 0.0, 1.0);
	vec3 base = mix(vec3(1.0), vec3(0.62, 0.64, 0.68), thick * 0.7 + coverage * 0.25);
	base = mix(base, vec3(0.30, 0.32, 0.35), darkness);
	vec3 col = base * mix(vec3(1.0), sun_color, 0.5) * mix(0.07, 1.0, day) * mix(0.8, 1.05, sunlit);
	// sun glow through thin cloud edges
	float s = pow(max(dot(dir, normalize(sun_dir)), 0.0), 24.0);
	col += sun_color * s * (1.0 - thick) * 0.6 * day;
	float horizon = smoothstep(0.02, 0.18, dir.y);
	ALBEDO = col;
	ALPHA = d * horizon * mix(0.85, 1.0, coverage);
}
