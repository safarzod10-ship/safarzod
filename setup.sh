#!/usr/bin/env bash
# Roulette Arena — установка на сервер одной командой:
#   sudo ./setup.sh
# Повторный запуск безопасен: уже сделанное пропускается, настройки сохраняются.
set -euo pipefail
cd "$(dirname "$0")"
ENV_FILE=.env

B=$'\e[1m'; G=$'\e[32m'; Y=$'\e[33m'; R=$'\e[31m'; N=$'\e[0m'
step() { echo; echo "${B}▶ $*${N}"; }
ok()   { echo "  ${G}✔${N} $*"; }
warn() { echo "  ${Y}!${N} $*"; }
die()  { echo; echo "  ${R}✖ $*${N}"; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Запустите с sudo:  sudo ./setup.sh"

# ---------- 1. Docker ----------
step "1/4  Docker"
if ! command -v docker >/dev/null 2>&1; then
  echo "  Устанавливаю Docker (официальный скрипт get.docker.com)…"
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker >/dev/null 2>&1 || true   # автозапуск после перезагрузки сервера
docker compose version >/dev/null 2>&1 || die "Нет docker compose. Обновите Docker: curl -fsSL https://get.docker.com | sh"
ok "$(docker --version)"

# ---------- 2. Настройки ----------
step "2/4  Настройки"
# shellcheck disable=SC1090
[ -f "$ENV_FILE" ] && . "./$ENV_FILE"
BOT_TOKEN=${BOT_TOKEN:-}; ADMIN_ID=${ADMIN_ID:-}; SUPPORT_USERNAME=${SUPPORT_USERNAME:-}; DOMAIN=${DOMAIN:-}

bot_username() { curl -fsS --max-time 15 "https://api.telegram.org/bot$1/getMe" | sed -n 's/.*"username":"\([^"]*\)".*/\1/p'; }

while :; do
  if [ -z "$BOT_TOKEN" ]; then
    echo "  Токен бота: @BotFather → /newbot (или /mybots → бот → API Token)."
    read -rsp "  Вставьте токен (символы не видны — так и должно быть) и нажмите Enter: " BOT_TOKEN; echo
  fi
  BOT_USERNAME=$(bot_username "$BOT_TOKEN" || true)
  [ -n "$BOT_USERNAME" ] && break
  warn "Telegram не принял токен, попробуйте ещё раз."; BOT_TOKEN=""
done
ok "Бот: @$BOT_USERNAME"

while ! [[ "$ADMIN_ID" =~ ^[0-9]{5,15}$ ]]; do
  echo "  Ваш Telegram ID — сюда будут приходить заявки на вывод. Узнать: напишите боту @userinfobot."
  read -rp "  Telegram ID администратора: " ADMIN_ID
done
ok "Администратор: $ADMIN_ID"

if [ -z "$SUPPORT_USERNAME" ]; then
  read -rp "  Ник для кнопки «Поддержка» (например @my_support, Enter — пропустить): " SUPPORT_USERNAME
fi
SUPPORT_USERNAME=${SUPPORT_USERNAME#@}
[ -n "$SUPPORT_USERNAME" ] && ok "Поддержка: @$SUPPORT_USERNAME"

if [ -z "$DOMAIN" ]; then
  PUBLIC_IP=$(curl -fsS --max-time 10 https://api.ipify.org || curl -fsS --max-time 10 https://ifconfig.me || true)
  [[ "$PUBLIC_IP" =~ ^[0-9.]+$ ]] || die "Не удалось определить внешний IP сервера."
  DOMAIN="${PUBLIC_IP//./-}.sslip.io"
fi
ok "Адрес мини-аппа: https://$DOMAIN/"

umask 077
cat > "$ENV_FILE" <<EOF
# Создано setup.sh. Секреты — никому не отправлять и не коммитить.
BOT_TOKEN=$BOT_TOKEN
ADMIN_ID=$ADMIN_ID
SUPPORT_USERNAME=$SUPPORT_USERNAME
DOMAIN=$DOMAIN
EOF
ok "Сохранено в .env (доступ только у root)"

# ---------- 3. Порты ----------
step "3/4  Порты 80 и 443"
busy=$(ss -Hltnp '( sport = :80 or sport = :443 )' 2>/dev/null | grep -v docker-proxy || true)
if [ -n "$busy" ]; then
  echo "$busy" | sed 's/^/    /'
  die "Порты 80/443 заняты другой программой (обычно nginx или apache). Отключите её: systemctl disable --now nginx"
fi
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw allow 443/udp >/dev/null
  ok "Порты открыты в фаерволе ufw"
fi
ok "Свободны"

# ---------- 4. Запуск ----------
step "4/4  Сборка и запуск (1–3 минуты)"
docker compose up -d --build
echo "  Жду, пока заработает HTTPS…"
for _ in $(seq 1 40); do
  if curl -fsS --max-time 10 -o /dev/null "https://$DOMAIN/api/round"; then READY=1; break; fi
  sleep 3
done

echo
echo "${B}══════════════════════════════════════════════${N}"
docker compose ps --format '  {{.Service}}: {{.Status}}'
if [ "${READY:-}" = 1 ]; then
  ok "Мини-апп: https://$DOMAIN/"
else
  warn "HTTPS ещё не готов. Логи: sudo docker compose logs caddy"
fi
ok "Бот: https://t.me/$BOT_USERNAME — откройте и нажмите /start"
echo "  Работает 24/7 и сам запускается после перезагрузки сервера."
echo "  Обновление после изменений в GitHub: sudo ./update.sh"
echo "${B}══════════════════════════════════════════════${N}"
