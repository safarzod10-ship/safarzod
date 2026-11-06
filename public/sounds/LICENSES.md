# Sound effect licenses

The game uses three sounds: `bounce` (ball on the floor), `throw` (release), `crowd` (basket; louder for a clean basket).

All files are mono, 44.1 kHz, 80 kbps CBR MP3. Each one is cut from a real recording that its author released as public domain (Public Domain Mark 1.0) or CC0. No attribution is required. Credits are listed here as a courtesy.

Processing common to every file: mixed down to mono, high-pass filtered, trimmed to the event, raised-cosine fades applied (in and out), normalized to a similar level (peak ≤ -1 dBFS, active RMS about -14 to -20 dBFS), and encoded with libmp3lame.

The archive.org items come from radio aporee ::: maps field recordings. Each item's archive.org metadata gives `licenseurl` = https://creativecommons.org/publicdomain/mark/1.0/ (Public Domain Mark 1.0).

| File | Source page | Author / recordist | License | What was done |
|---|---|---|---|---|
| crowd.mp3 | https://archive.org/details/aporee_59425_68193 (Xcel Energy Center, MN High School Hockey Tournament, Edina vs Moorhead 2nd OT) | Matt Todd | Public Domain Mark 1.0 | Cut 246.40–248.60 s (crowd cheering after the winning goal); 15 ms fade-in, 350 ms fade-out; HP 60 Hz; normalized |
| bounce.mp3 | https://archive.org/details/aporee_67036_77563 | Flavien Gillié | Public Domain Mark 1.0 | Cut 91.441–91.721 s: one dribble on the indoor sports floor, taken from a rhythmic dribble sequence; 10 ms in, 50 ms out; HP 50 Hz; normalized |
| throw.mp3 | https://opengameart.org/content/fabric-rustling (file `rustling.ogg`) | Iochi Glaucus | CC0 1.0 | Short fabric rustle (whoosh of the release), cut at 22.85–23.25 s; HP 400 Hz; 10 ms in, 80 ms out; normalized |
