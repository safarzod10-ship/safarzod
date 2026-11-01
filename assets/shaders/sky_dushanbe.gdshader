// DUSHANBE sky: analytic day/night gradient + sun/moon + texture-based cloud
// layer + stars. Cheap enough for the Mobile and Compatibility renderers
// (3 texture fetches, no loops). All colours are scene-linear; values are driven
// by DayNightCycle and WeatherManager (scripts/environment/).
shader_type sky;
render_mode use_debanding;

uniform vec3 zenith_color : source_color = vec3(0.10, 0.25, 0.55);
uniform vec3 horizon_color : source_color = vec3(0.55, 0.65, 0.78);
uniform vec3 ground_color : source_color = vec3(0.22, 0.20, 0.18);
uniform float sky_energy = 1.0;
uniform float horizon_falloff = 0.45;   // gradient exponent
uniform float sun_glow = 0.35;          // forward-scattering brightening around the sun
uniform float sun_disk_size = 0.9997;   // cos of angular radius (slightly enlarged)
uniform float sun_disk_energy = 18.0;

uniform vec3 moon_dir = vec3(0.3, 0.6, 0.74);
uniform vec3 moon_color : source_color = vec3(0.75, 0.8, 0.9);
uniform float moon_visibility = 0.0;
uniform float star_intensity = 0.0;

uniform sampler2D cloud_noise : filter_linear_mipmap, repeat_enable;
uniform float cloud_coverage : hint_range(0.0, 1.0) = 0.3;
uniform float cloud_softness = 0.25;
uniform float cloud_scale = 0.35;
uniform vec2 cloud_offset = vec2(0.0);
uniform vec3 cloud_lit_color : source_color = vec3(1.0, 0.98, 0.95);
uniform vec3 cloud_shade_color : source_color = vec3(0.55, 0.58, 0.64);
uniform float cloud_energy = 1.0;
uniform float overcast = 0.0;          // 0..1 flattens the sky towards a grey dome

float hash13(vec3 p) {
	p = fract(p * 0.1031);
	p += dot(p, p.zyx + 31.32);
	return fract((p.x + p.y) * p.z);
}

void sky() {
	vec3 d = normalize(EYEDIR);
	float up = clamp(d.y, 0.0, 1.0);
	vec3 sun = LIGHT0_ENABLED ? LIGHT0_DIRECTION : vec3(0.0, -1.0, 0.0);
	float mu = dot(d, sun);

	// base gradient
	vec3 col = mix(horizon_color, zenith_color, pow(up, horizon_falloff));
	// forward scattering halo, stronger near the horizon (Mie-like)
	float halo = pow(max(mu, 0.0), 6.0) * (0.4 + 0.6 * (1.0 - up));
	col += horizon_color * sun_glow * halo;
	// below the horizon: darkened ground bounce
	float below = clamp(-d.y * 6.0, 0.0, 1.0);
	col = mix(col, ground_color, below);

	// overcast dome
	vec3 grey = mix(horizon_color, zenith_color, 0.25) * 0.9;
	col = mix(col, vec3(dot(grey, vec3(0.333))), overcast * 0.85);

	// stars (night only, upper hemisphere)
	if (star_intensity > 0.001 && d.y > 0.0) {
		vec3 q = floor(d * 380.0);
		float h = hash13(q);
		float star = step(0.9975, h) * (h - 0.9975) * 400.0;
		col += vec3(star) * star_intensity * up * (1.0 - overcast);
	}

	// clouds projected on a flat layer
	float cloud_a = 0.0;
	if (d.y > 0.01 && cloud_coverage > 0.001) {
		vec2 uv = d.xz / (d.y + 0.12) * cloud_scale + cloud_offset;
		float n = texture(cloud_noise, uv).r * 0.65 + texture(cloud_noise, uv * 2.7 + 0.37).r * 0.35;
		float thr = 1.0 - cloud_coverage;
		cloud_a = smoothstep(thr - cloud_softness * 0.5, thr + cloud_softness, n);
		cloud_a *= smoothstep(0.01, 0.18, d.y);          // fade into horizon haze
		float lit = clamp(0.55 + 0.45 * mu, 0.0, 1.0);
		vec3 cc = mix(cloud_shade_color, cloud_lit_color, lit * (1.0 - overcast * 0.6)) * cloud_energy;
		cc += LIGHT0_COLOR * pow(max(mu, 0.0), 8.0) * 0.6 * cloud_energy;   // silver lining
		col = mix(col, cc, cloud_a);
	}

	// sun disk (hidden by clouds)
	if (LIGHT0_ENABLED && !AT_CUBEMAP_PASS) {
		float disk = smoothstep(sun_disk_size, sun_disk_size + 0.00012, mu);
		col += LIGHT0_COLOR * disk * sun_disk_energy * (1.0 - cloud_a) * (1.0 - overcast);
	}
	// moon disk
	if (moon_visibility > 0.001) {
		float m = smoothstep(0.99955, 0.99965, dot(d, normalize(moon_dir)));
		col += moon_color * m * 2.0 * moon_visibility * (1.0 - cloud_a);
	}
	COLOR = col * sky_energy;
}
