"""Экспорт обученного голоса Джарвиса (Piper/VITS) в формат для приложения (sherpa-onnx).

python export_tts.py <checkpoint.ckpt> <config.json> <out_dir> [--int8]

Создаёт out_dir/jarvis.onnx (с метаданными sherpa-onnx) и out_dir/tokens.txt.
"""
import json
import subprocess
import sys
from pathlib import Path

import onnx


def main():
    ckpt, config, out = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
    int8 = "--int8" in sys.argv
    out.mkdir(parents=True, exist_ok=True)
    raw = out / "raw.onnx"
    subprocess.run([sys.executable, "-m", "piper.train.export_onnx", "--checkpoint", str(ckpt), "--output-file", str(raw)], check=True)

    cfg = json.loads(config.read_text(encoding="utf-8"))
    # tokens.txt: «символ id» — как ждёт sherpa-onnx для моделей piper
    lines = []
    for sym, ids in cfg["phoneme_id_map"].items():
        # многосимвольные (английские дифтонги) sherpa-onnx не читает, для русского они не нужны
        if len(sym) != 1:
            continue
        lines.append(f"{sym} {ids[0]}")
    (out / "tokens.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")

    model = onnx.load(str(raw))
    meta = {
        "model_type": "vits",
        "comment": "piper",
        "language": "Russian",
        "voice": cfg.get("espeak", {}).get("voice", "ru"),
        "has_espeak": 1,
        "n_speakers": cfg.get("num_speakers", 1),
        "sample_rate": cfg.get("audio", {}).get("sample_rate", 22050),
    }
    for k, v in meta.items():
        p = model.metadata_props.add()
        p.key, p.value = k, str(v)
    final = out / "jarvis.onnx"
    onnx.save(model, str(final))
    raw.unlink()
    if int8:
        from onnxruntime.quantization import QuantType, quantize_dynamic
        q = out / "jarvis.int8.onnx"
        quantize_dynamic(str(final), str(q), weight_type=QuantType.QUInt8)
        q.replace(final)
    print("ok", final, round(final.stat().st_size / 1e6, 1), "MB")


if __name__ == "__main__":
    main()
