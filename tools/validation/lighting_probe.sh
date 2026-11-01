#!/usr/bin/env bash
# Measure calibration patches: tools/validation/lighting_probe.sh <renderer> <hour> [out.png] [weather]
cd "$(dirname "$0")/../.."
OUT=${3:-/tmp/lighting_probe.png}
timeout 300 xvfb-run -a -s "-screen 0 1280x720x24" godot --path . --resolution 1280x720 --rendering-method "$1" \
  res://tests/visual/capture.tscn -- res://scenes/testing/lighting_calibration.tscn medium "$OUT" hide_ui=1 probes=1 frames=40 time="$2" ${@:4} 2>&1 \
  | grep -E "^PROBES" | sed "s/^PROBES/$1 h$2/"
