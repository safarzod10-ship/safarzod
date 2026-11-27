# CLAUDE.md — virtual-country-map

Interactive procedural **continent map** for a multiplayer city-building game
that runs as a Telegram Mini App. This repository is **the map layer only**:
terrain, ocean, fog, trees, camera. Buildings, plots, cities, economy,
accounts, payments and server logic live in other modules / sessions and plug
in through the interfaces listed under "Extension points".

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
pixi-viewport 7 · simplex-noise 4 · TypeScript 5 (strict) · Vite 8 · Vitest.
No image assets: every texture is generated at start-up.

## Coordinate system  (read this before placing anything)

- **World units (wu)**: 1 wu = 1 metre nominal. World is a square
  `WORLD_SIZE = 16384` wu. Origin `(0,0)` = north-west corner, `+x` east,
  `+y` south (same handedness as the screen). Centre = `(8192, 8192)`.
- Everything inside the camera (`scene.layers.*`) is positioned **in world
  units**. A building at world `(x, y)` is `sprite.position.set(x, y)`.
- **Grid**: `GRID_CELL = 16` wu is the base lattice (also the generation grid).
  Helpers in `src/core/coords.ts`: `worldToCell`, `cellToWorld`, `snapToGrid`,
  `worldToChunk`. Footprints should be multiples of `GRID_CELL`.
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
      generateWorld.ts     lobes mask + domain warp + fbm → fields
      WorldFields.ts       grids (e, relief, forest, moist, meadow, coastDist)
      ScalarGrid.ts        Catmull-Rom sampled world grid
      WorldBackend.ts      worker / main-thread fallback behind one interface
      world.worker.ts      generation + chunk baking off the main thread
    terrain/
      chunkBaker.ts        PURE: fields → RGBA8 chunk (RGB albedo, A shoreline SDF)
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

1. `generateWorld(params)` builds low-frequency fields on grids (once, ~0.5 s,
   in the worker). `e` is the coast function: land where `e > 0`.
2. The world is a quadtree-like set of chunks at 4 LODs (`LODS` in config):
   4096/2048/1024/512 wu per chunk, always 257×257 texels with shared edges.
   Level 0 (16 chunks) is always resident; finer chunks are baked on demand
   for the visible area, cached (LRU), faded in.
3. A chunk texture stores albedo in RGB and a **signed distance to the
   waterline in A**. The fragment shader thresholds A, so the coast is crisp at
   any zoom, and adds tiled grass detail, sand grain, ripples, foam, waves.
   One draw call per visible chunk. Nothing is generated per frame.
4. Trees: deterministic placement per 1024 wu chunk, drawn as two static
   `ParticleContainer`s (shadows, canopies) only when zoomed in; further out
   groves are painted into the terrain texture.
5. Fog: one quad; density = f(distance from land) + drifting noise. The
   renderer clear colour equals the fog colour, so "outside" is always fog.

## Extension points (for buildings / plots / cities sessions)

- `map.scene.layers` — world-space containers, bottom to top:
  `terrain` (map) · **`ground`** (roads, plots, decals) · `shadows` ·
  **`objects`** (buildings; trees live here too) · **`overlay`** (selection,
  placement grid, labels) · `fog`. Add your display objects to `ground`,
  `objects`, `overlay`. Never add anything above `fog`.
- `map.query: WorldQuery` — `isLand`, `isBuildable`, `isAreaBuildable(rect)`,
  `isWooded`, `forestDensity`, `relief`, `coastValue`, `meta`. Pure functions
  of `WorldParams`; a server running `generateWorld` gets identical answers.
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

1. **Determinism is sacred.** `generateWorld`, `bakeChunk`, `placeTrees` use
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

- No lakes or rivers (by design for v1: inland water is filled).
- Trees are cosmetic; there is no "cleared land" state yet.
- Generated fields are not cached between launches (regenerated in ~0.5–2 s);
  an IndexedDB cache would remove that.
- FPS on real phones must be measured on-device (perf panel button in the HUD).
