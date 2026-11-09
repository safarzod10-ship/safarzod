#!/usr/bin/env bash
set -Eeuo pipefail

REPO_URL="${ZR_REPO_URL:-https://github.com/safarzod10-ship/safarzod.git}"
REPO_BRANCH="${ZR_BRANCH:-claude/zuba-ruba-mini-app-83vt56}"
REPO_SUBDIR="zuba-ruba"
INSTALL_DIR="${ZR_INSTALL_DIR:-/opt/zuba-ruba}"
MIN_DISK_GB=5
MIN_RAM_MB=900

if [[ -t 1 ]]; then
	BOLD=$'\e[1m'; DIM=$'\e[2m'; RED=$'\e[31m'; GREEN=$'\e[32m'; YELLOW=$'\e[33m'; RESET=$'\e[0m'
else
	BOLD=""; DIM=""; RED=""; GREEN=""; YELLOW=""; RESET=""
fi

step() { printf '\n%s==> %s%s\n' "$BOLD" "$1" "$RESET"; }
info() { printf '    %s\n' "$1"; }
ok() { printf '    %s✓%s %s\n' "$GREEN" "$RESET" "$1"; }
warn() { printf '    %s!%s %s\n' "$YELLOW" "$RESET" "$1"; }
die() { printf '\n%sОшибка:%s %s\n' "$RED" "$RESET" "$1" >&2; exit 1; }
trap 'die "установка прервана на строке $LINENO"' ERR

TTY_IN="${ZR_TTY_IN:-/dev/tty}"
TTY_OUT="${ZR_TTY_OUT:-/dev/tty}"

ask() {
	local prompt="$1" default="${2:-}" answer
	if [[ -n $default ]]; then
		printf '    %s %s[%s]%s: ' "$prompt" "$DIM" "$default" "$RESET" >"$TTY_OUT"
	else
		printf '    %s: ' "$prompt" >"$TTY_OUT"
	fi
	IFS= read -r answer <"$TTY_IN" || true
	printf '%s' "${answer:-$default}"
}

ask_secret() {
	local prompt="$1" answer
	printf '    %s: ' "$prompt" >"$TTY_OUT"
	IFS= read -rs answer <"$TTY_IN" || true
	printf '\n' >"$TTY_OUT"
	printf '%s' "$answer"
}

confirm() {
	local answer
	answer=$(ask "$1 (y/n)" "${2:-y}")
	[[ $answer =~ ^[YyДд] ]]
}

env_get() {
	local file="$1" key="$2"
	[[ -f $file ]] || return 0
	grep -E "^${key}=" "$file" | tail -n1 | cut -d= -f2- || true
}

check_system() {
	step "Проверка системы"
	[[ $(uname -s) == Linux ]] || die "поддерживается только Linux"
	if [[ $EUID -ne 0 ]]; then
		die "запустите установщик от root: curl -fsSL <адрес setup.sh> | sudo bash"
	fi
	OS_ID=""; OS_CODENAME=""
	if [[ -r /etc/os-release ]]; then
		# shellcheck disable=SC1091
		. /etc/os-release
		OS_ID="${ID:-}"; OS_CODENAME="${VERSION_CODENAME:-}"
		ok "ОС: ${PRETTY_NAME:-$OS_ID}"
	fi
	case "$(uname -m)" in
		x86_64|aarch64|arm64) ok "Архитектура: $(uname -m)" ;;
		*) die "архитектура $(uname -m) не поддерживается" ;;
	esac
	local ram_mb disk_gb
	ram_mb=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
	if (( ram_mb < MIN_RAM_MB )); then
		warn "Оперативной памяти ${ram_mb} МБ, рекомендуется от 1 ГБ"
	else
		ok "Память: ${ram_mb} МБ"
	fi
	mkdir -p "$(dirname "$INSTALL_DIR")"
	disk_gb=$(df -Pk "$(dirname "$INSTALL_DIR")" | awk 'NR==2 {print int($4/1024/1024)}')
	(( disk_gb >= MIN_DISK_GB )) || die "свободно ${disk_gb} ГБ, нужно не меньше ${MIN_DISK_GB} ГБ"
	ok "Свободно на диске: ${disk_gb} ГБ"
}

apt_install() {
	DEBIAN_FRONTEND=noninteractive apt-get update -qq
	DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$@" >/dev/null
}

install_docker() {
	case "$OS_ID" in
		ubuntu|debian) ;;
		*) die "автоматическая установка Docker поддерживается для Ubuntu и Debian. Установите Docker Engine и Compose вручную: https://docs.docker.com/engine/install/" ;;
	esac
	info "Установка Docker Engine из официального репозитория download.docker.com"
	apt_install ca-certificates curl gnupg
	install -m 0755 -d /etc/apt/keyrings
	curl -fsSL "https://download.docker.com/linux/${OS_ID}/gpg" -o /etc/apt/keyrings/docker.asc
	chmod a+r /etc/apt/keyrings/docker.asc
	echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/${OS_ID} ${OS_CODENAME} stable" >/etc/apt/sources.list.d/docker.list
	apt_install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
	systemctl enable --now docker >/dev/null 2>&1 || true
}

