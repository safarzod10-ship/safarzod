# Next task

**Blocked on Unity being free** — the FP-01 worker (artist-animated arms) owns Unity and was waiting for the owner's permission to run its proof-sheet render.

When Unity is free, in this order (one Unity process at a time):
1. `-executeMethod TownKit.Apply` (places the Tajik kit; read KIT_PLACED / KIT_SKIP lines), then `TownSetup.Preview` / `-mapshots` to check every placed piece looks right and blocks no route.
2. `python3 -I tools/chars/conv_chars.py` + `CharSetup.BuildChars` (simplified ct1/ct2), check sheets.
3. `Build.LinuxTown`; graphical run with `-uishots <dir>` (12 screens: menu bots/LAN, 3 settings tabs, loading, HUD freeze/live, buy, scoreboard, pause, match end) — review each screen at 1920x1080 and a 20:9 phone size (2400x1080).
4. Headless 10-minute match (`-autohost -batchmode -nographics`): count ROUND_END / BOMB_PLANTED / BOMB_DEFUSED / HALFTIME; expect ≥3 plants in 10 rounds, win share 30–70%.
5. Update FEATURES/BUGS/QUALITY_REPORT/PROGRESS; commit; new APK for the owner (FPS overlay on) to measure on a phone.

Not yet wired: field-of-view setting (Player.fovBase is fixed at 68), SFX/voice volume split (only master volume is offered in settings).
Queue after that: MAP-01 (bigger level for 5v5) -> WPN-01 (remaining weapon models) -> BUG-002/005 -> NET-01 two-process LAN test.
