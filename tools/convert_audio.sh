#!/bin/bash
# Convert the exported WAV clips to MP3 for the browser: long clips (music) stereo 96 kbit/s, short effects mono 112 kbit/s.
#   convert_audio.sh <wav dir> <web/audio dir>
set -e
src="$1"; dst="$2"; mkdir -p "$dst"
for f in "$src"/*.wav; do
  n=$(basename "$f" .wav)
  d=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f")
  if awk "BEGIN{exit !($d > 20)}"; then
    ffmpeg -v error -y -i "$f" -ac 2 -b:a 96k "$dst/$n.mp3"
  else
    ffmpeg -v error -y -i "$f" -ac 1 -b:a 112k "$dst/$n.mp3"
  fi
done
