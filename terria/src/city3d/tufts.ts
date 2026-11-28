/**
 * Grass tufts and little flowers scattered over the meadow, swaying in the
 * wind. One InstancedMesh each (two crossed quads per tuft), textures painted
 * on a canvas at start-up. Density follows the same patches as the ground.
 */
import {
  CanvasTexture,
  Color,
  DoubleSide,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  Vector3,
  BufferGeometry,
  type IUniform,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

function bladeTexture(): CanvasTexture {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const r = rng(7);
  for (let i = 0; i < 22; i++) {
    const x0 = S * (0.2 + r() * 0.6);
    const h = S * (0.45 + r() * 0.5);
    const lean = (r() - 0.5) * S * 0.45;
    const w = S * (0.035 + r() * 0.03);
    const grad = g.createLinearGradient(0, S, 0, S - h);
    const l = 0.75 + r() * 0.35;
    grad.addColorStop(0, `rgb(${62 * l | 0},${120 * l | 0},${30 * l | 0})`);
    grad.addColorStop(0.5, `rgb(${110 * l | 0},${178 * l | 0},${50 * l | 0})`);
    grad.addColorStop(1, `rgb(${196 * l | 0},${232 * l | 0},${110 * l | 0})`);
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(x0 - w, S);
    g.quadraticCurveTo(x0 - w * 0.6 + lean * 0.4, S - h * 0.55, x0 + lean, S - h);
    g.quadraticCurveTo(x0 + w * 0.6 + lean * 0.4, S - h * 0.55, x0 + w, S);
    g.closePath();
    g.fill();
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function flowerTexture(): CanvasTexture {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const r = rng(11);
  // a few stems with small blossoms on top
  for (let i = 0; i < 5; i++) {
    const x = S * (0.25 + r() * 0.5);
    const top = S * (0.25 + r() * 0.35);
    g.strokeStyle = '#3f7d22';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(x, S);
    g.quadraticCurveTo(x + (r() - 0.5) * 20, (S + top) / 2, x + (r() - 0.5) * 10, top);
    g.stroke();
    g.fillStyle = '#ffffff';
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      g.beginPath();
      g.ellipse(x + Math.cos(a) * 7, top + Math.sin(a) * 7, 6, 4, a, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#f5c518';
    g.beginPath();
    g.arc(x, top, 4.5, 0, Math.PI * 2);
    g.fill();
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** Two crossed vertical quads, origin at the bottom centre. */
function crossGeometry(w: number, h: number): BufferGeometry {
  const a = new PlaneGeometry(w, h, 1, 2);
  a.translate(0, h / 2, 0);
  const b = a.clone();
  b.rotateY(Math.PI / 2);
  const g = mergeGeometries([a, b])!;
  // lit like the ground under them, not like a vertical wall
  const n = g.getAttribute('normal');
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  return g;
}

export interface Tufts {
  meshes: InstancedMesh[];
  uniforms: { uTime: IUniform<number> };
  /** Hide the tufts inside rectangles (tiles) — under buildings. */
  clear(rects: { x: number; z: number; w: number; d: number }[]): void;
}

export function createTufts(opts: {
  area: number;
  count: number;
  flowers: number;
  density: (x: number, z: number) => number;
  seed?: number;
}): Tufts {
  const uniforms = { uTime: { value: 0 } as IUniform<number> };
  const make = (tex: CanvasTexture, geo: BufferGeometry, n: number, seed: number, tint: (r: () => number) => Color) => {
    const mat = new MeshLambertMaterial({ map: tex, alphaTest: 0.5, side: DoubleSide, alphaToCoverage: true });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = uniforms.uTime;
      // both sides of a blade are lit from above (no back-face normal flip)
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_begin>',
        '#include <normal_fragment_begin>\n  normal = normalize( vNormal );',
      );
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
#ifdef USE_INSTANCING
  vec3 ip = vec3(instanceMatrix[3].x, 0., instanceMatrix[3].z);
#else
  vec3 ip = vec3(0.);
#endif
  float bend = uv.y * uv.y;
  float gust = sin(uTime * 1.7 + ip.x * .35 + ip.z * .22) * .6 + sin(uTime * 3.1 + ip.x * 1.3) * .25;
  transformed.x += bend * gust * .09;
  transformed.z += bend * gust * .05;`,
        );
    };
    mat.customProgramCacheKey = () => 'terria-tuft-v2';
    const mesh = new InstancedMesh(geo, mat, n);
    const r = rng(seed);
    const m = new Matrix4();
    const q = new Quaternion();
    const up = new Vector3(0, 1, 0);
    let k = 0;
    const pos: number[] = [];
    for (let tries = 0; k < n && tries < n * 30; tries++) {
      const x = (r() - 0.5) * opts.area;
      const z = (r() - 0.5) * opts.area;
      if (r() > opts.density(x, z)) continue;
      const s = 0.6 + r() * 0.8;
      q.setFromAxisAngle(up, r() * Math.PI);
      m.compose(new Vector3(x, 0, z), q, new Vector3(s, s * (0.8 + r() * 0.5), s));
      mesh.setMatrixAt(k, m);
      mesh.setColorAt(k, tint(r));
      pos.push(x, z);
      k++;
    }
    mesh.count = k;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.frustumCulled = false;
    mesh.userData.pos = pos;
    mesh.userData.full = k;
    return mesh;
  };
  const grass = make(bladeTexture(), crossGeometry(0.2, 0.17), opts.count, opts.seed ?? 3, (r) =>
    new Color().setHSL(0.23 + r() * 0.05, 0.5 + r() * 0.2, 0.62 + r() * 0.14),
  );
  const flowers = make(flowerTexture(), crossGeometry(0.22, 0.22), opts.flowers, (opts.seed ?? 3) + 9, (r) =>
    r() < 0.7 ? new Color(1, 1, 1) : new Color().setHSL(0.13 + r() * 0.05, 0.9, 0.7),
  );
  const meshes = [grass, flowers];
  return {
    meshes,
    uniforms,
    clear(rects) {
      const hidden = new Matrix4().makeScale(0, 0, 0);
      const m = new Matrix4();
      for (const mesh of meshes) {
        const pos = mesh.userData.pos as number[];
        for (let i = 0; i < mesh.count; i++) {
          const x = pos[i * 2];
          const z = pos[i * 2 + 1];
          const inside = rects.some((rc) => x > rc.x - 0.15 && x < rc.x + rc.w + 0.15 && z > rc.z - 0.15 && z < rc.z + rc.d + 0.15);
          mesh.getMatrixAt(i, m);
          if (inside && m.elements[0] !== 0) mesh.setMatrixAt(i, hidden);
        }
        mesh.instanceMatrix.needsUpdate = true;
      }
    },
  };
}
