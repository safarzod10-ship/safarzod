# Credits — imported 3D models (stage 7)

All of these models were supplied by the project owner. They are used under the
**Creative Commons Attribution 4.0** licence (CC-BY 4.0,
http://creativecommons.org/licenses/by/4.0/). The author, licence and source of each come from
the glTF `asset.extras` of the file. The files are in `assets/models/extra/`.

| File in the game | Title | Author | Licence | Source |
|---|---|---|---|---|
| `motorboat.glb` | Small Motorboat | Timon Matthews (sketchfab.com/timonmatthews) | CC-BY 4.0 | https://sketchfab.com/3d-models/small-motorboat-b488d632a4804cd783e9ef009976bcd4 |
| `delivery_van.glb` | European Delivery Van | Evan Hiltz (sketchfab.com/evan.hiltz) | CC-BY 4.0 | https://sketchfab.com/3d-models/european-delivery-van-0b2f1ad95a79419f9a092420024d329c |
| `billboard.glb` | Metal Billboard Advertising Single Sided [Free] | Jotrain Models (sketchfab.com/Jotrain) | CC-BY 4.0 | https://sketchfab.com/3d-models/metal-billboard-advertising-single-sided-free-33c164cf9e4346d1b48eb0c49cb2643f |
| `road_pack.glb` | Modular City Road Pack – Game Ready | Salah3D (sketchfab.com/abbasyounis214) | CC-BY 4.0 | https://sketchfab.com/3d-models/modular-city-road-pack-game-ready-d9df5cfa079f4da8a18ef1372c00d01c |
| `guardrail.glb` | guardrail road | danimow (sketchfab.com/danimow) | CC-BY 4.0 | https://sketchfab.com/3d-models/guardrail-road-76e85683d30c4e6ba35da370467b7aa6 |
| `tajik_flag.glb` | Tajikistan Flag | ognuogaan135 (sketchfab.com/ognuogaan135) | CC-BY 4.0 | https://sketchfab.com/3d-models/tajikistan-flag-89aeef09d66b4e968b9abada7eb5a67b |
| `laklak_building.glb` | Tanır Makina Factory Building | benhur taşkın (sketchfab.com/betaarch) | CC-BY 4.0 | https://sketchfab.com/3d-models/tanr-makina-factory-building-ff70f7f34bfe4cd495c5fbf93b78f64d |
| `skyscraper.glb` | Skyscraper | Jampre (sketchfab.com/jampre) | CC-BY 4.0 | https://sketchfab.com/3d-models/skyscraper-a5dfa1cfd4564bbeb0bd335ef8b9a333 |
| `houses_lowpoly.glb` | Low-poly Houses Free | Nicholas-3D (sketchfab.com/Nicholas01) | CC-BY 4.0 | https://sketchfab.com/3d-models/low-poly-houses-free-afc6e8745a4542cba687104cf90d309d |

### Stage 8

| File in the game | Title | Author | Licence | Source |
|---|---|---|---|---|
| `camry.glb` | Toyota Camry 2020 | ItsDiyor (sketchfab.com/ItsDiyor) | CC-BY 4.0 | https://sketchfab.com/3d-models/toyota-camry-2020-236a5a6e2fa6420fbdf641f4800cd544 |
| `gas_station.glb` | Lowpoly Gas Station | AspectStudios (sketchfab.com/AspectStudio) | CC-BY 4.0 | https://sketchfab.com/3d-models/lowpoly-gas-station-02a11319cb744999adddd7236a46bf8e |
| `school.glb` | school building | swjeta (sketchfab.com/swjeta) | CC-BY 4.0 | https://sketchfab.com/3d-models/school-building-d34ac09a3ca544df999485c4b311abcc |
| `hospital.glb` | Jejungwon Hospital | Gwangju Arts & Culture Humanities Story Platform (sketchfab.com/gwangju_inmunstory) | CC-BY 4.0 | https://sketchfab.com/3d-models/jejungwon-hospital-0a2e305f66154fe2bb7e075e82ed3cf0 |
| `lexus_rx.glb` | 2022 Lexus RX 350 | ActsOfDoge (sketchfab.com/ActsOfDoge) | **Sketchfab Standard** (not CC) | https://sketchfab.com/3d-models/2022-lexus-rx-350-4493802f0abd4b0b8c401f17b57633b2 |
| `city_bus.glb` | city bus | not stated in the file (supplied by the project owner) | **unknown** | — |

**Licence notes for the owner:**

- **Lexus RX 350.** The Sketchfab Standard licence allows use inside a game, for whoever downloaded
  the model under that licence. It does not allow redistributing the model file on its own. If this
  repository or the raw `.glb` is public, keep that in mind.
- **City bus.** The file carries no author or licence information. Please confirm where it comes
  from before a public release.

## Changes made to the models

- **Delivery van:**
  - The body texture was recoloured from yellow to LakLak blue
    (`assets/vehicles/laklak/van_body_blue.png`).
  - The LakLak logo was added on both sides and the rear doors.
  - The wheels were given pivot nodes for the game's vehicle physics.
- **Billboard:** the posters are the 4 advertising banners supplied by the project owner
  (DCnext / DC City Dushanbe, Orienbank, LakLak, Eskhata), in `assets/textures/ads/ad_*.png`. Each
  banner is fitted to the board's 2.5:1 format, uncropped, with blurred sides.
- **Flag:** the cloth waves via a vertex shader, and the model is scaled ×20 (a 150 m flagpole).
- **Road pack:** the street lamps and the bench are used at ×3.2 scale.
- **Factory building:** used as the LakLak depot, with a sign drawn for the game.
- **Camry:** the wheels were cut out of the body mesh at runtime, so they can spin and steer.
- **Bus:** its 829 parts are merged per material, and the wheels are given pivot nodes.
- **School:** scaled ×25 to real size (≈65 × 55 × 12 m).

The LakLak logo on the van and the depot sign were made for this project.

The models' own textures are unchanged apart from the van's colour.

## HUD icons — game-icons.net (CC BY 3.0)
Icons `assets/ui/icons/gi_*.svg` (fist, pistol, AK, bat, car, fuel, wrench, map, etc.) from
https://game-icons.net by Lorc, Delapouite, Skoll and other contributors,
licensed under Creative Commons Attribution 3.0 (https://creativecommons.org/licenses/by/3.0/).
Taken from the npm package `@iconify-json/game-icons`; recoloured only.

## Main menu / shop artwork
`assets/ui/menu_main.png`, `assets/ui/menu_shop.png` — provided by the project owner.
Note: the artwork contains the text "GTA" — a third-party trademark; replace before store release.
