#!/usr/bin/env bash
# HEIST vs CHAOS server installer. Safe to run again (updates in place, never deletes data).
# Usage (as root on Debian/Ubuntu):
#   command -v docker || curl -fsSL https://get.docker.com | sh
#   docker run --rm ghcr.io/safarzod10-ship/heist-vs-chaos:1.0.5 install | bash
# Options via env: HVC_VERSION=1.0.0  SITE_ADDRESS=my.domain  HVC_DIR=/opt/heist-vs-chaos
set -euo pipefail
IMAGE="${HVC_IMAGE:-ghcr.io/safarzod10-ship/heist-vs-chaos}"
HVC_VER="${HVC_VERSION:-__HVC_DEFAULT_VERSION__}"
DIR="${HVC_DIR:-/opt/heist-vs-chaos}"
say() { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$*"; }
die() { printf '\033[1;31mXX\033[0m %s\n' "$*"; exit 1; }

[ "$(id -u)" = 0 ] || die "Run as root (sudo -i first)."
OS_NAME="$( (. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME") || echo unknown)"
say "System: ${OS_NAME} $(uname -m), $(nproc) CPU, $(awk '/MemTotal/{printf "%.1f GB", $2/1048576}' /proc/meminfo) RAM, $(df -h / | awk 'NR==2{print $4}') free disk"
[ "$(uname -m)" = x86_64 ] || warn "Only x86_64 is tested."
[ "$(nproc)" -ge 2 ] || warn "1 CPU: use the 480p profile in the panel."
FREE_KB=$(df -k / | awk 'NR==2{print $4}')
[ "$FREE_KB" -gt 4000000 ] || die "Need at least 4 GB free disk."

if ! command -v docker >/dev/null; then
  say "Installing Docker (official script)..."
  curl -fsSL https://get.docker.com | sh
fi
docker compose version >/dev/null 2>&1 || die "Docker Compose plugin missing (apt-get install docker-compose-plugin)."
systemctl enable --now docker >/dev/null 2>&1 || true

say "Existing containers (left untouched):"
docker ps --format '  {{.Names}}  {{.Image}}  {{.Ports}}' | grep -v 'heist-vs-chaos' || echo "  none"

mkdir -p "$DIR/data/backups" "$DIR/data/custom-audio/music" "$DIR/data/custom-audio/sfx" "$DIR/data/custom-audio/voice"
cd "$DIR"

if [ ! -f .env ]; then
  say "Creating .env with fresh secrets (stays on this server only)"
  IP="$(curl -fsS --max-time 8 https://api.ipify.org || hostname -I | awk '{print $1}')"
  SITE="${SITE_ADDRESS:-$(echo "$IP" | tr . -).sslip.io}"
  umask 077
  cat > .env <<ENV
# HEIST vs CHAOS secrets - do not share, do not commit.
ADMIN_TOKEN=$(openssl rand -hex 24)
SECRET_KEY=$(openssl rand -base64 32)
SITE_ADDRESS=$SITE
PUBLIC_URL=https://$SITE
KICK_CHANNEL=safarzod
HVC_VERSION=$HVC_VER
LOG_LEVEL=warn
ENV
  chmod 600 .env
else
  say "Keeping existing .env (secrets unchanged)"
  # The installer always deploys its own version (or the one requested via HVC_VERSION).
  if grep -q '^HVC_VERSION=' .env; then sed -i "s/^HVC_VERSION=.*/HVC_VERSION=$HVC_VER/" .env; else echo "HVC_VERSION=$HVC_VER" >> .env; fi
fi
set -a; . ./.env; set +a

# Ports 80/443 are needed for HTTPS (Kick webhooks require a public HTTPS URL).
# If another project's Caddy container already owns them, share it instead of fighting for the ports.
MODE=own
CADDY_MODE=""
PROXY_CTR=""
for c in $(docker ps --format '{{.Names}}'); do
  case "$c" in heist-vs-chaos-*) continue ;; esac
  if docker port "$c" 2>/dev/null | grep -qE '(^|[^0-9])443/tcp' && docker inspect -f '{{.Config.Image}} {{.Path}}' "$c" | grep -qi caddy; then
    PROXY_CTR="$c"
  fi
done
if [ -n "$PROXY_CTR" ]; then
  MODE=external
  say "Ports 80/443 belong to Caddy container '$PROXY_CTR' - the game will share it (that project is not restarted)."
else
  command -v ss >/dev/null || warn "'ss' not found: skipping the port check."
  for p in 80 443; do
    if command -v ss >/dev/null && ss -ltnH "( sport = :$p )" | grep -q . && ! docker ps --format '{{.Names}} {{.Ports}}' | grep -q "heist-vs-chaos.*:$p->"; then
      die "Port $p is used by another program (not a Caddy container). Free it or ask for a custom setup; nothing was changed."
    fi
  done
fi

