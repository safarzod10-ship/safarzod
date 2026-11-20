# Trusty

Гарант сделок и поиск разработчиков в Telegram: бот + Mini App.

| Папка | Что внутри |
|---|---|
| `brand/` | логотип, анимации, процесс отбора логотипа, шрифты |
| `bot/` | скрипты оформления бота (описание, команды, аватар) |
| `miniapp/` | Mini App: React + TypeScript + Vite. В Telegram работает с API, в обычном браузере на демо-данных |
| `server/` | API (FastAPI) и бот (aiogram 3) в одном процессе, PostgreSQL |
| `deploy/` | установщик для Ubuntu, systemd, Caddy, бэкапы, собранный Mini App (`deploy/webapp`) |

## Установка на сервер

```bash
curl -fsSL https://raw.githubusercontent.com/safarzod10-ship/safarzod/claude/telegram-guarantor-dev-search-bot-t1i99z/trusty-bot/deploy/install.sh | bash
```

Скрипт спросит токен бота, поставит PostgreSQL, Python-окружение, службу `trusty` (порт 8800, только localhost)
и сайт `https://trusty.2-27-22-171.sslip.io` в Caddy (через `import`, остальные сайты не меняются).
Повторный запуск обновляет код и сохраняет данные. На сервере: `trusty logs`, `trusty stats`, `trusty admins`,
`trusty update`. Бэкап базы каждый день в `/var/backups/trusty`, хранится 14 дней.

Администратор: отправить боту `/admin <код>` (код печатает установщик), максимум 2 администратора.

## Разработка

```bash
cd server && uv venv && uv pip install -r requirements.txt httpx
TRUSTY_DB_URL=postgresql+asyncpg://… python -m tests.test_flow      # сквозной тест API
cd miniapp && npm install && npm run dev                             # Mini App на демо-данных
npm run release                                                      # сборка в deploy/webapp
node scripts/live-e2e.mjs out http://127.0.0.1:8811 <токен>          # Mini App против живого API
```
