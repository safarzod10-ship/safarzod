#!/usr/bin/env bash
# Points the Godot 4.7 editor settings at the local Android toolchain.
# Idempotent. Secrets: only the PUBLIC, well-known Android debug keystore
# credentials (android/android) are used; release keys are never handled here.
set -euo pipefail
GODOT_VER="${GODOT_VER:-4.7}"
SDK="${ANDROID_HOME:-/opt/android-sdk}"
JDK="${JAVA_HOME_17:-/usr/lib/jvm/java-17-openjdk-amd64}"
KEYSTORE="${DEBUG_KEYSTORE:-$HOME/.android/debug.keystore}"
CFG="$HOME/.config/godot/editor_settings-${GODOT_VER}.tres"

if [ ! -f "$KEYSTORE" ]; then
  mkdir -p "$(dirname "$KEYSTORE")"
  keytool -genkeypair -v -keystore "$KEYSTORE" -storepass android -alias androiddebugkey \
    -keypass android -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Android Debug,O=Android,C=US"
fi
if [ ! -f "$CFG" ]; then
  godot --headless --editor --quit >/dev/null 2>&1 || true   # creates default settings file
fi
set_key() {  # key value(raw)
  if grep -q "^$1 = " "$CFG"; then
    sed -i "s|^$1 = .*|$1 = $2|" "$CFG"
  else
    sed -i "/^\[resource\]/a $1 = $2" "$CFG"
  fi
}
set_key "export/android/android_sdk_path" "\"$SDK\""
set_key "export/android/java_sdk_path" "\"$JDK\""
set_key "export/android/debug_keystore" "\"$KEYSTORE\""
set_key "export/android/debug_keystore_user" "\"androiddebugkey\""
set_key "export/android/debug_keystore_pass" "\"android\""
grep -E "export/android/(android_sdk_path|java_sdk_path|debug_keystore)" "$CFG"
