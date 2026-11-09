// Natural lawn / grass colouring shared by every grass surface (open-world terrain, peninsula
// terrain, city lawns, the 3D grass blades). The palette (sRGB):
//   main lawn  #557A3B   lush green #668B45   dry grass #9A9255   dark patches #354D2C   light grass #829B54
// The colour is chosen in WORLD space by four octaves of a tileable noise (large patches ~400 m,
// patches ~90 m, small dry / dark spots ~20 m, tufts ~6 m) with smooth transitions, so no surface
// is one flat colour and there is no acid green. The grass texture only adds its luminance detail
// (its own hue is discarded), normalised by its average (last mip) so the palette stays exact.

const vec3 GP_MAIN = vec3(0.0908, 0.1946, 0.0437);    // #557A3B in linear
const vec3 GP_LUSH = vec3(0.1329, 0.2582, 0.0595);    // #668B45
const vec3 GP_DRY = vec3(0.3231, 0.2874, 0.0908);     // #9A9255
const vec3 GP_DARK = vec3(0.0356, 0.0742, 0.0252);    // #354D2C
const vec3 GP_LIGHT = vec3(0.2232, 0.3279, 0.0887);   // #829B54

// p: world xz; noise: a tileable greyscale noise texture (repeat enabled); detail: 0 (Low) .. 1
vec3 grass_palette(vec2 p, sampler2D noise, float detail) {
	float n1 = texture(noise, p * 0.0024).r;
	float n2 = texture(noise, p * 0.0108 + vec2(0.31, 0.17)).r;
	float n3 = detail > 0.5 ? texture(noise, p * 0.046 + vec2(0.77, 0.41)).r : 0.5;
	float n4 = detail > 0.5 ? texture(noise, p * 0.17 + vec2(0.13, 0.59)).r : 0.5;
	vec3 c = mix(GP_MAIN, GP_LUSH, smoothstep(0.32, 0.72, n1));
	c = mix(c, GP_LIGHT, smoothstep(0.56, 0.86, n2) * 0.65);
	c = mix(c, GP_DARK, smoothstep(0.42, 0.16, n2 * 0.55 + n3 * 0.45) * 0.6);
	// small dry patches (sun-burnt spots, worn corners)
	float dry = smoothstep(0.66, 0.8, n3 * 0.55 + n1 * 0.25 + n4 * 0.2);
	c = mix(c, GP_DRY, dry * 0.8);
	// tuft-scale brightness flicker
	c *= 0.9 + 0.2 * n4;
	return c;
}

// luminance detail of a grass albedo texture, ~1.0 on average
float grass_detail(sampler2D tex, vec2 uv) {
	vec3 t = texture(tex, uv).rgb;
	vec3 avg = textureLod(tex, vec2(0.5), 12.0).rgb;
	float l = dot(t, vec3(0.299, 0.587, 0.114));
	float la = max(dot(avg, vec3(0.299, 0.587, 0.114)), 0.02);
	return clamp(l / la, 0.55, 1.5);
}
