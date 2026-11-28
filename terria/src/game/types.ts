/**
 * Game state and the client <-> server contract. Shared, pure types.
 */
import type { BuildingType, Good, Res } from './config.ts';

export type Stock = Record<Res, number>;

export interface Building {
  id: number;
  t: BuildingType;
  /** Top-left cell in WORLD cell coordinates (world metres / 16). */
  x: number;
  y: number;
  /** Completed level; 0 while the first construction is running. */
  lvl: number;
  /** Epoch ms when the pending level (lvl + 1) completes; 0 = nothing pending. */
  until: number;
}

export interface CityState {
  /** Schema version of this object. */
  v: 1;
  regionId: number;
  name: string;
  res: Stock;
  crystals: number;
  pop: number;
  th: number;
  /** Epoch ms when the town hall upgrade completes; 0 = none. */
  thUntil: number;
  /** Bitset (base64) over the region mask bounding box: owned cells. */
  owned: string;
  ownedCount: number;
  buildings: Building[];
  nextId: number;
  extraBuilders: number;
  /** Epoch ms up to which the economy has been simulated. */
  tick: number;
  /** System-market sales today (quota) and crystal land bought today. */
  day: number;
  soldToday: Partial<Record<Good, number>>;
  crystalCellsToday: number;
  /** Ids of the last action batches (idempotency). */
  ops: string[];
  createdAt: number;
  /** Number of actions ever done (0 = created the city and left). */
  actions: number;
}

/** Region mask as served at /regions/<id>.json (static, same for everyone). */
export interface RegionMaskDTO {
  id: number;
  /** Bounding box in world cells. */
  x0: number;
  y0: number;
  w: number;
  h: number;
  /** Buildable cells of this region (base64 bitset, row-major over w*h). */
  build: string;
  /** Wooded cells (subset of build). */
  wood: string;
  /** Number of buildable cells. */
  cells: number;
  /** Starter plot in world cells, clipped to the region. */
  start: { x: number; y: number; w: number; h: number };
  /** Town hall position (top-left, world cells). */
  hall: { x: number; y: number };
}

export type Action =
  | { type: 'build'; t: BuildingType; x: number; y: number }
  | { type: 'upgrade'; id: number }
  | { type: 'demolish'; id: number }
  | { type: 'townhall' }
  /** cells: indices into the region bbox (y * w + x) */
  | { type: 'land'; cells: number[]; pay: 'coins' | 'crystals' }
  | { type: 'rename'; name: string }
  | { type: 'builder' };

export type ActionResult = { ok: true } | { ok: false; error: string };

export type CityStatus = 'active' | 'abandoned';

/** What other players see about a city. */
export interface PublicCity {
  regionId: number;
  name: string;
  owner: string;
  th: number;
  pop: number;
  status: CityStatus;
  buildings: Building[];
  owned: string;
}

export interface WorldCitySummary {
  r: number;
  n: string;
  th: number;
  pop: number;
  s: CityStatus;
}

export interface PriceQuote {
  ref: number;
  /** price the system sells at (player buys) */
  buy: number;
  /** price the system pays (player sells) */
  sell: number;
}

export interface Order {
  id: number;
  regionId: number;
  cityName: string;
  side: 'buy' | 'sell';
  res: Good;
  qty: number;
  remaining: number;
  /** total price of the whole order in coins; unit price = total / qty */
  total: number;
  createdAt: number;
  expiresAt: number;
  status: 'open' | 'filled' | 'cancelled' | 'expired';
}

export interface Trade {
  id: number;
  res: Good;
  qty: number;
  unit: number;
  at: number;
  kind: 'exchange' | 'system';
}

export interface MeResponse {
  user: { id: number; name: string };
  city: CityState | null;
  serverTime: number;
  /** true when every region is taken and nothing could be recycled */
  full: boolean;
  freeRegions: number;
}

export interface CityResponse {
  city: CityState;
  serverTime: number;
  results?: ActionResult[];
}

export interface MarketResponse {
  prices: Record<Good, PriceQuote>;
  /** units the city may still sell to the system today */
  quota: Record<Good, number>;
  myOrders: Order[];
  serverTime: number;
}

export interface ApiError {
  error: string;
  message: string;
}
