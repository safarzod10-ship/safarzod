// Mountain ring (height field, 2.4-8.8 km): PBR-ish rock / soil / dry grass by slope and height,
// snow above a noisy snow line (only on gentle slopes: steep rock stays dark), darker gullies
// (vertex R = cavity from the height-field curvature), and AERIAL PERSPECTIVE: haze grows with
// distance (1 - exp(-d / haze_distance)) so every range behind is paler and bluer.
// Textures: rock_cliff / soil (ambientCG, CC0) sampled bi-planar at two scales (no visible tiling).
shader_type spatial;
render_mode cull_back, diffuse_lambert, specular_disabled;
uniform sampler2D noise_tex : hint_default_white, filter_linear_mipmap, repeat_enable;
uniform sampler2D rock_tex : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D soil_tex : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform float snow_line = 960.0;
uniform vec3 haze : source_color = vec3(0.66, 0.74, 0.84);
uniform float haze_distance = 7000.0;
uniform float haze_max = 0.78;
global uniform float city_night;
varying vec3 wp;
varying vec3 wn;
varying float cav;
void vertex() {
	wp = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	wn = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
	cav = COLOR.r;
}
vec3 biplanar(sampler2D t, vec3 p, vec3 n, float s) {
	vec3 a = texture(t, p.zy * s).rgb;
	vec3 b = texture(t, p.xy * s).rgb;
	vec3 c = texture(t, p.xz * s).rgb;
	vec3 w = pow(abs(n), vec3(4.0));
	return (a * w.x + b * w.z + c * w.y) / (w.x + w.y + w.z);
}
void fragment() {
	float n = texture(noise_tex, wp.xz * 0.0009).r * 0.6 + texture(noise_tex, wp.xz * 0.005).r * 0.4;
	float slope = 1.0 - clamp(wn.y, 0.0, 1.0);                 // 0 flat .. 1 vertical
	vec3 rock = biplanar(rock_tex, wp, wn, 1.0 / 90.0) * 0.6 + biplanar(rock_tex, wp, wn, 1.0 / 700.0) * 0.4;
	rock *= mix(vec3(0.92, 0.86, 0.80), vec3(1.05, 1.0, 0.95), n);
	vec3 soil = texture(soil_tex, wp.xz / 120.0).rgb * 0.5 + texture(soil_tex, wp.xz / 900.0).rgb * 0.5;
	vec3 grass = mix(vec3(0.36, 0.38, 0.20), vec3(0.50, 0.45, 0.28), n);  // dry steppe grass
	vec3 low = mix(grass, soil * vec3(1.05, 0.95, 0.82), smoothstep(0.35, 0.75, n + wp.y / 1600.0));
	float rk = smoothstep(0.22, 0.42, slope + (n - 0.5) * 0.25) ;
	rk = max(rk, smoothstep(500.0, 950.0, wp.y + n * 160.0) * 0.8);
	vec3 c = mix(low, rock, rk);
	c *= mix(0.62, 1.12, cav);                                   // gullies darker, crests lighter
	float snow = smoothstep(snow_line - 60.0, snow_line + 60.0, wp.y + (n - 0.5) * 380.0 + (1.0 - slope) * 180.0);
	snow *= 1.0 - smoothstep(0.35, 0.55, slope);                 // cliffs stay bare
	ALBEDO = mix(c, vec3(0.78, 0.80, 0.84), snow);
	ROUGHNESS = 0.95;
	float d = length(wp.xz - CAMERA_POSITION_WORLD.xz);
	float h = (1.0 - exp(-d / haze_distance)) * haze_max;
	h *= 1.0 - smoothstep(400.0, 1800.0, wp.y) * 0.25;           // crests stand out of the haze a little
	FOG = vec4(haze * (1.0 - 0.93 * city_night), h);
}
