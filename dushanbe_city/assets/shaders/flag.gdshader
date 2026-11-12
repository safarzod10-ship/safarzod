// National flag of Tajikistan, waving: red / white (with the golden crown and 7 stars) / green.
shader_type spatial;
render_mode cull_disabled;
void vertex() {
	float x = UV.x;
	VERTEX.z += sin(x * 7.0 - TIME * 3.0) * 1.2 * x + sin(x * 13.0 - TIME * 4.7) * 0.35 * x;
	VERTEX.y += sin(x * 5.0 - TIME * 2.0) * 0.4 * x;
}
void fragment() {
	float v = UV.y;
	vec3 c = v < 0.2857 ? vec3(0.8, 0.07, 0.1) : (v < 0.7143 ? vec3(0.97, 0.97, 0.97) : vec3(0.0, 0.5, 0.18));
	// crown + stars (simplified): golden arc and dots in the white band centre
	vec2 p = vec2((UV.x - 0.5) * 2.0, (v - 0.5) * 1.0);
	float crown = smoothstep(0.012, 0.0, abs(length(p - vec2(0.0, -0.02)) - 0.09)) * step(p.y, -0.01);
	float stars = 0.0;
	for (int i = 0; i < 7; i++) {
		float a = 3.14159 * (0.15 + 0.7 * float(i) / 6.0);
		vec2 s = vec2(cos(a) * 0.16, -sin(a) * 0.16 - 0.02);
		stars += smoothstep(0.02, 0.008, length(p - s));
	}
	c = mix(c, vec3(0.95, 0.75, 0.2), clamp(crown + stars, 0.0, 1.0));
	ALBEDO = c;
	ROUGHNESS = 0.8;
}
