// DUSHANBE - Ismoili Somoni monument surface (v3). One shader, five material
// instances (granite, arch stone, column stone, gold leaf, patinated bronze).
//
// Detail is layered, from large to small (docs/MONUMENT_MATERIALS.md):
//  1. geometry (silhouette, mouldings, bevels)                      - mesh
//  2. baked per-object maps on the unique UV atlas (UV):            - bake_map
//     R = large-scale AO (4 m rays), G = local AO / cavity (0.25 m), B = convexity
//     + optional baked tangent-space normal map (lions: detail of the old model)
//  3. tiling PBR scan (CC0), projected in OBJECT space (triplanar on Medium/Ultra,
//     dominant axis on Low) so texel density is constant and independent of the atlas
//  4. procedural panel joints / per-panel tone variation (stone cladding, gilding)
// Mobile + Compatibility renderers; max 5 samplers.
shader_type spatial;
render_mode cull_back, diffuse_burley, specular_schlick_ggx;

uniform sampler2D detail_albedo_rough : source_color, filter_linear_mipmap_anisotropic, repeat_enable; // A = roughness
uniform sampler2D detail_normal : hint_normal, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D bake_map : hint_default_white, filter_linear_mipmap, repeat_disable;
uniform sampler2D bake_normal : hint_normal, filter_linear_mipmap, repeat_disable;
uniform bool use_bake_normal = false;

uniform float tile_m = 1.5;              // metres per repeat of the detail scan
uniform bool triplanar = true;           // false = dominant-axis projection (Low preset)
uniform float triplanar_sharpness = 6.0;
uniform vec3 tint : source_color = vec3(1.0);
uniform float metallic_value : hint_range(0.0, 1.0) = 0.0;
uniform float metallic_in_cavity : hint_range(0.0, 1.0) = 1.0;   // metallic multiplier in cavities (patina)
uniform float roughness_scale = 1.0;
uniform float roughness_up = -1.0;       // >= 0: roughness of up-facing surfaces (polished floor, worn by feet)
uniform float roughness_in_cavity = 0.0; // added roughness in cavities (dust, patina)
uniform float normal_strength = 1.0;
uniform float bake_normal_strength = 1.0;
uniform float ao_strength : hint_range(0.0, 1.0) = 1.0;
uniform float cavity_darkening : hint_range(0.0, 1.0) = 0.5;  // albedo in crevices (dirt / thicker patina)
uniform float edge_polish : hint_range(0.0, 1.0) = 0.0;       // convex edges: lighter, smoother, more metallic
uniform vec2 joint_spacing = vec2(0.0, 0.0);  // panel size (m): x = horizontal, y = vertical; 0 = no joints
uniform float joint_width = 0.006;
uniform vec3 joint_color : source_color = vec3(0.35, 0.33, 0.30);
uniform float panel_tone = 0.0;          // per-panel albedo variation (+-)
uniform float panel_cell_m = 0.9;        // cell size for tone variation when no joints (gilding)
uniform float detail_fade_start = 40.0;  // detail normal faded out (anti-shimmer) between these distances
uniform float detail_fade_end = 120.0;

varying vec3 opos;
varying vec3 onrm;

void vertex() {
	opos = VERTEX;
	onrm = NORMAL;
}

float hash13(vec3 p) {
	p = fract(p * 0.1031);
	p += dot(p, p.zyx + 31.32);
	return fract((p.x + p.y) * p.z);
}

// distance (m) to the nearest joint line along one coordinate
float joint_d(float u, float s) {
	if (s <= 0.0) return 1e3;
	float f = u / s;
	return abs(f - round(f)) * s;
}

// normal maps are imported RG-compressed (compress/normal_map): rebuild Z
vec3 unpack_n(vec4 t) {
	vec2 xy = t.rg * 2.0 - 1.0;
	return vec3(xy, sqrt(max(0.0, 1.0 - dot(xy, xy))));
}

