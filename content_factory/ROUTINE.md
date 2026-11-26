# Content factory — routine for every scheduled run

Goal: every run produce ONE new, original, short vertical video (45–60 s) in the blocky 3D style,
voiced with the user's cloned voice (F5-TTS Russian, reference clips in voice/user/prep, mapping in voice_refs.json).
Deliver the MP4 (and the voice-only MP3) to the user with SendUserFile, status "proactive".

## Steps
1. `./bootstrap.sh` — exit 4 (VOICE_MISSING) means the container was reset: tell the user to re-send the
   voice recording MP3; then `./prep_ref.sh <mp3> voice/user/prep` and re-check that the ref_XX texts in
   voice_refs.json match the new clips (prep prints them) — fix the texts if clip boundaries moved.
2. Read `episodes.log` (what was already made) and `problems.log` (voice mistakes). For each problem word,
   add a fix to `stress_dict.json` ("слово": "сл+ово") or write the stress with "+" directly in the episode text.
3. Write `episodes/epNN/episode.json` (next number). Copy the schema from the latest episode. Rules below.
4. Preview: make a fake timeline is NOT needed; run `./run_episode.sh epNN` (≈35–45 min on CPU).
   If the run is interrupted, just run it again — voiced lines are kept.
5. Look at 4–6 stills (`node render.js episodes/epNN /tmp/x 1 t1,t2,...` while http server on 8766 runs)
   and fix framing problems (characters blocking the camera, back of the head in a close-up) by changing `cam`.
   Re-render only (voice is cached) — `./run_episode.sh epNN` again.
6. Append one line to `episodes.log`: `epNN | format | title | hook | one-line plot`.
7. SendUserFile out/epNN.mp4 (+ out/epNN_voice.mp3), short caption in Russian: title + hook + duration.

## Format rotation (do NOT make two episodes of the same format in a row — check episodes.log)
1. **series** — "Число над головой" episode (kindness numbers, Тимур narrates).
2. **detective** — "Кто из них врёт?": 3 suspects give alibis (labels with names), one hidden clue,
   "Подумай пять секунд" line with `"gap": 3.2`, reveal with flash/boom, funny kind ending. Logic must be fair.
3. **what-if** — "Что если…" thought experiment (что если над головой видно, сколько раз человек соврал /
   сколько у него друзей / сколько ему осталось спать…), 3 escalating situations + twist.
4. **mystery-night** — light spooky story (night, evening light, music "mystery"/"tense"): strange sounds,
   a figure in the park, the explanation is funny or kind. Never really scary, no violence.
5. **comedy** — school/home sketch with a punchline (teacher, mom, dad, homework, phone, cake), music "happy".
6. **choice** — "Что бы ты выбрал?": two options shown on labels over two characters, consequences, ask viewer.
7. **life-lesson** — a short moral story (honesty, friendship, being new at school) with an unexpected twist.
Record the format in episodes.log as the 2nd field: `epNN | format | title | hook | plot`.

## Writing rules (Russian)
- Original stories only. Never copy other channels' characters, plots or titles. No brand names (no "Roblox").
- Series world: "Число над головой" — over each person's head floats a number. Everyone thought it was money;
  it turned out to show kindness (hearts). Main cast: Тимур (narrator, "я"), Макс (ex-rich bully, now learning
  to be kind, number grows slowly), Лиза (new girl, huge number), Артём (friend), granny/тётя Зина, mom, teacher, kid.
  Standalone episodes outside the series are OK sometimes (school/park/home life, a twist at the end).
- Structure: hook in the first line (question / shock), 9–13 lines, a twist, last line = call to comment.
- Each line ≤ ~110 characters, simple spoken words. Write numbers in words. Use "ё".
  Mark ambiguous stresses with "+": вс+е (everyone) vs всё, з+амок/зам+ок, пл+ачу/плач+у, etc.
- Do NOT start a line with a short word like "Я", "И", "А", "Но" followed by a pause-free verb, or with a word whose
  first syllable is unstressed and short ("Наверное") — the model tends to swallow it. Start with a fuller word
  ("Тогда я…", "Она, наверное…").
- Dialogue: the voice is one person; put the speaker in the narration ("сказал Макс") and optionally
  `"pitch": -2` (deeper, Max/dad) or `"pitch": 3` (kid/granny-ish).
- Emotions available for lines: calm, sad, excited, warm, mystery, surprise, angry, outro.
- Content must stay kid-safe: no violence, no humiliation as a punchline, kindness wins.

## episode.json cheat-sheet
- top: title, hook (short, CAPS ok, 1 emoji ok), outro (CAPS question), music (warm|sad|mystery|happy|tense),
  location (school|park|home), time (day|evening|night), highlight (words to colour yellow), cast, props, lines.
- cast.<id>: preset (timur|max|liza|artem|granny|mom|teacher|dad|guard|kid), pos [x,z], hidden, label
  ({text, heart, color} or null), look overrides ({shirt:"#hex", ...}).
- props: {shape: wallet|phone|box|bag|book|ball|letter|cake|gift|money, pos [x,y,z] or holder: id, from, to (shot indices, 0-based), size, color}.
- lines[i]: text, emotion, cam, acts, optional location/time (persist), flash, chime, whoosh, boom, shake, pitch, speed, gap.
- cam: wide | wide:id1,id2 | orbit | top | close:id | medium:id | low:id | two:a:b | over:a:b
- acts.<id>: pos, moveTo [x,z] (walks), run, delay, walkTime, show, hide, faceTo (id | "cam" | [x,z]),
  pose (idle walk run carry laugh point sad cry shock angry cheer wave think hug give phone sit facepalm shrug),
  face (neutral smile sad cry shock angry smug laugh joy think), faceAfter [sec, face],
  label ({text, heart, color, pop} or {from, to, heart, color, dur, delay} for counting).
- Positions: school yard plaza x∈[-15,22], z∈[-8,8] (building at z=-12); park path z≈1 (x∈[-30,30]);
  home room x∈[-12,14], z∈[-12,6]. Keep 2.5+ units between characters.
