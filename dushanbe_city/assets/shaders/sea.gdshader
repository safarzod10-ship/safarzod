// DUSHANBE sea (mobile-friendly, no screen/depth texture reads):
// * GERSTNER WAVES in the vertex shader: 5 trochoidal waves (14-60 m, crests sharpen with
//   steepness), horizontal + vertical displacement and analytic normals; each wave fades out with
//   distance before the radial mesh gets too coarse for it (no aliasing), and all waves shrink in
//   shallow water (depth from the baked mask) - long gentle swell towards the beaches.
// * colour by depth (sea_mask.png R = depth/12 m): CLEAR SHALLOWS - alpha blending lets the seabed
//   (terrain tiles go down to 4.5 m) show through, turquoise -> blue-green -> dark deep blue.
// * sky reflection: engine sky radiance with Schlick fresnel (low roughness), sun glints from the
//   Gerstner + detail normals.
// * DYNAMIC FOAM (no constant white strip):
//   - swash at the waterline that advances and retreats with the wave phase;
//   - breaking lines in the surf zone travelling to the shore (shore proximity, mask G);
//   - whitecaps on the steepest crests (Gerstner height), broken up by noise;
//   - foam around obstacles: rocks / headlands (shore proximity near deep water);
//   - wake / ripples around the swimming or wading character (global water_player).
shader_type spatial;
render_mode blend_mix, depth_draw_opaque, cull_disabled, diffuse_burley, specular_schlick_ggx;

global uniform float city_night;
global uniform vec4 water_player;      // xyz = character position, w = 0 none / 1 wading / 2 swimming

uniform sampler2D mask_tex : filter_linear, repeat_disable;
uniform sampler2D wave_nrm : hint_normal, filter_linear_mipmap, repeat_enable;
uniform sampler2D foam_tex : hint_default_white, filter_linear_mipmap, repeat_enable;
uniform float mask_extent = 2048.0;
uniform vec3 shallow : source_color = vec3(0.20, 0.58, 0.56);
uniform vec3 mid : source_color = vec3(0.05, 0.30, 0.36);
uniform vec3 deep : source_color = vec3(0.015, 0.09, 0.17);
uniform float wave_scale = 1.0;        // per preset (Low 0.6)
uniform float detail = 1.0;            // 0 Low: 2 normal fetches, no breaking lines / whitecaps
uniform float foam_amount = 1.0;

varying vec3 wp;
varying vec3 gn;          // Gerstner normal (world)
varying float crest;      // 0..1 relative crest height (whitecaps)
varying float wdepth;     // water depth (m)

vec3 mask_at(vec2 xz) {
	vec2 muv = (xz + mask_extent) / (2.0 * mask_extent);
	if (any(lessThan(muv, vec2(0.0))) || any(greaterThan(muv, vec2(1.0)))) {
		return vec3(1.0, 0.0, 1.0);
	}
	return textureLod(mask_tex, muv, 0.0).rgb;
}

// one Gerstner wave: dir (unit), wavelength L, amplitude A, steepness Q
void gerstner(vec2 p, vec2 dir, float L, float A, float Q, float t, float fade,
		inout vec3 disp, inout vec3 nrm, inout float hsum) {
	float k = 6.2831853 / L;
	float c = sqrt(9.81 / k);
	float f = k * (dot(dir, p) - c * t);
	float a = A * fade;
	float cf = cos(f);
	float sf = sin(f);
	disp.x += Q * a * dir.x * cf;
	disp.z += Q * a * dir.y * cf;
	disp.y += a * sf;
	nrm.x -= dir.x * k * a * cf;
	nrm.z -= dir.y * k * a * cf;
	nrm.y -= Q * k * a * sf;
	hsum += A * fade;
}

void vertex() {
	wp = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	vec3 mk = mask_at(wp.xz);
	wdepth = mk.r * 12.0;
	float d = length(wp.xz - CAMERA_POSITION_WORLD.xz);
	// shoaling: waves shrink over the shallows (but keep a small swell right up to the beach)
	float sh = mix(0.25, 1.0, smoothstep(0.3, 4.0, wdepth)) * wave_scale;
	vec3 disp = vec3(0.0);
	vec3 n = vec3(0.0, 1.0, 0.0);
	float hs = 0.0;
	float t = TIME;
	gerstner(wp.xz, normalize(vec2(0.15, -1.0)), 60.0, 0.32 * sh, 0.55, t, 1.0 - smoothstep(500.0, 1400.0, d), disp, n, hs);
	gerstner(wp.xz, normalize(vec2(-0.45, -0.9)), 37.0, 0.20 * sh, 0.6, t, 1.0 - smoothstep(300.0, 800.0, d), disp, n, hs);
	gerstner(wp.xz, normalize(vec2(0.6, -0.8)), 23.0, 0.12 * sh, 0.65, t, 1.0 - smoothstep(160.0, 450.0, d), disp, n, hs);
	gerstner(wp.xz, normalize(vec2(-0.1, -1.0)), 14.5, 0.07 * sh, 0.7, t, 1.0 - smoothstep(90.0, 260.0, d), disp, n, hs);
	gerstner(wp.xz, normalize(vec2(0.85, -0.5)), 9.0, 0.04 * sh, 0.7, t, 1.0 - smoothstep(50.0, 140.0, d), disp, n, hs);
	VERTEX += disp;
	wp += disp;
	gn = normalize(n);
	crest = hs > 0.001 ? clamp(disp.y / hs, -1.0, 1.0) : 0.0;
}

