// Leaf-cluster cards + (LOD1) bark flagged by vertex alpha = 0. Alpha-scissor,
// two-sided with consistent outward (bent) normals, wind sway, per-instance tint
// (MultiMesh colour) and simple transmission for back-lit leaves.
shader_type spatial;
render_mode cull_disabled;

uniform sampler2D leaves : source_color, filter_linear_mipmap, repeat_disable;
uniform float alpha_cut = 0.42;
uniform vec3 tint : source_color = vec3(1.0);
uniform vec3 bark_color : source_color = vec3(0.30, 0.25, 0.20);
uniform float translucency = 0.28;
uniform float sway = 0.05;
uniform float tree_height = 15.0;
global uniform vec2 env_wind;

varying float is_bark;

void vertex() {
	is_bark = 1.0 - step(0.5, COLOR.a);
	vec3 wp = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	float h = clamp(VERTEX.y / tree_height, 0.0, 1.0);
	float phase = dot(MODEL_MATRIX[3].xz, vec2(0.13, 0.17));
	float gust = sin(TIME * 1.1 + phase) * 0.6 + sin(TIME * 2.7 + phase * 1.7 + wp.x * 0.3) * 0.4;
	float leaf = (1.0 - is_bark) * sin(TIME * 5.0 + wp.x * 2.1 + wp.z * 1.7) * 0.03;
	vec2 w = env_wind * (gust * sway * h * h * tree_height * 0.15 + leaf);
	VERTEX.xz += (inverse(mat3(MODEL_MATRIX)) * vec3(w.x, 0.0, w.y)).xz;
}

void fragment() {
	vec4 t = texture(leaves, UV);
	// Manual discard instead of ALPHA + ALPHA_SCISSOR_THRESHOLD: measured that the
	// scissor path rendered unlit (black) foliage on the Mobile renderer here
	// (docs/VEGETATION_SYSTEM.md); a plain discard keeps the material opaque.
	if (is_bark > 0.5) {
		ALBEDO = bark_color * COLOR.rgb;
		ROUGHNESS = 0.9;
	} else {
		if (t.a < alpha_cut) {
			discard;
		}
		ALBEDO = t.rgb * tint * COLOR.rgb;
		ROUGHNESS = 0.72;
		BACKLIGHT = ALBEDO * translucency;
	}
	SPECULAR = 0.3;
	NORMAL = FRONT_FACING ? NORMAL : -NORMAL;
}
