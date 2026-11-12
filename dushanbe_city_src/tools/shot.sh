#!/usr/bin/env bash
# shot.sh <out.png> <x,y,z,yaw,pitch> [extra args...]  — real render of the main scene
cd /home/user/safarzod/dushanbe_city
OUT=$1; CAM=$2; shift 2
timeout 600 xvfb-run -a -s "-screen 0 1280x720x24" godot --path . --resolution 1280x720 --rendering-method mobile \
  res://scenes/testing/capture.tscn -- scene=res://scenes/main/main.tscn out=$OUT cam=$CAM frames=50 hide_ui=1 "$@" 2>&1 \
  | grep -E "CAPTURED|SCRIPT ERROR|ERROR|categories" | grep -v "status < 0" | cut -c1-300
