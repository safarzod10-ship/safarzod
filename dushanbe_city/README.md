# DUSHANBE — этап «Город» (Godot 4.7)

Самостоятельный проект Godot 4.7.2 (Mobile/Vulkan, Jolt). Здесь обычный жилой район Душанбе 600 × 600 м,
по которому можно гулять от третьего лица. С версии 0.5 район стоит в центре городского **полуострова**:
зелёные окраины с холмами, пляжи, скалистые мысы, набережная, море, на горизонте горы в три слоя.
В левом верхнем углу круглая миникарта (`docs/COAST.md`). Памятников, достопримечательностей, машин, NPC и интерьеров
в проекте нет: это отдельные этапы.

* Главная сцена: `scenes/main/main.tscn`. Она создаёт освещение (`EnvironmentRig`), город (`CityWorld`),
  траву (`GrassField`), игрока и сенсорное управление, меню графики.
* Исходники и генераторы лежат в `../dushanbe_city_src/` (вне проекта Godot, в APK не попадают).
* Документация: `docs/CITY.md` (город, исследование, планировка, техника), `docs/COAST.md` (полуостров,
  море, горы, миникарта), `docs/PLAYER.md` (персонаж, анимации, ступени),
  `docs/TESTS.md` (тесты и замеры), `docs/ASSETS.md` (ресурсы и лицензии).

## Быстрый старт

```bash
cd dushanbe_city
godot --headless --import                                   # импорт ресурсов
godot --headless res://tests/player_tests.tscn              # тесты персонажа (анимации, скольжение стоп, прыжок, удары)
godot --headless res://tests/step_tests.tscn                # ступени 10–40 см, лестница, пандусы, потолок
godot --headless res://tests/city_tests.tscn                # загрузка города и побережья, вода, миникарта, посадка в Prado
godot --headless res://tests/vehicle_tests.tscn             # физика Prado: разгон, 200 км/ч, торможение, крен, занос, удары, ремонт
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
python3 terrain/build_coast.py          # полуостров: рельеф, пляжи, тропинки, набережная, коллизия, миникарта
python3 terrain/make_sea_textures.py    # карта нормалей волн
python3 city/backdrop.py                # фон: пригороды на материке и горы (после build_coast)
python3 vegetation/trees.py && python3 vegetation/plants.py   # деревья, кусты, цветы, трава
python3 vegetation/make_veg_materials.py
xvfb-run godot --path ../../dushanbe_city res://scenes/testing/veg_build.tscn   # импосторы + меши + каталог
python3 props/make_catalog.py           # каталог уличной мебели
```

## Управление

* ПК: WASD — ходьба, Shift — бег, Space — прыжок, F или ЛКМ — удар, мышь — камера (клик захватывает курсор, Esc отпускает).
* Prado (`docs/VEHICLE.md`): у водительской двери E или «СЕСТЬ»; W/S газ и тормоз (тормоз на стоянке включает задний ход),
  A/D руль, пробел ручник, R ремонт, C обзор, E выйти. На Android стрелки, педали, «РУЧНИК», «ВОССТАНОВИТЬ», «ВЫЙТИ».
* Android: джойстик слева, свайп справа — камера, кнопки «БЕГ», «ПРЫЖОК», «УДАР».
* Меню ☰ (вверху справа): графика Авто / Low / Medium / High / Ultra, 30/60 FPS, показ FPS, диагностика,
  динамическое разрешение, повтор теста производительности, время суток. См. `docs/PERFORMANCE.md`.
