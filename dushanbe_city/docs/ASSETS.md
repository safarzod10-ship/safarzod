# Ресурсы и лицензии

| Группа | Происхождение | Лицензия | Файлы |
|---|---|---|---|
| PBR-текстуры (асфальт, плитка, штукатурка, панели, кирпич, травертин, бетон, металл, профнастил, трава, земля, гравий, дерево, кора, листья, решётка) | ambientCG | CC0 1.0 | `assets/textures/LICENSES.json` (id каждого набора) |
| Кондиционеры, рольставни, камера, пластиковые стул/ящик, бочка, мешок, горшки, коробка, бетонный блок | Poly Haven | CC0 1.0 | `assets/models/props/LICENSES.json` |
| Остальная уличная мебель (скамейки, урны, контейнеры, фонари, светофоры, знаки, остановка, столбы, ограждения, ворота, детские площадки, топчан и др.) | собственные модели (Blender, `dushanbe_city_src/tools/props/`) | проект | `assets/models/props/meshes/*.res` |
| Деревья, кусты, цветы, трава | собственные процедурные модели (`dushanbe_city_src/tools/vegetation/`), текстуры листьев из ambientCG CC0 | проект | `assets/models/vegetation/` |
| Здания, дороги, фон | собственный генератор (`dushanbe_city_src/tools/city/`) | проект | `assets/city/` |
| Атлас вывесок и окон | генерируется (`atlases.py`), шрифт DejaVu Sans | DejaVu Fonts License (свободная) | `assets/textures/signs_atlas.png`, `assets/fonts/` |
| Персонаж | артефакт проекта (модель автора), риг добавлен | проект | `assets/characters/player/` |
| Анимации персонажа (idle, walk, jog, jump start/air/land, punch jab/cross) | Quaternius, Universal Animation Library [Standard], OpenGameArt, ретаргетинг в Godot 4 | CC0 1.0 | `assets/characters/animations/` (`UAL_LICENSE.txt`) |

Исходники высокого качества хранятся вне игрового проекта, в `dushanbe_city_src/`: 2K-архивы ambientCG,
сырые загрузки Poly Haven (скачиваются заново скриптами), `.blend` персонажа и мебели, все генераторы.
