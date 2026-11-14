#!/usr/bin/env bash
# One-command install / update of the Telegram video bot as a 24/7 systemd service.
# Usage:  curl -fsSL <raw url>/install.sh | sudo bash -s -- 'BOT_TOKEN'
set -euo pipefail

REPO="https://github.com/safarzod10-ship/safarzod.git"
BRANCH="claude/telegram-video-downloader-tyjy8k"
SUBDIR="tg-video-bot"
ROOT="/opt/tgvbot"
SRC="$ROOT/repo"
APP="$SRC/$SUBDIR"
SERVICE="tgvbot"
TOKEN="${1:-}"

[ "$(id -u)" -eq 0 ] || { echo "Run as root (sudo)"; exit 1; }

echo ">>> Installing system packages"
if command -v apt-get >/dev/null; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq git python3 python3-venv python3-pip ffmpeg ca-certificates >/dev/null
elif command -v dnf >/dev/null; then
  dnf install -y -q git python3 python3-pip ffmpeg-free ca-certificates || dnf install -y -q git python3 python3-pip ca-certificates
else
  echo "Unsupported distro: install git, python3 (3.9+), ffmpeg manually"; exit 1
fi

id -u "$SERVICE" >/dev/null 2>&1 || useradd --system --home "$ROOT" --shell /usr/sbin/nologin "$SERVICE"
mkdir -p "$ROOT"

echo ">>> Fetching code"
if [ -d "$SRC/.git" ]; then
  git -C "$SRC" fetch -q --depth 1 origin "$BRANCH"
  git -C "$SRC" reset -q --hard FETCH_HEAD
else
  rm -rf "$SRC"
  git clone -q --depth 1 --filter=blob:none --sparse -b "$BRANCH" "$REPO" "$SRC"
  git -C "$SRC" sparse-checkout set "$SUBDIR"
fi

echo ">>> Python environment"
[ -x "$ROOT/venv/bin/python" ] || python3 -m venv "$ROOT/venv"
"$ROOT/venv/bin/pip" install -q --upgrade pip
"$ROOT/venv/bin/pip" install -q --upgrade -r "$APP/requirements.txt"

ENV_FILE="$ROOT/.env"
if [ -n "$TOKEN" ]; then
  printf 'BOT_TOKEN=%s\nMAX_PARALLEL=8\nMAX_FILE_MB=50\nDATA_DIR=%s/data\nCOOKIES_FILE=%s/cookies.txt\n' \
    "$TOKEN" "$ROOT" "$ROOT" > "$ENV_FILE"
fi
[ -f "$ENV_FILE" ] || { echo "No token. Run again: ... | sudo bash -s -- 'BOT_TOKEN'"; exit 1; }
chmod 600 "$ENV_FILE"
mkdir -p "$ROOT/data"
chown -R "$SERVICE:$SERVICE" "$ROOT"

echo ">>> systemd service (auto-start, auto-restart)"
cat > /etc/systemd/system/$SERVICE.service <<UNIT
[Unit]
Description=Telegram video downloader bot
After=network-online.target
Wants=network-online.target

[Service]
User=$SERVICE
WorkingDirectory=$APP
EnvironmentFile=$ENV_FILE
ExecStart=$ROOT/venv/bin/python -u $APP/bot.py
Restart=always
RestartSec=3
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
UNIT

# Instagram/TikTok change often -> update yt-dlp every night and restart.
cat > /etc/systemd/system/$SERVICE-update.service <<UNIT
[Unit]
Description=Update yt-dlp for $SERVICE

[Service]
Type=oneshot
ExecStart=$ROOT/venv/bin/pip install -q --upgrade yt-dlp[default]
ExecStartPost=/bin/systemctl restart $SERVICE
UNIT
cat > /etc/systemd/system/$SERVICE-update.timer <<UNIT
[Unit]
Description=Nightly yt-dlp update for $SERVICE

[Timer]
OnCalendar=*-*-* 04:30
Persistent=true

[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable -q --now $SERVICE-update.timer
systemctl enable -q $SERVICE
systemctl restart $SERVICE
sleep 3
systemctl --no-pager --lines=5 status $SERVICE || true
echo
echo "✅ Done. The bot runs 24/7 and starts automatically after reboot."
echo "   Logs:    journalctl -u $SERVICE -f"
echo "   Restart: systemctl restart $SERVICE"
