// DUSHANBE sea: opaque (no screen/depth texture reads -> cheap on mobile GPUs).
// * colour by water depth from a prebaked mask (sea_mask.png: R depth/12 m, G shore proximity):
//   sandy-turquoise shallows -> blue-green -> deep blue;
// * small waves: two scrolling normal-map layers (+ a third far layer on High/Ultra) and, when
//   wave_height > 0, a gentle vertex swell on the camera-centred radial mesh;
// * sky reflection comes from the engine (low roughness, Schlick fresnel, sky radiance);
// * foam: thin animated band at the waterline and breaking lines approaching the beaches.
shader_type spatial;
render_mode blend_mix, depth_draw_opaque, cull_back, diffuse_burley, specular_schlick_ggx;

global uniform float city_night;

uniform sampler2D mask_tex : filter_linear, repeat_disable;
uniform sampler2D wave_nrm : hint_normal, filter_linear_mipmap, repeat_enable;
uniform sampler2D foam_tex : hint_default_white, filter_linear_mipmap, repeat_enable;
uniform float mask_extent = 2048.0;
uniform vec3 shallow : source_color = vec3(0.16, 0.50, 0.50);
uniform vec3 mid : source_color = vec3(0.05, 0.27, 0.33);
uniform vec3 deep : source_color = vec3(0.02, 0.11, 0.20);
uniform vec3 sand_tint : source_color = vec3(0.55, 0.55, 0.42);
uniform float wave_height = 0.0;       // vertex swell amplitude (m), 0 on Low/Medium
uniform float detail = 1.0;            // 0 Low: 2 normal fetches, no foam lines
uniform float foam_amount = 1.0;

varying vec3 wp;

float swell(vec2 p, float t) {
	return sin(dot(p, vec2(0.11, 0.07)) + t * 0.9) * 0.55
		+ sin(dot(p, vec2(-0.05, 0.13)) + t * 1.15) * 0.3
		+ sin(dot(p, vec2(0.21, -0.17)) + t * 1.7) * 0.15;
}

void vertex() {
	wp = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	if (wave_height > 0.0) {
		float d = length(wp.xz - CAMERA_POSITION_WORLD.xz);
		float fade = 1.0 - smoothstep(60.0, 220.0, d);
		float h = swell(wp.xz, TIME) * wave_height * fade;
		VERTEX.y += h;
		wp.y += h;
	}
}

void fragment() {
	vec2 muv = (wp.xz + mask_extent) / (2.0 * mask_extent);
	vec3 mk = texture(mask_tex, muv).rgb;
	bool outside = any(lessThan(muv, vec2(0.0))) || any(greaterThan(muv, vec2(1.0)));
	float depth = outside ? 12.0 : mk.r * 12.0;
	float shore = outside ? 0.0 : mk.g;
	float t = TIME;
	vec2 p = wp.xz;
	vec3 n1 = texture(wave_nrm, p * 0.045 + vec2(t * 0.012, t * 0.007)).rgb;
	vec3 n2 = texture(wave_nrm, p * 0.11 + vec2(-t * 0.018, t * 0.021)).rgb;
	vec3 n = normalize((n1 + n2) - 1.0);
	if (detail > 0.5) {
		vec3 n3 = texture(wave_nrm, p * 0.013 + vec2(t * 0.004, -t * 0.003)).rgb;
		n = normalize(n + (n3 - 0.5) * 1.2);
	}
	// calmer, smoother water in the shallows of the bays
	float calm = smoothstep(0.0, 2.5, depth);
	vec3 col = mix(shallow, mid, smoothstep(0.6, 4.0, depth));
	col = mix(col, deep, smoothstep(4.0, 11.0, depth));
	col = mix(sand_tint, col, smoothstep(0.0, 0.9, depth));     // sand shows through very shallow water
	// foam
	float f = 0.0;
	if (foam_amount > 0.0) {
		float fn = texture(foam_tex, p * 0.09 + vec2(t * 0.01, 0.0)).r;
		float edge = 1.0 - smoothstep(0.05, 0.45, depth);              // waterline band
		f = edge * smoothstep(0.35, 0.75, fn + 0.25 * sin(t * 1.6 + depth * 9.0));
		if (detail > 0.5) {
			float lines = smoothstep(0.82, 0.98, sin(shore * 34.0 - t * 1.3 + fn * 2.0));
			f = max(f, lines * shore * shore * smoothstep(0.3, 0.7, fn) * (1.0 - smoothstep(1.5, 3.5, depth)));
		}
		f *= foam_amount;
	}
	ALBEDO = mix(col, vec3(0.92, 0.95, 0.95), f) * (1.0 - 0.6 * city_night);
	ROUGHNESS = mix(0.05, 0.6, f) + 0.04 * (1.0 - calm);
	METALLIC = 0.0;
	SPECULAR = 0.5;
	NORMAL_MAP = n * 0.5 + 0.5;
	NORMAL_MAP_DEPTH = mix(0.35, 1.0, calm) * (1.0 - f);
}
