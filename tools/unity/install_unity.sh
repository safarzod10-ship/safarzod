#!/usr/bin/env bash
# Installs Unity 6000.3.29f1 (LTS) for Linux with Android build support into /opt/unity.
set -euo pipefail
V=6000.3.29f1; H=96d2fe17529c
R=/opt/unity/$V; U=$R/Editor/Data/PlaybackEngines/AndroidPlayer
D=/opt/unity-dl; HERE="$(cd "$(dirname "$0")" && pwd)"
B=https://download.unity3d.com/download_unity; G=https://dl.google.com/android/repository
g(){ curl -fsSL --retry 4 -C - -o "$1" "$2"; }
z(){ rm -rf t; mkdir t; unzip -q -o "$1" -d t; rm "$1"; }
mkdir -p "$R" "$D"; cd "$D"

if [ ! -x "$R/Editor/Unity" ]; then
  g editor.tar.xz $B/$H/LinuxEditorInstaller/Unity-$V.tar.xz
  tar -xJf editor.tar.xz -C "$R"; rm editor.tar.xz
fi
if [ ! -f "$U/modules.asset" ]; then
  # Unity ships Android support for Linux as a macOS .pkg (xar + gzip cpio)
  g android.pkg $B/$H/MacEditorTargetInstaller/UnitySetup-Android-Support-for-Editor-$V.pkg
  mkdir -p "$U"; python3 -I "$HERE/unpkg.py" android.pkg "$U" | tail -1; rm android.pkg
fi
if [ ! -x "$U/OpenJDK/bin/java" ]; then
  g jdk.zip $B/open-jdk/open-jdk-linux-x64/jdk17.0.21-9_9655b4326993de27c59a5b2b5a64a52a800f3a6db70da6cdeb98f634764c1960.zip
  mkdir -p "$U/OpenJDK"; unzip -q -o jdk.zip -d "$U/OpenJDK"; rm jdk.zip
fi
if [ ! -d "$U/NDK" ]; then
  g ndk.zip $G/android-ndk-r27c-linux.zip; z ndk.zip; mv t/android-ndk-r27c "$U/NDK"
fi
if [ ! -d "$U/SDK/cmdline-tools/21.0" ]; then
  mkdir -p "$U/SDK/platforms" "$U/SDK/build-tools" "$U/SDK/cmdline-tools"
  g pt.zip $G/platform-tools_r37.0.1-linux.zip; unzip -q -o pt.zip -d "$U/SDK"; rm pt.zip
  g bt.zip $G/build-tools_r36_linux.zip; z bt.zip; rm -rf "$U/SDK/build-tools/36.0.0"; mv t/* "$U/SDK/build-tools/36.0.0"
  g p36.zip $G/platform-36_r02.zip; z p36.zip; rm -rf "$U/SDK/platforms/android-36"; mv t/* "$U/SDK/platforms/android-36"
  g cl.zip $G/commandlinetools-linux-15641748_latest.zip; z cl.zip; mv t/cmdline-tools "$U/SDK/cmdline-tools/21.0"
fi
rm -rf t
"$R/Editor/Unity" -version
