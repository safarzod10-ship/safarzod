# HEIST vs CHAOS

Интерактивная 2D-игра для круглосуточных трансляций на Kick. Маленький плюшевый робот проникает в бумажный музей, крадёт экспонат и убегает. Каждое решение принимает чат: зрители пишут `1`, `2`, `3` или `4`. Если чат молчит, игра честно показывает **AUTO MODE**, и робот выбирает сам. Эфир продолжается без участия владельца.

Язык игры и озвучки — английский. Язык документации — русский.

| | |
|---|---|
| Клиент | TypeScript (strict), Phaser 3.90, Vite 7 — рендер Canvas, DOM-интерфейс поверх |
| Сервер | Node.js 24 LTS (работает и на 22.13+), Fastify 5, WebSocket, Zod 4 |
| Данные | SQLite (`node:sqlite`, WAL, миграции), секреты зашифрованы AES-256-GCM |
| Вещание | Xvfb + PulseAudio + Chromium + FFmpeg (x11grab → H.264/AAC → RTMPS) |
| Kick | Официальный Public API: app token, webhooks, RSA-подпись |
| Проверки | Vitest (логика), Playwright (браузер), валидатор 30 уровней, сканер секретов, GitHub Actions |
| Установка | Docker Compose: игра + Caddy (автоматический HTTPS) |

## Быстрый старт (разработка)

```bash
cd heist-vs-chaos
npm ci
npm run build
ADMIN_TOKEN=$(openssl rand -hex 24) SECRET_KEY=$(openssl rand -base64 32) npm start
# игра:  http://127.0.0.1:8080/        пульт: http://127.0.0.1:8080/panel/
# предпросмотр любой комнаты без сервера: /?preview=УРОВЕНЬ,РЕШЕНИЕ[,вариант]  например /?preview=12,3,row3
npm run check     # типы + валидатор уровней + unit-тесты + сканер секретов
npm run e2e       # браузерные сценарии (Playwright)
```

## Установка на сервер

Одна команда в консоли хостинга (Debian/Ubuntu, root). Подробности в [docs/SERVER.md](docs/SERVER.md).

```bash
command -v docker || curl -fsSL https://get.docker.com | sh; docker run --rm ghcr.io/safarzod10-ship/heist-vs-chaos:1.0.4 install | bash
```

В конце установщик выведет ссылку на игру, приватную ссылку на пульт и адрес webhook для Kick.

## Документация

| Документ | О чём |
|---|---|
| [docs/GAME_RULES.md](docs/GAME_RULES.md) | Правила, голосование, AUTO MODE, здоровье, вмешательства |
| [docs/LEVELS.md](docs/LEVELS.md) | Все 30 уровней: комнаты, варианты, подсказки, идеальный путь |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Устройство системы, надёжность, защита от повторов |
| [docs/KICK.md](docs/KICK.md) | Подключение Kick: приложение, webhook, подарки, статус стримера |
| [docs/SERVER.md](docs/SERVER.md) | Установка, вещание, профили качества, лимит 5 часов |
| [docs/PHONE.md](docs/PHONE.md) | Управление с телефона |
| [docs/AUDIO_ASSETS.md](docs/AUDIO_ASSETS.md) | Свои реплики, музыка, звуки; происхождение ассетов |
| [docs/OPERATIONS.md](docs/OPERATIONS.md) | Резервные копии, восстановление, обновление, откат, типовые проблемы |
| [docs/TESTING.md](docs/TESTING.md) | Что и как проверено |
| [docs/LIMITATIONS.md](docs/LIMITATIONS.md) | Честный список известных ограничений |
