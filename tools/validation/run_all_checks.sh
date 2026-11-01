#!/usr/bin/env bash
# Reproduces every stage-1 check. Run from the project root. Sequential on
# purpose (no parallel heavy jobs). Logs go to builds/logs/.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"; cd "$ROOT"
LOG=builds/logs; mkdir -p "$LOG"
ART=source_assets/artifact_V319FyaEBZx5atFp4i7bg3
PY=${DUSHANBE_PY:-/opt/dushanbe-venv/bin/python}
TIME="/usr/bin/time -f %e_s_%M_KB"
fail=0
step() { echo "== $*"; }

step "1. source integrity (SHA-256 of original artifact files)"
(cd "$ART" && sha256sum -c --quiet SHA256SUMS) && echo OK || { echo FAIL; fail=1; }

step "2. raw mesh analysis"
for k in prado monument character; do
  $PY -I tools/validation/artifact_mesh.py "$ART" $k --json docs/reports/${k}_source.json >/dev/null || fail=1
done; echo done

step "3. Blender: decode -> GLB -> re-import -> compare"
# character: stage-1 pipeline; prado + monument: stage-2 corrected pipeline (asset_pipeline_v2.py)
run_bl() {  # script key out report
  $TIME blender -b --factory-startup --python "$1" -- "$ART" $2 "$3" "$4" >"$LOG/blender_$2.log" 2>&1
  grep -h ROUNDTRIP "$LOG/blender_$2.log" || { echo "FAIL $2"; fail=1; }
  tail -1 "$LOG/blender_$2.log"
}
run_bl tools/blender/build_glb_from_artifact.py character assets/characters/main_character/main_character.glb docs/reports/character_blender.json
run_bl tools/blender/asset_pipeline_v2.py prado assets/vehicles/prado/prado.glb docs/reports/prado_v2.json
run_bl tools/blender/asset_pipeline_v2.py monument assets/monuments/ismoili_somoni/ismoili_somoni.glb docs/reports/monument_v2.json

step "4. Khronos glTF validator"
for f in $(find assets -name "*.glb" | sort); do
  gltf-transform validate "$f" >"$LOG/validate_$(basename $f).log" 2>&1
  grep -q "No errors found" "$LOG/validate_$(basename $f).log" && grep -q "No warnings found" "$LOG/validate_$(basename $f).log" \
    && echo "OK $f" || { echo "FAIL $f"; fail=1; }
done

step "5. Godot import"
$TIME godot --headless --import >"$LOG/godot_import.log" 2>&1; tail -1 "$LOG/godot_import.log"
grep -iE "^(ERROR|SCRIPT ERROR)" "$LOG/godot_import.log" && fail=1

step "6. Godot automated tests"
timeout 300 $TIME godot --headless res://tests/test_runner.tscn >"$LOG/godot_tests.log" 2>&1 || fail=1
grep -E "TEST_SUMMARY|TEST FAIL" "$LOG/godot_tests.log"; tail -1 "$LOG/godot_tests.log"

step "7. Main scene smoke run (headless, 400 frames)"
timeout 120 godot --headless --quit-after 400 >"$LOG/godot_main.log" 2>&1
grep -E "DUSHANBE boot|ERROR|leaked" "$LOG/godot_main.log"

step "8. Android debug export + APK verification"
APK=builds/android/dushanbe-debug.apk; mkdir -p builds/android
$TIME godot --headless --export-debug "Android" "$APK" >"$LOG/android_export.log" 2>&1 || fail=1
tail -1 "$LOG/android_export.log"
BT=${ANDROID_HOME:-/opt/android-sdk}/build-tools/35.0.1
if [ -s "$APK" ]; then
  $BT/apksigner verify "$APK" 2>/dev/null && echo "signature OK" || { echo "signature FAIL"; fail=1; }
  unzip -tq "$APK" || fail=1
  $BT/aapt2 dump badging "$APK" 2>/dev/null | grep -E "^package|native-code|sdkVersion|targetSdk"
  ls -l "$APK"; sha256sum "$APK"
else
  echo "APK missing"; fail=1
fi
echo "RESULT: $([ $fail = 0 ] && echo ALL CHECKS PASSED || echo SOME CHECKS FAILED)"
exit $fail
