// Shallow irrigation-ditch (aryk) water: moving normals, dark silty colour, reflections.
shader_type spatial;
render_mode blend_mix, cull_back, specular_schlick_ggx;
uniform sampler2D noise_tex : hint_default_white, filter_linear_mipmap, repeat_enable;
uniform vec3 water_color : source_color = vec3(0.16, 0.17, 0.12);
uniform float flow_speed = 0.35;
varying vec3 wpos;
void vertex() { wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz; }
void fragment() {
	vec2 p = wpos.xz * 0.6;
	float t = TIME * flow_speed;
	float a = texture(noise_tex, p + vec2(t, t * 0.3)).r;
	float b = texture(noise_tex, p * 1.7 - vec2(t * 0.6, -t)).r;
	vec3 n = normalize(vec3((a - 0.5) * 0.6, 1.0, (b - 0.5) * 0.6));
	NORMAL = normalize((VIEW_MATRIX * vec4(n, 0.0)).xyz);
	ALBEDO = water_color;
	ROUGHNESS = 0.04;
	SPECULAR = 0.5;
}
