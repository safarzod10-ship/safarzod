export const COURTYARD = { halfX: 10.5, halfZ: 9.25, chamfer: 1.8 } as const;

export interface Collider { x: [number, number]; z: [number, number]; h: number }

export function insideCourtyard(x: number, z: number, margin = 0): boolean {
  const { halfX, halfZ, chamfer } = COURTYARD;
  const ax = Math.abs(x), az = Math.abs(z);
  if (ax > halfX - margin || az > halfZ - margin) return false;
  return ax + az <= halfX + halfZ - chamfer - margin * Math.SQRT2;
}

export function hitsCollider(colliders: Collider[], x: number, z: number, radius = 0.35): boolean {
  return colliders.some((c) => x > c.x[0] - radius && x < c.x[1] + radius && z > c.z[0] - radius && z < c.z[1] + radius);
}
