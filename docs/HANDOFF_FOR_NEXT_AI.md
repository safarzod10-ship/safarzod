# DUSHANBE — передача проекта (для следующего разработчика / ИИ)

Состояние на 2026-11-01. Ветка `ccr-15022159-9x3k1d`, репозиторий `safarzod10-ship/safarzod`.
Этап 1 — завершён. Этап 2 — реализован технически, документация этапа 2 сокращена (этот файл).
**Этап 3 не начинался.**

## 1. Идея игры
Одиночная 3D open-world игра для Android про современный Душанбе (Таджикистан).
Стартовая зона 600 × 600 м вокруг памятника Исмоили Сомони. Реалистичный стиль, мобильная оптимизация.
В будущем: персонаж с анимациями, Toyota Land Cruiser Prado (вход/выход, управление), трафик,
пешеходы, задания, смена погоды/суток, Low/Medium/Ultra, сохранения, сенсорное управление.
План по этапам: `docs/MASTER_PLAN.md`.

## 2. Инструменты (проверенные версии)
Godot 4.7.2-stable (GDScript, рендерер Mobile/Vulkan + Compatibility/GLES3, Jolt Physics),
Blender 4.5.15 LTS (только background + Python API), OpenJDK 17, Android SDK (build-tools 35.0.1,
platform android-35), glTF-Transform 4.5.1, Python venv (numpy, scipy, pygltflib, Pillow).
Установка на чистый Debian/Ubuntu: `sudo tools/setup/install_toolchain.sh`, затем
`tools/android/configure_godot_android.sh`. Подробно: `docs/TOOLS.md`, `docs/ANDROID_BUILD.md`.

## 3. Как запустить и проверить
```bash
godot --headless --import                          # импорт ресурсов (~1 мин первый раз)
godot --headless res://tests/test_runner.tscn      # 71 автотест, код выхода 0 = OK
tools/validation/run_all_checks.sh                 # всё: исходники, Blender, валидатор, тесты, APK
godot --headless --export-debug "Android" builds/android/dushanbe-debug.apk
godot -e                                           # редактор (нужен GPU)
```
Скриншоты реальным рендером без GPU (Mesa lavapipe + Xvfb): `tools/validation/env_capture.sh`,
`tools/validation/lighting_probe.sh`. FPS с сервера НЕ показатель мобильной производительности.

## 4. Что сделано

### Этап 1 (основа)
- Godot-проект, автозагрузки: GameManager, SettingsManager, SaveManager, AssetRegistry, SceneLoader,
  PerformanceMonitor, InputManager (`docs/ARCHITECTURE.md`).
- Пресеты графики Low/Medium/Ultra (сохраняются), выбор рендерера (после перезапуска).
- Модели из артефакта https://claude.ai/artifact/V319FyaEBZx5atFp4i7bg3 → GLB (оригиналы с SHA-256 в
  `source_assets/artifact_V319FyaEBZx5atFp4i7bg3/`).
- **Освещение исправлено измерениями** (сцена `scenes/testing/lighting_calibration.tscn`, патчи с известным
  альбедо): синие тени = ambient только от неба → нейтральный цвет ambient по высоте солнца;
  пересвет Compatibility = клиппинг 3D-буфера после экспозиции → линейный тонмаппер + своя экспозиция.
  Таблица замеров: `docs/reports/lighting_probes_stage1_final.txt`.
- **Prado** (`tools/blender/asset_pipeline_v2.py`, отчёт `docs/reports/prado_v2.json`): колёса выпрямлены по
  плоскости 8 гаек (передние были повёрнуты на 17°, задние ±6°), пропорции под J150 (ширина 1.887 м,
  высота 1.843 м, база 2.79 м, колёса 0.777 м), 8 материалов. Отдельные: кузов, 4 колеса, руль.
- **Памятник Сомони**: закрыт зазор 0.97 м под короной (корона висела без опоры), высота 43 м, 5 материалов
  (золото, скульптура, декор, светлый/тёмный камень), UV. Статуя смотрит на запад (сверено с контуром OSM).
- Персонаж: сохранён как есть (1.75 м, PBR 2048²). **Скелета/весов/анимаций нет** — в источнике их нет.

### Этап 2 (природный Душанбе)
- Система координат и данные мира: `assets/world/world_config.json` (начало = памятник, +X восток,
  −Z север, метры; зоны, чанки, закладки камеры). Реальная планировка из OpenStreetMap
  (`assets/world/osm_layout.json`, ODbL), рельеф из SRTM (AWS Terrain Tiles). Генератор: `tools/world/build_world_data.py`.
- Рельеф: 8×8 чанков по 100 м (сетка 2 м, юбки против трещин LOD) + окраины до 1.6 км,
  коллизии HeightMapShape3D. Игровая зона 600×600 м, перепад ±8.5 м (реальный уклон к югу).
  `tools/blender/build_terrain.py`, `scripts/world/terrain_system.gd`.
- Горы: реальный рельеф Гиссарского хребта (до 4477 м, радиус 61.5 км), 3 плана, сжатие дистанции с
  сохранением углового размера + умеренное вертикальное усиление (×1.15/1.5/1.7 — художественное допущение),
  снег выше ~3300 м. `tools/blender/build_mountains.py`.
- Материалы ландшафта: 4 PBR-слоя (газон, сухая трава, лёсс, гравий/будущие дороги) по маске из OSM,
  анти-тайлинг, макро-вариации, мокрая поверхность. Текстуры CC0 ambientCG (`assets/textures/LICENSES.json`,
  скрипт `tools/textures/fetch_and_prepare.py`).
