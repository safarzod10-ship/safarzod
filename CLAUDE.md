# Project rules (read first in every session)

Game: tactical team shooter (attackers = "банда", defenders = "спецназ", plant/defuse one bomb), Tajik old-town setting.
Gameplay reference: Counter-Strike 1.6. Visual reference: Counter-Strike 2. Original assets only.
Target platform: Android phones (ARM64, Vulkan/GLES3). Desktop Linux build is used for automated checks only.

## Hard rules
- No generated or synthesized audio. Only real recordings with commercial-use licences (CC0 / CC-BY). Credits in Assets/Resources/Sounds/CREDITS.md and ASSET_LICENSES.md.
- Every third-party asset must have a licence that allows commercial use; record it in ASSET_LICENSES.md before committing.
- Never copy assets, maps, names or branding of existing commercial games.
- Do not mark a feature "passing" in FEATURES.json without the verification named in its acceptance test. Never weaken tests.
- Do not claim performance numbers that were not measured. FPS on phones is only known when measured on a phone.
- Commit and push after every finished step (branch ccr-572a59f7-ogt5pj). Keep commits free of build output, Library/, Builds/.
- Disk is small (~4 GB free). Delete temporary renders/builds; never leave more than 1 GB of own temp files.
- Only one Unity process may touch the project at a time.

## Environment
- Unity 6000.3.29f1 at /opt/unity/6000.3.29f1/Editor/Unity (licence activated in this container; new containers need tools/unity/install_unity.sh + tools/unity/activate_license.sh).
- URP 17.3, Netcode for GameObjects 2.14, AI Navigation 2.0, glTFast 6.21, uGUI.
- No GPU: rendering in this container is Mesa llvmpipe (CPU). Screenshots are slow but correct; FPS here is meaningless for phones.
- Android build needs: CMake 3.22.1 in AndroidPlayer/SDK/cmake, proxy CA imported into AndroidPlayer/OpenJDK cacerts, ~/.gradle/gradle.properties with https proxy (see .claude/skills/unity-build-test).

## Layout
- Assets/Scenes/Town.unity — the game level (match). Assets/Scenes/Bazaar.unity — old procedural map (legacy). Assets/Scenes/CharLab.unity — character lab.
- Assets/Scripts: Game.cs (rules), Player.cs (fighter, netcode), BotBrain.cs (AI), Hud.cs (UI, input, LAN), Visuals.cs (CharView, WeaponModels, Fx/sounds), Weapons.cs (weapon table), Anim/* (character rig, body animation, weapon rig, first-person view).
- Assets/Editor: Build.cs (Build.LinuxTown, Build.AndroidTown), TownSetup.cs (level import), TownGame.cs (match objects), TownGraffiti.cs, CharSetup.cs / WeaponSetup.cs / CharLab.cs (characters, weapons, proof sheets).
- tools/: install scripts and asset pipelines. docs/: plans and reports.

## Workflow per task
read NEXT_TASK.md -> implement -> compile -> run (headless match and/or screenshots) -> look at results -> fix -> update FEATURES.json, PROGRESS.md, BUGS.json, NEXT_TASK.md -> commit + push.
