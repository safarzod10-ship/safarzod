// DUSHANBE vehicle damage: smooth dents as a deformation FIELD in car-local space.
// * dent i: dent_pos[i] = (centre xyz, radius m), dent_dir[i] = (unit push direction xyz, depth m)
// * displacement u(p) = sum dir * depth * f(|p - c| / r) * crease, f = (1 - x^2)^2  (C1-smooth)
//   crease = two soft folds across the dent, oriented by the push direction (deterministic, no noise)
// * normals are bent by the tangential gradient of (u . n), so dents shade correctly
// * every part (body, doors, bumpers, bonnet, lights) evaluates the SAME field in car space ->
//   seams between separate meshes stay closed; UVs untouched; nothing is rebuilt on the CPU:
//   only these uniforms change when the car is hit, and repair zeroes dent_count.
// part_x/y/z = rows of the part -> car-local affine transform (instance uniforms, set once per part).
uniform vec4 dent_pos[8];
uniform vec4 dent_dir[8];
uniform int dent_count = 0;
instance uniform vec4 part_x = vec4(1.0, 0.0, 0.0, 0.0);
instance uniform vec4 part_y = vec4(0.0, 1.0, 0.0, 0.0);
instance uniform vec4 part_z = vec4(0.0, 0.0, 1.0, 0.0);
varying float v_damage;      // 0..1 dent influence here (scratches, paint loss, cracked glass)
varying vec3 v_carpos;       // car-local position (scratch pattern is fixed to the car)

vec3 to_car(vec3 v, float w) {
	vec4 p = vec4(v, w);
	return vec3(dot(part_x, p), dot(part_y, p), dot(part_z, p));
}

vec3 from_car_dir(vec3 d) {
	// inverse of a rotation * uniform scale basis: R^T / s^2
	float s2 = max(dot(part_x.xyz, part_x.xyz), 1e-6);
	return (part_x.xyz * d.x + part_y.xyz * d.y + part_z.xyz * d.z) / s2;
}

// (varyings may only be written in vertex(): results come back through out parameters)
void apply_dents(inout vec3 vertex, inout vec3 normal, out vec3 carpos, out float damage) {
	vec3 cp = to_car(vertex, 1.0);
	carpos = cp;
	damage = 0.0;
	if (dent_count == 0) {
		return;
	}
	vec3 cn = normalize(to_car(normal, 0.0));
	vec3 u = vec3(0.0);
	vec3 g = vec3(0.0);
	for (int i = 0; i < 8; i++) {
		if (i >= dent_count) { break; }
		vec4 P = dent_pos[i];
		vec4 D = dent_dir[i];
		vec3 rel = cp - P.xyz;
		float r2 = P.w * P.w;
		float x2 = dot(rel, rel) / r2;
		if (x2 >= 1.0) { continue; }
		float f = (1.0 - x2) * (1.0 - x2);
		vec3 ax = normalize(cross(D.xyz, vec3(0.0, 1.0, 0.0)) + vec3(1e-4, 0.0, 0.0));
		float ph = dot(rel, ax) * 12.0 / P.w;
		float crease = 0.7 + 0.3 * cos(ph);
		u += D.xyz * (D.w * f * crease);
		// gradient of f*crease (scalar part of u . n)
		vec3 gf = (-4.0 * (1.0 - x2) / r2) * rel * crease - f * 0.3 * sin(ph) * (12.0 / P.w) * ax;
		g += gf * (D.w * dot(D.xyz, cn));
		damage = max(damage, f * clamp(D.w / 0.05, 0.0, 1.0));
	}
	vec3 gt = g - cn * dot(g, cn);              // tangential gradient
	vertex += from_car_dir(u);
	normal = normalize(from_car_dir(normalize(cn - gt)) );
}

// scratches fixed to the car body: a few long, thin, anti-aliased streaks running along the car
// (as from scraping a wall or another car), broken into segments, only inside strongly dented areas.
// Call from fragment() (uses fwidth).
float scratch_mask(vec3 cp, float dmg) {
	if (dmg <= 0.3) { return 0.0; }
	float s = cp.y * 9.0 + sin(cp.z * 2.3) * 0.15;
	float d = abs(fract(s) - 0.5);                         // distance to the streak centre line
	float w = fwidth(s) * 1.2 + 0.015;
	float line = 1.0 - smoothstep(0.03, 0.03 + w, d);
	float seg = fract(sin(floor(s) * 91.7 + floor(cp.z * 2.5 + floor(s) * 0.37) * 17.3) * 43758.5453);
	return line * step(0.45, seg) * smoothstep(0.3, 0.75, dmg);
}
