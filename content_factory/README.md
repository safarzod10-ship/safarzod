# Content factory (blocky story shorts)

Pipeline that turns an `episodes/epNN/episode.json` script into a vertical 1080×1920 video:
cloned-voice narration (F5-TTS Russian + RUAccent stresses, checked by Whisper) → music/SFX mix →
three.js blocky 3D scene rendered in headless Chromium → MP4.

Voice samples and models are NOT stored here (privacy / size). See `ROUTINE.md` for the full workflow.
Working copy lives in the session scratchpad; this folder is a code backup.
