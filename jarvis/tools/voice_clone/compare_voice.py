"""Насколько синтез похож на оригинальный голос: синтезирует фразы из записей и считает
мел-кепстральное расстояние (MCD, после выравнивания DTW) до оригинала. Меньше — ближе.

python compare_voice.py <espeak-ng-data> <data_dir> <model_dir> [<model_dir> ...]
"""
import sys
from pathlib import Path

import librosa
import numpy as np
import sherpa_onnx


def mfcc(x, sr):
    x = librosa.resample(x, orig_sr=sr, target_sr=22050) if sr != 22050 else x
    m = librosa.feature.mfcc(y=x, sr=22050, n_mfcc=25, n_fft=1024, hop_length=256)
    return m[1:]  # без энергии


def mcd(a, b):
    _, wp = librosa.sequence.dtw(X=a, Y=b, metric="euclidean")
    d = np.mean([np.linalg.norm(a[:, i] - b[:, j]) for i, j in wp])
    return 10 / np.log(10) * np.sqrt(2) * d / 10


def main():
    espeak, data = Path(sys.argv[1]), Path(sys.argv[2])
    rows = [l.split("|") for l in (data / "metadata.csv").read_text(encoding="utf-8").splitlines() if l and "_" not in l.split("|")[0]]
    rows = rows[::4][:14]
    for md in map(Path, sys.argv[3:]):
        tts = sherpa_onnx.OfflineTts(sherpa_onnx.OfflineTtsConfig(model=sherpa_onnx.OfflineTtsModelConfig(
            vits=sherpa_onnx.OfflineTtsVitsModelConfig(model=str(md / "jarvis.onnx"), lexicon="", tokens=str(md / "tokens.txt"),
                                                      data_dir=str(espeak), noise_scale=0.5, noise_scale_w=0.8, length_scale=1.0),
            num_threads=2)))
        ds = []
        for name, text in rows:
            orig, sr = librosa.load(str(data / "wav" / name), sr=22050)
            g = tts.generate(text, sid=0, speed=1.0)
            syn = np.array(g.samples, dtype=np.float32)
            ds.append(mcd(mfcc(orig, sr), mfcc(syn, g.sample_rate)))
        print(f"{md.name:10s} MCD {np.mean(ds):.2f} (медиана {np.median(ds):.2f})")


if __name__ == "__main__":
    main()
