#!/usr/bin/env bash
# Full pipeline for one episode: voice -> audio mix -> render -> mp4 + mp3
# usage: run_episode.sh <episode name, e.g. ep02>
set -euo pipefail
FAC="$(cd "$(dirname "$0")" && pwd)"; NAME="$1"; EP="$FAC/episodes/$NAME"
cd "$FAC"
"$FAC/bootstrap.sh" check
echo "== voice"; "$FAC/voice/venv_f5/bin/python" make_voice.py "$EP" 2>&1 | grep -E "^line|Error|error" || true
n=$(python3 -I -c "import json,sys;print(len(json.load(open(sys.argv[1]))['lines']))" "$EP/episode.json")
for i in $(seq 1 $n); do [ -f "$EP/voice/l$i.wav" ] || { echo "missing voice line $i"; exit 3; }; done
echo "== audio"; python3 -I build_audio.py "$EP"
curl -s -o /dev/null "http://127.0.0.1:8766/engine/index.html" || { (cd "$FAC" && nohup python3 -m http.server 8766 --bind 127.0.0.1 >/dev/null 2>&1 &); sleep 1; }
echo "== render"; rm -rf "$EP/frames"; node render.js "episodes/$NAME" "$EP/frames" 30
echo "== encode"
ffmpeg -v error -y -framerate 30 -i "$EP/frames/f%05d.jpg" -i "$EP/mix.wav" -vf "scale=1080:1920:flags=lanczos,format=yuv420p" \
  -c:v libx264 -preset medium -crf 19 -c:a aac -b:a 160k -shortest -movflags +faststart "$FAC/out/$NAME.mp4"
ffmpeg -v error -y -i "$EP/voice_only.wav" -af loudnorm=I=-16:TP=-1.5 -ar 44100 -c:a libmp3lame -b:a 192k "$FAC/out/${NAME}_voice.mp3"
ffmpeg -v error -y -ss 1.2 -i "$FAC/out/$NAME.mp4" -frames:v 1 -q:v 3 "$FAC/out/${NAME}_cover.jpg"
rm -rf "$EP/frames"
echo "DONE $FAC/out/$NAME.mp4 ($(ffprobe -v error -show_entries format=duration -of csv=p=0 "$FAC/out/$NAME.mp4")s)"
