# Сборка Android APK

Источник требований: официальная документация Godot **4.7** «Exporting for Android».

## Требования

| Компонент | Версия | Нужно для |
|---|---|---|
| Godot export templates | 4.7.2.stable (`android_debug.apk`, `android_release.apk`) | экспорт |
| OpenJDK | 17 | apksigner |
| Android SDK Platform-Tools | ≥ 35.0.0 | adb |
| Android SDK Build-Tools | 35.0.1 | apksigner, zipalign |
| Android SDK Platform | android-35 | — |
| Command-line Tools | latest | sdkmanager |
| NDK r28b + CMake | **не нужны** | только для Gradle-сборки (Android-плагины) |

## Настройка (один раз)

```bash
sudo tools/setup/install_toolchain.sh          # Godot, шаблоны, JDK 17, SDK
tools/android/configure_godot_android.sh        # пути SDK/JDK + debug keystore в editor_settings-4.7.tres
```

Debug-keystore: `~/.android/debug.keystore` (стандартные публичные данные Android debug:
alias `androiddebugkey`, пароль `android`). Хранится **вне** репозитория.
Release-ключ не создавался (по ТЗ — только при необходимости и с согласования).

## Пресет `export_presets.cfg` → «Android»

* Архитектура: только `arm64-v8a`.
* Gradle-сборка: выключена (готовый официальный шаблон).
* Пакет: `tj.dushanbe.game`, версия `0.1.0-stage1` (code 1), имя `DUSHANBE`.
* minSdk 24, targetSdk 36 (из шаблона Godot 4.7.2).
* Иммерсивный режим, ориентация — сенсорная альбомная.
* Исключены из сборки: `tests/`, `tools/`, `docs/`, `source_assets/`, `builds/`.
* Дополнительно включён `assets/asset_registry.json`.

## Сборка

```bash
godot --headless --import
godot --headless --export-debug "Android" builds/android/dushanbe-debug.apk
# проверка
BT=/opt/android-sdk/build-tools/35.0.1
$BT/apksigner verify --verbose builds/android/dushanbe-debug.apk
$BT/aapt2 dump badging builds/android/dushanbe-debug.apk | grep -E "package|native-code|sdkVersion"
unzip -tq builds/android/dushanbe-debug.apk
```

## Установка на телефон

```bash
adb devices                                   # включите «Отладку по USB»
adb install -r builds/android/dushanbe-debug.apk
adb logcat -s godot                           # журнал движка
```
Либо скопировать APK на телефон и установить вручную (разрешить установку из неизвестных
источников).

## Результат этапа 1

Сборка **успешна** (см. TEST_RESULTS.md): подпись v2+v3 проверена, архив целый,
`arm64-v8a`, ресурсы (3 модели, VRAM-сжатые текстуры) внутри. **На устройстве не
запускалась** — в среде нет телефона и KVM для эмулятора.

Известное некритичное предупреждение `aapt2`: ссылка `mipmap/themed_icon` на
отсутствующий `res/mipmap-anydpi-v26/themed_icon.xml` — относится к шаблону Godot
(тематическая монохромная иконка Android 13), на установку не влияет; решается
указанием monochrome-иконки в пресете на этапе 10.
