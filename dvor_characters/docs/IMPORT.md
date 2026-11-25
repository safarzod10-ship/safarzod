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
- Анимации на месте: перемещение задаёт игровой код. Скорость бега для синхронизации шагов — в `export/raw/*.build.json` или в `speed_mps` экшена Run: Техник 4,5 м/с, Танк 3,8 м/с, Спринтер 5,6 м/с.
- Время событий:
  - момент удара (`event_hit_s`): Техник 0,30 с, Танк 0,50 с, Спринтер 0,23 с;
  - момент способности (`event_cast_s`): Техник 0,40 с, Танк 0,20 с, Спринтер 0,30 с.
- `frustumCulled = false` стоит у мешей персонажей. Поза Defeat выходит за исходные границы, а камера арены и так видит всех.

## 3. Для слабых устройств

- `lambert: true` — `MeshLambertMaterial` вместо `MeshStandardMaterial`. Текстура и так содержит запечённый свет.
- `renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5))`.
- Тени — пятном (как в `viewer/src/main.ts`), а не shadow map.
- Отдавать `.glb` с gzip или brotli.

## 4. Пересборка из исходников

```bash
# один раз
python3.11 -m venv /opt/dvor-venv && /opt/dvor-venv/bin/pip install "bpy==4.5.17" numpy Pillow
cd dvor_characters/viewer && npm ci          # three, glTF-Transform 4.5.1, meshoptimizer 1.3.0, vite
# KTX-Software 4.4.2 (бинарник ktx) — для KTX2-варианта:
#   github.com/KhronosGroup/KTX-Software/releases/tag/v4.4.2

# персонаж из модели заказчика
/opt/dvor-venv/bin/python blender/user/build_user_character.py -- --char technik   # sprinter | tank
cd viewer && node scripts/optimize.mjs USER_CH_Technik && node scripts/sync-assets.mjs

# просмотр и проверка
npx vite                                   # http://localhost:5173/ — тестовая сцена; /preview.html?char=USER_CH_Tank&view=front
node scripts/shots.mjs USER_CH_Tank        # превью и позы в review/
npx vite build && node scripts/perf.mjs    # замеры → review/perf.json
```
