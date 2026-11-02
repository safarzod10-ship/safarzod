// Round minimap: samples the prebaked map (assets/ui/minimap.png, +-1024 m, 1 px = 1 m) around the
// player, rotated so that screen-up = camera forward. Soft round edge + rim. No 3D camera involved.
shader_type canvas_item;
uniform sampler2D map_tex : source_color, filter_linear_mipmap, repeat_disable;
uniform vec2 center = vec2(0.0);       // player world x, z
uniform float radius_m = 160.0;        // world metres from the centre to the rim
uniform float yaw = 0.0;               // camera yaw (rad)
uniform float extent = 1024.0;
uniform vec4 rim : source_color = vec4(0.08, 0.09, 0.10, 0.9);
uniform vec4 sea : source_color = vec4(0.17, 0.38, 0.58, 1.0);

void fragment() {
	vec2 p = UV * 2.0 - 1.0;
	float r = length(p);
	vec2 right = vec2(cos(yaw), -sin(yaw));
	vec2 fwd = vec2(-sin(yaw), -cos(yaw));
	vec2 w = center + (p.x * right - p.y * fwd) * radius_m;
	vec2 uv = (w + extent) / (2.0 * extent);
	vec4 c = (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) ? sea : texture(map_tex, uv);
	float a = 1.0 - smoothstep(0.97, 1.0, r);
	c.rgb = mix(c.rgb, rim.rgb, smoothstep(0.90, 0.94, r) * rim.a);
	COLOR = vec4(c.rgb, a * 0.96);
}
