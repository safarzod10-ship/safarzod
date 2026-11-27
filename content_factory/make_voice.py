"""Voice every line of an episode with the cloned voice (F5-TTS Russian).
usage: python make_voice.py <ep_dir>
- emotion per line -> reference clip from voice_refs.json
- stress_dict.json fixes known stress/pronunciation mistakes before RUAccent
- every take is checked by Whisper; up to 4 takes, best one kept; weak lines logged to problems.log
- already generated lines are skipped (safe to re-run after an interruption)
"""
import sys, json, os, re, difflib, datetime
import numpy as np, soundfile as sf

FAC = os.path.dirname(os.path.abspath(__file__))
VOICE = os.path.join(FAC, "voice")
EP = sys.argv[1]
E = json.load(open(f"{EP}/episode.json", encoding="utf-8"))
REFS = json.load(open(f"{FAC}/voice_refs.json", encoding="utf-8"))
SD_PATH = f"{FAC}/stress_dict.json"
SD = json.load(open(SD_PATH, encoding="utf-8")) if os.path.exists(SD_PATH) else {}
os.makedirs(f"{EP}/voice", exist_ok=True)
todo = [i for i in range(1, len(E["lines"]) + 1) if not os.path.exists(f"{EP}/voice/l{i}.wav")]
if not todo:
    print("all lines already voiced"); sys.exit(0)

from ruaccent import RUAccent
from f5_tts.api import F5TTS
from faster_whisper import WhisperModel
acc = RUAccent(); acc.load(omograph_model_size="turbo3.1", use_dictionary=True, tiny_mode=False)

def apply_dict(t):
    for w, rep in SD.items():
        t = re.sub(rf"(?<![А-Яа-яЁё+]){re.escape(w)}(?![А-Яа-яЁё])", rep, t, flags=re.IGNORECASE)
    return t
def stress(t):
    t = apply_dict(t)
    if "+" in t:  # keep manual/dict stresses, let RUAccent fill the rest word by word
        out = []
        for tok in re.split(r"(\s+)", t):
            out.append(tok if ("+" in tok or not re.search(r"[А-Яа-яЁё]", tok)) else acc.process_all(tok))
        return "".join(out)
    return acc.process_all(t)
def clean_for_tts(t):
    t = t.replace("—", ",").replace("«", "").replace("»", "").replace("…", "...")
    return re.sub(r"\s+", " ", t).strip()

tts = F5TTS(model="F5TTS_v1_Base", ckpt_file=f"{VOICE}/models/f5ru/model_last_inference.safetensors",
            vocab_file=f"{VOICE}/models/f5ru/vocab.txt", device="cpu")
asr = WhisperModel("small", device="cpu", compute_type="int8")
from num2words import num2words
def _digits_to_words(s):  # Whisper writes numbers as digits; the script has them in words
    return re.sub(r"\d+", lambda m: " " + num2words(int(m.group()), lang="ru") + " ", s.replace("\u00a0", ""))
norm = lambda s: re.sub(r"[^а-яa-z0-9 ]", "", _digits_to_words(s).lower().replace("ё", "е").replace("+", "").replace("-", " ")).split()
refcache = {}
def ref(em):
    if em not in REFS: em = "calm"
    if em not in refcache:
        w, txt = REFS[em]; refcache[em] = (os.path.join(VOICE, w), stress(txt))
    return refcache[em]

for i in todo:
    line = E["lines"][i - 1]
    rw, rt = ref(line.get("emotion", "calm"))
    g = "... " + stress(clean_for_tts(line["text"]))  # leading pause: keeps the first syllable out of the ref/gen seam
    best = None
    for attempt, seed in enumerate([11, 23, 37, 53]):
        wav, sr, _ = tts.infer(ref_file=rw, ref_text=rt, gen_text=g, speed=line.get("speed", 1.0),
                               nfe_step=32, cfg_strength=2.0, sway_sampling_coef=-1.0, seed=seed)
        a16 = np.interp(np.arange(0, len(wav), sr / 16000), np.arange(len(wav)), wav).astype("float32")
        heard = " ".join(s.text for s in asr.transcribe(a16, language="ru")[0]).strip()
        score = difflib.SequenceMatcher(None, norm(line["text"]), norm(heard)).ratio()
        print(f"line {i} take {attempt + 1}: {score:.2f} | {heard}", flush=True)
        if best is None or score > best[0]: best = (score, wav, sr, heard)
        if score >= 0.95: break
    score, wav, sr, heard = best
    if score < 0.95:
        with open(f"{FAC}/problems.log", "a", encoding="utf-8") as f:
            f.write(f"{datetime.datetime.now():%Y-%m-%d %H:%M} {os.path.basename(EP)} l{i} score={score:.2f}\n  want: {line['text']}\n  sent: {g}\n  heard: {heard}\n")
    thr = 0.02 * np.abs(wav).max(); idx = np.where(np.abs(wav) > thr)[0]
    wav = wav[max(0, idx[0] - int(0.05 * sr)): idx[-1] + int(0.12 * sr)]
    f = int(0.01 * sr); wav[:f] *= np.linspace(0, 1, f); wav[-f:] *= np.linspace(1, 0, f)
    wav = np.interp(np.arange(0, len(wav), sr / 22050), np.arange(len(wav)), wav).astype("float32")
    sf.write(f"{EP}/voice/l{i}.wav", wav, 22050, subtype="PCM_16")
    print(f"line {i} saved, score {score:.2f}, {len(wav) / 22050:.2f}s", flush=True)
