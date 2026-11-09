// Procedural lawn grass: root->tip colour gradient, per-clump hue variation, wind sway,
// shrinks to zero near the streaming radius so the border is invisible.
shader_type spatial;
render_mode cull_disabled, diffuse_burley, specular_schlick_ggx;
#include "res://assets/shaders/grass_palette.gdshaderinc"
uniform sampler2D palette_noise : hint_default_white, filter_linear_mipmap, repeat_enable;
varying vec3 pal;
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
	pal = grass_palette(o.xz, palette_noise, 1.0);
	vec3 wp = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	float d = distance(wp.xz, grass_center.xz);
	float fade = 1.0 - smoothstep(grass_radius * 0.7, grass_radius, d);
	VERTEX.y *= fade;
	float w = sin(TIME * 1.7 + wp.x * 0.35 + wp.z * 0.21) * 0.5 + sin(TIME * 3.1 + wp.x * 1.3) * 0.2;
	VERTEX.xz += vec2(0.05, 0.03) * w * t * t;
}
void fragment() {
	// per clump: a slightly different hue (olive <-> blue-green), some clumps drier at the tips
	vec3 hue = mix(vec3(1.06, 1.0, 0.82), vec3(0.88, 1.02, 1.0), var_.x);
	vec3 base = pal * hue;
	vec3 tip = mix(base * 1.22, GP_DRY * 1.05, smoothstep(0.55, 1.0, var_.x * var_.y) * 0.55);
	// dark, shadowed roots -> lit tips
	ALBEDO = mix(base * 0.3, tip, smoothstep(0.0, 1.0, t)) * (0.86 + 0.26 * var_.y);
	ROUGHNESS = 0.62;
	SPECULAR = 0.35;
	BACKLIGHT = vec3(0.32, 0.38, 0.12) * t * t;
	AO = mix(0.3, 1.0, t);
	AO_LIGHT_AFFECT = 0.75;
}
