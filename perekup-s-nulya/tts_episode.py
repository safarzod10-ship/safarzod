#!/usr/bin/env python3
"""Voice an episode with ElevenLabs: one clip per subtitle line + a voice map for build_voice.py.

Usage: python3 tts_episode.py episode6.html voice/ep6_tts.json
The API key is injected by the session's network proxy (no key in code or env).
voice/epN_tts.json:
  {"voiceDir": "out/voice/ep6tts", "map": "voice/ep6_map.json", "model": "eleven_multilingual_v2",
   "voices": {"T": "<voice_id>", ...}, "settings": {...}, "say": {"text on screen": "text to speak"},
   "phoneFilter": ["F"]}
"""
import json
import os
import re
import subprocess
import sys
import urllib.request

html_path, cfg_path = sys.argv[1:3]
cfg = json.load(open(cfg_path, encoding='utf-8'))
html = open(html_path, encoding='utf-8').read()
subs = re.findall(r"^\s*\[\s*([\d.]+),\s*([\d.]+),\s*'(\w)',\s*'(.*?)'\],?\s*$", html, re.M)
os.makedirs(cfg['voiceDir'], exist_ok=True)
settings = cfg.get('settings', {'stability': 0.4, 'similarity_boost': 0.8, 'style': 0.35, 'use_speaker_boost': True})
say = cfg.get('say', {})


def speak_text(text):
    t = text
    for a, b in say.items():
        t = t.replace(a, b)
    return t.replace('*', '')


lines = []
total = 0
for i, (a, b, who, text) in enumerate(subs):
    voice = cfg['voices'][who]
    spoken = speak_text(text)
    out = os.path.join(cfg['voiceDir'], f'{i:02d}_{who}.mp3')
    if not os.path.exists(out):
        prev_t = speak_text(subs[i - 1][3]) if i and subs[i - 1][2] == who else ''
        body = {'text': spoken, 'model_id': cfg.get('model', 'eleven_multilingual_v2'), 'voice_settings': settings}
        if prev_t:
            body['previous_text'] = prev_t
        req = urllib.request.Request(
            f'https://api.elevenlabs.io/v1/text-to-speech/{voice}?output_format=mp3_44100_128',
            data=json.dumps(body).encode(), headers={'Content-Type': 'application/json'}, method='POST')
        with urllib.request.urlopen(req, timeout=120) as r:
            open(out, 'wb').write(r.read())
        total += len(spoken)
    dur = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out],
                               capture_output=True, text=True).stdout)
    lines.append({'a': float(a), 'file': os.path.basename(out), 'from': 0.0, 'to': round(dur, 3)})
    print(f'{a:>6} {who} {dur:5.2f}s  {spoken}')

json.dump({'comment': 'Generated with ElevenLabs by tts_episode.py', 'voiceDir': cfg['voiceDir'],
           'phoneFilter': cfg.get('phoneFilter', []), 'lines': lines},
          open(cfg['map'], 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('characters sent:', total)