if [ "$MODE" = external ]; then
  # Use a dedicated sub-name so we never collide with the other project's site address.
  case "$SITE_ADDRESS" in
    hvc.*) ;;
    *.sslip.io) SITE_ADDRESS="hvc.$SITE_ADDRESS"
                sed -i "s|^SITE_ADDRESS=.*|SITE_ADDRESS=$SITE_ADDRESS|; s|^PUBLIC_URL=.*|PUBLIC_URL=https://$SITE_ADDRESS|" .env ;;
  esac
  HVC_PROXY_NETWORK="$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$PROXY_CTR" | awk '{print $1}')"
  [ -n "$HVC_PROXY_NETWORK" ] || die "Cannot find the Docker network of $PROXY_CTR; nothing was changed."
  CF_DEST=/etc/caddy/Caddyfile
  CF_SRC="$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/etc/caddy/Caddyfile"}}{{.Source}}{{end}}{{end}}' "$PROXY_CTR")"
  if [ -z "$CF_SRC" ]; then
    CF_DIR="$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/etc/caddy"}}{{.Source}}{{end}}{{end}}' "$PROXY_CTR")"
    [ -n "$CF_DIR" ] && CF_SRC="$CF_DIR/Caddyfile"
  fi
  CADDY_MODE=file
  if [ -z "$CF_SRC" ] || [ ! -f "$CF_SRC" ]; then
    # Caddyfile is baked into that image: add our route at runtime through Caddy's local admin API
    # (no files of the other project are changed) and keep it present with a 1-minute systemd timer.
    CADDY_MODE=api
    docker exec "$PROXY_CTR" wget -q -O /dev/null http://127.0.0.1:2019/config/ 2>/dev/null \
      || die "Caddy admin API of $PROXY_CTR is not reachable (admin off?); nothing was changed. Ask for a custom setup."
  fi
  grep -v '^HVC_PROXY_NETWORK=' .env > .env.tmp && echo "HVC_PROXY_NETWORK=$HVC_PROXY_NETWORK" >> .env.tmp && cat .env.tmp > .env && rm -f .env.tmp
fi

say "Pulling image $IMAGE:$HVC_VERSION"
[ -n "${HVC_SKIP_PULL:-}" ] || docker pull "$IMAGE:$HVC_VERSION" || die "Cannot pull the image. If the GitHub package is private, run: docker login ghcr.io"
fetch() {  # fetch a file from the image; refuse anything that is not the expected file
  docker run --rm "$IMAGE:$HVC_VERSION" "$1" > "$2.new" && head -1 "$2.new" | grep -q '^#' || { rm -f "$2.new"; die "Image $IMAGE:$HVC_VERSION does not provide '$1'; nothing was changed."; }
  mv "$2.new" "$2"
}
if [ "$MODE" = external ]; then
  fetch compose-external compose.yaml
  rm -f Caddyfile
else
  fetch caddyfile Caddyfile
  fetch compose compose.yaml
fi
chown -R 10001:10001 data

# Remember the exact image that is running now (even if both are tagged "latest") for rollback.
PREV_ID="$(docker inspect --format '{{.Image}}' heist-vs-chaos-app-1 2>/dev/null || true)"
NEW_ID="$(docker image inspect --format '{{.Id}}' "$IMAGE:$HVC_VERSION")"
if [ -n "$PREV_ID" ] && [ "$PREV_ID" != "$NEW_ID" ]; then
  docker tag "$PREV_ID" "$IMAGE:rollback" && echo rollback > .previous-version
fi
cp -p .env .env.backup   # keep a copy: losing SECRET_KEY makes saved keys unreadable
[ -f data/heist.sqlite ] && docker run --rm -v "$DIR/data:/data" --user 10001 "$IMAGE:$HVC_VERSION" backup || true

HVC_IMAGE="$IMAGE" docker compose up -d --remove-orphans

if [ "$MODE" = external ] && [ "$CADDY_MODE" = api ]; then
  docker run --rm --network "container:$PROXY_CTR" "$IMAGE:$HVC_VERSION" caddy-route "$SITE_ADDRESS" heist-vs-chaos-app-1:8080 \
    || die "Could not add the game route to $PROXY_CTR. The game runs locally on 127.0.0.1:8080."
  cat > /etc/systemd/system/hvc-caddy-route.service <<UNIT
[Unit]
Description=HEIST vs CHAOS: keep the game route in the shared Caddy
After=docker.service
[Service]
Type=oneshot
ExecStart=/usr/local/bin/hvc caddy-route
UNIT
  cat > /etc/systemd/system/hvc-caddy-route.timer <<UNIT
[Unit]
Description=HEIST vs CHAOS: re-check the shared Caddy route every minute
[Timer]
OnBootSec=90
OnUnitActiveSec=60
[Install]
WantedBy=timers.target
UNIT
  systemctl daemon-reload && systemctl enable --now hvc-caddy-route.timer >/dev/null 2>&1 || warn "systemd timer not installed; run 'hvc caddy-route' after restarts of $PROXY_CTR"
  say "Added the game site to $PROXY_CTR via its admin API (re-checked every minute)"
fi

