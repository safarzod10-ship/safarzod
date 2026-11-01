// Window glass: interior atlas seen through glass (tulle, curtains, blinds, rooms) + sky
// reflections (low roughness, Fresnel). At night lit rooms glow (atlas alpha = lit mask).
shader_type spatial;
render_mode blend_mix, cull_back, specular_schlick_ggx;

global uniform float city_night;
uniform sampler2D interior_tex : source_color, filter_linear_mipmap, repeat_disable;
uniform float interior_day = 0.32;
uniform vec3 glass_tint : source_color = vec3(0.80, 0.86, 0.90);
uniform float night_energy = 0.8;

void fragment() {
	vec4 it = texture(interior_tex, UV);
	float fres = pow(1.0 - clamp(dot(NORMAL, VIEW), 0.0, 1.0), 4.0);
	vec3 interior = it.rgb * COLOR.rgb * interior_day * glass_tint;
	ALBEDO = interior * (1.0 - fres * 0.6);
	ROUGHNESS = 0.06;
	METALLIC = 0.0;
	SPECULAR = 0.65;
	float lit = step(0.05, it.a) * city_night;
	EMISSION = it.rgb * vec3(1.0, 0.85, 0.62) * lit * night_energy * (0.6 + 0.4 * it.a);
}
