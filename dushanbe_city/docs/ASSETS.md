# Ресурсы и лицензии

| Группа | Происхождение | Лицензия | Файлы |
|---|---|---|---|
| PBR-текстуры (асфальт, плитка, штукатурка, панели, кирпич, травертин, бетон, металл, профнастил, трава, земля, гравий, песок, скала, дерево, кора, листья, решётка) | ambientCG | CC0 1.0 | `assets/textures/LICENSES.json` (id каждого набора) |
| Кондиционеры, рольставни, камера, пластиковые стул/ящик, бочка, мешок, горшки, коробка, бетонный блок | Poly Haven | CC0 1.0 | `assets/models/props/LICENSES.json` |
| Остальная уличная мебель (скамейки, урны, контейнеры, фонари, светофоры, знаки, остановка, столбы, ограждения, ворота, детские площадки, топчан и др.) | собственные модели (Blender, `dushanbe_city_src/tools/props/`) | проект | `assets/models/props/meshes/*.res` |
| Деревья, кусты, цветы, трава | собственные процедурные модели (`dushanbe_city_src/tools/vegetation/`), текстуры листьев из ambientCG CC0 | проект | `assets/models/vegetation/` |
| Здания, дороги, фон | собственный генератор (`dushanbe_city_src/tools/city/`) | проект | `assets/city/` |
| Рельеф полуострова, набережная, маска моря, миникарта, карта нормалей волн | собственный генератор (`dushanbe_city_src/tools/terrain/`) | проект | `assets/terrain/`, `assets/ui/minimap.png`, `assets/textures/sea/` |
| Валуны | процедурные (`scripts/tools/build_coast_assets.gd`), текстура скалы ambientCG Rock030 | проект / CC0 | `assets/models/props/meshes/boulder_*.res` |
| Атлас вывесок и окон | генерируется (`atlases.py`), шрифт DejaVu Sans | DejaVu Fonts License (свободная) | `assets/textures/signs_atlas.png`, `assets/fonts/` |
| Персонаж | артефакт проекта (модель автора), риг добавлен | проект | `assets/characters/player/` |
| Анимации ходьбы, бега, прыжка, стойки | CMU Graphics Lab Motion Capture Database (mocap.cs.cmu.edu), BVH: cgspeed; клипы 16_16 (ходьба), 09_09 (бег), 16_01 (прыжок, стойка), 136_25 (ходьба назад), 113_18 (шаги вбок), 16_33 (остановка после ходьбы), 127_05 (остановка после бега); зеркало BVH: github.com/Shriinivas/cmubvh | свободно, включая коммерческое; указание источника | `assets/characters/animations/cmu/`, `player_mocap.res` |
| Toyota Land Cruiser Prado J150 (модель) | загружена автором проекта (`prado-2021-no-plates.glb`); подготовлена в Blender | по условиям автора проекта | `assets/vehicles/prado/` |
| Звук двигателя (6 петель) | OpenGameArt «racing car engine sound loops» | CC0 | `assets/audio/vehicle/engine_*.wav` |
| Визг шин | OpenGameArt «car tire squeal skid loop», qubodup | **CC-BY 3.0** (указание автора: qubodup) | `assets/audio/vehicle/tyre_squeal.wav` |
| Удары, стекло, стук подвески | OpenGameArt «crash collision» (qubodup), «75 CC0 breaking/falling/hit sfx» | CC0 | `assets/audio/vehicle/*.ogg` |
| Анимации удара (jab, cross), плавания (Swim_Fwd / Swim_Idle), двери и посадки (Interact, Sitting_Enter / Exit / Idle), PickUp | Quaternius, Universal Animation Library [Standard], OpenGameArt | CC0 1.0 | `assets/characters/animations/` (`UAL_LICENSE.txt`) |
| Звуки шагов: асфальт, плитка, песок, трава (по камню и песку Fantozzi), грунт (гравий Corsica_S), твёрдый пол | OpenGameArt: «Fantozzi's Footsteps», «42 snow and gravel footsteps», «Footsteps» | CC0 1.0 | `assets/audio/steps/` (`LICENSES.txt`) |

Исходники высокого качества хранятся вне игрового проекта, в `dushanbe_city_src/`: 2K-архивы ambientCG,
сырые загрузки Poly Haven (скачиваются заново скриптами), `.blend` персонажа и мебели, все генераторы.
