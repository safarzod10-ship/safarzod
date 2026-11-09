#!/usr/bin/env bash
set -Eeuo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PROJECT=$(cd "$HERE/../.." && pwd)
REPO_ROOT=$(git -C "$PROJECT" rev-parse --show-toplevel)
BRANCH=$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD)
WORK=$(mktemp -d)
TOKEN="123456:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
DOMAIN="zuba.localhost"
FIFO="$WORK/answers"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

cleanup() {
	stop_feeder
	[[ -f $WORK/roulette-arena/docker-compose.yml ]] && docker compose --project-directory "$WORK/roulette-arena" down -v >/dev/null 2>&1
	if [[ -f $WORK/opt/zuba-ruba/zuba-ruba/docker-compose.yml ]]; then
		docker compose --project-directory "$WORK/opt/zuba-ruba/zuba-ruba" down -v >/dev/null 2>&1 || true
	fi
	rm -rf "$WORK"
}
trap cleanup EXIT

answers() {
	rm -f "$FIFO"
	mkfifo "$FIFO"
	( exec 3>"$FIFO"; printf '%s\n' "$@" >&3; sleep 900 ) &
	FEEDER=$!
}

stop_feeder() {
	[[ -n ${FEEDER:-} ]] && kill "$FEEDER" 2>/dev/null || true
}

signed_init_data() {
	python3 - "$TOKEN" "$1" <<'EOF'
import hashlib, hmac, json, sys, time
from urllib.parse import urlencode
token, uid = sys.argv[1], int(sys.argv[2])
fields = {"auth_date": str(int(time.time())), "user": json.dumps({"id": uid, "first_name": "Admin", "username": "admin"}, separators=(",", ":"))}
secret = hmac.new(b"WebAppData", token.encode(), hashlib.sha256).digest()
fields["hash"] = hmac.new(secret, "\n".join(f"{k}={v}" for k, v in sorted(fields.items())).encode(), hashlib.sha256).hexdigest()
print(urlencode(fields))
EOF
}

run_installer() {
	(
		export ZR_SETUP_SOURCED=1 ZR_REPO_URL="file://$REPO_ROOT" ZR_BRANCH="$BRANCH" ZR_INSTALL_DIR="$WORK/opt/zuba-ruba"
		export ZR_TTY_IN="$FIFO" ZR_TTY_OUT=/dev/null
		# shellcheck source=../../setup.sh
		. "$PROJECT/setup.sh"
		curl() {
			case "$*" in
				*api.telegram.org*) echo '{"ok":true,"result":{"id":777000,"is_bot":true,"first_name":"ZUBA RUBA","username":"zuba_ruba_bot"}}' ;;
				*api.flyerhubs.com*) echo '{"type":"tasks","status":true,"webhook":null,"key_number":1,"bot_id":777000}' ;;
				*) command curl -k --resolve "$DOMAIN:443:127.0.0.1" "$@" ;;
			esac
		}
		getent() { echo "127.0.0.1 STREAM $DOMAIN"; }
		hostname() { echo "127.0.0.1"; }
		compose() {
			[[ $1 == build ]] && return 0
			docker compose --project-directory "$APP_DIR" -f "$APP_DIR/docker-compose.yml" "$@"
		}
		main
	)
}

APP="$WORK/opt/zuba-ruba/zuba-ruba"
RULIX="$WORK/roulette-arena"

start_foreign_project() {
	mkdir -p "$RULIX"
	cat >"$RULIX/docker-compose.yml" <<'EOF2'
name: roulette-arena
services:
  caddy:
    image: caddy:2.8-alpine
    command: ["caddy", "respond", "--listen", ":80", "--body", "<title>RULIX</title>"]
    ports: ["80:80", "443:443"]
    volumes: ["app_data:/data"]
volumes:
  app_data:
EOF2
	docker compose --project-directory "$RULIX" up -d >/dev/null 2>&1
	docker run --rm -v roulette-arena_app_data:/data alpine:3.20 sh -c 'echo players > /data/db.txt'
}

start_foreign_project
answers
if ZR_BOT_TOKEN="$TOKEN" ZR_ADMIN_IDS="1000" ZR_FLYER_API_KEY="FL-abcdefgh-12345" ZR_DOMAIN="$DOMAIN" run_installer >"$WORK/conflict.log" 2>&1; then
	fail "installer must stop when ports are taken by another project"
