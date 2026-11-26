# ДВОР

Telegram Mini App: арена «Царь двора», 2 на 2, пять героев. Играть: [@dvor_app](https://t.me/dvor_app) или
https://safarzod10-ship.github.io/safarzod/.

В папке лежит `.gdignore`, Godot-проект в корне репозитория её не видит.

## Игра

| Герой | HP | Скорость | Атака | Способность |
|---|---|---|---|---|
| Техник | 5100 | 2.4 | пистолет-пулемёт, 480 | турель на 8 с |
| Танк | 5400 | 1.9 | кулаки, 1000, броня 15 % | таран с оглушением |
| Спринтер | 4300 | 2.75 | две пластинки, 370, рикошет | три рывка |
| Снайпер | 4400 | 2.3 | винтовка, 1200 | пробивающий выстрел |
| Медик | 4300 | 2.6 | шприцы, 400 | аптечка на всех рядом |

Управление: джойстик под пальцем, двойной тап — рывок, атака идёт сама по ближнему врагу, тап по арене — выстрел
туда, одна кнопка способности. Круг с короной даёт очки; матч длится 2 минуты или до 100 очков.

Прогресс: старт с Бронзы III, кубки поднимают ранг до «Царь двора». Первого героя выбирают один раз, остальные
стоят по 50 000 монет. У героя четыре характеристики до 30 уровня, уровень героя — их среднее с округлением от .5.

## Код

| Путь | Что там |
|---|---|
| `viewer/src/app/main.ts` | экраны: главная, герой, задания, рейтинг, поиск, история, первый выбор |
| `viewer/src/app/battle.ts` | бой: камера, HUD, ввод, экран результата |
| `viewer/src/app/game/` | симуляция матча, боты, параметры героев, коллизии двора |
| `viewer/src/app/progress.ts` | кубки, ранги, монеты, улучшения |
| `viewer/src/app/api.ts` | рейтинг, облачное сохранение, рекорды чата |
| `viewer/splash/` | экран загрузки с логотипом |
| `server/worker.js` | Cloudflare Worker: бот, рейтинг, профили в D1 |
| `blender/`, `map/` | сборка героев, анимаций, турели и карты в Blender |
| `user_meshes/v2/` | исходные модели героев |
| `dist/` | готовые GLB (Meshopt) |

## Сборка

```sh
cd viewer
npm ci
node scripts/sync-assets.mjs
npm run dev
npx vite build && node scripts/pages.mjs
```

Содержимое `dist-pages/` публикуется в ветку `gh-pages`.

Модели после правок в Blender:

```sh
/opt/dvor-venv/bin/python blender/user/build_v2.py
/opt/dvor-venv/bin/python blender/user/run_v2.py
/opt/dvor-venv/bin/python blender/user/sniper_rifle.py
/opt/dvor-venv/bin/python blender/user/sniper_ik.py
/opt/dvor-venv/bin/python blender/props.py
cd viewer && node scripts/optimize.mjs && node scripts/optimize-map.mjs && node scripts/sync-assets.mjs
```

## Сервер

Worker `dvor-server` на бесплатном тарифе Cloudflare. Привязки: D1 `DB`, Durable Object `ROOMS`, `WEBAPP_URL`.
Секреты `BOT_TOKEN` и `WEBHOOK_SECRET` хранятся только в Cloudflare.

| Путь | |
|---|---|
| `POST /tg` | вебхук бота: `/start`, `/play`, `/top`, `/help`, inline-вызов `@dvor_app` |
| `GET /api/top` | топ-50, кэш 60 с |
| `POST /api/result` | результат боя, проверка initData |
| `POST /api/game-score` | рекорды чата для игры из сообщения |
| `POST /api/profile/load`, `/save` | облачное сохранение прогресса |

В @BotFather включены `/setinline`, `/newgame` с коротким именем `dvor` и картинкой `telegram/game_640x360.jpg`,
Main Mini App с адресом GitHub Pages.
