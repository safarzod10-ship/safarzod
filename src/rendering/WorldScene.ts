/**
 * Scene graph of the map and the place where future systems plug in.
 *
 *   camera (pixi-viewport, world units)
 *   ├─ terrain   baked land + animated ocean          [map layer, this repo]
 *   ├─ ground    roads, plots, decals                 [EXTENSION POINT]
 *   ├─ shadows   soft ground shadows of buildings     [EXTENSION POINT]
 *   ├─ objects   trees, later buildings (y-sorted)    [EXTENSION POINT]
 *   ├─ overlay   region borders, selection, labels    [EXTENSION POINT]
 *   └─ fog       always on top: nothing shows through the edge of the world
 *
 * Everything inside the camera uses world units (see core/coords.ts), so a
 * building at world (x, y) is simply `sprite.position.set(x, y)` in `objects`.
 */
import { Container, type TextureSource } from 'pixi.js';
import type { CameraView } from '../camera/CameraController.ts';
import { createCoastTexture } from '../world/coastTexture.ts';
import { FogLayer } from '../world/fog/FogLayer.ts';
import type { WorldBackend } from '../world/generation/WorldBackend.ts';
import type { WorldFields } from '../world/generation/WorldFields.ts';
import type { DetailTextures } from '../world/terrain/detailTextures.ts';
import { TerrainLayer } from '../world/terrain/TerrainLayer.ts';
import { RegionLayer } from '../world/regions/RegionLayer.ts';
import type { RegionIndex } from '../world/regions/regions.ts';
import { TreeLayer } from '../world/trees/TreeLayer.ts';

export interface SceneLayers {
  readonly terrain: Container;
  readonly ground: Container;
  readonly shadows: Container;
  readonly objects: Container;
  readonly overlay: Container;
  readonly fog: Container;
}

export class WorldScene {
  readonly root = new Container({ label: 'world' });
  readonly layers: SceneLayers;
  readonly terrain: TerrainLayer;
  readonly trees: TreeLayer;
  readonly fog: FogLayer;
  readonly regions: RegionLayer;
  private readonly coast: TextureSource;
  private treesPending = false;

  constructor(
    world: WorldFields,
    backend: WorldBackend,
    textures: DetailTextures,
    regionIndex: RegionIndex,
    options: { lowMemory?: boolean } = {},
  ) {
    this.coast = createCoastTexture(world);
    this.terrain = new TerrainLayer(backend, textures, this.coast, options);
    this.trees = new TreeLayer(world, backend);
    this.fog = new FogLayer(world, this.coast, textures.noise);
    this.regions = new RegionLayer(regionIndex);
    // Terrain that sits entirely under opaque fog is never shaded.
    this.terrain.isHidden = (rect) => this.fog.hides(rect);

    const make = (label: string, interactive: boolean): Container => {
      const c = new Container({ label });
      if (!interactive) c.eventMode = 'none';
      return c;
    };
    this.layers = {
      terrain: make('layer:terrain', false),
      ground: make('layer:ground', true),
      shadows: make('layer:shadows', false),
      objects: make('layer:objects', true),
      overlay: make('layer:overlay', true),
      fog: make('layer:fog', false),
    };
    this.layers.terrain.addChild(this.terrain.container);
    this.layers.objects.addChild(this.trees.container);
    this.layers.overlay.addChild(this.regions.container);
    this.layers.fog.addChild(this.fog.mesh);
    this.root.addChild(
      this.layers.terrain,
      this.layers.ground,
      this.layers.shadows,
      this.layers.objects,
      this.layers.overlay,
      this.layers.fog,
    );
  }

  /**
   * Per-frame update: selects LODs, schedules bakes, culls trees and fog.
   * @param resolution renderer resolution (device px per CSS px)
   */
  update(view: CameraView, resolution: number, timeSec: number): void {
    const deviceScale = view.scale * resolution;
    this.terrain.update({ bounds: view.bounds, deviceScale }, timeSec);
    this.treesPending = this.trees.update(view.bounds, deviceScale);
    this.regions.update(view.scale);
    this.fog.update(view.bounds, timeSec);
  }

  /** True while terrain or trees are still streaming in. */
  get busy(): boolean {
    return this.treesPending || this.terrain.busy;
  }

  destroy(): void {
    this.terrain.destroy();
    this.trees.destroy();
    this.fog.destroy();
    this.regions.destroy();
    this.root.destroy({ children: true });
    this.coast.destroy();
  }
}
