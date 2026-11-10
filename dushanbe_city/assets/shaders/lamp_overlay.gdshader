shader_type spatial;
// 0.25: lamp lens over a lamp painted on a car's texture (owner's car pack): invisible when the lamp is
// off, an additive glow when VehicleLights drives it (same parameter names as vehicle.gdshader)
render_mode blend_add, unshaded, cull_disabled, depth_draw_never, shadows_disabled;

uniform vec3 emission_color : source_color = vec3(0.0);
uniform float emission_energy = 0.0;
uniform vec2 side_gain = vec2(1.0);  // x: the car's left (the pack's +X, mesh-local), y: right
varying float v_side;

void vertex() {
	v_side = VERTEX.x;
}

void fragment() {
	// soft edges: brightest in the middle of the lens
	vec2 d = abs(UV - 0.5) * 2.0;
	float edge = 1.0 - smoothstep(0.55, 1.0, max(d.x, d.y));
	float side = v_side > 0.0 ? side_gain.x : side_gain.y;
	ALBEDO = emission_color * emission_energy * side * edge * 1.1;
}
