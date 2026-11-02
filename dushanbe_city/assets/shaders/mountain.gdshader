// Distant mountains in layers (foothills ~2.5 km, middle range ~3.7 km, snowy Hissar range ~5.5 km,
// low hills across the sea): rock / dry grass by slope & height, snow on the high crests, and
// AERIAL PERSPECTIVE: haze grows with distance (1 - exp(-d / haze_distance)), so every layer behind
// is paler and bluer than the one in front.
shader_type spatial;
render_mode cull_disabled, diffuse_lambert, specular_disabled;
uniform sampler2D noise_tex : hint_default_white, filter_linear_mipmap, repeat_enable;
uniform float snow_line = 640.0;
uniform vec3 haze : source_color = vec3(0.66, 0.74, 0.84);
uniform float haze_distance = 7200.0;
uniform float haze_max = 0.8;
global uniform float city_night;
varying vec3 wp;
void vertex() { wp = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz; }
void fragment() {
	float n = texture(noise_tex, wp.xz * 0.0011).r * 0.6 + texture(noise_tex, wp.xz * 0.006).r * 0.4;
	vec3 rock = mix(vec3(0.25, 0.23, 0.22), vec3(0.38, 0.34, 0.29), n);
	vec3 low = mix(vec3(0.33, 0.35, 0.22), vec3(0.42, 0.38, 0.26), n);
	vec3 c = mix(low, rock, smoothstep(60.0, 260.0, wp.y + n * 80.0));
	float snow = smoothstep(snow_line - 40.0, snow_line + 30.0, wp.y + (n - 0.5) * 160.0);
	ALBEDO = mix(c, vec3(0.93, 0.94, 0.96), snow);
	ROUGHNESS = 0.95;
	float d = length(wp.xz - CAMERA_POSITION_WORLD.xz);
	float h = (1.0 - exp(-d / haze_distance)) * haze_max;
	h *= 1.0 - smoothstep(300.0, 1400.0, wp.y) * 0.3;          // crests stand out of the haze a little
	FOG = vec4(haze * (1.0 - 0.93 * city_night), h);
}
