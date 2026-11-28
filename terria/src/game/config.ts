/**
 * TERRIA balance. Every number here was tuned with the balance simulator
 * (tools/balance/sim.ts): a diligent player (6 short sessions a day) buys the
 * whole region and upgrades everything to the maximum in about 90 days.
 *
 * Shared by the client (prediction, UI) and the server (authority). Pure data:
 * no DOM, no PixiJS, no Workers APIs.
 */

export const RESOURCES = ['coins', 'wood', 'stone', 'iron', 'food', 'goods'] as const;
export type Res = (typeof RESOURCES)[number];
/** Resources that can be traded on the market. */
export const GOODS = ['wood', 'stone', 'iron', 'food', 'goods'] as const;
export type Good = (typeof GOODS)[number];

export const RES_LABEL: Record<Res, string> = {
  coins: 'Монеты',
  wood: 'Древесина',
  stone: 'Камень',
  iron: 'Железо',
  food: 'Продукты',
  goods: 'Товары',
};
export const RES_ICON: Record<Res, string> = { coins: '🪙', wood: '🪵', stone: '🪨', iron: '⛓️', food: '🌾', goods: '📦' };

/** Region size the balance was tuned for (median buildable 16 m cells per region). */
export const REFERENCE_REGION_CELLS = 8500;
/** A grid cell is 16 x 16 m (GRID_CELL in core/config.ts). */
export const CELL_M = 16;

export const START = {
  res: { coins: 600, wood: 120, stone: 100, iron: 0, food: 60, goods: 0 } as Record<Res, number>,
  pop: 10,
  crystals: 0,
};

export type BuildingType =
  | 'townhall'
  | 'house'
  | 'farm'
  | 'sawmill'
  | 'quarry'
  | 'mine'
  | 'shop'
  | 'warehouse'
  | 'hospital'
  | 'factory'
  | 'school'
  | 'park'
  | 'fountain'
  | 'statue';

export interface BuildingDef {
  name: string;
  /** Footprint side in cells (square). */
  size: number;
  /** Cost of level 1; level n costs `cost * LEVEL_COST[n-1]`. */
  cost: Partial<Record<Res, number>>;
  /** Crystal price instead of a resource cost (decorations). */
  crystals?: number;
  /** Town hall level that unlocks it. */
  th: number;
  housing?: number;
  jobs?: number;
  /** Production per hour at level 1. */
  out?: Partial<Record<Res, number>>;
  /** Input per hour at level 1 (factory). */
  inp?: Partial<Record<Res, number>>;
  /** Extra storage per resource at level 1. */
  storage?: number;
  /** Citizens covered by healthcare at level 1. */
  care?: number;
  /** Shop income cap, coins per hour at level 1. */
  shop?: number;
  /** Pupils taught at level 1 (schools): educated workers pay more tax. */
  edu?: number;
  /** Happiness points (parks, decor), at level 1. */
  joy?: number;
  /** Upkeep, coins per hour at level 1. */
  upkeep: number;
  /** Max level (decorations stay at 1). */
  maxLevel: number;
  /** Production bonus when the footprint is mostly forest (sawmill). */
  forestBonus?: number;
  category: 'core' | 'living' | 'production' | 'service' | 'decor';
  description: string;
}

