# Progress log

## Before 2026-11-24 (summary)
- Unity 6000.3.29f1 + Android module installed; licence activated.
- Town level: user-supplied AI-generated mesh repaired, extended (streets, backdrop), PBR-textured (Poly Haven), HDRI sky, Unity scene.
- Real recorded sound set (73 files, CC0/CC-BY) with credits.
- Four characters with retargeted animations, weapon holding with IK, first-person arms (needs rework), 5 weapon models.
- Graffiti SAFARZOD / "11 A БА ПЕШ." on the east-lane wall.
- First working headless bot match (7 rounds, 0 exceptions). APK bazar-match.apk delivered to owner (not yet tested on device).

## 2026-11-24 — Project Phoenix start
- Audit: see QUALITY_REPORT.md. Baseline tag `baseline-before-phoenix` (local; tag push refused by remote).
- Created CLAUDE.md, MASTER_PLAN.md, FEATURES.json (29 requirements), BUGS.json (8), RESEARCH.md, QUALITY_REPORT.md, NEXT_TASK.md, ASSET_LICENSES.md, project skill unity-build-test.

## 2026-11-24 — Phoenix iteration 1
- First person: separate view-model overlay camera (layer 30, FOV 52) — weapon no longer stretched, cannot clip walls. Procedural hand IK rejected by owner; artist-animated FP packs chosen (DuqueCD7 AK + Pistol, ccransh sniper, teenjust500 knife); integration delegated to a worker.
- Fast C# type check without Unity: /opt/unity-dl/cscheck.sh (mono csc against Unity + package assemblies).
- Bots: team plan for one-site levels — defenders hold angles on the two entries, attackers split over south gate and east lane/arch, stage, execute together, carrier plants under escort; round/bomb events logged (ROUND_END, BOMB_PLANTED, BOMB_DEFUSED, HALFTIME, MATCH_END).
- Rules: classic economy (win 3250, loss 1400+500/streak max 3400, +800 band on plant), half-time side swap after 12 rounds, 12 s match-end with MVP.
- Characters: simplified special-forces sources prepared (ct1 106k->32k, ct2 72k->19k incl. carried gun).

## 2026-11-24 (afternoon)
- Tajik kit finished by the Blender worker: door, column, aivan section, panjara window, majolica panel, tandoor, tapchan, grape trellis (all original, CC0 Poly Haven base textures). Added to Assets/Town/Kit, scripts in tools/tjkit, sheet docs/kit/kit_sheet.png.
- TownKit.Apply editor tool: snaps wall pieces to real wall surfaces, stands them on the ground, skips floor props that overlap geometry or are near starts/bomb site, adds colliders.
- UI redesign (UiKit.cs + Hud.cs rewrite): menu over the live map with bots and Wi-Fi pages, settings modal (graphics/controls/sound) wired to GameSettings, loading screen, new HUD, buy menu with prices and affordability, pause, scoreboard, match-end screen with MVP. Fonts Russo One + PT Sans Narrow (OFL). Compile-checked only; screenshots pending until Unity is free.

## 2026-11-25
- First-person arm packs finished by the worker (knife in fist, sniper framing, pistol reload offset, in-game -fpshots check); in-game frames sent to owner. Knife arm material named "DMC5_Nero_BareArm" flagged in ASSET_LICENSES.md (replace before release unless cleared).
- TownKit.Apply run: 13 kit pieces placed in Town.unity (3 carved doors, 4 panjara windows, 2 majolica panels, 2 tapchans, tandoor, trellis); one panel removed (overlapped a window), south door moved over the mesh's plain door. Renders docs/kit/kit_on_map.jpg.
- Characters rebuilt from simplified SWAT sources (ct1 19.4k, ct2 11.9k tris).
- Settings: FOV slider (60–90°) drives the player camera; effects/voice volume sliders (pain/death sounds = voice).
- BUG-005: corpse hips travel clamped (0.35 m, shorter near walls).
- UI review of 12 screens at 1920x1080 (Low preset, CPU renderer: High took ~83 s per frame): fixed translucent modals (linear blending showed 4 % of the menu through), stretched slider knobs, buy list colliding with Close, unaffordable items not dimmed, match-end title over the HUD, menu camera inside a wall, loading screen not captured. `-gfx 0|1|2` test switch added.
- Credits page (АВТОРЫ) generated from the licence records; loading screen with own map render; settings persistence verified across two processes (UI-02 passing); UI-04 passing.
- Bots: fixed carrier freezing (path re-requested each frame), corpses blocking doorways (agent disabled on death), wedged agents re-plan, attackers stage out of sight, carrier pushes during the execute, skill spread ±0.05. 10-min `-botself` match: 15 rounds, halftime and MATCH_END at 13 work, 0 exceptions. Balance: defenders win 14–15/15, 0 plants — the site has a single entrance (NavGrid analysis); second entrance proposed to the owner.
