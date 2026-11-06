// Procedural lawn grass: root->tip colour gradient, per-clump hue variation, wind sway,
// shrinks to zero near the streaming radius so the border is invisible.
shader_type spatial;
render_mode cull_disabled, diffuse_burley, specular_disabled;
global uniform vec3 grass_center;
global uniform float grass_radius;
uniform vec3 root_color : source_color = vec3(0.10, 0.17, 0.05);
uniform vec3 tip_color : source_color = vec3(0.42, 0.55, 0.20);
uniform vec3 dry_color : source_color = vec3(0.58, 0.55, 0.30);
varying float t;
varying vec2 var_;
void vertex() {
	t = COLOR.r;
	// per-clump variation from the clump's world position (INSTANCE_CUSTOM is undefined on the GLES3
	// fallback renderer used by many Android devices and turned the blades white)
	vec3 o = MODEL_MATRIX[3].xyz;
	var_ = fract(sin(vec2(dot(o.xz, vec2(12.9898, 78.233)), dot(o.xz, vec2(39.3468, 11.135)))) * 43758.5453);
	vec3 wp = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	float d = distance(wp.xz, grass_center.xz);
	float fade = 1.0 - smoothstep(grass_radius * 0.7, grass_radius, d);
	VERTEX.y *= fade;
	float w = sin(TIME * 1.7 + wp.x * 0.35 + wp.z * 0.21) * 0.5 + sin(TIME * 3.1 + wp.x * 1.3) * 0.2;
	VERTEX.xz += vec2(0.05, 0.03) * w * t * t;
}
void fragment() {
	vec3 tip = mix(tip_color, dry_color, var_.x * var_.y * 0.8);
	ALBEDO = mix(root_color, tip, t) * (0.85 + 0.3 * var_.y);
	ROUGHNESS = 0.85;
	BACKLIGHT = vec3(0.25, 0.3, 0.1) * t;
	AO = mix(0.45, 1.0, t);
	AO_LIGHT_AFFECT = 0.6;
}
