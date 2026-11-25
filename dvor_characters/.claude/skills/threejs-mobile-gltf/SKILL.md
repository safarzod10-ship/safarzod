---
name: threejs-mobile-gltf
description: Three.js (r183+) reference for loading animated glTF/GLB characters on mobile web (Telegram Mini App) - GLTFLoader with Meshopt and KTX2, AnimationMixer clip control, performance profiling and mobile performance budgets. Use when integrating or profiling DVOR character GLBs in three.js.
license: MIT
---

Excerpts from Nice-Wolf-Studio/claude-skills-threejs-ecs-ts (MIT, see LICENSE). Read only the file for the step at hand:

- `model-loading.md` — GLTFLoader, DRACO/Meshopt/KTX2 decoders, caching, cloning skinned models
- `animation-systems.md` — AnimationMixer, cross-fades, one-shot clips, events
- `performance-profiling.md` — renderer.info, frame timing, draw-call budgets
- `performance.md` — mobile budgets: pixel ratio, materials, shadows, memory

Project integration code: `dvor_characters/viewer/src/characters.ts`; measured results: `dvor_characters/docs/REPORT.md`.
