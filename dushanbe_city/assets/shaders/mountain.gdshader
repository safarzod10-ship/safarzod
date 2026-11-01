// Distant mountain ridge: rock / dry grass by slope & height, snow on the crests (Hissar range).
shader_type spatial;
render_mode cull_disabled, diffuse_lambert, specular_disabled;
uniform sampler2D noise_tex : hint_default_white, filter_linear_mipmap, repeat_enable;
uniform float snow_line = 590.0;
uniform vec3 haze : source_color = vec3(0.62, 0.70, 0.80);
uniform float haze_amount = 0.42;
varying vec3 wp;
void vertex() { wp = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz; }
void fragment() {
	float n = texture(noise_tex, wp.xz * 0.0011).r * 0.6 + texture(noise_tex, wp.xz * 0.006).r * 0.4;
	vec3 rock = mix(vec3(0.25, 0.23, 0.22), vec3(0.38, 0.34, 0.29), n);
	vec3 low = mix(vec3(0.40, 0.37, 0.26), vec3(0.30, 0.32, 0.20), n);
	vec3 c = mix(low, rock, smoothstep(40.0, 180.0, wp.y + n * 60.0));
	float snow = smoothstep(snow_line - 40.0, snow_line + 20.0, wp.y + (n - 0.5) * 140.0);
	ALBEDO = mix(c, vec3(0.93, 0.94, 0.96), snow);
	ROUGHNESS = 0.95;
	FOG = vec4(haze, haze_amount * (1.0 - smoothstep(200.0, 700.0, wp.y) * 0.35));
}
