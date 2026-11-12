// Advertising poster on the roadside billboards (DushanbeCity bank): paper print, slightly glossy,
// lit by the billboard's floodlights at night (city_night).
shader_type spatial;
render_mode cull_back, diffuse_burley, specular_schlick_ggx;
global uniform float city_night;
uniform sampler2D poster : source_color, filter_linear_mipmap_anisotropic, repeat_disable;
void fragment() {
	vec3 c = texture(poster, UV).rgb;
	// floodlights from below: brighter at the bottom edge
	float flood = mix(1.0, 0.75, UV.y < 0.5 ? 0.0 : 0.0) * mix(0.7, 1.0, UV.y);
	ALBEDO = c;
	ROUGHNESS = 0.55;
	SPECULAR = 0.35;
	EMISSION = c * city_night * 0.85 * flood;
}
