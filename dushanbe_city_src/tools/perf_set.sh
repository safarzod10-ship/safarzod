#!/usr/bin/env bash
# Standard perf set: 3 views × 4 presets -> JSONL.  perf_set.sh <out.jsonl> [presets...]
# Views: avenue with plane trees, mahalla courtyard, city edge looking out (towards the coast/mountains).
cd /home/user/safarzod/dushanbe_city
OUT=$1; shift
PRESETS=${@:-"low medium high ultra"}
for Q in $PRESETS; do
  for CAM in "-50,1.7,-60,15,3" "-262,1.7,-205,200,4" "285,1.7,60,-90,2"; do
    timeout 900 xvfb-run -a -s "-screen 0 1280x720x24" godot --path . --resolution 960x540 --rendering-method mobile \
      res://scenes/testing/perf_probe.tscn -- cam=$CAM quality=$Q label="$Q@$CAM" out=$OUT frames=25 nodynres 2>&1 \
      | grep -E "^PERF|SCRIPT ERROR" | cut -c1-220
  done
done
