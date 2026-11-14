#!/usr/bin/env bash
# Сборка: веб-версия (для Safari) → упаковка в web/durak_web.zip → APK с ней внутри.
#   durak/tools/build.sh
# Ключ подписи APK — переменные GODOT_ANDROID_KEYSTORE_RELEASE_{PATH,USER,PASSWORD}.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=../builds
mkdir -p "$OUT/web" "$OUT/android" web
godot --headless --import >/dev/null 2>&1 || true
rm -f "$OUT"/web/*
godot --headless --export-release "Web" "$OUT/web/durak.html"
TMP=$(mktemp -d)
cp "$OUT/web/durak.html" "$TMP/index.html"
for f in "$OUT"/web/*; do
  case "$f" in *.html|*.wasm) ;; *) cp "$f" "$TMP/";; esac
done
gzip -9 -c "$OUT/web/durak.wasm" > "$TMP/durak.wasm.gz"
rm -f web/durak_web.zip
(cd "$TMP" && zip -q -r -9 "$OLDPWD/web/durak_web.zip" .)
rm -rf "$TMP"
ls -la web/durak_web.zip
godot --headless --export-release "Android" "$OUT/android/durak.apk"
ls -la "$OUT/android/durak.apk"
