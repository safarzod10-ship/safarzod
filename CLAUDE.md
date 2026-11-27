# CLAUDE.md — virtual-country-map

Interactive procedural **continent map** for a multiplayer city-building game
that runs as a Telegram Mini App. This repository is **the map layer only**:
terrain, ocean, fog, rivers, lakes, forests, the division of the land into
1000 player regions, camera. Buildings, cities, economy, accounts, payments,
region ownership and server logic live in other modules / sessions and plug in
through the interfaces listed under "Extension points".

Scale (canonical seed): world 131 x 131 km, continent ~55 x 72 km, land
~2230 km^2, 1000 regions of ~2.2 km^2 each, starter plot = 1 % of a region
(~150 x 150 m), 34 lakes, ~580 km of rivers, ~31 % forest.

## Commands

```bash
npm install
npm run dev          # Vite dev server (http://localhost:5173)
npm run typecheck    # tsc --noEmit  (Vite does NOT type-check)
npm test             # vitest: determinism, seams, bounds, camera math
npm run build        # typecheck + production build into dist/
npm run preview      # serve dist/
npm run map:preview  # node tools/render-preview.ts [seed] [outDir] -> PNGs, no browser
```

Before saying a change works: `npm run typecheck && npm test && npm run build`,
then open the page and look at it (full view, mid zoom, max zoom, a coast).

URL switches: `?seed=<number|text>` previews another world without saving it,
`?noworker` forces the main-thread fallback. `window.__vcm` is the `MapApp`
(debug/automation only, not a stable API).

## Stack

PixiJS 8 (WebGL 2, WebGL 1 fallback; **no WebGPU** — the shaders are GLSL) ·
pixi-viewport 7 · simplex-noise 4 · d3-delaunay 6 · TypeScript 5 (strict) ·
Vite 8 · Vitest.
No image assets: every texture is generated at start-up.

## Coordinate system  (read this before placing anything)

- **World units (wu)**: 1 wu = 1 metre. World is a square
  `WORLD_SIZE = 131072` wu. Origin `(0,0)` = north-west corner, `+x` east,
  `+y` south (same handedness as the screen). Centre = `(65536, 65536)`.
- Everything inside the camera (`scene.layers.*`) is positioned **in world
  units**. A building at world `(x, y)` is `sprite.position.set(x, y)`.
- **Grid**: `GRID_CELL = 16` wu is the lattice for buildings and plots.
  Helpers in `src/core/coords.ts`: `worldToCell`, `cellToWorld`, `snapToGrid`,
  `worldToChunk`. Footprints should be multiples of `GRID_CELL`. (The
  generation grid is coarser: `BASE_SPACING = 128` wu; finer detail is
  procedural.)
- **Camera scale** = CSS px per wu. Max zoom `CAMERA.maxScale = 1.6`; min zoom
  = "camera bounds fit the screen". Device px per wu = scale × renderer
  resolution (resolution is capped at 2 and may be lowered adaptively).
- **Screen ↔ world**: only via `map.camera.screenToWorld / worldToScreen`.
- The continent occupies the middle of the square; `world.meta.landBounds` is
  its bounding box and `world.meta.cameraBounds` the area the camera may show.

## Architecture

