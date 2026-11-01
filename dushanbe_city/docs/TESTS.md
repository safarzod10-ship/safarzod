# Тесты и замеры

Все проверки воспроизводимы командами из README. Результаты последнего прогона:

## Планировка (`python3 dushanbe_city_src/tools/city/validate_city.py`)
| Проверка | Результат |
|---|---|
| Пешеходная сеть (тротуары, пандусы, переходы, скругления, растр 0,5 м) | PASS: 1 компонента, 100% (`docs/maps/pedestrian_network.png`) |
| Здания не пересекают дороги и друг друга | PASS |
| Резервные участки пусты (здания, деревья, объекты) | PASS |
| Ни деревьев, ни объектов на проезжей части | PASS |
| 36 чанков: GLB + JSON | PASS |

## Город в движке (`godot --headless res://tests/city_tests.tscn`)
```
PASS city loaded in 8789 ms: 36 chunks
PASS colliders 1157, trees 1805, props 3944, multimeshes 1421
PASS all categories resolve to assets (missing: [])
PASS player spawned
PASS player on sidewalk at spawn: y=0.151 (≈0.15)
PASS player runs 5 s through the city: moved 18.9 m, y=0.151
```

## Персонаж (`godot --headless res://tests/player_tests.tscn`)
```
PASS idle: lowest foot/toe joint height 0.033 m (0.0..0.12)
PASS walk 1.40 m/s: stance foot slide 0.051 m/s (< 0.15)
PASS walk: stance ankle height 0.090 m vs idle 0.091 (|diff| < 0.02 — no floating/sinking)
PASS run 4.00 m/s: stance foot slide 0.110 m/s (< 0.3)
PASS curb 0.15 m climbed: y=0.151, z=-15.47
PASS step 0.30 m climbed: y=0.301
PASS jump height 1.04 m (0.8..1.2)
PASS landed on floor: y=0.000
```
Найдено и исправлено в ходе проверки: длины шага в контроллере были на 3% больше фактических
(скольжение 0,05/0,14 м/с). Подставлены измеренные значения. Замер скольжения делается по кадрам «плоской
стопы» (голеностоп и носок у минимума), дерево анимаций синхронизировано с физикой.

## Рендер
Скриншоты сделаны реальным рендером Godot (Vulkan Mobile на Mesa lavapipe, без GPU): `docs/screenshots/`.
Draw calls в типичных видах: 140–320. Треугольники в кадре: 0,35–1,25 млн (High). FPS с сервера
не отражает скорость телефона, поэтому не приводится. **Проверка на реальном Android-устройстве не выполнялась.**
