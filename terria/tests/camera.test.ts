import { describe, expect, it } from 'vitest';
import { clampCenter, computeZoomLimits } from '../src/camera/constraints.ts';
import { cellToWorld, chunkKey, snapToGrid, worldToCell, worldToChunk } from '../src/core/coords.ts';
import { hash2, mulberry32, seedFromString, subSeed } from '../src/core/rng.ts';
import { TerrainLayer } from '../src/world/terrain/TerrainLayer.ts';

const bounds = { x: 20000, y: 10000, width: 77000, height: 94000 };

describe('camera constraints', () => {
  it('minimum zoom fits the whole camera area on any screen shape', () => {
    for (const [w, h] of [
      [360, 800],
      [390, 844],
      [844, 390],
      [1920, 1080],
      [1024, 1366],
    ]) {
      const { minScale, maxScale } = computeZoomLimits(w, h, bounds, 1.6);
      expect(bounds.width * minScale).toBeLessThanOrEqual(w + 1e-6);
      expect(bounds.height * minScale).toBeLessThanOrEqual(h + 1e-6);
      // ...and is tight on one axis
      expect(Math.max((bounds.width * minScale) / w, (bounds.height * minScale) / h)).toBeCloseTo(1, 6);
      expect(maxScale).toBe(1.6);
    }
  });

  it('never lets the view leave the bounds when zoomed in', () => {
    const scale = 0.5;
    const w = 400;
    const h = 800;
    for (const [x, y] of [
      [-1e6, -1e6],
      [1e6, 1e6],
      [0, 200000],
      [60000, 60000],
    ]) {
      const p = clampCenter(x, y, scale, w, h, bounds);
      expect(p.x - w / scale / 2).toBeGreaterThanOrEqual(bounds.x - 1e-6);
      expect(p.x + w / scale / 2).toBeLessThanOrEqual(bounds.x + bounds.width + 1e-6);
      expect(p.y - h / scale / 2).toBeGreaterThanOrEqual(bounds.y - 1e-6);
      expect(p.y + h / scale / 2).toBeLessThanOrEqual(bounds.y + bounds.height + 1e-6);
    }
  });

  it('centres an axis on which the view is larger than the bounds', () => {
    const { minScale } = computeZoomLimits(390, 844, bounds, 1.6);
    const p = clampCenter(0, 0, minScale, 390, 844, bounds);
    expect(p.x).toBeCloseTo(bounds.x + bounds.width / 2, 6);
    expect(p.y).toBeCloseTo(bounds.y + bounds.height / 2, 6);
  });
});

describe('coordinates', () => {
  it('round-trips cells', () => {
    const c = worldToCell(1000, 2047.9);
    expect(c).toEqual({ cx: 62, cy: 127 });
    expect(cellToWorld(c.cx, c.cy)).toEqual({ x: 1000, y: 2040 });
    expect(snapToGrid(1007, 2040.1)).toEqual({ x: 1008, y: 2048 });
  });

  it('maps positions to chunks per LOD', () => {
    expect(worldToChunk(40000, 70000, 0)).toEqual({ cx: 1, cy: 2 });
    expect(worldToChunk(5000, 9000, 6)).toEqual({ cx: 9, cy: 17 });
    expect(chunkKey(1, 2, 3)).not.toBe(chunkKey(2, 2, 3));
    expect(chunkKey(1, 2, 3)).not.toBe(chunkKey(1, 3, 2));
  });

  it('picks finer terrain as the camera zooms in', () => {
    expect(TerrainLayer.levelFor(0.01)).toBe(0);
    expect(TerrainLayer.levelFor(0.04)).toBe(1);
    expect(TerrainLayer.levelFor(0.3)).toBe(4);
    expect(TerrainLayer.levelFor(3)).toBe(6);
  });
});

describe('rng', () => {
  it('is repeatable and seed dependent', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const c = mulberry32(43);
    const seqA = [a(), a(), a()];
    expect([b(), b(), b()]).toEqual(seqA);
    expect([c(), c(), c()]).not.toEqual(seqA);
    expect(seqA.every((v) => v >= 0 && v < 1)).toBe(true);
    expect(hash2(3, 4, 5)).toBe(hash2(3, 4, 5));
    expect(hash2(3, 4, 5)).not.toBe(hash2(4, 3, 5));
    expect(subSeed(1, 'a')).not.toBe(subSeed(1, 'b'));
    expect(seedFromString('123')).toBe(123);
    expect(seedFromString('atlantis')).toBe(seedFromString('atlantis'));
  });
});
