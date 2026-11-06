# DUSHANBE

> **Этап «Город» (новый проект):** `dushanbe_city/` — самостоятельный проект Godot 4.7 с районом 600×600 м,
> персонажем от третьего лица и сборкой Android. Исходники и генераторы: `dushanbe_city_src/`.
> См. `dushanbe_city/README.md` и `dushanbe_city/docs/`. Проект ниже (корень репозитория) — предыдущие этапы 1–2.

# DUSHANBE

Одиночная 3D-игра с открытым миром для Android: исследование современного Душанбе
(стартовая зона ≈ 600 × 600 м вокруг памятника Исмоили Сомони), автомобили,
пешеходы, задания. Реалистичный стиль, оптимизация под мобильные GPU.

| | |
|---|---|
| Движок | Godot **4.7.2-stable** (GDScript, рендерер Mobile/Vulkan + Compatibility/GLES3) |
| 3D | Blender **4.5.15 LTS** (background + Python API), обмен — GLB/glTF 2.0 |
| Платформа | Android, ARM64 (`arm64-v8a`), minSdk 24, targetSdk 36 |
| Физика | Jolt Physics (встроена в Godot 4.4+) |
| Статус | **Этапы 1–2 из 10**. Передача проекта: [docs/HANDOFF_FOR_NEXT_AI.md](docs/HANDOFF_FOR_NEXT_AI.md) |

## Быстрый старт

```bash
# 1. Инструменты (Debian 12 / Ubuntu, один раз)
sudo tools/setup/install_toolchain.sh
tools/android/configure_godot_android.sh
# (опционально, сервер с < 8 ГБ RAM)
sudo tools/setup/create_swap.sh 4

# 2. Импорт ресурсов и автотесты
godot --headless --import
godot --headless res://tests/test_runner.tscn        # код выхода 0 = все тесты прошли

# 3. Debug APK
godot --headless --export-debug "Android" builds/android/dushanbe-debug.apk

# Всё сразу (с логами в builds/logs/)
tools/validation/run_all_checks.sh
```

В редакторе с GPU: `godot -e` в корне проекта. Главная сцена — `scenes/bootstrap/boot.tscn`
→ диагностика движка → «Проверка моделей».

## Структура

```
project.godot, export_presets.cfg, icon.svg
assets/                      игровые ресурсы (GLB) + asset_registry.json
  characters/main_character/ главный персонаж (статичный меш, PBR 2048²)
  vehicles/prado/            Land Cruiser Prado: Body + 4 колеса + руль
  monuments/ismoili_somoni/  памятник Исмоили Сомони (43 м)
source_assets/               НЕИЗМЕНЯЕМЫЕ оригиналы из артефакта + SHA256SUMS (.gdignore)
scenes/bootstrap/            загрузочная сцена
scenes/testing/              диагностика движка, AssetValidation (тестовые примитивы помечены TEST_)
scripts/core|managers|graphics|ui|utilities/
tests/                       автотесты (test_runner.tscn), визуальный захват (tests/visual)
tools/blender/               конвейер Blender → GLB
tools/validation/            анализ мешей, run_all_checks.sh
tools/android/               настройка Android-экспорта
tools/setup/                 установка инструментов, swap
docs/                        документация, отчёты, скриншоты (.gdignore)
builds/                      APK, логи, архивы (в Git не попадают)
```

## Документация

[MASTER_PLAN](docs/MASTER_PLAN.md) · [ARCHITECTURE](docs/ARCHITECTURE.md) ·
[SERVER_AUDIT](docs/SERVER_AUDIT.md) · [TOOLS](docs/TOOLS.md) ·
[ASSET_REGISTRY](docs/ASSET_REGISTRY.md) · [GRAPHICS_STANDARD](docs/GRAPHICS_STANDARD.md) ·
[ANDROID_BUILD](docs/ANDROID_BUILD.md) · [TEST_RESULTS](docs/TEST_RESULTS.md) ·
[STAGE_01_REPORT](docs/STAGE_01_REPORT.md) · [PROGRESS](docs/PROGRESS.md)

## Правила репозитория

* Оригиналы в `source_assets/` не изменяются; все производные GLB воспроизводимы скриптами.
* Ключи подписи, пароли, токены, `.godot/`, APK и архивы в Git не коммитятся (`.gitignore`).
* Числа производительности в документации — только измеренные; FPS мобильных устройств
  подтверждается только на реальном телефоне.
