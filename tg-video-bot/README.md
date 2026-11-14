# Telegram-бот для скачивания видео: Instagram / TikTok / Pinterest

Пришли боту ссылку, и он ответит видео (а также фото и каруселями).

* `yt-dlp` с 16 параллельными соединениями, mp4 без перекодирования
* до 8 загрузок одновременно (`MAX_PARALLEL`)
* кэш file_id: повторная ссылка отправляется мгновенно, без скачивания
* работает в группах (бот находит ссылки в любом сообщении)
* yt-dlp обновляется автоматически каждую ночь

## Установка одной командой (Ubuntu/Debian VPS)

```bash
curl -fsSL https://raw.githubusercontent.com/safarzod10-ship/safarzod/claude/telegram-video-downloader-tyjy8k/tg-video-bot/install.sh | sudo bash -s -- 'ВАШ_ТОКЕН'
```

Та же команда без токена обновляет бота до последней версии.

| Действие | Команда |
|---|---|
| Логи | `journalctl -u tgvbot -f` |
| Перезапуск | `sudo systemctl restart tgvbot` |
| Остановка | `sudo systemctl stop tgvbot` |
| Настройки | `/opt/tgvbot/.env` |

## Instagram просит авторизацию?
Экспортируйте cookies из браузера (расширение «Get cookies.txt LOCALLY») в
`/opt/tgvbot/cookies.txt`, затем выполните `sudo systemctl restart tgvbot`.

## Ограничение
Обычный Bot API разрешает ботам отправлять файлы не больше 50 МБ. Бот выбирает
лучшее качество до 1080p, которое укладывается в этот лимит.

## «Cannot connect to host api.telegram.org»
Хостер или страна блокирует Telegram. Передайте прокси вторым аргументом:
```bash
curl -fsSL https://raw.githubusercontent.com/safarzod10-ship/safarzod/claude/telegram-video-downloader-tyjy8k/tg-video-bot/install.sh | sudo bash -s -- 'ВАШ_ТОКЕН' 'socks5://user:pass@host:port'
```
