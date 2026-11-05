#!/usr/bin/env bash
# Скачивает свежий код из GitHub и перезапускает приложение. Данные игроков сохраняются.
#   sudo ./update.sh
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] || { echo "Сначала запустите: sudo ./setup.sh"; exit 1; }

# safe.directory: папка может принадлежать обычному пользователю, а скрипт запущен через sudo
git -c safe.directory="$(pwd)" pull --ff-only
docker compose up -d --build
docker image prune -f >/dev/null
docker compose ps --format '{{.Service}}: {{.Status}}'
echo "Готово."