fi
grep -q "roulette-arena" "$WORK/conflict.log" || { cat "$WORK/conflict.log"; fail "conflict message"; }
[[ -n $(docker ps -q --filter label=com.docker.compose.project=roulette-arena) ]] || fail "foreign project must stay untouched without ZR_REMOVE_PROJECTS"
pass "occupied ports detected, foreign project left untouched"

answers
ZR_REMOVE_PROJECTS=roulette-arena ZR_BOT_TOKEN="$TOKEN" ZR_ADMIN_IDS="1000" ZR_FLYER_API_KEY="FL-abcdefgh-12345" ZR_DOMAIN="$DOMAIN" run_installer >"$WORK/first.log" 2>&1 || { cat "$WORK/first.log"; fail "first installation"; }
stop_feeder
pass "first installation (non-interactive, one command)"
[[ -z $(docker ps -aq --filter label=com.docker.compose.project=roulette-arena) ]] || fail "foreign containers removed"
[[ -z $(docker volume ls -q --filter label=com.docker.compose.project=roulette-arena) ]] || fail "foreign volumes removed"
[[ ! -d $RULIX ]] || fail "foreign project directory removed"
ls /root/removed-projects/roulette-arena-roulette-arena_app_data-*.tgz >/dev/null 2>&1 || fail "foreign data archived"
pass "foreign project removed completely, its data archived"

[[ $(stat -c %a "$APP/.env") == 600 ]] || fail ".env permissions"
grep -qx "BOT_USERNAME=zuba_ruba_bot" "$APP/.env" || fail "bot username from getMe"
grep -qx "ADMIN_IDS=1000" "$APP/.env" || fail "admin ids"
grep -qx "CADDY_GLOBAL_OPTIONS=" "$APP/.env" || fail "empty acme email"
PG_PASSWORD=$(grep '^POSTGRES_PASSWORD=' "$APP/.env" | cut -d= -f2)
HOOK_SECRET=$(grep '^FLYER_WEBHOOK_SECRET=' "$APP/.env" | cut -d= -f2)
[[ ${#PG_PASSWORD} -eq 48 && ${#HOOK_SECRET} -eq 48 ]] || fail "generated secrets"
pass ".env created with 600 permissions and generated secrets"

health=$(curl -sk --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/health")
[[ $health == *'"status":"ok"'* ]] || fail "health over https: $health"
page=$(curl -sk --resolve "$DOMAIN:443:127.0.0.1" -o /dev/null -w '%{http_code}' "https://$DOMAIN/")
[[ $page == 200 ]] || fail "mini app index: $page"
pass "API and Mini App reachable over HTTPS"

AUTH="Authorization: tma $(signed_init_data 1000)"
curl -sk --resolve "$DOMAIN:443:127.0.0.1" -X POST -H "$AUTH" "https://$DOMAIN/api/session" | grep -q '"is_admin":true' || fail "admin session"
curl -sk --resolve "$DOMAIN:443:127.0.0.1" -X PATCH -H "$AUTH" -H 'Content-Type: application/json' -d '{"values":{"reward_boost":"0.25"}}' "https://$DOMAIN/api/admin/settings" >/dev/null
pass "admin session and settings change"

answers "y"
run_installer >"$WORK/second.log" 2>&1 || { cat "$WORK/second.log"; fail "repeated installation"; }
stop_feeder
grep -q "Резервная копия базы перед обновлением" "$WORK/second.log" || fail "backup before update"
[[ $(grep '^POSTGRES_PASSWORD=' "$APP/.env" | cut -d= -f2) == "$PG_PASSWORD" ]] || fail "postgres password changed"
[[ $(grep '^FLYER_WEBHOOK_SECRET=' "$APP/.env" | cut -d= -f2) == "$HOOK_SECRET" ]] || fail "webhook secret changed"
ls "$APP"/backups/zuba-*.dump >/dev/null 2>&1 || fail "backup file"
AUTH="Authorization: tma $(signed_init_data 1000)"
settings=$(curl -sk --resolve "$DOMAIN:443:127.0.0.1" -H "$AUTH" "https://$DOMAIN/api/admin/settings")
[[ $settings == *'"key":"reward_boost"'*'"value":"0.25"'* ]] || fail "settings lost after update"
curl -sk --resolve "$DOMAIN:443:127.0.0.1" -H "$AUTH" "https://$DOMAIN/api/me" | grep -q '"id":1000' || fail "user lost after update"
pass "repeated installation keeps database, settings and secrets"
