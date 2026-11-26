/**
 * Particle smoke for the Technik's smoke grenade: soft camera-facing puffs that billow out of the
 * canister, grow, drift, rise and fade. One instanced draw call for every cloud on the map.
 * The puff texture is generated on a canvas (no image files, works in the artifact sandbox).
 */
import * as THREE from 'three';

const MAX = 160;

function puffTexture(): THREE.CanvasTexture {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  // overlapping soft blobs give a lumpy cauliflower edge instead of a perfect disc
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 26; i++) {
    const a = rnd() * Math.PI * 2, d = rnd() * S * 0.2;
    const x = S / 2 + Math.cos(a) * d, y = S / 2 + Math.sin(a) * d * 0.9;
    const r = S * (0.16 + rnd() * 0.15);
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    // lit from the top-left: lighter centre offset, darker rim
    const l = 0.78 + 0.22 * (1 - (y / S));
    const v = Math.round(255 * l);
    grd.addColorStop(0, `rgba(${v},${v},${v},0.55)`);
    grd.addColorStop(0.6, `rgba(${v - 20},${v - 20},${v - 18},0.25)`);
    grd.addColorStop(1, `rgba(${v - 40},${v - 40},${v - 36},0)`);
    g.fillStyle = grd;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  // round off: everything fades to 0 well before the square's edge
  g.globalCompositeOperation = 'destination-in';
  const m = g.createRadialGradient(S / 2, S / 2, S * 0.18, S / 2, S / 2, S / 2);
  m.addColorStop(0, 'rgba(0,0,0,1)');
  m.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = m;
  g.fillRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface P { x: number; y: number; z: number; vx: number; vy: number; vz: number; born: number; life: number; s0: number; s1: number; rot: number; vr: number; shade: number; peak: number }
interface Emitter { x: number; z: number; r: number; until: number; next: number; born: number }

export class SmokeSystem {
  readonly mesh: THREE.Mesh;
  private ps: P[] = [];
  private emitters: Emitter[] = [];
  private iPos: THREE.InstancedBufferAttribute;
  private iData: THREE.InstancedBufferAttribute;   // size, rotation, alpha, shade
  private geo: THREE.InstancedBufferGeometry;
  private mat: THREE.ShaderMaterial;
  private tex: THREE.CanvasTexture;
  private order: number[] = [];

  constructor() {
    this.tex = puffTexture();
    const quad = new THREE.PlaneGeometry(1, 1);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = quad.index;
    this.geo.setAttribute('position', quad.getAttribute('position'));
    this.geo.setAttribute('uv', quad.getAttribute('uv'));
    this.iPos = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.iData = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('iPos', this.iPos);
    this.geo.setAttribute('iData', this.iData);
    this.geo.instanceCount = 0;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: this.tex } },
      vertexShader: /* glsl */ `
        attribute vec3 iPos; attribute vec4 iData;
        varying vec2 vUv; varying float vA; varying float vShade;
        void main() {
          vUv = uv; vA = iData.z; vShade = iData.w;
          float c = cos(iData.y), s = sin(iData.y);
          vec2 q = mat2(c, s, -s, c) * position.xy * iData.x;
          vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
          mv.xy += q;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D map; varying vec2 vUv; varying float vA; varying float vShade;
        void main() {
          vec4 t = texture2D(map, vUv);
          vec3 col = t.rgb * mix(vec3(0.62, 0.61, 0.64), vec3(1.0, 0.99, 0.97), vShade);
          gl_FragColor = vec4(col, t.a * vA);
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
  }

  /** A canister lands at (x, z): a burst fills radius r at once, then it keeps puffing until `until`. */
  emit(x: number, z: number, r: number, now: number, until: number): void {
    this.emitters.push({ x, z, r, until, next: now, born: now });
    for (let i = 0; i < 26; i++) this.spawn(x, z, r, now, true);
  }

  private spawn(x: number, z: number, r: number, now: number, burst: boolean): void {
    if (this.ps.length >= MAX) this.ps.shift();
    const a = Math.random() * Math.PI * 2;
    // burst puffs fly out to fill the circle; later puffs start at the canister and drift outwards
    const reach = burst ? r * (0.25 + 0.75 * Math.sqrt(Math.random())) : r * 0.5 * Math.random();
    const life = burst ? 2.2 + Math.random() * 1.6 : 2.4 + Math.random() * 1.2;
    const sp = reach * 2.6;   // with the drag below the puff coasts ~reach metres
    const s1 = 1.3 + Math.random() * 0.9;
    this.ps.push({
      x: x + Math.cos(a) * 0.15, y: 0.35, z: z + Math.sin(a) * 0.15,
      vx: Math.cos(a) * sp, vy: 0.25 + Math.random() * 0.35, vz: Math.sin(a) * sp,
      born: now, life, s0: 0.35, s1, rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.6,
      shade: 0.55 + Math.random() * 0.45, peak: 0.75 + Math.random() * 0.25,
    });
  }

  update(dt: number, now: number, camera: THREE.Object3D): void {
    // emitters keep the cloud full while the grenade lasts
    this.emitters = this.emitters.filter((e) => {
      if (now >= e.until) return false;
      while (now >= e.next) { this.spawn(e.x, e.z, e.r, now, false); e.next += 0.09; }
      return true;
    });
    const drag = Math.exp(-dt * 2.6);
    this.ps = this.ps.filter((p) => now - p.born < p.life);
    for (const p of this.ps) {
      p.x += p.vx * dt; p.z += p.vz * dt; p.y += p.vy * dt;
      p.vx *= drag; p.vz *= drag; p.vy *= Math.exp(-dt * 0.8);
      p.rot += p.vr * dt;
    }
    // back-to-front so the soft edges blend correctly
    const cp = camera.position;
    const d = this.ps.map((p) => (p.x - cp.x) ** 2 + (p.y - cp.y) ** 2 + (p.z - cp.z) ** 2);
    this.order = this.ps.map((_, i) => i).sort((a, b) => d[b] - d[a]);
    const pos = this.iPos.array as Float32Array, dat = this.iData.array as Float32Array;
    this.order.forEach((idx, i) => {
      const p = this.ps[idx];
      const k = (now - p.born) / p.life;
      const size = p.s0 + (p.s1 - p.s0) * (1 - (1 - Math.min(1, k * 1.6)) ** 3);
      const alpha = p.peak * Math.min(1, k / 0.12) * (1 - Math.max(0, (k - 0.55) / 0.45)) ** 1.5;
      // keep the bottom of each billboard above the asphalt (no hard cut line)
      pos[i * 3] = p.x; pos[i * 3 + 1] = Math.max(p.y, size * 0.42); pos[i * 3 + 2] = p.z;
      dat[i * 4] = size; dat[i * 4 + 1] = p.rot; dat[i * 4 + 2] = alpha; dat[i * 4 + 3] = p.shade;
    });
    this.geo.instanceCount = this.ps.length;
    this.iPos.needsUpdate = true;
    this.iData.needsUpdate = true;
  }

  clear(): void { this.ps = []; this.emitters = []; this.geo.instanceCount = 0; }

  dispose(): void {
    this.mesh.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
    this.tex.dispose();
  }
}
