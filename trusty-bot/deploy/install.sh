#!/usr/bin/env bash
# Trusty installer / updater for Ubuntu (run as root). Safe to run again: it updates the code and keeps data and settings.
#
#   curl -fsSL https://raw.githubusercontent.com/safarzod10-ship/safarzod/claude/telegram-guarantor-dev-search-bot-t1i99z/trusty-bot/deploy/install.sh | bash
#
# What it touches: packages git, python3-venv, postgresql; user "trusty"; /opt/trusty, /etc/trusty, /var/lib/trusty;
# systemd units trusty.service and trusty-backup.timer; /etc/caddy/trusty.caddy plus one "import" line in the Caddyfile.
# Existing Caddy sites are left as they are. The Caddyfile is backed up first and restored if the new config is invalid.
set -euo pipefail

REPO="https://github.com/safarzod10-ship/safarzod.git"
BRANCH="claude/telegram-guarantor-dev-search-bot-t1i99z"
DOMAIN="${TRUSTY_DOMAIN:-trusty.2-27-22-171.sslip.io}"
PORT=8800
APP=/opt/trusty
SRC=$APP/src/trusty-bot
ENVF=/etc/trusty/trusty.env
CADDYFILE=/etc/caddy/Caddyfile

say() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mОшибка: %s\033[0m\n' "$*" >&2; exit 1; }
rand() { python3 -c "import secrets,sys; print(secrets.token_hex(int(sys.argv[1])))" "$1"; }

[ "$(id -u)" = 0 ] || die "запустите от root"
cd /
command -v caddy >/dev/null && systemctl is-active -q caddy || die "Caddy не найден или не запущен"
if ss -ltnH "sport = :$PORT" | grep -q . && ! systemctl is-active -q trusty; then
  die "порт $PORT уже занят другой программой"
fi

say "1/8 Пакеты"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq git python3-venv python3-pip postgresql >/dev/null

say "2/8 Пользователь и папки"
id trusty >/dev/null 2>&1 || useradd --system --home-dir $APP --no-create-home --shell /usr/sbin/nologin trusty
mkdir -p $APP /etc/trusty /var/lib/trusty/uploads
chown -R trusty:trusty /var/lib/trusty
chmod 755 $APP
chmod 700 /etc/trusty

say "3/8 Код из GitHub"
if [ -d $APP/src/.git ]; then
  git -C $APP/src fetch -q --depth 1 origin "$BRANCH"
  git -C $APP/src reset -q --hard FETCH_HEAD
else
  rm -rf $APP/src
  git clone -q --depth 1 --filter=blob:none --sparse -b "$BRANCH" "$REPO" $APP/src
  git -C $APP/src sparse-checkout set trusty-bot
fi
echo "версия: $(git -C $APP/src log -1 --format='%h %cd' --date=format:'%d.%m %H:%M')"

say "4/8 Python-окружение"
[ -x $APP/venv/bin/python ] || python3 -m venv $APP/venv
$APP/venv/bin/pip install -q --upgrade pip
$APP/venv/bin/pip install -q --only-binary :all: -r $SRC/server/requirements.txt

say "5/8 База данных PostgreSQL"
systemctl enable -q --now postgresql
PGCONF=$(ls -d /etc/postgresql/*/main 2>/dev/null | sort -V | tail -1)
if [ -n "$PGCONF" ] && [ ! -f "$PGCONF/conf.d/trusty.conf" ]; then
  mkdir -p "$PGCONF/conf.d"
  printf "# small server: keep PostgreSQL light\nshared_buffers = 64MB\nmax_connections = 40\nwork_mem = 4MB\n" > "$PGCONF/conf.d/trusty.conf"
  systemctl restart postgresql
fi
if [ -f $ENVF ] && grep -q '^TRUSTY_DB_URL=' $ENVF; then
  DB_URL=$(grep '^TRUSTY_DB_URL=' $ENVF | cut -d= -f2-)
else
  DBPASS=$(rand 16)
  DB_URL="postgresql+asyncpg://trusty:$DBPASS@127.0.0.1:5432/trusty"
  if runuser -u postgres -- psql -tAc "select 1 from pg_roles where rolname='trusty'" | grep -q 1; then
    runuser -u postgres -- psql -qc "alter role trusty with login password '$DBPASS'"
  else
    runuser -u postgres -- psql -qc "create role trusty with login password '$DBPASS'"
  fi
fi
runuser -u postgres -- psql -tAc "select 1 from pg_database where datname='trusty'" | grep -q 1 || runuser -u postgres -- createdb -O trusty trusty

say "6/8 Настройки"
get() { [ -f $ENVF ] && grep "^$1=" $ENVF | cut -d= -f2- || true; }
TOKEN="${TRUSTY_BOT_TOKEN:-$(get TRUSTY_BOT_TOKEN)}"
if [ -z "$TOKEN" ]; then
  [ -r /dev/tty ] || die "нет токена бота: задайте TRUSTY_BOT_TOKEN"
  read -rsp "Токен бота из @BotFather (ввод скрыт): " TOKEN </dev/tty; echo
fi
[[ "$TOKEN" =~ ^[0-9]+:[A-Za-z0-9_-]{30,}$ ]] || die "токен выглядит неправильно"
ADMIN_CODE=$(get TRUSTY_ADMIN_CODE); [ -n "$ADMIN_CODE" ] || ADMIN_CODE=$(rand 6)
umask 077
cat > $ENVF <<EOF
TRUSTY_BOT_TOKEN=$TOKEN
TRUSTY_DB_URL=$DB_URL
TRUSTY_PUBLIC_URL=https://$DOMAIN
TRUSTY_ADMIN_CODE=$ADMIN_CODE
TRUSTY_UPLOAD_DIR=/var/lib/trusty/uploads
TRUSTY_BOT_MODE=polling
EOF
umask 022
chmod 600 $ENVF

say "7/8 Службы"
install -m 644 $SRC/deploy/trusty.service /etc/systemd/system/trusty.service
cat > /etc/systemd/system/trusty-backup.service <<EOF
[Unit]
Description=Trusty database backup
[Service]
Type=oneshot
ExecStart=/bin/sh $SRC/deploy/backup.sh
EOF
cat > /etc/systemd/system/trusty-backup.timer <<EOF
[Unit]
Description=Daily Trusty database backup
[Timer]
OnCalendar=*-*-* 04:20
Persistent=true
[Install]
WantedBy=timers.target
EOF
cat > /usr/local/bin/trusty <<EOF
#!/bin/sh
# trusty admins | admin-remove <id> | unban <id> | stats | logs | restart | update
case "\$1" in
  logs) exec journalctl -u trusty -n 100 -f ;;
  restart) exec systemctl restart trusty ;;
  update) exec bash -c "curl -fsSL https://raw.githubusercontent.com/safarzod10-ship/safarzod/$BRANCH/trusty-bot/deploy/install.sh | bash" ;;
esac
set -a; . $ENVF; set +a
cd $SRC/server && exec $APP/venv/bin/python -m trusty.cli "\$@"
EOF
chmod 755 /usr/local/bin/trusty
systemctl daemon-reload
systemctl enable -q trusty trusty-backup.timer
systemctl restart trusty
systemctl start trusty-backup.timer
for i in $(seq 1 30); do curl -fs "http://127.0.0.1:$PORT/api/health" >/dev/null && break; sleep 1; done
curl -fs "http://127.0.0.1:$PORT/api/health" >/dev/null || { journalctl -u trusty -n 30 --no-pager; die "сервис trusty не запустился"; }

say "8/8 Caddy: https://$DOMAIN"
sed "s/__DOMAIN__/$DOMAIN/" $SRC/deploy/trusty.caddy > /etc/caddy/trusty.caddy.new
if ! grep -q '^import /etc/caddy/trusty.caddy' $CADDYFILE || ! cmp -s /etc/caddy/trusty.caddy.new /etc/caddy/trusty.caddy; then
  BACKUP="$CADDYFILE.before-trusty-$(date +%Y%m%d-%H%M%S)"
  cp -a $CADDYFILE "$BACKUP"
  [ -f /etc/caddy/trusty.caddy ] && cp -a /etc/caddy/trusty.caddy /etc/caddy/trusty.caddy.old
  mv /etc/caddy/trusty.caddy.new /etc/caddy/trusty.caddy
  grep -q '^import /etc/caddy/trusty.caddy' $CADDYFILE || printf '\n# Trusty Mini App\nimport /etc/caddy/trusty.caddy\n' >> $CADDYFILE
  restore() {
    cp -a "$BACKUP" $CADDYFILE
    if [ -f /etc/caddy/trusty.caddy.old ]; then mv /etc/caddy/trusty.caddy.old /etc/caddy/trusty.caddy; else rm -f /etc/caddy/trusty.caddy; fi
    systemctl reload caddy || true
  }
  if ! caddy validate --config $CADDYFILE --adapter caddyfile >/tmp/trusty-caddy.log 2>&1; then
    tail -5 /tmp/trusty-caddy.log; restore; die "конфиг Caddy не прошёл проверку, старый восстановлен"
  fi
  systemctl reload caddy || { restore; die "Caddy не перезагрузился, старый конфиг восстановлен"; }
  rm -f /etc/caddy/trusty.caddy.old
  echo "Caddyfile: копия до изменений в $BACKUP"
else
  rm -f /etc/caddy/trusty.caddy.new
  echo "конфиг Caddy не изменился"
fi
OK=""
for i in $(seq 1 40); do
  if curl -fs "https://$DOMAIN/api/health" >/dev/null 2>&1; then OK=1; break; fi
  sleep 3
done
for s in vpn.2-27-22-171.sslip.io; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "https://$s/" || true)
  echo "проверка соседнего сайта $s: HTTP $code"
done

TG=$(curl -s -m 15 "https://api.telegram.org/bot$TOKEN/getMe" || true)
BOT=$(printf '%s' "$TG" | python3 -c "import sys,json; d=json.load(sys.stdin); print('@'+d['result']['username'] if d.get('ok') else 'ошибка %s %s' % (d.get('error_code'), d.get('description')))" 2>/dev/null || echo "нет ответа")

printf '\n\033[1;32mГотово.\033[0m\n'
echo "Mini App:        https://$DOMAIN $( [ -n "$OK" ] && echo '(работает)' || echo '(сертификат ещё выпускается, проверьте через минуту)')"
echo "Бот:             $BOT"
echo "Стать админом:   отправьте боту  /admin $ADMIN_CODE   (максимум 2 администратора)"
echo "Команды:         trusty logs | trusty stats | trusty admins | trusty update"
