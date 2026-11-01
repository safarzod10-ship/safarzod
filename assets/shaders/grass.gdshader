// Geometry grass blades (opaque). UV.y = 0 root .. 1 tip. Per-instance colour from the
// splat map (green lawn vs. dry straw). Wind bend; blades shrink smoothly towards the
// visibility limit so there is no popping (fade_start/fade_end set per preset).
shader_type spatial;
render_mode cull_disabled;

uniform vec3 root_color : source_color = vec3(0.12, 0.20, 0.06);
uniform vec3 tip_color : source_color = vec3(0.40, 0.56, 0.20);
uniform vec3 dry_root_color : source_color = vec3(0.36, 0.30, 0.17);
uniform vec3 dry_tip_color : source_color = vec3(0.80, 0.70, 0.45);   // straw
uniform float fade_start = 30.0;
uniform float fade_end = 45.0;
uniform float bend = 0.10;
global uniform vec2 env_wind;
global uniform float env_wetness;

varying float hgt;

void vertex() {
	hgt = UV.y;   // 0 at the root, 1 at the tip (see tools/blender/build_vegetation.py)
	vec3 wp = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	float dist = length(wp - CAMERA_POSITION_WORLD);
	float shrink = 1.0 - smoothstep(fade_start, fade_end, dist);
	VERTEX.y *= shrink;
	float s = sin(TIME * 1.8 + wp.x * 0.35 + wp.z * 0.27) * 0.6 + sin(TIME * 3.9 + wp.x * 1.3) * 0.25;
	VERTEX.xz += env_wind * s * bend * hgt * hgt * shrink;
}

void fragment() {
	// instance colour: rgb = brightness/hue variation, a = dryness (0 lawn .. 1 straw)
	vec3 green = mix(root_color, tip_color, hgt);
	vec3 dry = mix(dry_root_color, dry_tip_color, hgt);
	vec3 c = mix(green, dry, COLOR.a) * COLOR.rgb;
	ALBEDO = c * mix(1.0, 0.7, env_wetness);
	ROUGHNESS = mix(0.8, 0.45, env_wetness);
	SPECULAR = 0.25;
	BACKLIGHT = c * 0.25;
	AO = mix(0.55, 1.0, hgt);
	NORMAL = FRONT_FACING ? NORMAL : -NORMAL;
}
