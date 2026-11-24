shader_type spatial;
// Flame tongue on an upright particle quad: two scrolling noise octaves shaped
// into a tapering flame, black-body colour ramp, additive.
render_mode blend_add, unshaded, cull_disabled, depth_draw_never, shadows_disabled;

uniform sampler2D noise_tex : repeat_enable, filter_linear_mipmap;
uniform float intensity = 1.0;
uniform float speed = 1.0;
varying float v_life;
varying float v_seed;

void vertex() {
	v_life = INSTANCE_CUSTOM.y;
	v_seed = fract(float(INSTANCE_ID) * 0.6180339);
	// Y-locked billboard: flames stay upright, turn to face the camera.
	vec3 up = vec3(0.0, 1.0, 0.0);
	vec3 to_cam = INV_VIEW_MATRIX[3].xyz - MODEL_MATRIX[3].xyz;
	to_cam.y = 0.0;
	vec3 fwd = normalize(to_cam + vec3(0.0001, 0.0, 0.0));
	vec3 right = normalize(cross(up, fwd));
	float sx = length(MODEL_MATRIX[0].xyz);
	float sy = length(MODEL_MATRIX[1].xyz);
	// sway the top of the flame
	float sway = sin(TIME * 3.1 * speed + v_seed * 40.0) * 0.12 * UV.y * 0.0 + sin(TIME * 2.3 + v_seed * 17.0) * 0.1 * (1.0 - UV.y);
	vec3 p = right * (VERTEX.x + sway) * sx + up * VERTEX.y * sy;
	MODELVIEW_MATRIX = VIEW_MATRIX * mat4(vec4(1.0, 0.0, 0.0, 0.0), vec4(0.0, 1.0, 0.0, 0.0), vec4(0.0, 0.0, 1.0, 0.0), MODEL_MATRIX[3]);
	VERTEX = p;
}

void fragment() {
	float y = 1.0 - UV.y;                 // 0 at the base, 1 at the tip
	float x = abs(UV.x - 0.5) * 2.0;
	float t = TIME * speed;
	float n1 = texture(noise_tex, vec2(UV.x * 0.9 + v_seed, y * 0.7 - t * 0.9 + v_seed * 3.0)).r;
	float n2 = texture(noise_tex, vec2(UV.x * 2.1 - v_seed * 2.0, y * 1.6 - t * 1.7)).r;
	float n = n1 * 0.62 + n2 * 0.38;
	float width = mix(0.95, 0.12, pow(y, 0.8));
	float body = 1.0 - smoothstep(width * 0.35, width, x + (n - 0.5) * 0.55 * (0.3 + y));
	float tip = 1.0 - smoothstep(0.35, 1.0, y + (0.5 - n) * 0.7);
	float base = smoothstep(0.0, 0.08, y);
	float f = body * tip * base * (0.55 + n * 0.9);
	float fade = smoothstep(0.0, 0.15, v_life) * (1.0 - smoothstep(0.6, 1.0, v_life));
	f *= fade;
	vec3 col = mix(vec3(0.9, 0.12, 0.02), vec3(1.0, 0.45, 0.05), smoothstep(0.15, 0.5, f));
	col = mix(col, vec3(1.0, 0.72, 0.22), smoothstep(0.55, 1.0, f));
	col = mix(col, vec3(1.0, 0.9, 0.6), smoothstep(1.0, 1.4, f) * (1.0 - y));
	ALBEDO = col * intensity * COLOR.rgb * smoothstep(0.03, 0.3, f);
	ALPHA = clamp(f * 1.6, 0.0, 1.0) * COLOR.a;
}
