# Голос Джарвиса: обучение синтеза

Обучает офлайн-синтез речи (Piper / VITS) на записях из `jarvis/sounds/incoming`, чтобы приложение говорило **любой** текст этим голосом без интернета (через sherpa-onnx).

Готовая модель (`jarvis.onnx`, `tokens.txt`) в репозиторий не кладётся — только в APK. Голос — для личного использования.

## Шаги

```bash
# 1. окружение (CPU достаточно, GPU ускорит в десятки раз)
python3 -m venv venv && . venv/bin/activate
pip install torch --index-url https://download.pytorch.org/whl/cpu
pip install "lightning>=2,<3" tensorboard tensorboardX "jsonargparse[signatures]>=4.27.7" onnx onnxscript \
    pysilero-vad cython "librosa<1" onnxruntime soundfile piper-tts "sherpa-onnx==1.10.45"
git clone https://github.com/OHF-Voice/piper1-gpl.git
SP=$(python -c "import piper,os;print(os.path.dirname(piper.__file__))")
cp -r piper1/src/piper/train $SP/ && cp piper1/src/piper/*.py $SP/ && cp -r piper1/src/piper/lithuanian $SP/
(cd $SP/train/vits/monotonic_align && mkdir -p monotonic_align && cythonize -i core.pyx && mv core*.so monotonic_align/)
sed -i 's/opset_version=OPSET_VERSION,/opset_version=OPSET_VERSION, dynamo=False,/' $SP/train/export_onnx.py

# 2. базовая русская модель для дообучения
curl -L -o anton.ckpt https://huggingface.co/rraaww/ru_piper/resolve/main/anton.ckpt

# 3. датасет: записи → wav 22 кГц + metadata.csv (текст фраз берётся из tools/build_voice.py)
python3 jarvis/tools/voice_clone/make_dataset.py data

# 4. дообучение (~70 с на эпоху на 4 ядрах CPU; 50–100 эпох)
python -m piper.train fit --data.voice_name jarvis --data.csv_path data/metadata.csv --data.audio_dir data/wav \
  --model.sample_rate 22050 --data.espeak_voice ru --data.cache_dir train/cache --data.config_path train/config.json \
  --data.batch_size 12 --data.validation_split 0.0 --data.num_test_examples 0 \
  --trainer.accelerator cpu --trainer.max_epochs 3580 --trainer.default_root_dir train --ckpt_path anton.ckpt

# 5. экспорт для приложения (int8 — в 3 раза меньше, качество то же) и проверка
python jarvis/tools/voice_clone/export_tts.py train/lightning_logs/version_0/checkpoints/last.ckpt train/config.json out --int8
python jarvis/tools/voice_clone/eval_tts.py out <espeak-ng-data> <vosk-model-small-ru> data/wav eval
cp out/jarvis.onnx out/tokens.txt jarvis/android/app/src/main/assets/tts/
```

Больше записей — лучше голос: 2 минуты дают узнаваемый тембр, 15–30 минут — почти неотличимый.
