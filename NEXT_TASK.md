# Next task

**Waiting on the owner:** approval of a second entrance into the bomb site (map change). Findings 2026-11-25:
the site has one usable entrance (NW passage through the arch); the "south gate" route has no direct path (map wall at z≈4.2,
NavGrid path ratio 3–6). With equal bots the defenders win 14–15 of 15 and the bomb is never planted. Proposal for the owner:
open a passage from the south gate (≈(1,7)) through the wall at z≈4 into the site courtyard, or take this up in MAP-01 (bigger level).

Done today (see PROGRESS.md 2026-11-25): Tajik kit placed, simplified SWAT models, UI screenshots and fixes (1920x1080, 2400x1080),
credits page, settings persistence test (UI-02 passing), UI-04 passing, FOV/volume settings, bot fixes (frozen carrier, corpses
blocking doorways, equal skill, staging), -botself / -gfx / -settest / NavProbe / NavGrid tools.

APK delivered 2026-11-25 (Builds/android/town.apk, 252 MB, FPS overlay on); waiting for the owner's phone readings.

Next, in order:
1. Deliver the APK; ask the owner for FPS/frame-time readings from the overlay (PERF-01) — never invent numbers.
2. After owner approval: second site entrance (TownSetup), re-run `NavGrid.Run` (approach ratios) and a 10-min `-autohost -botself`
   match: expect ≥3 plants in 10 rounds and a 30–70 % round share; update BUG-003/004.
3. UI-03: capture kill feed, hit marker and planted-bomb HUD states; UI-01: 4:3 capture.
4. MAP-01 (bigger level for 5v5) -> WPN-01 (remaining weapon models) -> BUG-002 (TP reload pose) -> BUG-005 visual check -> NET-01.

Test commands: see .claude/skills/unity-build-test. Unattended matches need `-botself` (otherwise the idle host stalls rounds).
Graphical runs on this CPU renderer need `-gfx 0` (High takes ~80 s per frame).
