#!/bin/sh
# `docker run IMAGE install` prints the server installer; anything else starts the game server.
set -e
case "${1:-}" in
  install) exec cat /app/deploy/install.sh ;;
  compose) exec cat /app/deploy/compose.yaml ;;
  caddyfile) exec cat /app/deploy/Caddyfile ;;
  backup) exec node --disable-warning=ExperimentalWarning -e "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('/data/heist.sqlite');const f='/data/backups/heist-manual-'+new Date().toISOString().replace(/[:.]/g,'-')+'.sqlite';require('fs').mkdirSync('/data/backups',{recursive:true});d.prepare('VACUUM INTO ?').run(f);console.log(f)" ;;
esac
exec node --disable-warning=ExperimentalWarning /app/dist/server/server/main.js
