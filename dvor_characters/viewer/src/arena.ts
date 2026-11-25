/**
 * DVOR arena map ("ДВОР" courtyard): loading + the data the game needs about it.
 * The map is static and unlit (light is baked into its atlas), 2 draw calls, ~900 triangles.
 *
 * Coordinates: metres, +Y up, +X east, +Z south; the game camera looks north (-Z) at the
 * "ДВОР" wall. Walkable courtyard = rectangle below minus the 45° cut corners, minus COLLIDERS.
 */
import * as THREE from 'three';
import type { CharacterLibrary } from './characters';

export const ARENA_ID = 'MAP_Dvor';
export const COURTYARD = { halfX: 10.5, halfZ: 9.25, chamfer: 1.8 } as const;

export interface Collider { x: [number, number]; z: [number, number]; h: number }

export interface Arena {
  root: THREE.Group;
  colliders: Collider[];
  bytes: number;
  loadMs: number;
  usedKtx2: boolean;
}

export async function loadArena(lib: CharacterLibrary, baseUrl: string): Promise<Arena> {
  const [{ gltf, bytes, loadMs, usedKtx2 }, colliders] = await Promise.all([
    lib.loadStatic(ARENA_ID),
    fetch(`${baseUrl}${ARENA_ID}.colliders.json`).then((r) => (r.ok ? r.json() : [])).catch(() => []),
  ]);
  const root = gltf.scene;
  root.traverse((o) => {
    o.matrixAutoUpdate = false;
    o.updateMatrix();
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mat = m.material as THREE.MeshBasicMaterial;
    if (mat.map) mat.map.anisotropy = 4;       // floor is seen at a grazing angle
  });
  root.updateMatrixWorld(true);
  return { root, colliders, bytes, loadMs, usedKtx2 };
}

/** True when (x, z) is on the courtyard floor (inside the fence), `margin` metres from it. */
export function insideCourtyard(x: number, z: number, margin = 0): boolean {
  const { halfX, halfZ, chamfer } = COURTYARD;
  const ax = Math.abs(x), az = Math.abs(z);
  if (ax > halfX - margin || az > halfZ - margin) return false;
  // cut corner: line through (halfX - chamfer, halfZ) and (halfX, halfZ - chamfer)
  return ax + az <= halfX + halfZ - chamfer - margin * Math.SQRT2;
}

/** True when a circle of `radius` at (x, z) overlaps a prop footprint. */
export function hitsCollider(colliders: Collider[], x: number, z: number, radius = 0.35): boolean {
  return colliders.some((c) => x > c.x[0] - radius && x < c.x[1] + radius && z > c.z[0] - radius && z < c.z[1] + radius);
}
