// DUSHANBE-X procedural facades: buildings of the open world are boxes; windows, frames, sills,
// panel seams, balcony bands, entrances, shop windows with signs and night-lit rooms are computed
// here from per-vertex parameters (cheap geometry, thousands of buildings on Android).
// UV      = (u along the facade from its first bay, v height above the building base) in metres
// UV2     = (top of the ground floor incl. plinth, number of bays * bay width = window zone length)
// COLOR   = rgb wall tint, a = (style + seed * 0.9) / 8
//           styles: 0 plaster block, 1 concrete panel, 2 brick, 3 office glass, 4 house, 5 shop,
//                   6 public (school / admin), 7 hotel
// CUSTOM0 = (bay width, floor height, window width, flags: 1 entrance facade, 2 shop ground floor,
//            4 roof / no windows)
shader_type spatial;
render_mode blend_mix, depth_draw_opaque, cull_back, diffuse_burley, specular_schlick_ggx;

global uniform float city_night;
global uniform float city_wetness;
uniform sampler2D plaster_alb : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D panel_alb : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D brick_alb : source_color, filter_linear_mipmap_anisotropic, repeat_enable;
uniform sampler2D interior_tex : source_color, filter_linear_mipmap, repeat_disable;
uniform sampler2D sign_tex : source_color, filter_linear_mipmap, repeat_disable;
uniform sampler2D macro_tex : hint_default_white, filter_linear_mipmap, repeat_enable;

varying vec4 params;
varying vec2 info;
varying float style;
varying float seed;

float hash(vec3 p) {
	p = fract(p * vec3(0.1031, 0.1030, 0.0973));
	p += dot(p, p.yzx + 33.33);
	return fract((p.x + p.y) * p.z);
}

void vertex() {
	params = CUSTOM0;
	info = UV2;
	float a = COLOR.a * 8.0;
	style = floor(a + 0.02);
	seed = clamp(fract(a + 0.02) / 0.9, 0.0, 1.0);
}

