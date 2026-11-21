#!/bin/sh
set -e
mkdir -p /var/backups/trusty
chmod 700 /var/backups/trusty
runuser -u postgres -- pg_dump -Fc trusty > "/var/backups/trusty/trusty-$(date +%F).dump"
find /var/backups/trusty -name 'trusty-*.dump' -mtime +14 -delete
