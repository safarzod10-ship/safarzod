shader_type spatial;
// Soft noisy billboard puff: smoke (blend_mix, lit by tint) or fireball (hot > 0).
render_mode blend_mix, unshaded, cull_disabled, depth_draw_never, shadows_disabled;

uniform sampler2D noise_tex : repeat_enable, filter_linear_mipmap;
uniform float hot = 0.0;          // 0 smoke, 1 fireball core that cools into smoke
uniform float density = 1.0;
uniform vec3 smoke_color : source_color = vec3(0.09, 0.085, 0.08);
varying float v_life;
varying float v_seed;

void vertex() {
	v_life = INSTANCE_CUSTOM.y;
	v_seed = fract(float(INSTANCE_ID) * 0.6180339);
	float a = INSTANCE_CUSTOM.x + v_seed * 6.283;
	mat2 r = mat2(vec2(cos(a), sin(a)), vec2(-sin(a), cos(a)));
	vec2 q = r * VERTEX.xy;
	float s = length(MODEL_MATRIX[0].xyz);
	MODELVIEW_MATRIX = VIEW_MATRIX * mat4(INV_VIEW_MATRIX[0], INV_VIEW_MATRIX[1], INV_VIEW_MATRIX[2], MODEL_MATRIX[3]);
	VERTEX = vec3(q * s, 0.0);
}

void fragment() {
	vec2 c = UV - 0.5;
	float r = length(c) * 2.0;
	float n = texture(noise_tex, UV * 0.8 + vec2(v_seed * 5.0, v_seed * 3.0 - TIME * 0.05)).r;
	float n2 = texture(noise_tex, UV * 2.2 - vec2(v_seed, TIME * 0.11)).r;
	float d = 1.0 - smoothstep(0.25, 1.0, r + (n - 0.5) * 0.9 + (n2 - 0.5) * 0.35);
	float heat = hot * (1.0 - smoothstep(0.0, 0.45, v_life));
	vec3 fire = mix(vec3(0.9, 0.22, 0.02), vec3(1.0, 0.72, 0.3), smoothstep(0.35, 1.0, d * (0.5 + n))) * (1.1 + 1.5 * heat);
	vec3 smoke = smoke_color * (0.6 + n * 0.8) * COLOR.rgb;
	ALBEDO = mix(smoke, fire, clamp(heat * (0.4 + d), 0.0, 1.0));
	float fade = smoothstep(0.0, 0.06, v_life) * (1.0 - smoothstep(0.45, 1.0, v_life));
	ALPHA = clamp(d * density * fade * COLOR.a, 0.0, 1.0);
}
