import type { BuildingType } from '../game/config.ts';
import type { MapApp } from '../rendering/MapApp.ts';
import type { Store } from './store.ts';
import type { Shell, Tab } from './ui/shell.ts';

/** What screens may ask the game to do. */
export interface Game {
  readonly store: Store;
  readonly shell: Shell;
  readonly map: MapApp;
  startBuild(t: BuildingType): void;
  startExpand(): void;
  flyHome(): void;
  openBuilding(id: number): void;
  openTab(t: Tab): void;
  /** Ask Telegram (or the mock) for a stars payment, refresh on success. */
  buyPack(pack: string): Promise<void>;
  togglePerf(): void;
}
