#!/usr/bin/env bash
# A/B performance probe: each run disables one subsystem. perf_ab.sh <out.jsonl> <quality> <cam> [res] [offs...]
cd /home/user/safarzod/dushanbe_city
OUT=$1; Q=$2; CAM=$3; RES=${4:-960x540}; shift 4 2>/dev/null
OFFS=${@:-"none sky_rt shadows foliage_shadows trees grass props detail backdrop fog,glow city"}
for OFF in $OFFS; do
  [ "$OFF" = none ] && OFF=""
  timeout 900 xvfb-run -a -s "-screen 0 1280x720x24" godot --path . --resolution $RES --rendering-method mobile \
    res://scenes/testing/perf_probe.tscn -- cam=$CAM quality=$Q off=$OFF label="off:${OFF:-none}" out=$OUT frames=25 nodynres 2>&1 | grep -E "^PERF|SCRIPT ERROR" | cut -c1-300
done
