# Next task

**FP-01 / BUG-001 — first-person hands.** Owner rejected procedural IK holding. Replace with artist-animated first-person arm+weapon packs.
Waiting for owner's choice from docs/fp_candidates.md (sheet sent 2026-11-24). Recommendation: DuqueCD7 AK-47 + Pistol packs (same arms, 11 animations each: idle, walk, run, fire, reload, draw...) plus ccransh sniper and a knife pack.
Then: import GLB (glTFast), extract clips, play idle/fire/reload/draw in FpView by weapon family, keep the view-model camera (FpView.Layer, FOV 52).
Running now (worker): FP-01 artist-animated arms. Done this session without Unity, awaiting verification: bot team tactics, economy/halftime/match end, graphics presets + FPS overlay, simplified ct1/ct2 sources (run tools/chars/conv_chars.py then CharSetup.BuildChars after the worker finishes).
Queue after that: GP-02/BUG-003 -> PERF-02/BUG-007 -> GFX-01 -> UI-01..04 -> MAP-01/02 -> WPN-01.
