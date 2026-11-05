// Choreography of the robo-cheetah "lightning pounce" attack.
// [time, value] keys with monotone cubic interpolation; springs in the rig add follow-through.

export const SEQ_DURATION = 7.6;

export const T = {
  alert: 0.9,      // 1. ears up, locks onto the target
  stalk: 1.3,      // 2. low stalking crouch, growl
  charge: 1.7,     //    electric charge runs over the legs, spots light up, butt wiggle
  pounce: 2.62,    // 3. lightning pounce forward (afterimages)
  land: 2.92,
  slash1: 3.08,    // 4. two energy claw slashes
  slash2: 3.44,
  dashBack: 4.3,   // 5. dashes back to its spot
  home: 4.62,
  roar: 4.95,      // 6. roar
  rest: 7.6,       // 7. back to idle
};

const TRACKS = {
  // whole-body offset in cheetah space (pounce forward and back)
  rootX: [[0, 0], [2.55, -6], [2.62, -8], [2.92, 66], [3.5, 69], [4.3, 66], [4.62, 0], [4.8, -3], [5.0, 0]],
  rootY: [[0, 0], [2.62, 0], [2.76, -46], [2.92, 0], [3.0, 3], [3.15, 0], [4.3, 0], [4.46, -16], [4.62, 0]],
  // body stretch in the air (front legs reach forward, hind legs back)
  ext: [[0, 0], [2.6, 0], [2.7, 1], [2.86, 0.8], [2.95, 0], [4.32, 0], [4.42, 0.6], [4.6, 0]],
  crouch: [[0, 0], [1.2, 0], [1.6, 1], [2.55, 1.1], [2.65, 0.2], [2.95, 0.55], [3.2, 0.35], [4.2, 0.3], [4.7, 0.45], [5.0, 0.1], [7.6, 0]],
  wiggle: [[0, 0], [1.9, 0], [2.05, 1], [2.5, 1], [2.6, 0]],
  // head pitch (+ = down)
  head: [[0, 0], [0.9, 0], [1.1, -6], [1.6, 12], [2.55, 14], [2.75, -4], [3.08, 10], [3.44, 12], [4.2, 4], [4.95, -14], [5.6, -12], [6.1, 0], [7.6, 0]],
  ears: [[0, 0], [0.9, 0], [1.05, 1], [1.5, -0.6], [4.8, -0.6], [5.0, -1], [5.7, -1], [6.3, 0.6], [7.0, 0]],
  angry: [[0, 0], [1.1, 0], [1.6, 1], [5.8, 1], [6.5, 0]],
  charge: [[0, 0], [1.7, 0], [2.55, 1], [3.6, 1], [4.4, 0.6], [5.2, 0]],
  // front paw strikes: 0 planted, 1 raised forward, 0 slammed down (slash)
  paw1: [[0, 0], [2.92, 0], [2.98, 1], [3.08, 0], [3.3, 0]],
  paw2: [[0, 0], [3.26, 0], [3.34, 1], [3.44, 0], [3.7, 0]],
  jaw: [[0, 0], [1.4, 0], [1.6, 0.25], [2.5, 0.2], [2.7, 0.55], [2.95, 0.15], [3.08, 0.5], [3.2, 0.1], [3.44, 0.5], [3.6, 0.1],
    [4.95, 0.05], [5.15, 1], [5.6, 0.9], [5.85, 0], [7.6, 0]],
  tail: [[0, 0], [0.9, 0], [1.3, 0.6], [2.6, 0.8], [2.8, -0.6], [3.6, 0.2], [4.5, -0.5], [5.0, 1], [5.8, 0.7], [7.0, 0]],
  shake: [[0, 0], [1.6, 0], [1.9, 0.2], [2.55, 0.35], [2.62, 0], [5.1, 0], [5.2, 0.7], [5.6, 0.6], [5.75, 0]],
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
