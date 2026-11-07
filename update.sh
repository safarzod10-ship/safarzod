#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] || { echo "Сначала запустите: sudo ./setup.sh"; exit 1; }

git -c safe.directory="$(pwd)" pull --ff-only
docker compose up -d --build
docker image prune -f >/dev/null
docker compose ps --format '{{.Service}}: {{.Status}}'
echo "Готово."
