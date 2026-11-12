// DUSHANBE grass: alpha-free geometric blades for dense MultiMesh lawns.
// COLOR.g = height factor along the blade (0 root .. 1 tip), COLOR.r = root AO, COLOR.b = blade seed.
// Wind bend grows with height^2. Root->tip colour gradient, per-instance colour variation
// (world-position hash), and distance fade: blades shrink to nothing between
// fade_start and fade_end so the edge of a grass patch around the camera is invisible.
shader_type spatial;
render_mode cull_disabled, diffuse_burley, specular_schlick_ggx;

#include "res://assets/shaders/vegetation_common.gdshaderinc"
#include "res://assets/shaders/grass_palette.gdshaderinc"

group_uniforms colour;
uniform vec4 color_root : source_color = vec4(0.13, 0.17, 0.06, 1.0);
uniform vec4 color_mid : source_color = vec4(0.27, 0.38, 0.12, 1.0);
uniform vec4 color_tip : source_color = vec4(0.48, 0.56, 0.22, 1.0);
uniform vec4 color_dry : source_color = vec4(0.58, 0.52, 0.30, 1.0);
uniform float dry_amount : hint_range(0.0, 1.0) = 0.15;   // share of yellowed blades / patches
uniform float hue_variation : hint_range(0.0, 0.5) = 0.08;
uniform float brightness_variation : hint_range(0.0, 0.5) = 0.12;
uniform float patch_scale = 0.18;  // world frequency of colour patches (1/m)
uniform float ao_strength : hint_range(0.0, 1.0) = 0.7;
uniform float roughness : hint_range(0.0, 1.0) = 0.8;
uniform float specular : hint_range(0.0, 1.0) = 0.3;
uniform float translucency : hint_range(0.0, 2.0) = 0.45;
uniform float normal_up_blend : hint_range(0.0, 1.0) = 0.55; // softens lighting like a lawn
uniform bool use_instance_custom = false;
uniform bool use_palette = true;          // colours from the natural lawn palette (same as the ground)
uniform sampler2D palette_noise : hint_default_white, filter_linear_mipmap, repeat_enable;
group_uniforms wind;
uniform float bend_amount = 0.10;   // tip displacement (m) at wind strength 1
uniform float flutter_amount = 0.02;
group_uniforms fade;
uniform float fade_start = 18.0;
uniform float fade_end = 26.0;

varying vec3 v_col;
varying vec3 v_vnormal;

float vnoise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	float a = veg_hash12(i);
	float b = veg_hash12(i + vec2(1.0, 0.0));
	float c = veg_hash12(i + vec2(0.0, 1.0));
	float d = veg_hash12(i + vec2(1.0, 1.0));
	return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

void vertex() {
	vec3 opos = MODEL_MATRIX[3].xyz;
	float ih = veg_hash12(opos.xz * 1.713 + 7.0);
	float ih2 = veg_hash12(opos.zx * 2.37 + 1.0);
	// (no INSTANCE_CUSTOM: undefined on the GLES3 fallback renderer -> white blades)
	float hgt = COLOR.g;
	// distance fade (shrink): uses the instance origin so a clump fades as a whole
	vec3 cam = INV_VIEW_MATRIX[3].xyz;
	float dist = length(opos - cam);
	float fade = 1.0 - smoothstep(fade_start, fade_end, dist);
	VERTEX.y *= fade;
	VERTEX.xz *= mix(0.4, 1.0, fade);
	// wind bend
	float t = TIME * veg_wind_speed;
	vec3 wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	float wave = dot(wpos.xz, veg_wind_dir) * 0.45;
	float str = veg_wind_strength * (0.55 + 0.45 * sin(t * 1.3 - wave + ih * 2.0))
			* (0.7 + 0.3 * sin(t * 0.31 - wave * 0.2));
	vec3 wd = veg_local_wind(MODEL_MATRIX);
	float bend = hgt * hgt * (bend_amount * str + 0.02 * veg_wind_strength * sin(t * 4.1 + COLOR.b * 30.0 + ih * 6.0));
	vec3 side = vec3(-wd.z, 0.0, wd.x);
	VERTEX += wd * bend + side * hgt * flutter_amount * veg_wind_strength * sin(t * 6.3 + COLOR.b * 17.0);
	VERTEX.y -= abs(bend) * hgt * 0.35;
	// colour
	vec3 c_root = color_root.rgb;
	vec3 c_mid = color_mid.rgb;
	vec3 c_tip = color_tip.rgb;
	if (use_palette) {
		// the ground's palette colour at this clump: blades a bit lighter at the tip, dark at the root
		vec3 pc = grass_palette(opos.xz, palette_noise, 1.0);
		// darker roots, natural mid, tips slightly sun-bleached (no lime): deeper, more real lawn
		c_root = pc * 0.26;
		c_mid = pc * 0.72;
		c_tip = mix(pc * 1.02, GP_DRY * 0.95, 0.12 + 0.18 * ih2);
	}
	vec3 c = hgt < 0.45 ? mix(c_root, c_mid, hgt / 0.45)
			: mix(c_mid, c_tip, (hgt - 0.45) / 0.55);
	float patchn = vnoise(opos.xz * patch_scale);
	float dry = smoothstep(1.0 - dry_amount, 1.0, patchn * 0.7 + fract(COLOR.b * 7.13 + ih) * 0.3);
	c = mix(c, (use_palette ? GP_DRY : color_dry.rgb) * mix(0.55, 1.0, hgt), dry);
	c = veg_variation(c, ih, ih2 * 0.5 + patchn * 0.5, hue_variation * 1.4, brightness_variation * 1.6);
	c *= mix(1.0, COLOR.r, ao_strength);
	v_col = c;
	vec3 n = normalize(mix(NORMAL, vec3(0.0, 1.0, 0.0), normal_up_blend * 0.6));   // more light / shade across the blades
	v_vnormal = normalize((MODELVIEW_MATRIX * vec4(n, 0.0)).xyz);
}

void fragment() {
	ALBEDO = v_col;
	NORMAL = normalize(v_vnormal);
	ROUGHNESS = roughness;
	SPECULAR = specular;
	BACKLIGHT = v_col * translucency * 0.7;
}
