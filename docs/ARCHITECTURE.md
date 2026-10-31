# Архитектура DUSHANBE (этап 1)

## Автозагрузки (singletons)

Порядок загрузки задан в `project.godot` и важен: зависимости идут раньше зависящих.

| # | Узел | Файл | Ответственность |
|---|------|------|-----------------|
| 1 | `SaveManager` | `scripts/managers/save_manager.gd` | Атомарная запись (tmp → rename). Настройки: `user://settings.cfg` (ConfigFile). Прогресс: `user://saves/slot_N.json` с `format_version`; повреждённые/новее-чем-игра слоты отвергаются. |
| 2 | `SettingsManager` | `scripts/managers/settings_manager.gd` | Пресеты Low/Medium/Ultra (`GraphicsPresets`), применение параметров вьюпорта, выбор рендерера (через override-файл, после перезапуска), `get_capabilities()`; сигнал `graphics_applied`. |
| 3 | `AssetRegistry` | `scripts/managers/asset_registry.gd` | Чтение `assets/asset_registry.json` (источник, лицензия, ожидаемые характеристики), `validate_paths()`. |
| 4 | `PerformanceMonitor` | `scripts/managers/performance_monitor.gd` | Каждые 0.5 с — реальные значения `Engine`/`Performance` (FPS, худший кадр, draw calls, примитивы, видеопамять); история 60 с; `summary()`. Ничего не синтезирует. |
| 5 | `InputManager` | `scripts/managers/input_manager.gd` | Регистрация действий (клавиатура, геймпад), `get_move_vector()`, `virtual_stick` (для будущего экранного джойстика), обзор камеры пальцем в правой половине экрана → `consume_look_delta()`. |
| 6 | `SceneLoader` | `scripts/managers/scene_loader.gd` | Фоновая загрузка (`ResourceLoader.load_threaded_*`), прогресс, `change_scene()`, `load_resource_async()` — основа будущего стриминга чанков города. |
| 7 | `GameManager` | `scripts/core/game_manager.gd` | Состояния BOOT/MENU/LOADING/PLAYING/PAUSED, пауза, сохранение настроек при сворачивании на Android (`NOTIFICATION_APPLICATION_PAUSED`), кнопка «Назад», журнал ошибок загрузки. |

## Компоненты сцен

* `GraphicsApplier` (`scripts/graphics/graphics_applier.gd`) — узел в каждой 3D-сцене;
  применяет сценовую часть пресета: тени солнца (дистанция, сплиты), дальность камеры,
  glow, туман по глубине у границы дальности.
* `DiagnosticsOverlay` (`scripts/ui/diagnostics_overlay.gd`) — UI диагностики и переключения
  качества/рендерера, кнопки ≥ 64 px по высоте (касание пальцем).
* `OrbitCamera`, `MeshStats` (`scripts/utilities/`) — тестовая камера и сбор статистики мешей.

## Поток запуска

```
boot.tscn ─► проверка AssetRegistry ─► SceneLoader.change_scene(diagnostics.tscn)
                                         ▲                     │ кнопка
                                         └── asset_validation.tscn ◄┘
```

## Поток настроек графики

```
UI-кнопка ─► SettingsManager.set_quality(q)
             ├─ Viewport: scaling_3d_scale, msaa_3d, FXAA, mesh_lod_threshold, анизотропия
             ├─ RenderingServer: размер атласа направленных теней, качество мягких теней
             ├─ Engine.max_fps = 30 / 60
             ├─ emit graphics_applied ─► GraphicsApplier (тени/дальность/glow в сцене)
             └─ SaveManager.save_settings()  (атомарно)
```

Смена рендерера (`mobile` ↔ `gl_compatibility`) записывает `user://renderer_override.cfg`
(подключён через `application/config/project_settings_override`) и применяется после
перезапуска — переключение рендерера на лету в Godot невозможно.

## Решения и обоснования

* **Без Gradle-сборки** на этапе 1: экспорт из официального готового шаблона — не нужен NDK,
  сборка 11 с. Gradle понадобится только для Android-плагинов.
* **Jolt Physics** — стабильнее штатного движка для транспорта (этап 4).
* **Фоновая загрузка с `use_sub_threads=false`**: при `true` Godot 4.7.2 оставлял ~5
  неосвобождённых RefCounted при выходе (проверено `--verbose`).
* **Методы, а не лямбды** для сигналов автозагрузок из сцен — Godot автоматически
  отключает их при удалении узла.
* Ориентация моделей: вперёд = **+Z** (Godot `Vector3.MODEL_FRONT`), метры, Y вверх.

## Расширение (будущие этапы)
* `scripts/player/`, `scripts/vehicles/`, `scripts/world/` создаются на этапах 3–5 (сейчас
  не создаются пустыми намеренно).
* Экранный джойстик пишет в `InputManager.virtual_stick`; игровой код не меняется.
* Стриминг города: `SceneLoader.load_resource_async(chunk_path, callback)`.
