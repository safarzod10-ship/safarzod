# ДВОР — 3D-персонажи (Техник, Танк, Спринтер)

Это отдельный подпроект. В папке лежит `.gdignore`, поэтому Godot-проект DUSHANBE в этом репозитории не затрагивается. Цель — Telegram Mini App на Three.js и TypeScript.

- **Основной комплект** — `dist/USER_CH_*.glb`: модели заказчика (Tripo), заригованные, с 7 клипами, текстурой 1024 и Meshopt.
- **Запасной комплект** — `dist/CH_*.glb`: процедурные модели первой итерации.
- **Карта арены** — `dist/MAP_Dvor.glb` (976 треугольников) по двум картинкам заказчика.

Документы:
- [Отчёт с измерениями](docs/REPORT.md)
- [Импорт в игру](docs/IMPORT.md)
- [Карта арены: размеры, текстуры, проверка краёв](docs/MAP.md)
- [Бег из motion capture](docs/RUN.md)
- [Оболочка Mini App: экраны по макету](docs/APP.md)

| Папка | Содержимое |
|---|---|
| `user_meshes/` | исходные GLB заказчика (не меняются) |
| `mocap/cmu/` | записи CMU motion capture (BVH, свободная лицензия) — источник клипа Run |
| `map/` | карта: `ref/` картинки заказчика, `tools/` сборка текстур, `blender/` геометрия, `source/` .blend, `textures/`, `export/` |
| `ref/` | концепт-лист и вырезки по персонажам |
| `blender/user/` | подготовка моделей заказчика: суставы, разрез, скелет, веса, ретаргетинг; `hands.py` — новые кисти из руки; `mocap_run.py` — бег из mocap |
| `blender/` | общая библиотека (`dvor_lib.py`), клипы (`anims.py`), процедурные модели `char_*.py` |
| `source/` | исходники `.blend` (`USER_CH_*` — основной комплект) |
| `textures/` | текстуры 1024 (`USER_*`) и атласы 512 процедурных моделей |
| `export/raw/` | GLB прямо из Blender + `*.build.json` с измерениями |
| `dist/` | оптимизированные GLB (Meshopt; `*.ktx2.glb` — с KTX2) + `report.json` |
| `viewer/` | Vite + TS: тестовая сцена (`index.html`), превью (`preview.html`), скрипты оптимизации, снимков и замеров; `src/play.ts` + `artifact/` — страница «Пробежка по двору» с джойстиком (сборка: `npx vite build --config vite.play.config.ts && node scripts/artifact-assets.mjs`) |
| `viewer/src/app/`, `viewer/app.html` | оболочка Telegram Mini App по макету (главная, выбор героя, поиск боя, бой) |
| `review/` | превью с 4 ракурсов, листы поз, игровая камера, `perf.json` |
| `.claude/skills/` | установленные скиллы (MIT): `blender-image-to-3d`, `blender-*` (EL4CTEO), `threejs-mobile-gltf` |

Инструменты: Blender 4.5.17 LTS (модуль `bpy`), three.js r187, glTF-Transform 4.5.1, meshoptimizer 1.3.0, KTX-Software 4.4.2.