if [ "$MODE" = external ] && [ "$CADDY_MODE" = file ]; then
  # Add (or refresh) our marked block in the shared Caddyfile; validate first, restore on any failure.
  BK="$CF_SRC.bak-hvc-$(date +%Y%m%d-%H%M%S)"
  cp -p "$CF_SRC" "$BK"
  TMP="$(mktemp)"
  sed '/^# >>> heist-vs-chaos >>>$/,/^# <<< heist-vs-chaos <<<$/d' "$CF_SRC" > "$TMP"
  cat >> "$TMP" <<CADDY
# >>> heist-vs-chaos >>>
$SITE_ADDRESS {
	encode gzip
	request_body {
		max_size 1MB
	}
	reverse_proxy heist-vs-chaos-app-1:8080
}
# <<< heist-vs-chaos <<<
CADDY
  cat "$TMP" > "$CF_SRC"   # keep the inode: single-file bind mounts would not see a replaced file
  rm -f "$TMP"
  if docker exec "$PROXY_CTR" caddy validate --config "$CF_DEST" --adapter caddyfile >/dev/null 2>&1 \
     && docker exec "$PROXY_CTR" caddy reload --config "$CF_DEST" --adapter caddyfile >/dev/null 2>&1; then
    say "Added the game site to $PROXY_CTR (backup: $BK)"
  else
    cat "$BK" > "$CF_SRC"
    docker exec "$PROXY_CTR" caddy reload --config "$CF_DEST" --adapter caddyfile >/dev/null 2>&1 || true
    die "Caddy rejected the new config; the original was restored. The game runs locally on 127.0.0.1:8080."
  fi
fi
say "Waiting for the game server..."
for i in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:8080/healthz >/dev/null 2>&1; then break; fi
  sleep 2
  [ "$i" = 60 ] && die "Server did not become healthy. See: docker compose -f $DIR/compose.yaml logs app"
done

install -m 755 /dev/stdin /usr/local/bin/hvc <<'HVC'
#!/usr/bin/env bash
# hvc - HEIST vs CHAOS helper: status | logs | stop | start | restart | backup | update [ver] | rollback | restore <file>
set -euo pipefail
cd /opt/heist-vs-chaos
set -a; . ./.env; set +a
dc() { docker compose "$@"; }
case "${1:-status}" in
  status) dc ps; curl -fsS http://127.0.0.1:8080/healthz && echo ;;
  logs) dc logs --tail 200 app ;;
  stop) dc stop ;;
  start) dc up -d ;;
  restart) dc restart app ;;
  backup) docker exec heist-vs-chaos-app-1 /app/deploy/entrypoint.sh backup ;;
  caddy-route)
    # Find the Caddy container that owns port 443 (another project) and make sure our route is there.
    ctr=""
    for c in $(docker ps --format '{{.Names}}'); do
      case "$c" in heist-vs-chaos-*) continue ;; esac
      if docker port "$c" 2>/dev/null | grep -qE '(^|[^0-9])443/tcp' && docker inspect -f '{{.Config.Image}} {{.Path}}' "$c" | grep -qi caddy; then ctr="$c"; fi
    done
    [ -n "$ctr" ] || exit 0
    docker run --rm --network "container:$ctr" "${HVC_IMAGE:-ghcr.io/safarzod10-ship/heist-vs-chaos}:${HVC_VERSION}" caddy-route "$SITE_ADDRESS" heist-vs-chaos-app-1:8080 | grep -v '^route present$' || true ;;
  update) docker run --rm "${HVC_IMAGE:-ghcr.io/safarzod10-ship/heist-vs-chaos}:${2:-latest}" install | HVC_VERSION="${2:-latest}" bash ;;
  rollback) [ -f .previous-version ] || { echo "no previous version recorded"; exit 1; }
            v=$(cat .previous-version); sed -i "s/^HVC_VERSION=.*/HVC_VERSION=$v/" .env; dc up -d; echo "rolled back to $v" ;;
  restore) f="${2:?usage: hvc restore data/backups/FILE.sqlite}"; [ -f "$f" ] || { echo "no such file"; exit 1; }
           dc stop app; cp data/heist.sqlite "data/heist-before-restore-$(date +%s).sqlite" 2>/dev/null || true
           rm -f data/heist.sqlite-wal data/heist.sqlite-shm; cp "$f" data/heist.sqlite; chown 10001:10001 data/heist.sqlite; dc start app; echo restored ;;
  *) echo "usage: hvc status|logs|stop|start|restart|backup|update [ver]|rollback|restore <file>" ;;
esac
HVC

say "Installed. Version $HVC_VERSION"
echo
echo "  Game page (public):  https://$SITE_ADDRESS/"
echo "  Host panel (PRIVATE, keep this link secret):"
echo "      https://$SITE_ADDRESS/panel/#t=$ADMIN_TOKEN"
echo "  Kick webhook URL:    https://$SITE_ADDRESS/webhooks/kick"
echo
echo "  Manage: hvc status | hvc logs | hvc stop | hvc start | hvc update | hvc rollback | hvc backup"
