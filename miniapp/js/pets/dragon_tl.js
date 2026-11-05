// Choreography of the roar + fire-breath sequence.
// Every track is a list of [time, value] keys, interpolated with a monotone
// cubic (smooth velocity, no overshoot). Springs in the rig add follow-through.

export const SEQ_DURATION = 8.0; // seconds

// Phase markers (shared by animation, FX and sound so everything stays in sync)
export const T = {
  calmEnd: 0.9,       // 1. calm breathing
  tiltBack: 1.0,      // 2. head goes back
  wingsUp: 1.35,      // 3. wings rise, body tenses
  jawOpen: 2.2,       // 4. mouth opens wide
  roarStart: 2.4,     // 5. roar
  roarEnd: 3.85,      // 6. (vibration during roar)
  inhale: 3.95,       // 7. preparing the fire: inhale, throat glow
  fireStart: 4.55,    //    fire!
  fireEnd: 6.35,
  smokeEnd: 7.3,
  rest: 8.0,          //    back to idle
};

const TRACKS = {
  // degrees, negative = head tilts up/back
  head: [[0, 0], [1.0, 0], [1.75, -24], [2.25, -30], [2.55, -6], [3.2, -3], [3.85, -5], [4.3, -38], [4.62, -50], [5.3, -54], [6.0, -60], [6.35, -56], [6.9, -28], [8.0, 0]],
  // neck reach: -1 pulled back, +1 thrust forward
  reach: [[0, 0], [1.0, 0], [1.75, -0.9], [2.25, -1], [2.55, 0.8], [3.85, 0.7], [4.3, -0.9], [4.62, 0.35], [6.35, 0.2], [6.9, 0.1], [8.0, 0]],
  jaw: [[0, 0], [2.05, 0.04], [2.45, 1], [3.8, 0.92], [4.1, 0.22], [4.45, 0.3], [4.6, 0.72], [6.35, 0.66], [6.65, 0.3], [7.2, 0.12], [7.7, 0]],
  wings: [[0, 0], [1.3, 0], [2.3, 1], [3.9, 0.92], [4.4, 1], [6.4, 0.95], [7.95, 0]],
  tense: [[0, 0], [1.2, 0], [2.2, 1], [3.9, 1], [4.45, 1.1], [6.4, 0.75], [7.9, 0]],
  tail: [[0, 0], [1.3, 0], [2.4, 1], [6.4, 0.85], [7.95, 0]],
  shake: [[0, 0], [2.42, 0], [2.6, 1], [3.7, 1], [3.9, 0], [4.6, 0], [4.75, 0.28], [6.2, 0.28], [6.4, 0]],
  fire: [[0, 0], [4.5, 0], [4.62, 1], [6.2, 1], [6.38, 0]],
  inhale: [[0, 0], [3.9, 0], [4.42, 1], [4.6, 0]],
  glow: [[0, 0], [4.0, 0], [4.45, 1], [6.3, 1], [6.9, 0]],
  angry: [[0, 0], [1.1, 0], [2.0, 1], [6.5, 1], [7.7, 0]],
  smoke: [[0, 0], [6.25, 0], [6.4, 1], [7.0, 0.6], [7.4, 0]],
};

function monotone(keys, t) {
  const n = keys.length;
  if (t <= keys[0][0]) return keys[0][1];
  if (t >= keys[n - 1][0]) return keys[n - 1][1];
  let i = 0;
  while (t > keys[i + 1][0]) i++;
  const [x0, y0] = keys[i], [x1, y1] = keys[i + 1];
  const h = x1 - x0;
  const slope = (a, b) => (keys[b][1] - keys[a][1]) / (keys[b][0] - keys[a][0]);
  const d = slope(i, i + 1);
  const tangent = (k) => {
    if (k === 0 || k === n - 1) return 0;
    const s0 = slope(k - 1, k), s1 = slope(k, k + 1);
    if (s0 * s1 <= 0) return 0;
    return (2 * s0 * s1) / (s0 + s1); // harmonic mean -> monotone
  };
  let m0 = tangent(i), m1 = tangent(i + 1);
  if (d === 0) { m0 = 0; m1 = 0; }
  const u = (t - x0) / h, u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * y0 + (u3 - 2 * u2 + u) * h * m0 + (-2 * u3 + 3 * u2) * y1 + (u3 - u2) * h * m1;
}

/** Sequence pose at time s (seconds since start), or the rest pose if null. */
export function samplePose(s) {
  const p = {};
  for (const k in TRACKS) p[k] = s == null ? TRACKS[k][0][1] : monotone(TRACKS[k], s);
  return p;
}
