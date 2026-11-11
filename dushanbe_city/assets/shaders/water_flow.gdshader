// Flowing surface water (pond / stream): moving ripples, darker deep tint, light rings near p_src.
shader_type spatial;
render_mode blend_mix, depth_draw_opaque;
uniform vec3 tint : source_color = vec3(0.12, 0.42, 0.6);
uniform vec3 src = vec3(0.0);
varying vec3 wp;
void vertex() { wp = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz; }
void fragment() {
	float d = distance(wp.xz, src.xz);
	float rings = 0.5 + 0.5 * sin(d * 5.0 - TIME * 4.0);
	rings *= 1.0 - smoothstep(0.0, 6.0, d);
	float rip = 0.5 + 0.5 * sin(wp.x * 2.3 + TIME * 1.1) * sin(wp.z * 1.9 - TIME * 0.9);
	vec3 c = tint * (0.85 + 0.25 * rip) + vec3(0.6, 0.75, 0.8) * rings * 0.5;
	ALBEDO = c;
	ALPHA = 0.82;
	ROUGHNESS = 0.05;
	SPECULAR = 0.7;
	NORMAL_MAP = normalize(vec3(0.5 + 0.08 * sin(wp.x * 3.0 + TIME * 2.0), 0.5 + 0.08 * cos(wp.z * 3.0 - TIME * 1.7), 1.0));
}
