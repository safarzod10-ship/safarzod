# Master plan

## Decisions (with reasons)
- **Render pipeline: URP**, not HDRP. Target is Android phones; HDRP does not run on mobile. Realism comes from PBR textures, baked/probe lighting, SSAO, post-processing and good art, tuned per quality preset.
- **Networking: Netcode for GameObjects**, host-authoritative listen server over LAN (Unity Transport). Trusted casual play; no dedicated server.
- **Bots: NavMesh + simple state machine** (BotBrain). Runs on host only.
- **Characters: retargeted baked clips + Playables + two-bone IK** (Assets/Scripts/Anim). Kept: works on all four rigs.
- **Level: imported textured GLB (Town) + editor scripts** for markers, graffiti, match objects. The old procedural Bazaar scene is legacy.
- **Assets: only CC0/CC-BY** (Poly Haven, ambientCG, Sketchfab CC-BY, Freesound CC0/CC-BY, OpenGameArt CC0).

## Hardware limits of the build machine
4 CPU cores, 15 GB RAM, no GPU, ~4 GB free disk. Consequences: rendering checks via CPU rasteriser (slow), no light baking with GPU lightmapper, no on-device FPS. Performance is measured as CPU frame time in headless runs plus on-device numbers from the owner.

## Phases (priority order)
1. **Playable core (P0)**: first-person weapon view, bots that plant/defuse, round rules verified, touch controls, zero errors. 
2. **Performance for phones (P0)**: decimate characters + LODs, quality presets, frame stats overlay, APK test by owner.
3. **UI/UX (P0)**: designed menu, HUD, settings (graphics/controls/sound), pause, scoreboard, match end, loading.
4. **Level (P0/P1)**: enlarge to a proper 5v5 layout, Tajik architectural identity (carved doors/columns, aivan, ornaments, bazaar), fix artefacts.
5. **Weapons (P0/P1)**: remaining 19 weapon models with grips; muzzle/shells/decals.
6. **Audio polish, LAN test, licences audit, final report.**

## Verification
Every feature in FEATURES.json has an acceptance test. Automated: headless match logs (REPORT/BOTS lines), proof sheets, editor checks. Visual: screenshots reviewed by a separate reviewer pass. On-device: owner reports.
