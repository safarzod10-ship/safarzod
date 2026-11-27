/** Messages exchanged with the world worker. */
import type { WorldFieldsRaw } from './WorldFields.ts';
import type { WorldParams } from './WorldParams.ts';

export type WorkerRequest =
  | { type: 'init'; params: WorldParams }
  | { type: 'bake'; id: number; level: number; cx: number; cy: number };

export type WorkerResponse =
  | { type: 'progress'; value: number }
  | { type: 'ready'; raw: WorldFieldsRaw }
  | { type: 'baked'; id: number; pixels: Uint8Array; ms: number }
  | { type: 'error'; message: string };
