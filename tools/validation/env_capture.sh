#!/usr/bin/env bash
# Real-renderer screenshot of the stage-2 environment scene.
# env_capture.sh <out.png> <quality> <renderer> "<x,y,z,yaw,pitch>" [time] [weather] [extra key=value...]
cd "$(dirname "$0")/../.."
OUT=$1; Q=$2; R=$3; FLY=$4; T=${5:-11}; W=${6:-Clear}; shift 6 2>/dev/null || shift $#
timeout 600 xvfb-run -a -s "-screen 0 1280x720x24" godot --path . --resolution 1280x720 --rendering-method "$R" \
  res://tests/visual/capture.tscn -- res://scenes/world/dushanbe_environment.tscn "$Q" "$OUT" fly="$FLY" time="$T" weather="$W" frames=45 "$@" 2>&1 \
  | grep -E "^CAPTURED|SCRIPT ERROR|SHADER ERROR|^ERROR" | grep -v "status < 0" | cut -c1-400
