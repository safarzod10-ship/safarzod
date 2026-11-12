#!/usr/bin/env python3
"""Voice an episode locally with a cloned voice (Chatterbox Multilingual, MIT licence).

Run with the venv that has chatterbox-tts installed:
  <venv>/bin/python tts_clone.py komentograd1.html voice/kg1_tts.json
voice/xx_tts.json: {"voiceDir": "out/voice/kg1", "map": "voice/kg1_map.json", "ref": "out/voice/ref/host.wav",
                    "exaggeration": 0.6, "cfg": 0.4, "say": {"on-screen text": "spoken text"}}
"""
import json, os, re, subprocess, sys
import torch, torchaudio
from chatterbox.mtl_tts import ChatterboxMultilingualTTS

html_path, cfg_path = sys.argv[1:3]
cfg = json.load(open(cfg_path, encoding='utf-8'))
html = open(html_path, encoding='utf-8').read()
subs = re.findall(r"^\s*\[\s*([\d.]+),\s*([\d.]+),\s*'(\w)',\s*'(.*?)'\],?\s*$", html, re.M)
os.makedirs(cfg['voiceDir'], exist_ok=True)
torch.set_num_threads(os.cpu_count() or 4)
model = ChatterboxMultilingualTTS.from_pretrained(device='cpu')
say = cfg.get('say', {})
lines = []
for i, (a, b, who, text) in enumerate(subs):
    t = text
    for k, v in say.items():
        t = t.replace(k, v)
    t = t.replace('*', '').replace('∗', '')
    out = os.path.join(cfg['voiceDir'], f'{i:02d}_{who}.wav')
    if not os.path.exists(out):
        torch.manual_seed(cfg.get('seed', 7) + i)
        wav = model.generate(t, language_id='ru', audio_prompt_path=cfg['ref'],
                             exaggeration=cfg.get('exaggeration', 0.6), cfg_weight=cfg.get('cfg', 0.4))
        torchaudio.save(out, wav, model.sr)
    dur = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out], capture_output=True, text=True).stdout)
    lines.append({'a': float(a), 'file': os.path.basename(out), 'from': 0.0, 'to': round(dur, 3)})
    print(f'{a:>6} {who} {dur:5.2f}s  {t}', flush=True)
json.dump({'comment': 'Generated locally by tts_clone.py', 'voiceDir': cfg['voiceDir'], 'phoneFilter': cfg.get('phoneFilter', []), 'lines': lines},
          open(cfg['map'], 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