void fragment() {
	vec3 mk = mask_at(wp.xz);
	float depth = mk.r * 12.0;
	float shore = mk.g;
	float t = TIME;
	vec2 p = wp.xz;
	// detail normals (tangent space) on top of the Gerstner normal
	vec3 n1 = texture(wave_nrm, p * 0.045 + vec2(t * 0.012, t * 0.007)).rgb;
	vec3 n2 = texture(wave_nrm, p * 0.11 + vec2(-t * 0.018, t * 0.021)).rgb;
	vec3 dn = (n1 + n2) - 1.0;
	if (detail > 0.5) {
		vec3 n3 = texture(wave_nrm, p * 0.013 + vec2(t * 0.004, -t * 0.003)).rgb;
		dn += (n3 - 0.5) * 1.2;
	}
	dn = normalize(dn);
	float calm = smoothstep(0.0, 2.5, depth);
	// ripples / wake around the character in the water
	float pr = 0.0;
	if (water_player.w > 0.5) {
		vec2 dv = p - water_player.xz;
		float r = length(dv);
		float ring = sin(r * 7.0 - t * 6.0) * exp(-r * 0.55) * (water_player.w > 1.5 ? 1.0 : 0.6);
		dn.xy += normalize(dv + 1e-4) * ring * 0.9;
		// thin broken foam ring hugging the body (stirred water), not a solid disc
		pr = smoothstep(1.2, 0.75, r) * smoothstep(0.25, 0.6, r) * (0.25 + 0.25 * sin(t * 3.0 + r * 9.0)) * (water_player.w > 1.5 ? 1.0 : 0.6);
		dn = normalize(dn);
	}
	// colour by depth
	vec3 col = mix(shallow, mid, smoothstep(0.8, 4.5, depth));
	col = mix(col, deep, smoothstep(4.5, 11.0, depth));
	// waves catch light: thinner, brighter water at the crests (subsurface look)
	col += vec3(0.02, 0.07, 0.06) * max(crest, 0.0) * calm;
	// clear shallows: the seabed shows through, fading to opaque by ~3.5 m
	float alpha = mix(0.0, 1.0, smoothstep(0.0, 3.5, depth)) * smoothstep(0.0, 0.12, depth) + 0.12 * smoothstep(0.0, 0.25, depth);
	alpha = clamp(alpha, 0.0, 1.0);
	// FOAM
	float f = 0.0;
	if (foam_amount > 0.0) {
		float fn = texture(foam_tex, p * 0.09 + vec2(t * 0.01, 0.0)).r;
		float fn2 = texture(foam_tex, p * 0.31 - vec2(0.0, t * 0.02)).r;
		// swash: the waterline foam advances and retreats with the wave phase
		float phase = sin(t * 0.8 - shore * 6.0) * 0.5 + 0.5;
		float swash = (1.0 - smoothstep(0.02, 0.12 + 0.35 * phase, depth)) * smoothstep(0.3, 0.7, fn + fn2 * 0.4);
		f = swash;
		if (detail > 0.5) {
			// breaking lines travelling to the shore through the surf zone
			float lines = smoothstep(0.80, 0.98, sin(shore * 34.0 - t * 1.3 + fn * 2.0));
			f = max(f, lines * shore * shore * smoothstep(0.3, 0.7, fn) * (1.0 - smoothstep(1.5, 3.5, depth)));
			// whitecaps on the steepest crests, out on open water
			float caps = smoothstep(0.72, 0.95, crest) * smoothstep(0.55, 0.85, fn2 + fn * 0.3);
			f = max(f, caps * 0.5 * smoothstep(2.0, 5.0, depth));
			// obstacles: rocky headlands / steep shores (close to shore but already deep)
			float rocks = shore * smoothstep(1.2, 3.0, depth) * smoothstep(0.55, 0.85, fn2 + 0.3 * sin(t * 1.1 + fn * 6.0));
			f = max(f, rocks * 0.8);
		}
		f = max(f, pr * smoothstep(0.45, 0.75, fn2 + fn * 0.3));
		f *= foam_amount;
	}
	alpha = max(alpha, f);
	ALBEDO = mix(col, vec3(0.90, 0.93, 0.93), f) * (1.0 - 0.6 * city_night);
	ALPHA = alpha;
	ROUGHNESS = mix(0.04, 0.6, f) + 0.04 * (1.0 - calm);
	METALLIC = 0.0;
	SPECULAR = 0.5;
	// combine: Gerstner normal (world) -> view space, detail normals perturb it
	vec3 N = normalize((VIEW_MATRIX * vec4(gn, 0.0)).xyz);
	vec3 T = normalize((VIEW_MATRIX * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
	vec3 B = normalize(cross(N, T));
	T = cross(B, N);
	float dd = mix(0.35, 1.0, calm) * (1.0 - f);
	NORMAL = normalize(N + (T * dn.x + B * dn.y) * dd * 0.5);
}
