// Facade for the big landmark blocks (palace, library, museum, opera ...): on the walls a plinth, a
// grid of tall windows with light frames between pilasters, a cornice line at every storey and a
// parapet band at the top; roofs plain. Works on BoxMesh boxes (model space, centred); the box
// height comes as an instance uniform.
shader_type spatial;
render_mode diffuse_burley;
uniform vec3 base : source_color = vec3(0.94, 0.93, 0.9);
uniform vec3 trim : source_color = vec3(0.82, 0.78, 0.7);
uniform vec3 glass : source_color = vec3(0.16, 0.24, 0.3);
uniform float bay = 4.2;
uniform float storey = 4.6;
instance uniform float box_h = 10.0;
varying vec3 lp;
varying vec3 ln;
void vertex() {
	lp = VERTEX;
	ln = NORMAL;
}
float band(float x, float a, float b) { return step(a, x) * (1.0 - step(b, x)); }
void fragment() {
	vec3 c = base;
	float rough = 0.6;
	float metal = 0.0;
	if (abs(ln.y) < 0.5) {
		float u = abs(ln.x) > 0.5 ? lp.z : lp.x;
		float y = lp.y + box_h * 0.5;               // 0 at the foot
		float top = box_h - y;
		if (y < 1.1) {
			c = trim * 0.85;                         // plinth
		} else if (top < 1.4) {
			c = trim;                                // parapet / frieze
			if (top < 0.35) c = trim * 0.9;
		} else {
			float fu = fract(u / bay + 0.5);
			float fy = fract((y - 1.1) / storey);
			// pilasters between the bays
			float pil = 1.0 - band(fu, 0.14, 0.86);
			// windows: tall openings with a frame
			float win = band(fu, 0.24, 0.76) * band(fy, 0.18, 0.86);
			float frame = band(fu, 0.21, 0.79) * band(fy, 0.14, 0.9) - win;
			float mull = win * (1.0 - band(abs(fu - 0.5), 0.02, 1.0));      // vertical mullion
			float trans = win * (1.0 - band(abs(fy - 0.66), 0.012, 1.0));   // transom
			float cornice = 1.0 - band(fy, 0.04, 1.0);
			c = mix(c, trim, pil * 0.5);
			c = mix(c, trim * 1.05, frame);
			if (win > 0.5) {
				float sky = 0.25 + 0.35 * (1.0 - fy);
				c = glass + vec3(sky * 0.25, sky * 0.3, sky * 0.35);
				rough = 0.08;
				metal = 0.3;
			}
			c = mix(c, trim, max(mull, trans));
			c = mix(c, trim * 0.92, cornice);
		}
	} else if (ln.y > 0.5) {
		c = base * 0.82;
	}
	ALBEDO = c;
	ROUGHNESS = rough;
	METALLIC = metal;
}
