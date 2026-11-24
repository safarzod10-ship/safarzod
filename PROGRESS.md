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
