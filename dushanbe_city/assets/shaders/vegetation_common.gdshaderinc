// DUSHANBE vegetation — shared wind + variation helpers (Mobile-renderer friendly).
// Global uniforms (project.godot [shader_globals]):
//   veg_wind_dir      vec2  world XZ wind direction (normalised)
//   veg_wind_strength float 0 = calm, 0.3 = breeze, 1 = strong wind
//   veg_wind_speed    float time multiplier for all wind motion
// Mesh vertex COLOR convention (written by tools/vegetation/vegmesh.py):
//   r = ambient occlusion, g = flutter weight (grass: blade height 0..1),
//   b = branch phase 0..1,  a = branch sway weight 0..1

global uniform vec2 veg_wind_dir;
global uniform float veg_wind_strength;
global uniform float veg_wind_speed;

float veg_hash12(vec2 p) {
	vec3 p3 = fract(vec3(p.xyx) * 0.1031);
	p3 += dot(p3, p3.yzx + 33.33);
	return fract((p3.x + p3.y) * p3.z);
}

// World wind direction expressed in the object's local space (handles rotated / uniformly scaled instances).
vec3 veg_local_wind(mat4 model) {
	vec3 w = vec3(veg_wind_dir.x, 0.0, veg_wind_dir.y);
	mat3 m = mat3(model[0].xyz, model[1].xyz, model[2].xyz);
	vec3 l = w * m; // transpose(m) * w
	return l / max(dot(m[0], m[0]), 1e-4);
}

// Gust envelope travelling along the wind direction (world-space, so neighbouring trees move coherently).
float veg_gust(vec3 obj_pos, float t, float ih) {
	float wave = dot(obj_pos.xz, veg_wind_dir) * 0.05;
	return 0.6 + 0.4 * sin(t * 0.37 - wave + ih * 2.0) * (0.6 + 0.4 * sin(t * 0.13 - wave * 0.5 + ih * 5.0));
}

// Full tree / shrub displacement in local space.
vec3 veg_tree_wind(vec3 v, vec3 n, vec4 col, mat4 model, float t, float ih,
		float sway_height, float sway_amount, float branch_amount, float flutter_amount) {
	vec3 opos = model[3].xyz;
	float str = veg_wind_strength * veg_gust(opos, t, ih);
	vec3 wd = veg_local_wind(model);
	vec3 side = vec3(-wd.z, 0.0, wd.x);
	float h = clamp(v.y / max(sway_height, 0.1), 0.0, 1.4);
	float trunk = (0.65 + 0.35 * sin(t * 0.9 + ih * 6.2832)) * h * h * sway_amount * str;
	float bph = col.b * 6.2832;
	float br = col.a * branch_amount * str;
	vec3 d = wd * (trunk + br * (0.55 + 0.45 * sin(t * 2.1 + bph + ih * 3.0)));
	d += side * br * 0.35 * sin(t * 1.63 + bph * 1.7);
	d.y -= br * 0.2 * (0.5 + 0.5 * sin(t * 2.1 + bph));
	float fl = col.g * flutter_amount * (0.25 + str) * sin(t * 7.3 + dot(v, vec3(2.3, 1.7, 3.1)) + bph * 4.0);
	d += n * fl + vec3(0.0, fl * 0.4, 0.0);
	return d;
}

vec3 veg_variation(vec3 c, float h1, float h2, float hue_var, float bright_var) {
	float hv = (h1 - 0.5) * 2.0 * hue_var;
	c *= vec3(1.0 + hv * 0.9, 1.0 + hv * 0.15, 1.0 - hv * 1.2);
	c *= 1.0 + (h2 - 0.5) * 2.0 * bright_var;
	return c;
}
