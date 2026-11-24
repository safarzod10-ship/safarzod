# Next task

**FP-01 / BUG-001 — first-person weapon view.** Weapon must sit lower-right with the barrel forward, both hands on it, for knife, usp, deagle, ak, awp. Then FP-02 (reload/switch/recoil).
Files: Assets/Scripts/Anim/FpView.cs (pose table lines ~80-110, arm placement ~115-130), Assets/Scripts/Anim/WeaponRig.cs, Assets/Editor/CharLab.cs (SheetFp proof sheet).
Verify: CharLab.SheetFp sheet + in-game screenshots (Build.LinuxTown, -autohost -shots).

Queue after that: GP-02/BUG-003 (bots plant/defuse, balance) -> PERF-02/BUG-007 (decimate SWAT + LOD) -> GFX-01 presets -> UI-01..04 -> MAP-01/02 -> WPN-01.
