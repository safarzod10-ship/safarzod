// Grape vine / climbing foliage cards: leaf atlas with manual alpha cutoff (discard),
// two-sided lighting, slight translucency.
shader_type spatial;
render_mode cull_disabled, diffuse_burley;
uniform sampler2D leaf_tex : source_color, filter_linear_mipmap, repeat_enable;
uniform vec3 tint : source_color = vec3(0.78, 0.92, 0.62);
void fragment() {
	vec4 c = texture(leaf_tex, UV * 2.0);
	if (c.a < 0.45) { discard; }
	ALBEDO = c.rgb * tint * COLOR.rgb;
	if (!FRONT_FACING) { NORMAL = -NORMAL; }
	ROUGHNESS = 0.7;
	BACKLIGHT = vec3(0.35, 0.45, 0.15);
}