```
src/
  main.ts                  bootstrap: HUD, renderer, world, MapApp, persistence
  core/                    no PixiJS, no DOM (except storage/telegram)
    config.ts              ALL tunables: world size, LODs, camera, fog, trees
    coords.ts math.ts rng.ts perf.ts storage.ts telegram.ts
  world/
    generation/            PURE + DETERMINISTIC (runs in worker, node, tests)
      WorldParams.ts       seed + shape params; the only thing persisted
      generateWorld.ts     lobes mask + domain warp + fbm → base grid, then
                           hydrology, slow fields, regions, summary
      hydrology.ts         rivers (Dijkstra from the coast) and lakes
      rivers.ts            RiverNetwork: segments + spatial hash + distance
      procedural.ts        relief and forest density from seeded noise
      WorldFields.ts       the world: grids, rivers, lakes, regions, queries
      ScalarGrid.ts        Catmull-Rom sampled world grid
      WorldBackend.ts      worker / main-thread fallback behind one interface
      world.worker.ts      generation, chunk baking, tree placement
    regions/
      regions.ts           PURE: buildRegions (centroidal Voronoi on land),
                           RegionIndex (regionAt, info, polygon, neighbors)
      RegionLayer.ts       dashed borders + selected region / starter plot
    coastTexture.ts        shared texture: distance from land, sea-vs-inland
    terrain/
      chunkBaker.ts        PURE: world → RGBA8 chunk (RGB albedo, A shoreline SDF)
      TerrainLayer.ts      LOD selection, bake queue, LRU cache, fade-in
      terrainShader.ts     one GLSL program for land + sea
      detailTextures.ts    procedural tileable grass + noise textures
      palette.ts
    ocean/                 oceanPalette.ts (baked depth colour), oceanGlsl.ts (waves/foam)
    fog/FogLayer.ts        fog bank driven by distance-from-land texture
    trees/                 treePlacement.ts (PURE), treeAtlas.ts, TreeLayer.ts
    WorldQuery.ts          read-only terrain questions for other systems
  rendering/
    createRenderer.ts      Pixi Application (WebGL only)
    WorldScene.ts          scene graph + layers (extension points)
    MapApp.ts              frame loop, resize, idle throttle, stats
    QualityController.ts   adaptive resolution
  camera/
    constraints.ts         PURE zoom limits + clamping
    CameraController.ts    pixi-viewport wrapper
  ui/                      DOM HUD (loading, zoom buttons, scale bar, perf panel)
tests/                     vitest (node)
tools/                     offline PNG preview of the baked map
```

Dependency direction: `core` ← `world/generation` ← `world/*` ← `rendering`
← `main`. `camera` depends only on `core` (+ pixi-viewport). `ui` knows only
`MapStats`. Nothing in `world/generation`, `chunkBaker.ts`, `treePlacement.ts`
or `camera/constraints.ts` may import PixiJS or touch the DOM.

### How the terrain is drawn

1. `generateWorld(params)` builds the world once (~0.8 s, in the worker). The
   base grid `e` (128 wu spacing) is the coast function: land where `e > 0`;
   lakes are carved into it. Everything finer is procedural: extra coast
   octaves per LOD (`coastDetail`), relief, forest density, and rivers, which
   are geometry (`RiverNetwork`) applied analytically. The single source of
   truth for "is this land" is `WorldFields.coastValue(x, y)` =
   `min(coast + detail, riverDistance * RIVER_GRADIENT)`.
2. The world is a quadtree-like set of chunks at 7 LODs (`LODS` in config):
   32768 … 512 wu per chunk (128 … 2 wu per texel), always 257×257 texels with
   shared edges. Level 0 (16 chunks) is always resident; finer chunks are
   baked on demand for the visible area, cached (LRU), faded in. Chunks fully
   under opaque fog are skipped.
3. A chunk texture stores albedo in RGB and a **signed distance to the nearest
   waterline (sea, lake or river) in A**. The fragment shader thresholds A, so
   shores are crisp at any zoom, and adds tiled grass detail, sand grain,
   ripples, foam, waves. Fresh water (decided by `coastTexture` G) is calm.
   Coarse LODs draw rivers wider than they are and omit the smallest streams.
   One draw call per visible chunk. Nothing is generated per frame.
4. Trees: deterministic placement per 1024 wu chunk (in the worker), drawn as
   one static `ParticleContainer` per chunk only when zoomed in; further out
   forests are painted into the terrain texture with the same probability.
   README has a full "how trees are made" section.
5. Regions: `buildRegions` relaxes 1000 sites over the land (Lloyd) so areas
   are similar; `RegionLayer` draws all borders as one dashed-line mesh with
   constant on-screen width.
5. Fog: one quad; density = f(distance from land) + drifting noise. The
   renderer clear colour equals the fog colour, so "outside" is always fog.

## Extension points (for buildings / plots / cities sessions)

- `map.scene.layers` — world-space containers, bottom to top:
  `terrain` (map) · **`ground`** (roads, plots, decals) · **`shadows`** ·
  **`objects`** (buildings; trees live here too) · **`overlay`** (region
  borders live here; add selection, placement grid, labels) · `fog`. Add your
  display objects to `ground`, `shadows`, `objects`, `overlay`. Never add
  anything above `fog`. Other players' cities are just more objects in these
  layers; cull them by `camera.getView().bounds` and draw simplified markers
  when zoomed out (a region is only a few px wide in the full view).
