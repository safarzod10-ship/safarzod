#!/usr/bin/env bash
# HEIST vs CHAOS server installer. Safe to run again (updates in place, never deletes data).
# Usage (as root on Debian/Ubuntu):
#   curl -fsSL https://get.docker.com | sh            # only if Docker is missing
#   docker run --rm ghcr.io/safarzod10-ship/heist-vs-chaos:latest install | bash
# Options via env: HVC_VERSION=1.0.0  SITE_ADDRESS=my.domain  HVC_DIR=/opt/heist-vs-chaos
set -euo pipefail
IMAGE="${HVC_IMAGE:-ghcr.io/safarzod10-ship/heist-vs-chaos}"
VERSION="${HVC_VERSION:-latest}"
DIR="${HVC_DIR:-/opt/heist-vs-chaos}"
say() { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m %s\n' "$*"; }
die() { printf '\033[1;31mXX\033[0m %s\n' "$*"; exit 1; }

[ "$(id -u)" = 0 ] || die "Run as root (sudo -i first)."
. /etc/os-release 2>/dev/null || true
say "System: ${PRETTY_NAME:-unknown} $(uname -m), $(nproc) CPU, $(awk '/MemTotal/{printf "%.1f GB", $2/1048576}' /proc/meminfo) RAM, $(df -h / | awk 'NR==2{print $4}') free disk"
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
HVC_VERSION=$VERSION
LOG_LEVEL=warn
ENV
  chmod 600 .env
else
  say "Keeping existing .env"
  if [ -n "${HVC_VERSION:-}" ]; then sed -i "s/^HVC_VERSION=.*/HVC_VERSION=$HVC_VERSION/" .env; fi
fi
set -a; . ./.env; set +a

# Ports 80/443 are needed for HTTPS (Kick webhooks require a public HTTPS URL).
for p in 80 443; do
  if ss -ltnH "( sport = :$p )" | grep -q . && ! docker ps --format '{{.Names}} {{.Ports}}' | grep -q "heist-vs-chaos.*:$p->"; then
    die "Port $p is used by another program. Free it or ask for a custom setup; nothing was changed."
  fi
done

say "Pulling image $IMAGE:$HVC_VERSION"
docker pull "$IMAGE:$HVC_VERSION" || die "Cannot pull the image. If the GitHub package is private, run: docker login ghcr.io"
docker run --rm "$IMAGE:$HVC_VERSION" compose > compose.yaml
docker run --rm "$IMAGE:$HVC_VERSION" caddyfile > Caddyfile
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
