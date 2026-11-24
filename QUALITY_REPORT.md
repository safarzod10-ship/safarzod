# Quality report (measured values only)

## 2026-11-24 baseline
| Metric | Value | How measured |
|---|---|---|
| Compile errors | 0 | Unity batch build log |
| Headless match exceptions | 0 in 4 min | match.log grep |
| Rounds in 4 min (5v5 bots) | 7, score 6:1 attackers | REPORT lines |
| Bomb plants by bots | 0 | REPORT bomb=False always |
| Linux build size | 597 MB | BUILD_RESULT |
| APK size | 200 MB | file size |
| Level triangles | ~65k | geometry report |
| Character triangles | ct1 50.6k, ct2 50.9k, t1 8.3k, t2 7.8k | CharSetup report |
| On-device FPS | not measured | needs owner's phone |