void fragment() {
	float u = UV.x;
	float v = UV.y;
	float bay = max(params.x, 1.0);
	float fh = max(params.y, 2.4);
	float ww = params.z;
	int flags = int(params.w + 0.5);
	float g0 = info.x;
	float umax = info.y;
	vec3 tint = COLOR.rgb;
	float m = texture(macro_tex, vec2(u, v) * 0.05 + seed * 7.0).r;
	// ---- wall material
	vec3 wall;
	if (style == 1.0) {
		wall = texture(panel_alb, vec2(u, v) * 0.33).rgb;
	} else if (style == 2.0) {
		wall = texture(brick_alb, vec2(u, v) * 0.45).rgb;
		tint = mix(vec3(1.0), tint, 0.25);
	} else {
		wall = texture(plaster_alb, vec2(u, v) * 0.4).rgb;
	}
	wall *= tint * (0.86 + 0.28 * m);
	float rough = 0.88;
	float spec = 0.35;
	vec3 emis = vec3(0.0);
	bool solid = (flags & 4) != 0;
	// plinth
	float plinth = style == 3.0 || style == 5.0 ? 0.3 : (style == 4.0 ? 0.5 : 0.9);
	if (v < plinth && !solid) {
		wall = vec3(0.42, 0.40, 0.38) * (0.8 + 0.4 * m);
	}
	// grid position
	bool ground = v < g0;
	float fv = ground ? (v - plinth) : (v - g0);
	float fl = ground ? 0.0 : floor(fv / fh) + 1.0;
	float lv = ground ? fv : mod(fv, fh);
	float floor_h = ground ? max(g0 - plinth, 2.4) : fh;
	float bi = floor(u / bay);
	float lu = (fract(u / bay) - 0.5) * bay;
	bool in_zone = u > 0.0 && u < umax && !solid;
	float rnd = hash(vec3(bi, fl, seed * 97.0));
	// ---- windows
	float wh = style == 3.0 ? floor_h - 0.6 : min(floor_h * 0.52, 1.75);
	float sill = style == 3.0 ? 0.3 : floor_h * 0.3;
	float w_half = ww * 0.5;
	bool shop_floor = !solid && ground && (style == 5.0 || (flags & 2) != 0);
	bool entrance = !solid && ground && (flags & 1) != 0 && style != 3.0 && mod(bi + 1.0, 4.0) == 0.0;
	if (shop_floor) {
		w_half = bay * 0.5 - 0.25;
		sill = 0.35;
		wh = floor_h - 1.25;
	}
	float wx = abs(lu);
	float wy = lv - sill;
	bool win = in_zone && v > plinth && wx < w_half && wy > 0.0 && wy < wh;
	// office glass: continuous ribbon glazing
	if (style == 3.0 && !ground) {
		win = in_zone && wy > 0.0 && wy < wh && wx < bay * 0.5 - 0.08;
	}
	float frame_w = style == 3.0 ? 0.05 : 0.075;
	if (win) {
		vec2 wuv = vec2((lu + w_half) / (2.0 * w_half), 1.0 - wy / wh);
		bool frame = wx > w_half - frame_w || wy < frame_w || wy > wh - frame_w || abs(wuv.x - 0.5) * 2.0 * w_half < frame_w * 0.5;
		if (shop_floor) {
			frame = wx > w_half - frame_w || wy < frame_w || wy > wh - frame_w;
		}
		if (frame) {
			vec3 fc = style == 3.0 || shop_floor ? vec3(0.32, 0.33, 0.35) : (rnd > 0.25 ? vec3(0.9, 0.9, 0.88) : vec3(0.45, 0.3, 0.2));
			wall = fc;
			rough = 0.5;
		} else {
			// interior seen through the glass (atlas 4 x 4) + reflection
			float cell = floor(hash(vec3(bi * 1.7, fl * 3.1, seed * 13.0)) * 16.0);
			vec2 cuv = (vec2(mod(cell, 4.0), floor(cell / 4.0)) + clamp(wuv, 0.02, 0.98)) / 4.0;
			vec4 it = texture(interior_tex, cuv);
			float fres = pow(1.0 - clamp(dot(NORMAL, VIEW), 0.0, 1.0), 4.0);
			vec3 sky = vec3(0.55, 0.65, 0.78);
			wall = mix(it.rgb * 0.30 * vec3(0.8, 0.86, 0.9), sky * 0.35, 0.25 + fres * 0.6);
			if (style == 3.0) { wall = mix(wall, vec3(0.25, 0.42, 0.5) * 0.6, 0.55); }
			rough = 0.06;
			spec = 0.7;
			float lit = step(0.05, it.a) * step(0.35, rnd) * city_night;
			emis = it.rgb * vec3(1.0, 0.85, 0.62) * lit * 0.8;
			if (shop_floor) { emis = vec3(1.0, 0.92, 0.75) * 0.6 * city_night; }
		}
	} else if (in_zone && v > plinth && !ground) {
		// sill under the window, panel seams, balcony bands
		if (wx < w_half + 0.08 && wy > -0.08 && wy < 0.0) { wall *= 1.25; }
		if (style == 1.0) {
			float seam = min(abs(lu + bay * 0.5 - bay * floor((lu + bay * 0.5) / bay) - 0.0), 1.0);
			if (abs(fract(u / bay)) < 0.012 || lv < 0.025) { wall *= 0.62; }
		}
		if ((style == 0.0 || style == 1.0 || style == 7.0) && mod(bi + floor(seed * 3.0), 3.0) == 1.0 && wy < 0.0 && wy > -sill) {
			wall = mix(wall, vec3(0.78, 0.76, 0.72) * (0.85 + 0.2 * m), 0.85);        // balcony parapet
		}
	}
	// ---- ground floor: entrances, shop sign band
	if (entrance && wx < 0.75 && v > plinth && v < plinth + 2.3) {
		wall = vec3(0.32, 0.22, 0.14) * (0.8 + 0.3 * m);
		if (wx > 0.68 || v > plinth + 2.22) { wall = vec3(0.6, 0.6, 0.58); }
		rough = 0.6;
		emis += vec3(1.0, 0.8, 0.5) * 0.25 * city_night * step(plinth + 2.1, v);
	}
	if (shop_floor && in_zone && v > g0 - 0.95 && v < g0 - 0.15) {
		float group = floor(u / (bay * 3.0));
		float row = floor(hash(vec3(group, seed * 31.0, 5.0)) * 16.0);
		float col = step(0.5, hash(vec3(group, 2.0, seed)));
		vec2 suv = vec2((col + fract(u / (bay * 3.0))) / 2.0, (row + 1.0 - (v - (g0 - 0.95)) / 0.8) / 16.0);
		vec3 sg = texture(sign_tex, suv).rgb;
		wall = sg;
		rough = 0.4;
		emis += sg * 0.5 * city_night;
	}
	// cornice line at the top of every 5th floor on public buildings
	if ((style == 6.0 || style == 7.0) && lv < 0.18 && !ground) { wall *= 0.85; }
	float wet = city_wetness;
	wall *= mix(1.0, 0.75, wet);
	ALBEDO = wall;
	ROUGHNESS = mix(rough, 0.2, wet * 0.6);
	SPECULAR = spec;
	EMISSION = emis;
}
