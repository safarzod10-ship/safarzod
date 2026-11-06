// DUSHANBE vehicle glass: tinted, reflective, transparent; cracks (frosted, whiter) where dented.
shader_type spatial;
render_mode blend_mix, depth_draw_opaque, cull_back, diffuse_burley, specular_schlick_ggx;
#include "res://assets/shaders/vehicle_damage.gdshaderinc"

uniform sampler2D albedo_tex : source_color, filter_linear_mipmap, repeat_enable, hint_default_white;
uniform vec4 albedo_color : source_color = vec4(1.0);
uniform float opacity = 0.55;

void vertex() {
	vec3 cpos;
	float dmg;
	apply_dents(VERTEX, NORMAL, cpos, dmg);
	v_carpos = cpos;
	v_damage = dmg;
}

void fragment() {
	vec4 t = texture(albedo_tex, UV) * albedo_color;
	float crack = smoothstep(0.2, 0.8, v_damage);
	ALBEDO = mix(t.rgb * vec3(0.18, 0.21, 0.24), vec3(0.75, 0.78, 0.8), crack * 0.7);
	ROUGHNESS = mix(0.04, 0.45, crack);
	METALLIC = 0.0;
	SPECULAR = 0.6;
	ALPHA = clamp(max(opacity, t.a * 0.0 + opacity) + crack * 0.35, 0.0, 0.95);
}
