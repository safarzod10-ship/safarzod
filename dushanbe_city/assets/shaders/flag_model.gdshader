// The imported Tajikistan flag cloth (tajik_flag.glb) waving in the wind: a travelling wave along
// the cloth from the pole to the free end (amplitude grows with the distance from the pole).
// pole_l / along_l / normal_l are the pole point, the pole->tip direction and the sideways
// displacement direction (1 world metre) in the mesh's local space (set from GDScript).
shader_type spatial;
render_mode cull_disabled, diffuse_burley;
uniform sampler2D tex : source_color, filter_linear_mipmap_anisotropic;
uniform vec3 pole_l = vec3(0.0);
uniform vec3 along_l = vec3(1.0, 0.0, 0.0);
uniform vec3 normal_l = vec3(0.0, 0.0, 1.0);
uniform float len_l = 1.0;
uniform float amp = 1.5;          // world metres at the free end
void vertex() {
	float d = clamp(dot(VERTEX - pole_l, along_l) / len_l, 0.0, 1.0);
	float w = sin(d * 8.5 - TIME * 2.3) * 0.7 + sin(d * 17.0 - TIME * 3.7 + 1.3) * 0.3;
	VERTEX += normal_l * w * amp * d;
}
void fragment() {
	ALBEDO = texture(tex, UV).rgb;
	ROUGHNESS = 0.85;
	SPECULAR = 0.25;
	BACKLIGHT = ALBEDO * 0.35;
}
