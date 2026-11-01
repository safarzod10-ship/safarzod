# DUSHANBE — этап «Город» (Godot 4.7)

Самостоятельный проект Godot 4.7.2 (Mobile/Vulkan, Jolt). Здесь обычный жилой район Душанбе 600 × 600 м,
по которому можно гулять от третьего лица. Памятников, достопримечательностей, машин, NPC и интерьеров
в проекте нет: это отдельные этапы.

* Главная сцена: `scenes/main/main.tscn`. Она создаёт освещение (`EnvironmentRig`), город (`CityWorld`),
  траву (`GrassField`), игрока и сенсорное управление, меню графики.
* Исходники и генераторы лежат в `../dushanbe_city_src/` (вне проекта Godot, в APK не попадают).
* Документация: `docs/CITY.md` (город, исследование, планировка, техника), `docs/PLAYER.md` (персонаж),
  `docs/TESTS.md` (тесты и замеры), `docs/ASSETS.md` (ресурсы и лицензии).

## Быстрый старт

```bash
cd dushanbe_city
godot --headless --import                                   # импорт ресурсов
godot --headless res://tests/player_tests.tscn              # 8 тестов персонажа
godot --headless res://tests/city_tests.tscn                # 6 тестов загрузки города
python3 ../dushanbe_city_src/tools/city/validate_city.py    # 5 проверок планировки
godot -e                                                    # редактор (нужен GPU)
godot --headless --export-debug "Android" ../builds/android/dushanbe-city-debug.apk
```

## Пересборка города из исходников

```bash
cd dushanbe_city_src/tools
python3 textures/fetch_textures.py      # CC0 текстуры ambientCG (2K в raw/, игровые в assets/textures)
python3 city/atlases.py ../../dushanbe_city   # атлас окон и таджикских вывесок
python3 city/make_materials.py          # материалы города
python3 city/build_city.py              # планировка -> 36 чанков GLB + JSON экземпляров
python3 city/backdrop.py                # фон: дальние кварталы и горы
python3 vegetation/trees.py && python3 vegetation/plants.py   # деревья, кусты, цветы, трава
python3 vegetation/make_veg_materials.py
xvfb-run godot --path ../../dushanbe_city res://scenes/testing/veg_build.tscn   # импосторы + меши + каталог
python3 props/make_catalog.py           # каталог уличной мебели
```

## Управление

* ПК: WASD — ходьба, Shift — бег, Space — прыжок, мышь — камера (клик захватывает курсор, Esc отпускает).
* Android: джойстик слева, свайп справа — камера, кнопки «БЕГ» и «ПРЫЖОК».
* Меню ☰ (вверху слева): графика Low / Medium / High, время суток.