- Растительность: чинар, карагач, пирамидальный тополь, туя (LOD0/LOD1) + самшит, можжевельник, роза +
  трава (геометрия). 1422 дерева, 2454 куста, размещены по OSM (аллеи, парк Рудаки, вдоль проспекта),
  не на дорогах/площади. MultiMesh, ячейки 50 м, трава стримится вокруг камеры.
  `tools/blender/build_vegetation.py`, `scripts/world/vegetation_system.gd`.
- Небо (свой sky-шейдер: облака, солнце, луна, звёзды), DayNightCycle (астрономия для широты 38.57°,
  06/12/18/00, скорость/пауза), WeatherManager (Clear, Cloudy, Overcast, LightRain, Rain, Fog, плавные переходы,
  дождь частицами, влажность для будущих мокрых дорог). `scripts/environment/`.
- Пресеты управляют реальными параметрами: дальность/плотность травы, дальность деревьев и LOD, кусты,
  тени, размер radiance-кубмапы неба, число капель дождя, внутреннее разрешение, MSAA.
- Камера разработчика + панель (время, погода, закладки, вверх/вниз, сенсорный джойстик):
  `scripts/tools/dev_camera.gd`, `scripts/ui/environment_panel.gd`.
- Главная сцена APK: `scenes/bootstrap/boot.tscn` → `scenes/world/dushanbe_environment.tscn`.
- Скриншоты реальным рендером: `docs/screenshots/stage2/` (обзор, горы, трава, деревья, 06/12/18/00,
  облачно/пасмурно/дождь/туман, Low/Medium/Ultra, Compatibility).

### Памятник v3 (переработка 2026-11-01)
Текущий памятник переработан: фото-исследование, разделение на 14 элементов, фаски/подразделение,
**лежащие львы из старой модели** (на фото львы лежат), материалы по фото (бронзовая статуя и львы,
позолота проёма/короны/скипетра, кремовая облицовка, красный гранит), 3 атласа AO + CC0-сканы,
LOD0/1/2 с измеренными порогами, теневые прокси, коллизия. Сцена проверки:
`scenes/testing/monument_inspection.tscn` (кадры 20/10/5/2/1 м, виды как на фото). Документы:
`docs/MONUMENT_*.md` (6 шт.), отчёты `docs/reports/monument_v3_*.json`. Пересборка: шаг 3b
`tools/validation/run_all_checks.sh` (~8 мин CPU). Нерешённые дефекты — `MONUMENT_VISUAL_QA.md` §5.

### Старый памятник
`assets/monuments/old_monument/old_monument.glb` — **только хранится** (из него в v3 взяты только
львы — см. `MONUMENT_TEXTURE_TRANSFER.md`), в игре не используется,
из APK исключён. См. `assets/monuments/old_monument/README.md`.

## 5. Проверено / не проверено
| | Статус |
|---|---|
| Автотесты (71: настройки, сохранения, модели, рельеф, коллизии, небо, время суток, погода, пресеты, ссылки на ресурсы) | ✅ |
| glTF-валидатор для всех GLB | ✅ 0 ошибок |
| Реальный программный рендер (Mobile/Vulkan и Compatibility) | ✅ скриншоты |
| Debug APK (arm64-v8a, подпись v2/v3, структура архива) | ✅ собирается |
| Запуск на телефоне, FPS | ⛔ НЕ проверялось (нет устройства) |

Нагрузка (программный рендер, вид в парке): Low ≈131 draw calls / 0.26 млн треуг.,
Medium ≈209 / 0.37 млн, Ultra ≈291 / 0.82 млн (крупный план травы Ultra до 1.37 млн — только для мощных устройств).

## 6. Известные проблемы и что сделать дальше
1. **Проверить APK на реальном Android** (Low/Medium/Ultra, FPS из оверлея). Возможно, понадобится урезать Ultra-траву.
2. Листва: `ALPHA_SCISSOR` давал чёрную листву в Mobile-рендере (lavapipe), заменено на ручной `discard`.
   Проверить на реальном GPU.
3. Compatibility: на полуденном солнце белые поверхности клиппятся (линейный тонмаппер) — приемлемо для Low.
4. При выходе из сцены окружения иногда предупреждение «4 ObjectDB instances leaked» — не исследовано.
5. Prado: длина 4.47 м против 4.84 (не исправлялась, чтобы не искажать арки); двери/стёкла/фары не
   отделены от кузова (слиты в исходнике), нет UV для текстур кузова.
6. Персонаж: нужен риг (скелет + веса) и анимации — этап 3/4.
7. Документация этапа 2 сокращена: этот файл вместо отдельных TERRAIN_SYSTEM / VEGETATION_SYSTEM /
   WEATHER_SYSTEM / DAY_NIGHT_SYSTEM / ANDROID_PERFORMANCE / STAGE_02_REPORT — при необходимости развернуть.
8. Данные кешей (SRTM-тайлы, архивы ambientCG) не в репозитории: пересоздаются скриптами
   `tools/geodata/fetch_dem.py`, `tools/textures/fetch_and_prepare.py` (нужен интернет).

## 7. Следующий этап (3) — по плану
Персонаж от третьего лица: риг, анимации idle/walk/run/jump (AnimationTree), контроллер, сенсорный
джойстик (писать в `InputManager.virtual_stick`), камера персонажа. Затем (этап 4) Prado на VehicleBody3D.
