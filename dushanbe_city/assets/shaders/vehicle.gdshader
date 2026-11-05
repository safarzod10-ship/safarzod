// DUSHANBE vehicle surfaces (paint, plastics, chrome, lights, rubber, interior) converted from the
// model's glTF materials, plus the damage field (vehicle_damage.gdshaderinc):
// dents deform + re-shade the surface, scratches expose primer/metal on painted panels.
// paint = 1: glossy car paint with a clear-coat-like specular (the source had roughness 1.0 everywhere).
shader_type spatial;
render_mode blend_mix, depth_draw_opaque, cull_back, diffuse_burley, specular_schlick_ggx;
#include "res://assets/shaders/vehicle_damage.gdshaderinc"

uniform sampler2D albedo_tex : source_color, filter_linear_mipmap_anisotropic, repeat_enable, hint_default_white;
uniform vec4 albedo_color : source_color = vec4(1.0);
uniform float roughness = 0.8;
uniform float metallic = 0.0;
uniform float specular = 0.5;
uniform float paint = 0.0;           // 1 = body paint (gloss + scratches show primer)
uniform vec3 emission_color : source_color = vec3(0.0);
uniform float emission_energy = 0.0;
uniform float alpha_cut = 0.0;       // > 0: alpha-tested decals (grille, badges)
uniform vec2 side_gain = vec2(1.0);  // emission on the car's left (x < 0) / right side: turn signals

void vertex() {
	vec3 cpos;
	float dmg;
	apply_dents(VERTEX, NORMAL, cpos, dmg);
	v_carpos = cpos;
	v_damage = dmg;
}

void fragment() {
	vec4 t = texture(albedo_tex, UV) * albedo_color;
	if (alpha_cut > 0.0 && t.a < alpha_cut) {
		discard;
	}
	vec3 alb = t.rgb;
	float rough = roughness;
	float met = metallic;
	float sc = scratch_mask(v_carpos, v_damage) * paint;
	// dented paint: slightly darker, duller; scratches show grey primer / bare metal
	alb = mix(alb, alb * 0.78, v_damage * paint * 0.7);
	rough = mix(rough, 0.55, v_damage * paint);
	alb = mix(alb, vec3(0.56, 0.57, 0.58), sc);
	met = mix(met, 0.7, sc);
	ALBEDO = alb;
	ROUGHNESS = rough;
	METALLIC = met;
	SPECULAR = specular;
	// lamps: per-side gain (indicators), a smashed lamp (strong dent here) goes dark
	float side = v_carpos.x < 0.0 ? side_gain.x : side_gain.y;
	EMISSION = emission_color * emission_energy * side * (1.0 - smoothstep(0.45, 0.8, v_damage));
}
