/**
 * Animated part of the ocean, as a GLSL function composed into the terrain
 * fragment shader (land and sea are shaded in one pass so the waterline stays
 * crisp and the whole terrain costs one draw call per chunk).
 *
 * Inputs
 *   base   baked depth colour (see oceanPalette.ts)
 *   depth  distance from the waterline in world units (valid near the shore)
 *   world  world position (wu)
 *   t      time in seconds, wrapped at 1000 s (all rates below loop cleanly)
 *   px     world units covered by one device pixel
 *   fresh  0 = sea, 1 = river or lake well inside the continent: calm water,
 *          no surf
 */
export const OCEAN_GLSL = /* glsl */ `
vec3 shadeOcean(vec3 base, float depth, vec2 world, float t, float px, sampler2D noiseTex, float fresh) {
  // ripples are slightly stretched east-west, like wind-driven waves
  vec2 wuv = world * vec2(1.0 / 300.0, 1.0 / 170.0);
  float r1 = texture(noiseTex, wuv + t * vec2(0.011, 0.006)).r;
  float r2 = texture(noiseTex, wuv * 1.9 + t * vec2(-0.009, 0.012)).b;
  float ripple = r1 + r2 - 1.0;
  // far away the ripples would only show the texture repeating: fade them
  // out and let a broad, slow swell carry the variation instead
  float near = 1.0 - smoothstep(1.2, 5.0, px);
  float swell = texture(noiseTex, world * (1.0 / 2900.0) + t * vec2(0.002, 0.001)).g - 0.5;

  float calm = 1.0 - 0.45 * fresh;
  vec3 col = base * (1.0 + ripple * 0.11 * near * calm + swell * 0.10 * (1.0 - fresh));
  col += vec3(0.75, 0.95, 1.0) * smoothstep(0.08, 0.55, ripple) * 0.035 * near;

  // bright rim hugging the coast; about 1.5 px wide when zoomed far out
  float rimWidth = max(1.3, 1.6 * px);
  float rim = 1.0 - smoothstep(0.0, rimWidth, depth);
  float rimStrength = mix(0.88, 0.5, smoothstep(1.0, 7.0, px)) * (1.0 - 0.72 * fresh);

  // foam lines rolling towards the beach (close-up only)
  float bandsVisible = 1.0 - smoothstep(0.7, 1.9, px);
  float phase = depth * 0.4 + 6.2831853 * (t * 0.13) + (r1 - 0.5) * 5.5;
  float bands = smoothstep(0.8, 0.98, sin(phase));
  bands *= (1.0 - smoothstep(3.0, 21.0, depth)) * smoothstep(0.38, 0.62, r2 + 0.12) * (1.0 - fresh);

  float foam = clamp(rim * rimStrength + bands * 0.62 * bandsVisible, 0.0, 1.0);
  return mix(col, vec3(0.97, 0.99, 1.0), foam);
}
`;
