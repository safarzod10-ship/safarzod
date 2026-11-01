// DUSHANBE - automotive glass. `vlt` is VISIBLE LIGHT TRANSMISSION of the tinted glazing:
// the scene behind the glass is attenuated to vlt (premultiplied blending: background * (1 - ALPHA)
// with ALPHA = 1 - vlt), while the reflection (Fresnel specular of a smooth dielectric) is added on
// top and NOT attenuated - so 20 % VLT reads dark but you still see a bright interior / objects
// behind it, and reflections stay strong. This is not "20 % opacity": a 20 %-opaque material would
// pass 80 % of the background. Tint colour = the film's slight neutral-grey/green cast.
shader_type spatial;
render_mode blend_premul_alpha, depth_draw_opaque, cull_back, specular_schlick_ggx;

uniform float vlt : hint_range(0.0, 1.0) = 0.20;
uniform vec3 tint : source_color = vec3(0.10, 0.12, 0.12);
uniform float roughness_value : hint_range(0.0, 1.0) = 0.03;
uniform float dirt : hint_range(0.0, 1.0) = 0.04;

void fragment() {
	float ndv = clamp(dot(normalize(NORMAL), normalize(VIEW)), 0.0, 1.0);
	float fres = pow(1.0 - ndv, 5.0);
	// transmission falls at grazing angles (more reflected, longer path in the glass)
	float transmit = vlt * (1.0 - fres) * (1.0 - dirt);
	ALPHA = 1.0 - transmit;
	// premultiplied: the colour written is what the GLASS itself adds (film tint scatter, tiny)
	ALBEDO = tint * 0.04 * ALPHA;
	METALLIC = 0.0;
	ROUGHNESS = roughness_value;
	SPECULAR = 0.5;
}
