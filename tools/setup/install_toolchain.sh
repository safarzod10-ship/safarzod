#!/usr/bin/env bash
# DUSHANBE — reproducible toolchain installer (Debian 12 / Ubuntu 22.04+, x86_64).
# Installs exactly the versions verified in stage 1 (docs/TOOLS.md), checking
# official checksums. Idempotent; needs sudo for apt and /opt.
#   sudo tools/setup/install_toolchain.sh
set -euo pipefail
GODOT_VER=4.7.2
BLENDER_VER=4.5.15
CMDLINE_TOOLS=commandlinetools-linux-16111833_latest.zip
PREFIX=/opt
DL=$PREFIX/dl
SDK=$PREFIX/android-sdk
USER_HOME=$(getent passwd "${SUDO_USER:-${USER:-$(id -un)}}" | cut -d: -f6)  # $USER is unset in some containers
need_mb() { local avail; avail=$(df -Pm "$PREFIX" | awk 'NR==2{print $4}'); [ "$avail" -ge "$1" ] || { echo "Need ${1} MB free in $PREFIX, have ${avail}"; exit 1; }; }

need_mb 6000   # downloads ~1.8 GB + installs ~2.5 GB + headroom
apt-get update
apt-get install -y --no-install-recommends openjdk-17-jdk-headless git unzip zip xz-utils curl wget jq tmux \
  imagemagick python3 python3-venv time ca-certificates nodejs npm \
  mesa-vulkan-drivers libvulkan1 xvfb xauth   # lavapipe + Xvfb: real-renderer screenshots without a GPU
mkdir -p "$DL"; cd "$DL"

# --- Godot (official GitHub release, SHA-512 verified)
B=https://github.com/godotengine/godot/releases/download/${GODOT_VER}-stable
curl -fsSLO "$B/SHA512-SUMS.txt"
for f in Godot_v${GODOT_VER}-stable_linux.x86_64.zip Godot_v${GODOT_VER}-stable_export_templates.tpz; do
  [ -f "$f" ] || curl -fSLO "$B/$f"
done
sha512sum -c --ignore-missing SHA512-SUMS.txt
mkdir -p $PREFIX/godot && unzip -oq Godot_v${GODOT_VER}-stable_linux.x86_64.zip -d $PREFIX/godot
ln -sf $PREFIX/godot/Godot_v${GODOT_VER}-stable_linux.x86_64 /usr/local/bin/godot
T="$USER_HOME/.local/share/godot/export_templates/${GODOT_VER}.stable"; mkdir -p "$T"
unzip -ojq Godot_v${GODOT_VER}-stable_export_templates.tpz 'templates/android_*' 'templates/version.txt' \
  'templates/linux_debug.x86_64' 'templates/linux_release.x86_64' -d "$T"

# --- Blender LTS (download.blender.org, SHA-256 verified)
BB=https://download.blender.org/release/Blender${BLENDER_VER%.*}
[ -f blender-${BLENDER_VER}-linux-x64.tar.xz ] || curl -fSLO "$BB/blender-${BLENDER_VER}-linux-x64.tar.xz"
curl -fsSLO "$BB/blender-${BLENDER_VER}.sha256"
grep linux-x64 blender-${BLENDER_VER}.sha256 | sha256sum -c
mkdir -p $PREFIX/blender && tar -xJf blender-${BLENDER_VER}-linux-x64.tar.xz -C $PREFIX/blender
ln -sf $PREFIX/blender/blender-${BLENDER_VER}-linux-x64/blender /usr/local/bin/blender

# --- Android SDK (command-line tools only; no Android Studio, no NDK)
if [ ! -x "$SDK/cmdline-tools/latest/bin/sdkmanager" ]; then
  curl -fSLO https://dl.google.com/android/repository/$CMDLINE_TOOLS
  mkdir -p "$SDK/cmdline-tools" && unzip -qo $CMDLINE_TOOLS -d "$SDK/cmdline-tools"
  mv "$SDK/cmdline-tools/cmdline-tools" "$SDK/cmdline-tools/latest"
fi
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
yes | "$SDK/cmdline-tools/latest/bin/sdkmanager" --sdk_root="$SDK" --licenses >/dev/null || true
"$SDK/cmdline-tools/latest/bin/sdkmanager" --sdk_root="$SDK" "platform-tools" "build-tools;35.0.1" "platforms;android-35"

# --- Python venv for helper tools (nothing installed globally)
python3 -m venv $PREFIX/dushanbe-venv
$PREFIX/dushanbe-venv/bin/pip install -q numpy pygltflib Pillow scipy   # scipy: KD-tree (monument model comparison)
# --- glTF-Transform CLI (Khronos validator + inspection)
npm install -g @gltf-transform/cli@4.5.1

chown -R "${SUDO_USER:-${USER:-$(id -un)}}" "$USER_HOME/.local/share/godot" || true
echo "Installed. Next (as your normal user): tools/android/configure_godot_android.sh"
godot --headless --version; blender -b --version | head -1; java -version 2>&1 | head -1
