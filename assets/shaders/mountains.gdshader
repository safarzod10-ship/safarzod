// Mountain backdrop: land-cover vertex colours (from true altitude/slope, baked in
// Blender) + a light triplanar rock detail on the near layer. Aerial perspective comes
// from the Environment fog (exponential + aerial perspective from the sky).
shader_type spatial;
render_mode cull_back;

uniform sampler2D rock_detail : source_color, filter_linear_mipmap, repeat_enable;
uniform float detail_scale = 0.012;
uniform float detail_strength = 0.35;
uniform float detail_distance = 3500.0;
global uniform float env_wetness;

varying vec3 wpos;
varying vec3 wnrm;

void vertex() {
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	wnrm = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
}

void fragment() {
	vec3 c = COLOR.rgb;
	float d = length(wpos - CAMERA_POSITION_WORLD);
	float k = (1.0 - smoothstep(detail_distance * 0.5, detail_distance, d)) * detail_strength;
	if (k > 0.001) {
		vec3 bw = pow(abs(wnrm), vec3(4.0));
		bw /= bw.x + bw.y + bw.z;
		vec3 t = texture(rock_detail, wpos.zy * detail_scale).rgb * bw.x
			+ texture(rock_detail, wpos.xz * detail_scale).rgb * bw.y
			+ texture(rock_detail, wpos.xy * detail_scale).rgb * bw.z;
		c *= mix(vec3(1.0), t * 2.0, k);
	}
	ALBEDO = c * mix(1.0, 0.8, env_wetness);
	ROUGHNESS = 0.95;
	SPECULAR = 0.2;
}
