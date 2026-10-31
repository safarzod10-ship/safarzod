# Инструменты и версии (этап 1)

Установка на новом сервере: `sudo tools/setup/install_toolchain.sh`, затем
`tools/android/configure_godot_android.sh`.

| Инструмент | Версия | Источник / проверка | Путь | Назначение |
|---|---|---|---|---|
| Godot Engine | **4.7.2.stable.official.ed1daf0bf** | github.com/godotengine/godot releases, SHA-512 ✔ | `/opt/godot`, `/usr/local/bin/godot` | Движок, headless-импорт, тесты, экспорт |
| Godot export templates | 4.7.2.stable | тот же релиз (`.tpz`, SHA-512 ✔); распакованы только Android + Linux x86_64 (567 МБ вместо 1.28 ГБ) | `~/.local/share/godot/export_templates/4.7.2.stable` | Android APK |
| Blender | **4.5.15 LTS** (build 2026-10-22, Python 3.11.15) | download.blender.org, SHA-256 ✔ | `/opt/blender`, `/usr/local/bin/blender` | Background-режим, Python API, glTF импорт/экспорт |
| OpenJDK | **17.0.20.1** (headless) | apt `openjdk-17-jdk-headless` | `/usr/lib/jvm/java-17-openjdk-amd64` | Рекомендован документацией Godot 4.7 для Android (JDK 21 тоже есть в системе, не используется) |
| Android cmdline-tools | latest (`commandlinetools-linux-16111833`) | dl.google.com | `/opt/android-sdk/cmdline-tools/latest` | `sdkmanager` |
| Android Platform-Tools | adb 1.0.41 / 37.0.1 | sdkmanager | `/opt/android-sdk/platform-tools` | Установка APK на устройство (`adb install`) |
| Android Build-Tools | **35.0.1** (apksigner 0.9, aapt2) | sdkmanager (версия из документации Godot 4.7) | `/opt/android-sdk/build-tools/35.0.1` | Подпись и проверка APK |
| Android Platform | **android-35** | sdkmanager | `/opt/android-sdk/platforms` | SDK-платформа |
| Android NDK / CMake | — **не установлены** | — | — | Нужны только для Gradle-сборки (плагины); экспорт из готового шаблона без них |
| Android Studio | — не устанавливалась | — | — | Не требуется |
| Python venv | Python 3.13.18; numpy 2.5.4, pygltflib 1.16.5, Pillow 13.0.0 | pip (в venv, не глобально) | `/opt/dushanbe-venv` | Анализ мешей, метаданные, отчёты |
| glTF-Transform CLI | **4.5.1** (Node 22.23.4) | npm | глобально | Валидатор Khronos (`validate`), `inspect` |
| Mesa lavapipe + Xvfb | Mesa 25.2.8, Xvfb 21.1.12 | apt `mesa-vulkan-drivers` | — | Программный Vulkan: реальный рендер скриншотов без GPU |
| GNU time | 1.9 | apt `time` | `/usr/bin/time` | Пиковая RAM и время операций |
| Git | 2.43.0 | предустановлен | — | Контроль версий |
| ImageMagick | 6.9.12-98 | предустановлен | — | Проверка/конвертация текстур (`identify`) |
| FFmpeg | 6.1.1 | предустановлен | — | Не использовался на этапе 1 (будет для видео/аудио) |
| jq 1.7, curl 8.5.0, wget 1.21.4, unzip 6.00, tmux 3.4 | — | предустановлены | — | Скрипты, загрузки, длительные задачи |

## Проверенные возможности

**Godot:** `--version`, `--headless`, создание/импорт проекта, проверка GDScript
(рантайм-тесты с автозагрузками), запуск сцен, фоновая загрузка, экспорт Android.
Примечание: `--check-only --script` вне контекста проекта не видит автозагрузки и
выдаёт ложные «Identifier not found» — для проверки используется `tests/test_runner.tscn`.

**Blender (background):** Python-скрипт, построение меша из буферов, custom normals, UV,
материалы Principled BSDF с текстурами, bmesh-проверки (non-manifold, boundary, loose,
zero-area), экспорт GLB, повторный импорт и сравнение. Cycles/EEVEE-рендер не запускался.

## Размер установленного (контейнер)
Godot 140 МБ · шаблоны 567 МБ · Blender 1.2 ГБ · Android SDK 485 МБ · venv 107 МБ ·
загрузки `/opt/dl` 1.8 ГБ (архивы, можно удалить после установки).
