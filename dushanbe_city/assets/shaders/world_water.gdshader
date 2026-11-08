// Mountain rivers and lakes of the open world (and the waterfall sheet when fall = true):
// scrolling ripples (flow along -Z for rivers is approximated with two noise layers), clear
// turquoise mountain water, foam where the river is fast; the waterfall scrolls down quickly.
shader_type spatial;
render_mode blend_mix, depth_draw_opaque, cull_disabled, specular_schlick_ggx;
global uniform float city_wetness;
uniform sampler2D noise_tex : hint_default_white, filter_linear_mipmap, repeat_enable;
uniform vec3 deep_color : source_color = vec3(0.07, 0.24, 0.27);
uniform vec3 shallow_color : source_color = vec3(0.22, 0.45, 0.42);
uniform bool fall = false;
varying vec3 wpos;

void vertex() {
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

void fragment() {
	if (fall) {
		float a = texture(noise_tex, vec2(UV.x * 2.0, UV.y * 0.6 - TIME * 1.8)).r;
		float b = texture(noise_tex, vec2(UV.x * 5.0 + 0.3, UV.y * 1.4 - TIME * 2.6)).r;
		float foam = smoothstep(0.35, 0.8, a * 0.6 + b * 0.5);
		ALBEDO = mix(vec3(0.55, 0.7, 0.72), vec3(0.95), foam);
		ALPHA = 0.75 + 0.25 * foam;
		ROUGHNESS = 0.3;
	} else {
	vec2 p = wpos.xz * 0.25;
	float t = TIME * 0.4;
	float a = texture(noise_tex, p + vec2(t * 0.3, t)).r;
	float b = texture(noise_tex, p * 1.9 - vec2(t * 0.5, -t * 0.7)).r;
	vec3 n = normalize(vec3((a - 0.5) * 0.25, 1.0, (b - 0.5) * 0.25));
	NORMAL = normalize((VIEW_MATRIX * vec4(n, 0.0)).xyz);
	float foam = smoothstep(0.72, 0.9, a * 0.5 + b * 0.5) * 0.35;
	float fres = pow(1.0 - clamp(dot(NORMAL, VIEW), 0.0, 1.0), 3.0);
	vec3 col = mix(shallow_color, deep_color, 0.5 + 0.3 * (a - 0.5));
	col = mix(col, vec3(0.62, 0.72, 0.8), fres * 0.5);
	ALBEDO = mix(col, vec3(0.92), foam);
	ROUGHNESS = 0.06;
	SPECULAR = 0.6;
}
}
