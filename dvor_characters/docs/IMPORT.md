# Импорт персонажей в проект «ДВОР» (Three.js + TypeScript)

Существующий интерфейс, карта и дизайн игры не меняются. Добавляются только ресурсы и один модуль.

## 1. Что скопировать

| Откуда (`dvor_characters/`) | Куда в игре | Зачем |
|---|---|---|
| `dist/USER_CH_Technik.glb`, `USER_CH_Sprinter.glb`, `USER_CH_Tank.glb` | `public/models/` | основной вариант (Meshopt + JPEG 1024) |
| `dist/USER_CH_*.ktx2.glb` | `public/models/` | необязательно: KTX2 для экономии видеопамяти |
| `node_modules/three/examples/jsm/libs/basis/basis_transcoder.{js,wasm}` | `public/basis/` | только если используете KTX2 |
| `viewer/src/characters.ts` | `src/characters/characters.ts` | загрузка, клонирование, клипы, LOD |

Требуемая версия: `three@0.187.0` или новее.

Чтобы `CharacterLibrary` загружал основной комплект, в `CHARACTER_IDS` (`characters.ts`) нужны ID с префиксом `USER_`. Есть два варианта:
- переименовать файлы в `CH_*.glb`;
- передавать ID с префиксом, как в `viewer/src/main.ts`: `'USER_' + id`.

## 2. Код

```ts
import { CharacterLibrary, CharacterInstance } from './characters/characters';

const lib = new CharacterLibrary(renderer, {
  baseUrl: '/models/',
  transcoderPath: '/basis/',   // убрать, если KTX2 не нужен
  textures: 'png',             // 'auto' = KTX2, если GPU поддерживает сжатые форматы
});

const asset = await lib.load('USER_CH_Technik');           // один раз на тип персонажа
const hero = new CharacterInstance(asset, { lambert: lowEndDevice });
scene.add(hero.root);                                      // смотрит в +Z, 1 единица = 1 м, высота 1,5 м

hero.play('Run');                                          // Idle, Run, Attack, Ability, Hit, Defeat, Victory
hero.onFinished((clip) => { if (clip !== 'Defeat') hero.play('Idle'); });

// в игровом цикле
hero.update(dt);
```

Особенности:
- Несколько одинаковых персонажей — это несколько `new CharacterInstance(asset)`. Геометрия и текстура общие, скелеты свои (`SkeletonUtils.clone`).
- Одноразовые клипы (Attack, Ability, Hit, Defeat) останавливаются на последнем кадре и вызывают `onFinished`.
- Анимации на месте: перемещение задаёт игровой код. Скорость, при которой стопа не скользит, — `RUN_SPEED` в `characters.ts`: Техник 2,35 м/с, Спринтер 2,72 м/с, Танк 1,78 м/с. Для другой скорости: `hero.play('Run', 0.15, speed / RUN_SPEED[id])` — шаги станут чаще ([RUN.md](RUN.md)).
- Время событий:
  - момент удара (`event_hit_s`): Техник 0,30 с, Танк 0,50 с, Спринтер 0,23 с;
  - момент способности (`event_cast_s`): Техник 0,40 с, Танк 0,20 с, Спринтер 0,30 с.
- `frustumCulled = false` стоит у мешей персонажей. Поза Defeat выходит за исходные границы, а камера арены и так видит всех.

## 3. Карта арены

Скопировать:
- `dist/MAP_Dvor.glb` или `MAP_Dvor.ktx2.glb` и `dist/MAP_Dvor.colliders.json` → `public/models/`;
- `viewer/src/arena.ts` → `src/characters/arena.ts`.

```ts
import { loadArena, insideCourtyard, hitsCollider } from './characters/arena';

const arena = await loadArena(lib, '/models/');   // тот же CharacterLibrary: Meshopt + KTX2
scene.add(arena.root);                            // unlit, свет запечён; 4 draw calls, 976 треугольников
// можно ли стоять в точке: внутри забора и не в ящике/блоке
const ok = insideCourtyard(x, z, 0.6) && !hitsCollider(arena.colliders, x, z);
```

Координаты карты: двор x от −10,5 до 10,5, z от −9,25 до 9,25 (+Z — юг), углы срезаны на 1,8 м. Камера в тестовой сцене (`viewer/src/main.ts`, `placeCamera`) держит персонажа в центре: угол 55°, fov 40°, расстояние 16 м. На этой камере проверено, что за краями карты нигде нет пустоты (`docs/MAP.md`). Если в игре будет другая камера (ниже угол, шире fov), прогоните `node scripts/edges.mjs`.

## 4. Для слабых устройств

- `lambert: true` — `MeshLambertMaterial` вместо `MeshStandardMaterial`. Текстура и так содержит запечённый свет.
- `renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5))`.
- Тени — пятном (как в `viewer/src/main.ts`), а не shadow map.
- Отдавать `.glb` с gzip или brotli.

## 5. Пересборка из исходников

```bash
# один раз
python3.11 -m venv /opt/dvor-venv && /opt/dvor-venv/bin/pip install "bpy==4.5.17" numpy Pillow
cd dvor_characters/viewer && npm ci          # three, glTF-Transform 4.5.1, meshoptimizer 1.3.0, vite
# KTX-Software 4.4.2 (бинарник ktx) — для KTX2-варианта:
#   github.com/KhronosGroup/KTX-Software/releases/tag/v4.4.2

# персонаж из модели заказчика
/opt/dvor-venv/bin/python blender/user/build_user_character.py -- --char technik   # sprinter | tank
/opt/dvor-venv/bin/python blender/user/hands.py --char technik                    # новые кисти (после build)
/opt/dvor-venv/bin/python blender/user/mocap_run.py --char technik                # Run из mocap (после hands)
cd viewer && node scripts/optimize.mjs USER_CH_Technik && node scripts/sync-assets.mjs

# просмотр и проверка
npx vite                                   # http://localhost:5173/ — тестовая сцена; /preview.html?char=USER_CH_Tank&view=front
node scripts/shots.mjs USER_CH_Tank        # превью и позы в review/
npx vite build && node scripts/perf.mjs    # замеры → review/perf.json
```
