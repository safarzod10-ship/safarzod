#!/bin/sh
set -eu
umask 077

KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
INTERVAL="${BACKUP_INTERVAL_SECONDS:-86400}"
TARGET=/backups

backup() {
	stamp=$(date -u +%Y%m%d-%H%M%S)
	file="$TARGET/zuba-$stamp.dump"
	if pg_dump -h postgres -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -f "$file.partial"; then
		mv "$file.partial" "$file"
		echo "backup created: $file"
	else
		rm -f "$file.partial"
		echo "backup failed" >&2
	fi
	find "$TARGET" -name 'zuba-*.dump' -type f -mtime +"$KEEP_DAYS" -delete
}

if [ "${1:-}" = "once" ]; then
	backup
	exit 0
fi

while true; do
	backup
	sleep "$INTERVAL"
done
