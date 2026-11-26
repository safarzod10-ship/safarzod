# HYPOFANGS (web port)

HTML5 / JavaScript port of the Windows Unity build of HYPOFANGS, made with the owner's authorisation.
Runs in a browser, in a Telegram Mini App (touch) and on desktop (keyboard and mouse).

## Layout

- `web/` — the game as served (no build step on the server).
  - `js/engine/` — small runtime mirroring the Unity parts the game uses: hierarchy and components (`core.js`),
    scene loading from the exported JSON (`scene.js`), 2D physics subset (`physics.js`), WebGL sprite batcher with
    a 2D light buffer (`gl.js`, `render.js`), input, audio.
  - `js/game/` — the game scripts ported from the decompiled C# (PlayerController, Enemy, LevelManager, world objects, prologue).
  - `js/ui/` — HUD, menus rebuilt from the exported uGUI prefabs (`uitree.js`), touch buttons.
  - `js/net/api.js` — balance, Telegram Stars top-ups and staked runs (Cloudflare Worker backend).
  - `data/` — exported scenes, ScriptableObjects and the sprite manifest; `atlas/` — sprite atlases; `audio/` — MP3.
- `tools/` — the export pipeline:
  - `export_unity.py <HYPOFANGS_Data> <sprites.json> <out>` (UnityPy): scenes, assets, Light2D, 9-slice borders, textures.
  - `pack_atlas.py <export> <sprites dir> <sprites.json> <web>`: atlas pages and `data/sprites.json`.
  - `convert_audio.sh <wav dir> <web/audio>`: WAV to MP3 (ffmpeg).

## Run locally

    cd web && python3 -m http.server 8000

`?room=N` starts the Neon District at room N (0-based).

## Score for staked runs

The original HUD has no score. A run is one life in the Neon District (it ends on death or when quitting to the menu);
score = kills × 100 + rooms cleared × 300.

## Credits

Asset credits and third-party notices of the original build are shown on the in-game credits screen (`data/credits`).
