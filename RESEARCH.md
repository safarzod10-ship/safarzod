# Research notes

## Rendering on phones
- HDRP does not support mobile platforms; URP is Unity's pipeline for Android. Use URP Lit, SSAO renderer feature (cost on mobile: test Low/off), post-processing Volume (ACES, bloom low), reflection probes, light probes for dynamic characters.
- Baking: no GPU here; CPU progressive lightmapper is possible but slow. Current ambient = spherical harmonics from the HDRI (TownEnv) — cheap and stable.

## Tajik architecture references (for MAP-02)
- Pamiri house (chid): central skylight (chorkhona) with four concentric square beams, five pillars, carved wood.
- Khujand / Istaravshan: carved wooden doors (geometric/girih and floral), carved columns with stalactite capitals, aivan (open veranda) with painted ceilings.
- Courtyard houses with adobe/plaster walls, flat roofs, wooden lintels, blue/turquoise painted window frames, grape trellises, tapchan beds, tandoor ovens.
- Bazaars: covered rows with fabric awnings, melons, dried fruit, spices, carpets, suzani embroidery.
- Landmarks style: turquoise glazed domes, majolica tile panels (Dushanbe teahouse "Rohat", Haji Yakub mosque) — use generic motifs, not copies.

## Asset sources (licences checked per file, see ASSET_LICENSES.md)
- Poly Haven (CC0) textures/HDRI; ambientCG (CC0) textures; Sketchfab CC-BY models; Freesound CC0/CC-BY; OpenGameArt CC0 (Free Firearm Sound Library).

## Agent harness guidance applied
- Persistent state files (FEATURES.json, PROGRESS.md, NEXT_TASK.md) so a new session can resume; one feature at a time; verify before marking passing; commit after each step.

## 2026-11-24 — asset search for Tajik identity (Sketchfab, commercial licences only)
Found usable (CC BY): Samovar (hellotaia f428aa16, tomich516 83499690), Post-Soviet retro dining pack (mariakrasinska acee1702), fruit bowl / fruit pack with pomegranates (meerschaumdigital 373c679b, 105da0b0), pomegranate (mauricesvay 62ac29fe).
Not found in usable quality: carved Central-Asian doors and columns, aivan, painted ceilings, suzani, tapchan, Tajik majolica.
Decision: model the architectural identity ourselves — Blender (headless, Python) for carved doors/columns/aivan/lattice windows; ornaments (girih, islimi rosettes) generated as vector patterns in Python and baked into height/normal maps; majolica tile panels from the same pattern generator with a glaze colour palette (turquoise, cobalt, white, ochre).
