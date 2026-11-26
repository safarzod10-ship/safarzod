# ДВОР — 3D-персонажи (Техник, Танк, Спринтер, Снайпер, Медик)

Это отдельный подпроект. В папке лежит `.gdignore`, поэтому Godot-проект DUSHANBE в этом репозитории не затрагивается. Цель — Telegram Mini App на Three.js и TypeScript.

- **Герои** — `dist/USER_HERO_*.glb`: пять моделей заказчика (второй набор Tripo, `user_meshes/v2/`), заригованы
  (`blender/user/build_v2.py`, суставы `joints_v2.py`), 7 клипов, бег из motion capture (`run_v2.py`), текстура 1024, Meshopt.
  Старые модели (первый набор Tripo и процедурные) удалены.
- **Карта арены** — `dist/MAP_Dvor.glb` (976 треугольников) по двум картинкам заказчика.

Документы:
- [Отчёт с измерениями](docs/REPORT.md)
- [Импорт в игру](docs/IMPORT.md)
- [Карта арены: размеры, текстуры, проверка краёв](docs/MAP.md)
- [Бег из motion capture](docs/RUN.md)
- [Оболочка Mini App: экраны по макету](docs/APP.md)
- [Баланс пяти героев](docs/BALANCE.md)

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
