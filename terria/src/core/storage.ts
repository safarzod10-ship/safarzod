/**
 * Persistence of the world parameters (and, for convenience, the camera).
 *
 * The world is fully described by WorldParams: storing that small object is
 * what guarantees "the map never changes between launches". When the game
 * gets a backend, the server becomes the source of truth for these params and
 * this module only caches them.
 */
import { DEFAULT_WORLD_PARAMS, normalizeWorldParams, type WorldParams } from '../world/generation/WorldParams.ts';
import { seedFromString } from './rng.ts';

const WORLD_KEY = 'vcm.world.v2';
const CAMERA_KEY = 'vcm.camera.v2';

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null; // private mode, blocked storage, corrupted value
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: the defaults still give the same world */
  }
}

export function loadWorldParams(): WorldParams {
  return normalizeWorldParams(read<Partial<WorldParams>>(WORLD_KEY));
}

export function saveWorldParams(params: WorldParams): void {
  write(WORLD_KEY, params);
}

/**
 * World used for this launch:
 *  - `?seed=<number|text>` in the URL previews another world without saving;
 *  - otherwise the stored params, or the canonical default on first launch.
 */
export function resolveWorldParams(search: string = location.search): { params: WorldParams; preview: boolean } {
  const query = new URLSearchParams(search);
  const seedText = query.get('seed');
  if (seedText) {
    return { params: { ...DEFAULT_WORLD_PARAMS, seed: seedFromString(seedText) }, preview: true };
  }
  const params = loadWorldParams();
  saveWorldParams(params);
  return { params, preview: false };
}

export interface CameraState {
  seed: number;
  x: number;
  y: number;
  scale: number;
}

export function loadCameraState(seed: number): CameraState | null {
  const s = read<CameraState>(CAMERA_KEY);
  if (!s || s.seed !== seed) return null;
  if (![s.x, s.y, s.scale].every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
  return s;
}

export function saveCameraState(state: CameraState): void {
  write(CAMERA_KEY, state);
}