- `map.query: WorldQuery` — `isLand`, `isBuildable`, `isAreaBuildable(rect)`,
  `isWooded`, `forestDensity`, `relief`, `coastValue`, `riverDistance`,
  `regionAt(x, y)`, `meta`. Pure functions of `WorldParams`; a server running
  `generateWorld` gets identical answers.
- `map.query.regions: RegionIndex` — the 1000 regions: `info(id)` (home point,
  land area, `starterPlot` rect = 1 % of the area), `polygon(id)`,
  `neighbors(id)`, `regionAt(x, y)`. Ids are 0-based; show `id + 1` to players.
  **Ownership is not stored here**: "player P owns region R and has unlocked
  these rects" is game state for the backend module. Assigning a random free
  region = pick a free id server-side, then `map.showRegion(id)` /
  `map.selectRegion(id)` on the client.
- `map.camera: CameraController` — `getView()`, `onChange(cb)`,
  `screenToWorld`, `worldToScreen`, `flyTo`, `fitWorld`, `zoomBy`.
- `map.onFrame(view, deltaMs)` — per-frame hook after the scene update.
- `placeTrees(world, cx, cy)` — exact tree positions (for clearing land).
- New pure world data → add a field in `WorldFields` + generator step, and a
  method on `WorldQuery`. New visuals → a new layer class added in `WorldScene`.

Suggested module homes: `src/buildings/`, `src/plots/`, `src/net/`. They may
import from `core`, `camera`, `world/WorldQuery`, `rendering/WorldScene`
(types). The map must not import from them.

## Rules

1. **Determinism is sacred.** `generateWorld`, `buildHydrology`,
   `buildRegions`, `bakeChunk`, `placeTrees` use
   only `+ - * / sqrt`, integer hashing and seeded noise. No `Math.random`,
   `Date`, `Math.sin/cos/exp/pow` in anything that decides *where land is*
   (transcendentals differ between JS engines). Cosmetic-only code (texture
   painters, shaders) may use them.
2. **Changing the generator changes everyone's map.** `tests/generation.test.ts`
   pins a fingerprint of the canonical world. If it fails, either revert or
   bump `GENERATOR_VERSION` and update the snapshot deliberately
   (`npx vitest run -u`).
3. **Performance budget** (mid-range Android WebView): no per-frame allocation
   in `update()` paths, no work proportional to world size per frame, one draw
   call per terrain chunk, static particle buffers, no filters / masks /
   `cacheAsTexture` on world layers, no `backdrop-filter` in the HUD. Heavy
   CPU work goes to the worker or is time-sliced (`WorldBackend`).
4. Keep tunables in `core/config.ts`; keep colours in `palette.ts` /
   `oceanPalette.ts`.
5. TypeScript: strict, `erasableSyntaxOnly` (no enums, no parameter
   properties), imports carry the `.ts` extension (so `node file.ts` works).
6. PixiJS 8 API only (see https://github.com/pixijs/pixijs-skills). Custom
   shaders are written in Pixi's GLSL ES 1.0-compatible dialect
   (`in/out/texture/finalColor`) and must keep working on WebGL 1.
7. Do not commit secrets, `dist/`, `node_modules/`. No analytics or network
   calls from the map layer (the Telegram SDK is loaded only inside Telegram).
8. Out of scope here: buildings, plots, cities, economy, accounts, payments,
   server code. If a task needs them, put them in their own module.

## Known limitations / next steps

- Rivers have no bridges / fords and lakes no special gameplay; both simply
  are not land. A starter plot never touches water (tested: > 97 % of plots
  are fully buildable; the rest clip a beach or bank and need a nudge).
- Region sizes vary (about 0.65x … 1.35x of the average).
- Tiny islets can appear right at the shore from the fine coast octaves; they
  are land for `isLand` but belong to the nearest region and are cosmetic.
- Trees are cosmetic; there is no "cleared land" state yet (see README).
- Generated fields are not cached between launches (regenerated in ~0.5–2 s);
  an IndexedDB cache would remove that.
- FPS on real phones must be measured on-device (perf panel button in the HUD).