check_tools() {
	step "Проверка компонентов"
	local missing=()
	for tool in git curl openssl; do
		command -v "$tool" >/dev/null || missing+=("$tool")
	done
	if (( ${#missing[@]} )); then
		if [[ $OS_ID =~ ^(ubuntu|debian)$ ]] && confirm "Не найдены: ${missing[*]}. Установить?"; then
			apt_install "${missing[@]}" ca-certificates
		else
			die "установите: ${missing[*]}"
		fi
	fi
	ok "git, curl, openssl"
	if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
		if confirm "Docker или Docker Compose не найдены. Установить?"; then
			install_docker
		else
			die "Docker Engine и плагин Compose обязательны"
		fi
	fi
	docker info >/dev/null 2>&1 || die "Docker установлен, но демон не запущен: systemctl start docker"
	ok "$(docker --version)"
	ok "$(docker compose version)"
}

fetch_project() {
	step "Загрузка проекта"
	if [[ -d $INSTALL_DIR/.git ]]; then
		info "Обновление $INSTALL_DIR"
		git -C "$INSTALL_DIR" fetch --depth 1 origin "$REPO_BRANCH"
		if ! git -C "$INSTALL_DIR" diff --quiet; then
			die "в $INSTALL_DIR есть локальные изменения кода. Сохраните их и повторите."
		fi
		git -C "$INSTALL_DIR" checkout -q -B "$REPO_BRANCH" FETCH_HEAD
	elif [[ -e $INSTALL_DIR ]] && [[ -n $(ls -A "$INSTALL_DIR" 2>/dev/null) ]]; then
		die "$INSTALL_DIR не пуст и не является установкой ZUBA RUBA"
	else
		git clone --quiet --depth 1 --branch "$REPO_BRANCH" --filter=blob:none --sparse "$REPO_URL" "$INSTALL_DIR"
		git -C "$INSTALL_DIR" sparse-checkout set "$REPO_SUBDIR"
	fi
	APP_DIR="$INSTALL_DIR/$REPO_SUBDIR"
	[[ -f $APP_DIR/docker-compose.yml ]] || die "в репозитории не найден $REPO_SUBDIR/docker-compose.yml"
	ok "Версия: $(git -C "$INSTALL_DIR" log -1 --format='%h %cd' --date=short)"
}

telegram_get_me() {
	curl -fsS --max-time 15 "https://api.telegram.org/bot$1/getMe" 2>/dev/null || true
}

json_field() {
	sed -n "s/.*\"$1\":\"\{0,1\}\([^,\"}]*\)\"\{0,1\}.*/\1/p" | head -n1
}

prompt_bot_token() {
	local current="$1" token response
	while true; do
		if [[ -n $current ]] && confirm "Использовать сохранённый токен бота?"; then
			token="$current"
		else
			token=$(ask_secret "Токен Telegram-бота от @BotFather")
		fi
		current=""
		if [[ ! $token =~ ^[0-9]{6,12}:[A-Za-z0-9_-]{30,}$ ]]; then
			warn "Неверный формат токена"
			continue
		fi
		response=$(telegram_get_me "$token")
		if [[ $response == *'"ok":true'* ]]; then
			BOT_TOKEN="$token"
			BOT_USERNAME=$(printf '%s' "$response" | json_field username)
			BOT_ID=$(printf '%s' "$response" | json_field id)
			ok "Бот @$BOT_USERNAME (ID $BOT_ID)"
			return
		fi
		warn "Telegram не принял токен (getMe). Проверьте токен и доступ к api.telegram.org."
	done
}

prompt_admins() {
	local value
	while true; do
		value=$(ask "Telegram ID администратора (несколько — через запятую)" "$1")
		value=${value// /}
		if [[ $value =~ ^[0-9]{3,15}(,[0-9]{3,15})*$ ]]; then
			ADMIN_IDS="$value"
			ok "Администраторы: $ADMIN_IDS"
			return
		fi
		warn "Нужен числовой Telegram ID, например 123456789. Узнать его можно у @userinfobot."
	done
}

prompt_flyer() {
	local current="$1" key response
	while true; do
		if [[ -n $current ]] && confirm "Использовать сохранённый ключ Flyer?"; then
			key="$current"
		else
			key=$(ask_secret "API-ключ Flyer (FL-...)")
		fi
		current=""
		if [[ ! $key =~ ^FL-[A-Za-z0-9-]{8,}$ ]]; then
			warn "Неверный формат ключа Flyer"
			continue
		fi
		response=$(curl -fsS --max-time 15 -H 'Content-Type: application/json' -d "{\"key\":\"$key\"}" https://api.flyerhubs.com/get_me 2>/dev/null || true)
		if [[ -z $response ]]; then
			warn "api.flyerhubs.com недоступен"
		elif [[ $response == *'"error"'* ]] && [[ $response != *'"error":null'* ]] && [[ $response != *'"error":""'* ]]; then
			warn "Flyer вернул ошибку: $(printf '%s' "$response" | json_field error)"
		else
			local type
			type=$(printf '%s' "$response" | json_field type)
			if [[ -n $type && $type != tasks ]]; then
				warn "Тип бота во Flyer — «$type». Для заданий нужен тип «tasks» (методы get_tasks и check_task)."
			else
				ok "Ключ Flyer принят"
			fi
			FLYER_API_KEY="$key"
			return
		fi
		if confirm "Сохранить ключ без проверки?" n; then
			FLYER_API_KEY="$key"
			return
		fi
	done
}

prompt_domain() {
	local value addresses local_ips
	while true; do
		value=$(ask "Домен для Mini App (например, app.example.com)" "$1")
		value=${value,,}
		value=${value#https://}
		value=${value%/}
		if [[ ! $value =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$ ]]; then
			warn "Некорректное доменное имя"
			continue
		fi
		addresses=$( (getent ahostsv4 "$value" || true) | awk '{print $1}' | sort -u | tr '\n' ' ')
		if [[ -z $addresses ]]; then
			warn "Домен $value не резолвится. Создайте A-запись на IP этого сервера."
			confirm "Продолжить всё равно?" n || continue
		else
			local_ips=$(hostname -I 2>/dev/null || true)
			local matched=0
			for ip in $addresses; do
				[[ " $local_ips " == *" $ip "* ]] && matched=1
			done
			if (( matched )); then
				ok "Домен указывает на этот сервер ($addresses)"
			else
				warn "Домен указывает на $addresses, а адреса сервера: $local_ips"
				warn "Если сервер за NAT, это нормально. Иначе HTTPS-сертификат не будет выпущен."
				confirm "Продолжить?" y || continue
			fi
		fi
		DOMAIN="$value"
		return
	done
}

configure() {
	step "Настройка"
	local env_file="$APP_DIR/.env" reuse=0
	if [[ -f $env_file ]]; then
		info "Найдена конфигурация $env_file"
		if confirm "Оставить текущие настройки без изменений?"; then
			reuse=1
		fi
	fi
	POSTGRES_PASSWORD=$(env_get "$env_file" POSTGRES_PASSWORD)
	FLYER_WEBHOOK_SECRET=$(env_get "$env_file" FLYER_WEBHOOK_SECRET)
	BACKUP_KEEP_DAYS=$(env_get "$env_file" BACKUP_KEEP_DAYS)
	if (( reuse )); then
		BOT_TOKEN=$(env_get "$env_file" BOT_TOKEN)
		local response
		response=$(telegram_get_me "$BOT_TOKEN")
		[[ $response == *'"ok":true'* ]] || die "сохранённый токен бота больше не действителен. Запустите установщик снова и введите новый токен."
		BOT_USERNAME=$(printf '%s' "$response" | json_field username)
		ADMIN_IDS=$(env_get "$env_file" ADMIN_IDS)
		FLYER_API_KEY=$(env_get "$env_file" FLYER_API_KEY)
		DOMAIN=$(env_get "$env_file" DOMAIN)
		ACME_EMAIL=$(env_get "$env_file" ACME_EMAIL)
		ok "Используются сохранённые настройки (бот @$BOT_USERNAME, домен $DOMAIN)"
	else
		prompt_bot_token "$(env_get "$env_file" BOT_TOKEN)"
		prompt_admins "$(env_get "$env_file" ADMIN_IDS)"
		prompt_flyer "$(env_get "$env_file" FLYER_API_KEY)"
		prompt_domain "$(env_get "$env_file" DOMAIN)"
		ACME_EMAIL=$(env_get "$env_file" ACME_EMAIL)
		while true; do
			ACME_EMAIL=$(ask "E-mail для регистрации HTTPS-сертификата Let's Encrypt" "$ACME_EMAIL")
			[[ $ACME_EMAIL =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]] && break
			warn "Введите корректный e-mail"
		done
	fi
	if [[ -z $POSTGRES_PASSWORD ]]; then
		POSTGRES_PASSWORD=$(openssl rand -hex 24)
		ok "Сгенерирован пароль PostgreSQL"
	else
		ok "Пароль PostgreSQL сохранён без изменений"
	fi
	if [[ -z $FLYER_WEBHOOK_SECRET ]]; then
		FLYER_WEBHOOK_SECRET=$(openssl rand -hex 24)
		ok "Сгенерирован секрет вебхука Flyer"
	fi
	local tmp
	tmp=$(umask 077 && mktemp "$APP_DIR/.env.XXXXXX")
	cat >"$tmp" <<EOF
BOT_TOKEN=$BOT_TOKEN
BOT_USERNAME=$BOT_USERNAME
ADMIN_IDS=$ADMIN_IDS
FLYER_API_KEY=$FLYER_API_KEY
FLYER_WEBHOOK_SECRET=$FLYER_WEBHOOK_SECRET
DOMAIN=$DOMAIN
ACME_EMAIL=$ACME_EMAIL
POSTGRES_USER=zuba
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
POSTGRES_DB=zuba
BACKUP_KEEP_DAYS=${BACKUP_KEEP_DAYS:-14}
LOG_LEVEL=INFO
EOF
	if [[ -f $env_file ]]; then
		cp -p "$env_file" "$env_file.bak"
		chmod 600 "$env_file.bak"
	fi
	mv "$tmp" "$env_file"
	chmod 600 "$env_file"
	ok "Конфигурация записана в $env_file (права 600)"
}

compose() {
	docker compose --project-directory "$APP_DIR" -f "$APP_DIR/docker-compose.yml" "$@"
}

deploy() {
	step "Сборка и запуск"
	mkdir -p "$APP_DIR/backups"
	chmod 700 "$APP_DIR/backups"
	if compose ps --status running --services 2>/dev/null | grep -qx postgres; then
		info "Резервная копия базы перед обновлением"
		compose exec -T backup /bin/sh /backup.sh once || warn "не удалось создать резервную копию"
	fi
	compose build --pull
	compose up -d --remove-orphans
	info "Миграции базы выполняются сервисом migrate"
	local status
	for _ in $(seq 1 60); do
		status=$(docker inspect -f '{{.State.Health.Status}}' "$(compose ps -q api)" 2>/dev/null || true)
		[[ $status == healthy ]] && break
		sleep 3
	done
	[[ $status == healthy ]] || { compose logs --tail 50 migrate api; die "API не запустился"; }
	ok "API работает"
}

verify() {
	step "Проверка HTTPS"
	local code=""
	for _ in $(seq 1 40); do
		code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://$DOMAIN/health" || true)
		[[ $code == 200 ]] && break
		sleep 5
	done
	if [[ $code == 200 ]]; then
		ok "https://$DOMAIN/health отвечает"
	else
		warn "HTTPS пока недоступен. Проверьте DNS и открытые порты 80/443: docker compose logs caddy"
	fi
	code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "https://$DOMAIN/" || true)
	[[ $code == 200 ]] && ok "Mini App отдаётся по https://$DOMAIN/" || warn "Главная страница вернула код $code"
}

summary() {
	cat <<EOF

${BOLD}ZUBA RUBA установлен${RESET}

  Mini App:            https://$DOMAIN/
  Бот:                 https://t.me/$BOT_USERNAME
  Панель управления:   Mini App → Профиль → «Панель управления»
                       (доступна только Telegram ID: $ADMIN_IDS)
  Каталог:             $APP_DIR

${BOLD}Подключение к BotFather${RESET}
  1. Откройте @BotFather → /mybots → @$BOT_USERNAME → Bot Settings → Configure Mini App.
  2. Нажмите Enable Mini App и укажите адрес: https://$DOMAIN/
  3. Кнопка меню «Открыть» и команда /start настраиваются ботом автоматически.

${BOLD}Подключение вебхука Flyer${RESET}
  В настройках бота в @FlyerServiceBot укажите адрес уведомлений:
  https://$DOMAIN/flyer/webhook/$FLYER_WEBHOOK_SECRET

${BOLD}Обслуживание${RESET}
  Логи:          cd $APP_DIR && docker compose logs -f api worker
  Обновление:    повторно запустите установщик — база и настройки сохраняются
  Бэкапы:        $APP_DIR/backups (ежедневно, хранятся ${BACKUP_KEEP_DAYS:-14} дн.)

Вывод Telegram Stars выключен по умолчанию. Включайте его в настройках
панели управления только после проверки правил, описанных в README.
EOF
}

main() {
	[[ -r $TTY_IN ]] || die "нужен интерактивный терминал (запустите в SSH-сессии)"
	printf '%sУстановка ZUBA RUBA%s\n' "$BOLD" "$RESET"
	info "Репозиторий: $REPO_URL ($REPO_BRANCH)"
	info "Каталог установки: $INSTALL_DIR"
	check_system
	check_tools
	fetch_project
	configure
	deploy
	verify
	summary
}

if [[ ${ZR_SETUP_SOURCED:-0} != 1 ]]; then
	main "$@"
fi
