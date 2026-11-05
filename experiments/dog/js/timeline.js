// Choreography of the robo-dog "eye laser" attack.
// Tracks are [time, value] keys with monotone cubic interpolation (smooth, no overshoot);
// springs in the rig add follow-through on top.

export const SEQ_DURATION = 8.0;

// Phase markers shared by animation, FX and sound
export const T = {
  notice: 1.0,      // 1. ears perk up, curious head tilt
  growl: 1.6,       // 2. crouch, snarl, growl
  bark1: 2.45,      // 3. two barks
  bark2: 2.85,
  charge: 3.05,     // 4. eyes charge up (ears flatten, back lights fill)
  laserOn: 3.85,    // 5. twin eye lasers, sweeping
  laserOff: 5.85,
  shake: 6.05,      // 6. cool-down steam + wet-dog shake
  rest: 8.0,        // 7. back to happy idle
};

const TRACKS = {
  // head pitch, degrees (+ = looks down)
  head: [[0, 0], [1.0, 0], [1.6, -4], [2.3, 7], [2.45, -6], [2.6, 6], [2.85, -6], [3.0, 6], [3.8, 4],
    [4.0, 12], [4.6, 40], [5.1, 24], [5.6, 46], [5.85, 40], [6.3, 2], [8.0, 0]],
  // curious head tilt (roll), degrees
  tilt: [[0, 0], [1.0, 0], [1.3, -13], [1.55, -11], [1.85, 0], [6.6, 0], [6.95, 9], [7.3, 0]],
  ears: [[0, 0], [1.0, 0], [1.25, 1], [2.9, 0.8], [3.2, -1], [5.9, -1], [6.4, 0.3], [7.2, 1], [8.0, 0]],
  crouch: [[0, 0], [1.6, 0], [2.3, 1], [3.6, 1.1], [3.85, 0.85], [5.85, 0.9], [6.4, 0], [8.0, 0]],
  jaw: [[0, 0], [1.7, 0], [2.0, 0.18], [2.4, 0.15], [2.48, 0.95], [2.62, 0.1], [2.88, 0.95], [3.02, 0.12],
    [3.4, 0.08], [5.85, 0.1], [6.2, 0], [7.25, 0], [7.4, 0.35], [7.6, 0]],
  angry: [[0, 0], [1.5, 0], [2.1, 1], [5.9, 1], [6.6, 0]],
  wag: [[0, 1], [1.0, 1], [1.3, 0.25], [6.4, 0.2], [6.9, 1.6], [8.0, 1]],
  charge: [[0, 0], [3.05, 0], [3.85, 1], [5.85, 1], [6.3, 0]],
  laser: [[0, 0], [3.8, 0], [3.9, 1], [5.8, 1], [5.9, 0]],
  shake: [[0, 0], [1.6, 0], [2.0, 0.15], [3.05, 0.15], [3.8, 0.45], [3.9, 0.3], [5.85, 0.3], [5.95, 0]],
  wiggle: [[0, 0], [6.0, 0], [6.15, 1], [6.6, 1], [6.8, 0]],
  steam: [[0, 0], [5.85, 0], [5.95, 1], [6.8, 0.5], [7.3, 0]],
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
    return (2 * s0 * s1) / (s0 + s1);
  };
  let m0 = tangent(i), m1 = tangent(i + 1);
  if (d === 0) { m0 = 0; m1 = 0; }
  const u = (t - x0) / h, u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * y0 + (u3 - 2 * u2 + u) * h * m0 + (-2 * u3 + 3 * u2) * y1 + (u3 - u2) * h * m1;
}

export function samplePose(s) {
  const p = {};
  for (const k in TRACKS) p[k] = s == null ? TRACKS[k][0][1] : monotone(TRACKS[k], s);
  return p;
}