export const BUILDINGS: Record<BuildingType, BuildingDef> = {
  townhall: {
    name: 'Ратуша', size: 3, cost: {}, th: 1, housing: 20, upkeep: 0, maxLevel: 6, category: 'core',
    description: 'Сердце города. Её уровень открывает новые здания и максимальный уровень построек.',
  },
  house: {
    name: 'Жилой дом', size: 2, cost: { coins: 35, wood: 25, stone: 10 }, th: 1, housing: 30, upkeep: 0.3, maxLevel: 5,
    category: 'living', description: 'Дома для жителей. Жители работают на предприятиях и платят налоги.',
  },
  farm: {
    name: 'Ферма', size: 4, cost: { coins: 40, wood: 5 }, th: 1, jobs: 8, out: { food: 18 }, upkeep: 0.35, maxLevel: 5,
    category: 'production', description: 'Поля и амбар. Кормят город: 1 продукт в час на 6 жителей.',
  },
  sawmill: {
    name: 'Лесопилка', size: 3, cost: { coins: 50 }, th: 1, jobs: 8, out: { wood: 20 }, upkeep: 0.35, maxLevel: 5,
    category: 'production', description: 'Древесина для строительства.',
  },
  quarry: {
    name: 'Карьер', size: 3, cost: { coins: 55 }, th: 1, jobs: 8, out: { stone: 16 }, upkeep: 0.35, maxLevel: 5,
    category: 'production', description: 'Камень для строительства.',
  },
  shop: {
    name: 'Рынок квартала', size: 2, cost: { coins: 90, wood: 30, stone: 25 }, th: 2, jobs: 6, shop: 28, upkeep: 0.6, maxLevel: 5,
    category: 'service', description: 'Доход от покупок жителей. Ограничен числом жителей.',
  },
  warehouse: {
    name: 'Склад', size: 3, cost: { coins: 70, wood: 35, stone: 35 }, th: 2, storage: 3000, upkeep: 0.3, maxLevel: 5,
    category: 'service', description: 'Увеличивает вместимость каждого ресурса.',
  },
  mine: {
    name: 'Шахта', size: 3, cost: { coins: 180, wood: 70, stone: 70 }, th: 3, jobs: 10, out: { iron: 12 }, upkeep: 0.7, maxLevel: 5,
    category: 'production', description: 'Железо для улучшений и завода.',
  },
  hospital: {
    name: 'Больница', size: 3, cost: { coins: 300, wood: 90, stone: 120, iron: 25 }, th: 3, jobs: 12, care: 300, upkeep: 1.2, maxLevel: 5,
    category: 'service', description: 'Здоровье жителей. Без больниц большой город грустнеет.',
  },
  factory: {
    name: 'Завод', size: 4, cost: { coins: 550, wood: 180, stone: 180, iron: 90 }, th: 4, jobs: 16,
    inp: { wood: 12, iron: 6 }, out: { goods: 6 }, upkeep: 1.8, maxLevel: 5,
    category: 'production', description: 'Перерабатывает древесину и железо в товары для старших уровней.',
  },
  school: {
    name: 'Школа', size: 3, cost: { coins: 260, wood: 100, stone: 120 }, th: 3, jobs: 8, edu: 250, upkeep: 1, maxLevel: 5,
    category: 'service', description: 'Учит детей. Образованные жители платят до 25 % больше налогов.',
  },
  park: {
    name: 'Сквер', size: 2, cost: { coins: 25 }, th: 1, joy: 4, upkeep: 0.05, maxLevel: 1,
    category: 'decor', description: 'Зелень и лавочки. Немного радует жителей.',
  },
  fountain: {
    name: 'Фонтан', size: 2, cost: {}, crystals: 60, th: 2, joy: 25, upkeep: 0, maxLevel: 1,
    category: 'decor', description: 'Украшение за кристаллы. Заметно радует жителей.',
  },
  statue: {
    name: 'Памятник основателю', size: 2, cost: {}, crystals: 150, th: 3, joy: 60, upkeep: 0, maxLevel: 1,
    category: 'decor', description: 'Украшение за кристаллы с вашим именем на табличке.',
  },
};

/** Cost to reach level n, relative to the level-1 cost. */
export const LEVEL_COST = [1, 3, 8, 20, 50];
/** Output / housing / storage / care multiplier at level n. */
export const LEVEL_OUT = [1, 1.7, 2.7, 4.2, 6.3];
export const LEVEL_JOBS = [1, 1.5, 2.2, 3.1, 4.3];
/** Build time of level n in hours, for a 4x4 building (scaled by sqrt(area / 16)). */
export const LEVEL_HOURS = [0.1, 0.4, 1, 2, 4];
/** Levels 4 and 5 also need iron and goods. */
export const LATE_IRON = 0.3 / 4; // of the coin cost
export const LATE_GOODS = 0.25 / 10;