void fragment() {
	// ---- base normal (view space), optionally with the baked tangent-space normal
	vec3 n_view = normalize(NORMAL);
	if (use_bake_normal) {
		vec3 bn = unpack_n(texture(bake_normal, UV));
		bn.xy *= bake_normal_strength;
		n_view = normalize(TANGENT * bn.x + BINORMAL * bn.y + NORMAL * bn.z);
	}
	mat3 obj_to_view = mat3(VIEW_MATRIX) * mat3(MODEL_MATRIX);
	vec3 n_obj = normalize(transpose(obj_to_view) * n_view);   // rigid transforms: inverse = transpose
	vec3 g = normalize(onrm);                                    // geometric normal (projection weights)

	// ---- projection weights
	vec3 w = pow(abs(g), vec3(triplanar_sharpness));
	if (!triplanar) {
		vec3 a = abs(g);
		w = (a.x > a.y && a.x > a.z) ? vec3(1, 0, 0) : (a.y > a.z ? vec3(0, 1, 0) : vec3(0, 0, 1));
	}
	w /= (w.x + w.y + w.z);
	vec2 uvx = opos.zy / tile_m;
	vec2 uvy = opos.xz / tile_m + vec2(0.37, 0.61);
	vec2 uvz = opos.xy / tile_m + vec2(0.13, 0.29);

	vec4 ar = vec4(0.0);
	vec3 tnx = vec3(0.0), tny = vec3(0.0), tnz = vec3(0.0);
	if (w.x > 0.01) { ar += texture(detail_albedo_rough, uvx) * w.x; tnx = unpack_n(texture(detail_normal, uvx)); }
	if (w.y > 0.01) { ar += texture(detail_albedo_rough, uvy) * w.y; tny = unpack_n(texture(detail_normal, uvy)); }
	if (w.z > 0.01) { ar += texture(detail_albedo_rough, uvz) * w.z; tnz = unpack_n(texture(detail_normal, uvz)); }

	float dist = length(VERTEX);
	float ns = normal_strength * (1.0 - smoothstep(detail_fade_start, detail_fade_end, dist));
	// UDN triplanar normal blend (object space), on top of the (baked) base normal
	vec3 nx = vec3(n_obj.x, tnx.y * ns + n_obj.y, tnx.x * ns + n_obj.z);
	vec3 ny = vec3(tny.x * ns + n_obj.x, n_obj.y, tny.y * ns + n_obj.z);
	vec3 nz = vec3(tnz.x * ns + n_obj.x, tnz.y * ns + n_obj.y, n_obj.z);
	vec3 n_det = normalize(nx * w.x + ny * w.y + nz * w.z);

	// ---- baked AO / cavity / convexity (unique UV atlas)
	vec3 bk = texture(bake_map, UV).rgb;
	float ao_large = bk.r;
	float cavity = bk.g;                 // 1 = open, 0 = deep crevice
	float convex = clamp(bk.b * 2.0 - 1.0, 0.0, 1.0);

	vec3 albedo = ar.rgb * tint;
	float rough = ar.a * roughness_scale;

	// ---- panel joints + per-panel tone (dominant-axis panel coordinates)
	vec3 ag = abs(g);
	vec2 pc = ag.y > max(ag.x, ag.z) ? opos.xz : (ag.x > ag.z ? vec2(opos.z, opos.y) : opos.xy);
	bool floor_face = ag.y > max(ag.x, ag.z);
	vec2 sp = floor_face ? vec2(joint_spacing.x) : joint_spacing;
	float jd = min(joint_d(pc.x, sp.x), joint_d(pc.y, sp.y));
	float joint = 1.0 - smoothstep(joint_width * 0.5, joint_width, jd);
	joint *= 1.0 - smoothstep(25.0, 60.0, dist);                // sub-pixel beyond ~40 m
	vec2 cell_s = vec2(sp.x > 0.0 ? sp.x : panel_cell_m, sp.y > 0.0 ? sp.y : panel_cell_m);
	vec3 cell = floor(vec3(pc / cell_s, floor_face ? 7.0 : (ag.x > ag.z ? 3.0 : 5.0)));
	float tone = (hash13(cell + 17.0) - 0.5) * 2.0 * panel_tone;
	albedo *= 1.0 + tone;
	albedo = mix(albedo, joint_color, joint * 0.85);
	rough = mix(rough, 0.85, joint);
	if (joint > 0.0) {   // groove: tilt the normal across the joint (cheap bevelled groove)
		float sx = joint_d(pc.x, sp.x) < joint_d(pc.y, sp.y) ? 1.0 : 0.0;
		float side = sign(fract((sx > 0.5 ? pc.x / sp.x : pc.y / max(sp.y, 1e-3))) - 0.5);
		vec3 ax = floor_face ? (sx > 0.5 ? vec3(1, 0, 0) : vec3(0, 0, 1))
				: (ag.x > ag.z ? (sx > 0.5 ? vec3(0, 0, 1) : vec3(0, 1, 0)) : (sx > 0.5 ? vec3(1, 0, 0) : vec3(0, 1, 0)));
		n_det = normalize(n_det - ax * side * joint * 0.35);
	}

	// ---- cavities / edges
	albedo *= mix(1.0, cavity, cavity_darkening);
	rough = clamp(rough + roughness_in_cavity * (1.0 - cavity), 0.03, 1.0);
	float metal = metallic_value * mix(metallic_in_cavity, 1.0, cavity);
	albedo = mix(albedo, albedo * 1.25, convex * edge_polish);
	rough = mix(rough, rough * 0.6, convex * edge_polish);
	metal = mix(metal, min(1.0, metal + 0.3), convex * edge_polish * step(0.01, metallic_value));
	if (roughness_up >= 0.0) {
		rough = mix(rough, roughness_up + (ar.a - 0.3) * 0.3, smoothstep(0.85, 0.97, g.y) * (1.0 - joint));
	}

	ALBEDO = albedo;
	ROUGHNESS = rough;
	METALLIC = metal;
	NORMAL = normalize(obj_to_view * n_det);
	AO = mix(1.0, ao_large * mix(1.0, cavity, 0.5), ao_strength);
	AO_LIGHT_AFFECT = 0.25;
}
