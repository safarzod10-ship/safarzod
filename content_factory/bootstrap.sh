#!/usr/bin/env bash
# Checks (and if needed reinstalls) everything the factory needs.
# usage: bootstrap.sh [check]      exit 4 = voice samples missing (ask the user to re-send the recording)
set -euo pipefail
FAC="$(cd "$(dirname "$0")" && pwd)"
V="$FAC/voice"; [ -e "$V" ] || mkdir -p "$V"
ok=1
[ -x "$V/venv_f5/bin/python" ] && "$V/venv_f5/bin/python" -c "import f5_tts.api, ruaccent, faster_whisper" 2>/dev/null || ok=0
[ -s "$V/models/f5ru/model_last_inference.safetensors" ] || ok=0
[ -f "$FAC/engine/node_modules/three/build/three.module.js" ] || ok=0
if [ $ok = 0 ]; then
  echo "== installing tools (10-15 min)"
  command -v uv >/dev/null || pip install -q uv
  uv python install 3.11 >/dev/null
  [ -x "$V/venv_f5/bin/python" ] || uv venv -q -p 3.11 "$V/venv_f5"
  VIRTUAL_ENV="$V/venv_f5" uv pip install -q --index-strategy unsafe-best-match --extra-index-url https://download.pytorch.org/whl/cpu \
    f5-tts ruaccent faster-whisper num2words "numpy>=2.0.2,<2.3" "setuptools<81"
  mkdir -p "$V/models/f5ru"
  for f in F5TTS_v1_Base_v2/model_last_inference.safetensors F5TTS_v1_Base/vocab.txt; do
    [ -s "$V/models/f5ru/$(basename $f)" ] || curl -sSL -o "$V/models/f5ru/$(basename $f)" "https://huggingface.co/Misha24-10/F5-TTS_RUSSIAN/resolve/main/$f"
  done
  if [ ! -f "$FAC/engine/node_modules/three/build/three.module.js" ]; then
    rm -rf "$FAC/engine/node_modules"; (cd "$FAC/engine" && npm init -y >/dev/null && npm i -s three@0.170.0)
  fi
fi
python3 -I - "$FAC" <<'EOF'
import json, os, sys
fac = sys.argv[1]
refs = json.load(open(f"{fac}/voice_refs.json", encoding="utf-8"))
miss = [k for k, (w, _) in refs.items() if not os.path.exists(os.path.join(fac, "voice", w))]
if miss:
    print("VOICE_MISSING", miss); sys.exit(4)
print("tools ok, voice ok")
EOF