export const TOWNHALL = {
  maxLevel: 6,
  /** coins to go from level n to n+1 (index n-1); wood and stone are 30 % of it, iron 10 % from level 3, goods 2 % from level 5 */
  cost: [115, 1150, 9500, 57000, 230000],
  /** population needed to start the upgrade from level n, for a reference-size region */
  pop: [65, 450, 2200, 7800, 20000],
  /** share of the region that must be owned */
  land: [0.03, 0.1, 0.25, 0.45, 0.7],
  /** hours of construction from level n */
  hours: [0.5, 2, 6, 12, 24],
  incomePerLevel: 10,
  builders: [2, 3, 4, 5, 6, 7],
  storagePerLevel: 600,
};

export const ECONOMY = {
  /** Tax bonus when every citizen is covered by schools. */
  educationBonus: 0.25,
  taxPerWorker: 0.5,
  shopDemandPerCitizen: 0.3,
  foodPerCitizen: 1 / 6,
  /** Offline production is capped (the city never decays, it just waits). */
  offlineCapHours: 12,
  growthPerHour: 0.12,
};

export const LAND = {
  /** price(f) = base * (1 + k * f^g), f = owned share of the region */
  base: 5.57,
  k: 52.33,
  g: 1.885,
  /** 1 crystal buys land worth this many coins */
  crystalRate: 25,
  /** crystal land purchases per day (cells) */
  crystalCellsPerDay: 100,
  /** the starter plot is 1 % of the region */
  starterShare: 0.01,
};

export const MARKET = {
  /** Reference prices in coins per unit. The live price drifts with player trades. */
  base: { wood: 1, stone: 1.2, iron: 2.5, food: 0.75, goods: 7 } as Record<Good, number>,
  /** The system sells to players at ref * sellMul and buys from them at ref * buyMul. */
  systemSellMul: 1.25,
  systemBuyMul: 0.75,
  /** Units per resource a city may sell to the system per day, per town hall level. */
  systemBuyQuotaPerTh: 300,
  /** Drift bounds of the reference price. */
  minMul: 0.4,
  maxMul: 2.5,
  /** Weight of one trade in the reference price (scaled by volume, capped). */
  tradeWeightPer1000: 0.05,
  tradeWeightMax: 0.2,
  /** Exchange fee taken from the seller's coins. */
  fee: 0.02,
  orderTtlHours: 72,
  maxOrdersPerCity: 10,
  maxOrderQty: 1_000_000,
  /** Player-to-player exchange opens at this town hall level. */
  exchangeTh: 2,
};

/** Inactive cities: after this many days without a visit the city is marked abandoned. */
export const INACTIVITY = {
  /** never did anything after creating the city */
  untouchedDays: 3,
  /** by town hall level 1..6 */
  daysByTh: [7, 7, 21, 21, 45, 45],
  /** warn through the bot this many days before */
  warnDaysBefore: 2,
};

export interface CrystalPack {
  id: string;
  stars: number;
  crystals: number;
  label: string;
}
export const CRYSTAL_PACKS: CrystalPack[] = [
  { id: 'p25', stars: 25, crystals: 150, label: 'Горсть' },
  { id: 'p50', stars: 50, crystals: 320, label: 'Мешочек' },
  { id: 'p100', stars: 100, crystals: 700, label: 'Сундук' },
  { id: 'p250', stars: 250, crystals: 1900, label: 'Ларец' },
  { id: 'p500', stars: 500, crystals: 4000, label: 'Казна' },
];

export const CRYSTAL_SHOP = {
  /** a permanent extra builder, once */
  extraBuilder: 300,
};

export const NAME = { min: 2, max: 24 };
