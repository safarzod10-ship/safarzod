# 30 уровней кампании

Файл создаётся автоматически: `npm run docs:levels` (источник — `src/shared/levels/campaign.ts`).

Урон за ошибку: уровни 1–15 — 1 HP; 16–25 — 2 HP в побеге; 26–30 — 2 HP в краже и побеге. У робота 3 HP.

## 1. First Night — East Wing

Экспонат: **The Sleepy Moon Vase**. An easy start: one trick per room. Решений: 5. Урон: 1 HP. Достижимых состояний: 14.

| # | Фаза | Комната | Испытание | Варианты | Подсказка (начальное состояние) |
|---|---|---|---|---|---|
| 1 | Проникновение | courtyard | entry safe:dock | 1) Rope down the skylight<br>2) Climb in the window<br>3) Sneak via the dock | Skylight: wet and slippery · Window: sensor blinking red · Dock: empty and dark |
| 2 | Проникновение | corridor | laser mode:low | 1) Jump over<br>2) Slide under<br>3) Wait for a gap | Red beams hum at ankle height. |
| 3 | Кража | sculpture | case sensor:motion | 1) Swap the weight<br>2) Angle a mirror<br>3) Wait for the blink | A motion eye blinks off every few seconds. |
| 4 | Побег | sculpture | guard mode:away | 1) Hide behind the statue<br>2) Tiptoe behind the guard<br>3) Wait in the shadows | The guard strolls away toward the statue, back turned. |
| 5 | Побег | corridor | chase routes:stairs,elevator,window,free:stairs,freeIfAlarm:window | 1) Run down the stairs<br>2) Take the elevator<br>3) Jump out the window | Stairs: quiet · Lift: guard inside · Window: barred |

Идеальный путь (0 урона): dock → jump → wait → tiptoe → stairs

## 2. Watching Eyes — Portrait Hall

Экспонат: **Crown of Seven Pears**. Cameras look one way at a time. Решений: 5. Урон: 1 HP. Достижимых состояний: 21.

| # | Фаза | Комната | Испытание | Варианты | Подсказка (начальное состояние) |
|---|---|---|---|---|---|
| 1 | Проникновение | courtyard | entry safe:window | 1) Rope down the skylight<br>2) Climb in the window<br>3) Sneak via the dock | Skylight: wet and slippery · Window: sensor unplugged · Dock: guard on a coffee break |
| 2 | Проникновение | atrium | camera zone:floor | 1) Sneak along the floor<br>2) Climb the ledge<br>3) Hide in a crate | The camera stares at the floor path. |
| 3 | Кража | vault | case sensor:beam | 1) Swap the weight<br>2) Angle a mirror<br>3) Wait for the blink | A light beam crosses the case. Bounce it away. |
| 4 | Побег | gallery | laser mode:high | 1) Jump over<br>2) Slide under<br>3) Wait for a gap | Beams hang at head height. The floor is clear. |
| 5 | Побег | stairwell | chase routes:stairs,elevator,window,free:elevator,freeIfAlarm:stairs | 1) Run down the stairs<br>2) Take the elevator<br>3) Jump out the window | Stairs: boots stomping · Lift: empty, waiting · Window: barred |

Идеальный путь (0 урона): window → ledge → mirror → slide → elevator

## 3. Golden Rims — Mosaic Atrium

Экспонат: **The Whistling Mask**. Pressure plates hide in plain sight. Решений: 5. Урон: 1 HP. Достижимых состояний: 20.

| # | Фаза | Комната | Испытание | Варианты | Подсказка (начальное состояние) |
|---|---|---|---|---|---|
| 1 | Проникновение | courtyard | entry safe:skylight | 1) Rope down the skylight<br>2) Climb in the window<br>3) Sneak via the dock | Skylight: dry and unlatched · Window: sensor blinking red · Dock: guard on a coffee break |
| 2 | Проникновение | atrium | plates safe:2,rows:3 | 1) Cross on back row<br>2) Cross on middle row<br>3) Cross on front row | Pressure plates have gold rims. Find the row with none. |
| 3 | Кража | sculpture | case sensor:beam | 1) Swap the weight<br>2) Angle a mirror<br>3) Wait for the blink | A light beam crosses the case. Bounce it away. |
| 4 | Побег | gallery | camera zone:ledge | 1) Sneak along the floor<br>2) Climb the ledge<br>3) Hide in a crate | The camera watches the high ledge. |
| 5 | Побег | corridor | chase routes:stairs,elevator,window,free:window,freeIfAlarm:elevator | 1) Run down the stairs<br>2) Take the elevator<br>3) Jump out the window | Stairs: boots stomping · Lift: guard inside · Window: soft awning below |

Идеальный путь (0 урона): skylight → row2 → mirror → floor → window

## 4. Purr Patrol — Old Library

Экспонат: **The Golden Goose Egg**. Meet the museum cat. Escape over the roof. Решений: 5. Урон: 1 HP. Достижимых состояний: 23.

| # | Фаза | Комната | Испытание | Варианты | Подсказка (начальное состояние) |
|---|---|---|---|---|---|
| 1 | Проникновение | library | cat awake:false | 1) Tiptoe past the cat<br>2) Toss a yarn ball<br>3) Climb over the shelves | The museum cat is fast asleep on a cushion. |
| 2 | Проникновение | gallery | laser mode:pulse | 1) Jump over<br>2) Slide under<br>3) Wait for a gap | The beams blink on and off. Count the gaps. |
| 3 | Кража | vault | case sensor:motion | 1) Swap the weight<br>2) Angle a mirror<br>3) Wait for the blink | A motion eye blinks off every few seconds. |
| 4 | Побег | gallery | guard mode:statue | 1) Hide behind the statue<br>2) Tiptoe behind the guard<br>3) Wait in the shadows | The guard polishes the statue, flashlight sweeping the path. |
| 5 | Побег | rooftop | searchlight mode:leaving | 1) Sprint across now<br>2) Duck behind the chimney<br>3) Slide down the drainpipe | The searchlight swings AWAY across the roof. |

Идеальный путь (0 урона): tiptoe → wait → wait → shadow → sprint

## 5. Lights Out — Machine Hall

Экспонат: **The Mint Comet Gem**. Cutting power helps - until the backup kicks in. Решений: 5. Урон: 1 HP. Достижимых состояний: 19.

| # | Фаза | Комната | Испытание | Варианты | Подсказка (начальное состояние) |
|---|---|---|---|---|---|
| 1 | Проникновение | corridor | fusebox linked:false | 1) Cut the power<br>2) Leave it alone<br>3) Overload the fuses | An old fuse box powers this floor's lasers and cameras. |
| 2 | Проникновение | corridor | laser mode:high | 1) Jump over<br>2) Slide under<br>3) Wait for a gap | Beams hang at head height. The floor is clear. |
| 3 | Кража | sculpture | case sensor:beam | 1) Swap the weight<br>2) Angle a mirror<br>3) Wait for the blink | A light beam crosses the case. Bounce it away. |
| 4 | Побег | corridor | laser mode:low | 1) Jump over<br>2) Slide under<br>3) Wait for a gap | Red beams hum at ankle height. |
| 5 | Побег | corridor | chase routes:stairs,elevator,window,free:stairs,freeIfAlarm:window | 1) Run down the stairs<br>2) Take the elevator<br>3) Jump out the window | Stairs: quiet · Lift: guard inside · Window: barred |

Идеальный путь (0 урона): cut → jump → mirror → jump → stairs

## 6. The Keycard — Staff Offices

Экспонат: **Little Bronze Dancer**. Some doors want a keycard. Решений: 6. Урон: 1 HP. Достижимых состояний: 55.

| # | Фаза | Комната | Испытание | Варианты | Подсказка (начальное состояние) |
|---|---|---|---|---|---|
| 1 | Проникновение | courtyard | entry safe:dock | 1) Rope down the skylight<br>2) Climb in the window<br>3) Sneak via the dock | Skylight: wet and slippery · Window: sensor blinking red · Dock: empty and dark |
| 2 | Проникновение | library | keycard guard:asleep,desk:false | 1) Lift the guard's keycard<br>2) Search the desk<br>3) Move on | A snoring guard, keycard on the belt. The desk drawer is shut and rusty. |
| 3 | Проникновение | vault | door lock:magnetic | 1) Swipe a keycard<br>2) Pick the lock<br>3) Crawl the vent | A magnetic lock - no keyhole to pick. You have NO keycard. The vent is noisy. |
| 4 | Кража | sculpture | case sensor:weight | 1) Swap the weight<br>2) Angle a mirror<br>3) Wait for the blink | A scale sensor: replace the exhibit with equal weight. No decoy - the backpack will do, noisily. |
| 5 | Побег | sculpture | guard mode:toward | 1) Hide behind the statue<br>2) Tiptoe behind the guard<br>3) Wait in the shadows | A guard walks YOUR way. A big statue offers cover. |
| 6 | Побег | corridor | chase routes:stairs,elevator,chute,free:elevator,freeIfAlarm:chute | 1) Run down the stairs<br>2) Take the elevator<br>3) Dive down the chute | Stairs: boots stomping · Lift: empty, waiting · Chute: jammed |

Идеальный путь (0 урона): dock → lift → swipe → swap → statue → elevator

## 7. Souvenir Run — Gift Shop Arcade

Экспонат: **Scroll of Endless Snacks**. A replica from the shop fools a weight sensor. Решений: 6. Урон: 1 HP. Достижимых состояний: 52.

| # | Фаза | Комната | Испытание | Варианты | Подсказка (начальное состояние) |
|---|---|---|---|---|---|
| 1 | Проникновение | atrium | giftshop gate:open | 1) Walk in, grab a replica<br>2) Reach through the bars<br>3) Skip the shop | The gift shop is open. Plaster replicas weigh just like the real thing. |
| 2 | Проникновение | gallery | camera zone:both | 1) Sneak along the floor<br>2) Climb the ledge<br>3) Hide in a crate | The camera sweeps floor AND ledge. Need cover. |
| 3 | Проникновение | gallery | plates safe:0,rows:3 | 1) Cross on back row<br>2) Cross on middle row<br>3) Cross on front row | Pressure plates have gold rims. Find the row with none. |
| 4 | Кража | vault | case sensor:weight | 1) Swap the weight<br>2) Angle a mirror<br>3) Wait for the blink | A scale sensor: replace the exhibit with equal weight. No decoy - the backpack will do, noisily. |
| 5 | Побег | rooftop | searchlight mode:coming | 1) Sprint across now<br>2) Duck behind the chimney<br>3) Slide down the drainpipe | The searchlight swings TOWARD you. A chimney is close. |
| 6 | Побег | stairwell | chase routes:stairs,window,chute,free:chute,freeIfAlarm:stairs | 1) Run down the stairs<br>2) Jump out the window<br>3) Dive down the chute | Stairs: boots stomping · Window: barred · Chute: open |

Идеальный путь (0 урона): walk → box → row0 → swap → duck → chute

## 8. Wide Awake — Reading Rooms

Экспонат: **The Backwards Clock**. Not every fuse box is your friend. Stay quiet: alert changes the exits. Решений: 6. Урон: 1 HP. Достижимых состояний: 38.

| # | Фаза | Комната | Испытание | Варианты | Подсказка (начальное состояние) |
|---|---|---|---|---|---|
| 1 | Проникновение | library | cat awake:true | 1) Tiptoe past the cat<br>2) Toss a yarn ball<br>3) Climb over the shelves | The museum cat is WIDE awake, tail twitching. |
| 2 | Проникновение | corridor | fusebox linked:true | 1) Cut the power<br>2) Leave it alone<br>3) Overload the fuses | A red tag: ALARM-LINKED. Cutting it rings the bells. |
| 3 | Проникновение | gallery | camera zone:ledge | 1) Sneak along the floor<br>2) Climb the ledge<br>3) Hide in a crate | The camera watches the high ledge. |
| 4 | Кража | sculpture | case sensor:motion | 1) Swap the weight<br>2) Angle a mirror<br>3) Wait for the blink | A motion eye blinks off every few seconds. |
| 5 | Побег | atrium | plates safe:1,rows:3 | 1) Cross on back row<br>2) Cross on middle row<br>3) Cross on front row | Pressure plates have gold rims. Find the row with none. |
| 6 | Побег | corridor | chase routes:elevator,window,chute,free:window,freeIfAlarm:elevator | 1) Take the elevator<br>2) Jump out the window<br>3) Dive down the chute | Lift: guard inside · Window: soft awning below · Chute: jammed |

Идеальный путь (0 урона): yarn → leave → floor → wait → row1 → window

## 9. Four Ways — Grand Gallery

Экспонат: **The Jade Dragon Teapot**. Now with four choices. Read every clue. Решений: 6. Урон: 1 HP. Достижимых состояний: 27.

| # | Фаза | Комната | Испытание | Варианты | Подсказка (начальное состояние) |
|---|---|---|---|---|---|
| 1 | Проникновение | courtyard | entry safe:window | 1) Rope down the skylight<br>2) Climb in the window<br>3) Sneak via the dock | Skylight: wet and slippery · Window: sensor unplugged · Dock: guard on a coffee break |
| 2 | Проникновение | corridor | laser mode:low | 1) Jump over<br>2) Slide under<br>3) Wait for a gap<br>4) Walk straight through | Red beams hum at ankle height. |
| 3 | Проникновение | gallery | guard mode:radio | 1) Hide behind the statue<br>2) Tiptoe behind the guard<br>3) Wait in the shadows<br>4) Toss a coin to distract | The guard stands still, humming to the radio. Coins jingle on the floor. |
| 4 | Кража | vault | case sensor:heat | 1) Swap the weight<br>2) Angle a mirror<br>3) Wait for the blink<br>4) Cool down with the fan | A heat sensor: a warm robot will trip it. |
| 5 | Побег | atrium | camera zone:floor | 1) Sneak along the floor<br>2) Climb the ledge<br>3) Hide in a crate<br>4) Stroll right past | The camera stares at the floor path. |
| 6 | Побег | stairwell | chase routes:stairs,elevator,window,chute,free:chute,freeIfAlarm:stairs | 1) Run down the stairs<br>2) Take the elevator<br>3) Jump out the window<br>4) Dive down the chute | Stairs: boots stomping · Lift: guard inside · Window: barred · Chute: open |

Идеальный путь (0 урона): window → jump → coin → cool → ledge → chute

## 10. Double Trouble — Armory

Экспонат: **Helmet of Sir Wobble**. Lasers AND cameras in one room. Решений: 6. Урон: 1 HP. Достижимых состояний: 61.

| # | Фаза | Комната | Испытание | Варианты | Подсказка (начальное состояние) |
|---|---|---|---|---|---|
| 1 | Проникновение | office | keycard guard:stirring,desk:true | 1) Lift the guard's keycard<br>2) Search the desk<br>3) Move on | A twitchy, half-awake guard. A keycard glints in an open drawer. |
| 2 | Проникновение | corridor | door lock:brass | 1) Swipe a keycard<br>2) Pick the lock<br>3) Crawl the vent | An old brass lock - pickable. You have NO keycard. The vent is noisy. |
| 3 | Проникновение | gallery | laserCam laser:low,zone:floor | 1) Jump along the floor<br>2) Slide along the floor<br>3) Jump along the ledge<br>4) Slide along the ledge | Red beams hum at ankle height. The camera watches the floor. |
| 4 | Кража | sculpture | case sensor:beam | 1) Swap the weight<br>2) Angle a mirror<br>3) Wait for the blink<br>4) Cool down with the fan | A light beam crosses the case. Bounce it away. |
| 5 | Побег | sculpture | guardPlates guard:away,safe:2 | 1) Cross on back row<br>2) Cross on middle row<br>3) Cross on front row<br>4) Hide behind the statue | The guard strolls away toward the statue. Gold-rimmed tiles are plates. |
| 6 | Побег | corridor | chase routes:stairs,elevator,window,chute,free:stairs,freeIfAlarm:elevator | 1) Run down the stairs<br>2) Take the elevator<br>3) Jump out the window<br>4) Dive down the chute | Stairs: quiet · Lift: guard inside · Window: barred · Chute: jammed |

Идеальный путь (0 урона): desk → swipe → jump-ledge → mirror → row2 → stairs

## 11. Vault Fever — Coin Vault

Экспонат: **Coin of the Last Sunrise**. The vault has its own lock. Решений: 7. Урон: 1 HP. Достижимых состояний: 65.

| # | Фаза | Комната | Испытание | Варианты | Подсказка (начальное состояние) |
|---|---|---|---|---|---|
| 1 | Проникновение | courtyard | entry safe:skylight | 1) Rope down the skylight<br>2) Climb in the window<br>3) Sneak via the dock | Skylight: dry and unlatched · Window: sensor blinking red · Dock: guard on a coffee break |
| 2 | Проникновение | basement | fusebox linked:false | 1) Cut the power<br>2) Leave it alone<br>3) Overload the fuses | An old fuse box powers this floor's lasers and cameras. |
| 3 | Проникновение | corridor | laserCam laser:high,zone:ledge | 1) Jump along the floor<br>2) Slide along the floor<br>3) Jump along the ledge<br>4) Slide along the ledge | Beams hang at head height. The floor is clear. The camera watches the ledge. |
| 4 | Кража | vault | door lock:magnetic | 1) Swipe a keycard<br>2) Pick the lock<br>3) Crawl the vent | A magnetic lock - no keyhole to pick. You have NO keycard. The vent is noisy. |
| 5 | Кража | sculpture | case sensor:motion | 1) Swap the weight<br>2) Angle a mirror<br>3) Wait for the blink<br>4) Cool down with the fan | A motion eye blinks off every few seconds. |
| 6 | Побег | corridor | laser mode:pulse | 1) Jump over<br>2) Slide under<br>3) Wait for a gap<br>4) Walk straight through | The beams blink on and off. Count the gaps. |
| 7 | Побег | corridor | chase routes:stairs,elevator,window,chute,free:elevator,freeIfAlarm:window | 1) Run down the stairs<br>2) Take the elevator<br>3) Jump out the window<br>4) Dive down the chute | Stairs: boots stomping · Lift: empty, waiting · Window: barred · Chute: jammed |

Идеальный путь (0 урона): skylight → cut → jump-floor → vent → wait → wait → elevator

## 12. True North — Explorers Hall

Экспонат: **The Honest Compass**. The shop is barred - think around it. Решений: 7. Урон: 1 HP. Достижимых состояний: 58.

| # | Фаза | Комната | Испытание | Варианты | Подсказка (начальное состояние) |
|---|---|---|---|---|---|
| 1 | Проникновение | shop | giftshop gate:barred | 1) Walk in, grab a replica<br>2) Reach through the bars<br>3) Skip the shop | Gift shop gate is barred and wired. Replicas sit right behind the bars. |
| 2 | Проникновение | gallery | guard mode:statue | 1) Hide behind the statue<br>2) Tiptoe behind the guard<br>3) Wait in the shadows<br>4) Toss a coin to distract | The guard polishes the statue, flashlight sweeping the path. |
| 3 | Проникновение | atrium | plates safe:3,rows:4 | 1) Cross on back row<br>2) Cross on inner back<br>3) Cross on inner front<br>4) Cross on front row | Pressure plates have gold rims. Find the row with none. |
| 4 | Кража | atrium | camera zone:both | 1) Sneak along the floor<br>2) Climb the ledge<br>3) Hide in a crate<br>4) Stroll right past | The camera sweeps floor AND ledge. Need cover. |
| 5 | Кража | vault | case sensor:weight | 1) Swap the weight<br>2) Angle a mirror<br>3) Wait for the blink<br>4) Cool down with the fan | A scale sensor: replace the exhibit with equal weight. No decoy - the backpack will do, noisily. |
| 6 | Побег | rooftop | searchlight mode:sweep | 1) Sprint across now<br>2) Duck behind the chimney<br>3) Slide down the drainpipe | Two searchlights sweep the whole roof. A drainpipe hangs at the edge. |
| 7 | Побег | stairwell | chase routes:stairs,elevator,window,chute,free:window,freeIfAlarm:chute | 1) Run down the stairs<br>2) Take the elevator<br>3) Jump out the window<br>4) Dive down the chute | Stairs: boots stomping · Lift: guard inside · Window: soft awning below · Chute: jammed |

Идеальный путь (0 урона): reach → shadow → row3 → box → swap → pipe → window

## 13. Quiet Wishes — Lantern Room

Экспонат: **Lamp of Quiet Wishes**. A keycard is the quiet way into the vault. Решений: 7. Урон: 1 HP. Достижимых состояний: 82.

| # | Фаза | Комната | Испытание | Варианты | Подсказка (начальное состояние) |
|---|---|---|---|---|---|
| 1 | Проникновение | office | cat awake:true | 1) Tiptoe past the cat<br>2) Toss a yarn ball<br>3) Climb over the shelves | The museum cat is WIDE awake, tail twitching. |
| 2 | Проникновение | office | keycard guard:asleep,desk:false | 1) Lift the guard's keycard<br>2) Search the desk<br>3) Move on | A snoring guard, keycard on the belt. The desk drawer is shut and rusty. |
| 3 | Проникновение | atrium | camera zone:floor | 1) Sneak along the floor<br>2) Climb the ledge<br>3) Hide in a crate<br>4) Stroll right past | The camera stares at the floor path. |
| 4 | Кража | vault | door lock:magnetic | 1) Swipe a keycard<br>2) Pick the lock<br>3) Crawl the vent | A magnetic lock - no keyhole to pick. You have NO keycard. The vent is noisy. |
| 5 | Кража | sculpture | case sensor:heat | 1) Swap the weight<br>2) Angle a mirror<br>3) Wait for the blink<br>4) Cool down with the fan | A heat sensor: a warm robot will trip it. |
| 6 | Побег | sculpture | guardPlates guard:toward,safe:0 | 1) Cross on back row<br>2) Cross on middle row<br>3) Cross on front row<br>4) Hide behind the statue | A guard walks YOUR way! Gold-rimmed tiles are plates. |
| 7 | Побег | corridor | chase routes:stairs,elevator,chute,free:chute,freeIfAlarm:elevator | 1) Run down the stairs<br>2) Take the elevator<br>3) Dive down the chute | Stairs: boots stomping · Lift: guard inside · Chute: open |

Идеальный путь (0 урона): yarn → lift → ledge → swipe → cool → statue → chute

## 14. Starlight Strings — Music Hall

Экспонат: **The Starlight Harp**. Backup power makes the escape tricky. Решений: 7. Урон: 1 HP. Достижимых состояний: 39.

| # | Фаза | Комната | Испытание | Варианты | Подсказка (начальное состояние) |
|---|---|---|---|---|---|
| 1 | Проникновение | courtyard | entry safe:dock | 1) Rope down the skylight<br>2) Climb in the window<br>3) Sneak via the dock | Skylight: wet and slippery · Window: sensor blinking red · Dock: empty and dark |
| 2 | Проникновение | corridor | fusebox linked:true | 1) Cut the power<br>2) Leave it alone<br>3) Overload the fuses | A red tag: ALARM-LINKED. Cutting it rings the bells. |
| 3 | Проникновение | corridor | laser mode:pulse | 1) Jump over<br>2) Slide under<br>3) Wait for a gap<br>4) Walk straight through | The beams blink on and off. Count the gaps. |
| 4 | Кража | gallery | guard mode:toward | 1) Hide behind the statue<br>2) Tiptoe behind the guard<br>3) Wait in the shadows<br>4) Toss a coin to distract | A guard walks YOUR way. A big statue offers cover. |
| 5 | Кража | vault | case sensor:beam | 1) Swap the weight<br>2) Angle a mirror<br>3) Wait for the blink<br>4) Cool down with the fan | A light beam crosses the case. Bounce it away. |
| 6 | Побег | corridor | laserCam laser:low,zone:ledge | 1) Jump along the floor<br>2) Slide along the floor<br>3) Jump along the ledge<br>4) Slide along the ledge | Red beams hum at ankle height. The camera watches the ledge. |
| 7 | Побег | rooftop | searchlight mode:coming | 1) Sprint across now<br>2) Duck behind the chimney<br>3) Slide down the drainpipe | The searchlight swings TOWARD you. A chimney is close. |

Идеальный путь (0 урона): dock → leave → wait → statue → mirror → jump-floor → duck

## 15. Lost Islands — Map Room

Экспонат: **Globe of Lost Islands**. Everything you learned, in one night. Решений: 7. Урон: 1 HP. Достижимых состояний: 115.

| # | Фаза | Комната | Испытание | Варианты | Подсказка (начальное состояние) |
|---|---|---|---|---|---|
| 1 | Проникновение | library | keycard guard:asleep,desk:true | 1) Lift the guard's keycard<br>2) Search the desk<br>3) Move on | A snoring guard, keycard on the belt. A keycard glints in an open drawer. |
| 2 | Проникновение | shop | giftshop gate:open | 1) Walk in, grab a replica<br>2) Reach through the bars<br>3) Skip the shop | The gift shop is open. Plaster replicas weigh just like the real thing. |
| 3 | Проникновение | corridor | door lock:brass | 1) Swipe a keycard<br>2) Pick the lock<br>3) Crawl the vent | An old brass lock - pickable. You have NO keycard. The vent is noisy. |
| 4 | Кража | atrium | plates safe:1,rows:4 | 1) Cross on back row<br>2) Cross on inner back<br>3) Cross on inner front<br>4) Cross on front row | Pressure plates have gold rims. Find the row with none. |
| 5 | Кража | sculpture | case sensor:weight | 1) Swap the weight<br>2) Angle a mirror<br>3) Wait for the blink<br>4) Cool down with the fan | A scale sensor: replace the exhibit with equal weight. No decoy - the backpack will do, noisily. |
| 6 | Побег | gallery | camera zone:ledge | 1) Sneak along the floor<br>2) Climb the ledge<br>3) Hide in a crate<br>4) Stroll right past | The camera watches the high ledge. |
| 7 | Побег | corridor | chase routes:stairs,elevator,window,chute,free:stairs,freeIfAlarm:window | 1) Run down the stairs<br>2) Take the elevator<br>3) Jump out the window<br>4) Dive down the chute | Stairs: quiet · Lift: guard inside · Window: barred · Chute: jammed |

Идеальный путь (0 урона): lift → walk → swipe → row1 → swap → floor → stairs

## 16. Grinning Crystal — Hall of Curiosities

Экспонат: **The Grinning Crystal Skull**. Escape mistakes now cost 2 HP. Решений: 8. Урон: 1/2 HP. Достижимых состояний: 69.

| # | Фаза | Комната | Испытание | Варианты | Подсказка (начальное состояние) |
|---|---|---|---|---|---|
| 1 | Проникновение | courtyard | entry safe:window | 1) Rope down the skylight<br>2) Climb in the window<br>3) Sneak via the dock | Skylight: wet and slippery · Window: sensor unplugged · Dock: guard on a coffee break |
| 2 | Проникновение | corridor | fusebox linked:false | 1) Cut the power<br>2) Leave it alone<br>3) Overload the fuses | An old fuse box powers this floor's lasers and cameras. |
| 3 | Проникновение | gallery | laserCam laser:low,zone:floor | 1) Jump along the floor<br>2) Slide along the floor<br>3) Jump along the ledge<br>4) Slide along the ledge | Red beams hum at ankle height. The camera watches the floor. |
| 4 | Кража | atrium | guardPlates guard:away,safe:0 | 1) Cross on back row<br>2) Cross on middle row<br>3) Cross on front row<br>4) Hide behind the statue | The guard strolls away toward the statue. Gold-rimmed tiles are plates. |
| 5 | Кража | vault | case sensor:motion | 1) Swap the weight<br>2) Angle a mirror<br>3) Wait for the blink<br>4) Cool down with the fan | A motion eye blinks off every few seconds. |
| 6 | Побег | gallery | laser mode:high | 1) Jump over<br>2) Slide under<br>3) Wait for a gap<br>4) Walk straight through | Beams hang at head height. The floor is clear. |
| 7 | Побег | sculpture | guard mode:radio | 1) Hide behind the statue<br>2) Tiptoe behind the guard<br>3) Wait in the shadows<br>4) Toss a coin to distract | The guard stands still, humming to the radio. Coins jingle on the floor. |
| 8 | Побег | corridor | chase routes:stairs,elevator,window,chute,free:elevator,freeIfAlarm:chute | 1) Run down the stairs<br>2) Take the elevator<br>3) Jump out the window<br>4) Dive down the chute | Stairs: boots stomping · Lift: empty, waiting · Window: barred · Chute: jammed |

Идеальный путь (0 урона): window → cut → jump-floor → row0 → wait → slide → coin → elevator

## 17. Phoenix Rising — Feather Gallery

Экспонат: **The Phoenix Quill**. A twitchy guard, a sharp drawer. Решений: 8. Урон: 1/2 HP. Достижимых состояний: 104.

| # | Фаза | Комната | Испытание | Варианты | Подсказка (начальное состояние) |
|---|---|---|---|---|---|
| 1 | Проникновение | office | cat awake:false | 1) Tiptoe past the cat<br>2) Toss a yarn ball<br>3) Climb over the shelves | The museum cat is fast asleep on a cushion. |
| 2 | Проникновение | office | keycard guard:stirring,desk:true | 1) Lift the guard's keycard<br>2) Search the desk<br>3) Move on | A twitchy, half-awake guard. A keycard glints in an open drawer. |
| 3 | Проникновение | corridor | door lock:magnetic | 1) Swipe a keycard<br>2) Pick the lock<br>3) Crawl the vent | A magnetic lock - no keyhole to pick. You have NO keycard. The vent is noisy. |
| 4 | Кража | corridor | laser mode:pulse | 1) Jump over<br>2) Slide under<br>3) Wait for a gap<br>4) Walk straight through | The beams blink on and off. Count the gaps. |
| 5 | Кража | sculpture | case sensor:heat | 1) Swap the weight<br>2) Angle a mirror<br>3) Wait for the blink<br>4) Cool down with the fan | A heat sensor: a warm robot will trip it. |
| 6 | Побег | atrium | plates safe:2,rows:4 | 1) Cross on back row<br>2) Cross on inner back<br>3) Cross on inner front<br>4) Cross on front row | Pressure plates have gold rims. Find the row with none. |
| 7 | Побег | rooftop | searchlight mode:sweep | 1) Sprint across now<br>2) Duck behind the chimney<br>3) Slide down the drainpipe | Two searchlights sweep the whole roof. A drainpipe hangs at the edge. |
| 8 | Побег | stairwell | chase routes:stairs,elevator,window,chute,free:window,freeIfAlarm:stairs | 1) Run down the stairs<br>2) Take the elevator<br>3) Jump out the window<br>4) Dive down the chute | Stairs: boots stomping · Lift: guard inside · Window: soft awning below · Chute: jammed |

Идеальный путь (0 урона): tiptoe → desk → swipe → wait → cool → row2 → pipe → window

## 18. Tide Queen — Ocean Wing

Экспонат: **Ring of the Tide Queen**. Barred shop, sweeping cameras, busy guards. Решений: 8. Урон: 1/2 HP. Достижимых состояний: 92.

| # | Фаза | Комната | Испытание | Варианты | Подсказка (начальное состояние) |
|---|---|---|---|---|---|
| 1 | Проникновение | shop | giftshop gate:barred | 1) Walk in, grab a replica<br>2) Reach through the bars<br>3) Skip the shop | Gift shop gate is barred and wired. Replicas sit right behind the bars. |
| 2 | Проникновение | atrium | camera zone:both | 1) Sneak along the floor<br>2) Climb the ledge<br>3) Hide in a crate<br>4) Stroll right past | The camera sweeps floor AND ledge. Need cover. |
| 3 | Проникновение | sculpture | guard mode:away | 1) Hide behind the statue<br>2) Tiptoe behind the guard<br>3) Wait in the shadows<br>4) Toss a coin to distract | The guard strolls away toward the statue, back turned. |
| 4 | Кража | corridor | door lock:brass | 1) Swipe a keycard<br>2) Pick the lock<br>3) Crawl the vent | An old brass lock - pickable. You have NO keycard. The vent is noisy. |
| 5 | Кража | vault | case sensor:weight | 1) Swap the weight<br>2) Angle a mirror<br>3) Wait for the blink<br>4) Cool down with the fan | A scale sensor: replace the exhibit with equal weight. No decoy - the backpack will do, noisily. |
| 6 | Побег | corridor | laserCam laser:high,zone:floor | 1) Jump along the floor<br>2) Slide along the floor<br>3) Jump along the ledge<br>4) Slide along the ledge | Beams hang at head height. The floor is clear. The camera watches the floor. |
| 7 | Побег | sculpture | guardPlates guard:toward,safe:1 | 1) Cross on back row<br>2) Cross on middle row<br>3) Cross on front row<br>4) Hide behind the statue | A guard walks YOUR way! Gold-rimmed tiles are plates. |
| 8 | Побег | corridor | chase routes:stairs,elevator,window,chute,free:chute,freeIfAlarm:elevator | 1) Run down the stairs<br>2) Take the elevator<br>3) Jump out the window<br>4) Dive down the chute | Stairs: boots stomping · Lift: guard inside · Window: barred · Chute: open |

Идеальный путь (0 урона): reach → box → tiptoe → pick → swap → slide-ledge → statue → chute

## 19. Twin Moons — Night Sky Hall

Экспонат: **The Twin-Moon Vase**. An alarm-linked box guards a tile maze. Решений: 8. Урон: 1/2 HP. Достижимых состояний: 55.

| # | Фаза | Комната | Испытание | Варианты | Подсказка (начальное состояние) |
|---|---|---|---|---|---|
| 1 | Проникновение | courtyard | entry safe:skylight | 1) Rope down the skylight<br>2) Climb in the window<br>3) Sneak via the dock | Skylight: dry and unlatched · Window: sensor blinking red · Dock: guard on a coffee break |
| 2 | Проникновение | basement | fusebox linked:true | 1) Cut the power<br>2) Leave it alone<br>3) Overload the fuses | A red tag: ALARM-LINKED. Cutting it rings the bells. |
| 3 | Проникновение | gallery | plates safe:0,rows:4 | 1) Cross on back row<br>2) Cross on inner back<br>3) Cross on inner front<br>4) Cross on front row | Pressure plates have gold rims. Find the row with none. |
| 4 | Кража | gallery | laserCam laser:low,zone:ledge | 1) Jump along the floor<br>2) Slide along the floor<br>3) Jump along the ledge<br>4) Slide along the ledge | Red beams hum at ankle height. The camera watches the ledge. |
| 5 | Кража | sculpture | case sensor:beam | 1) Swap the weight<br>2) Angle a mirror<br>3) Wait for the blink<br>4) Cool down with the fan | A light beam crosses the case. Bounce it away. |
| 6 | Побег | gallery | camera zone:both | 1) Sneak along the floor<br>2) Climb the ledge<br>3) Hide in a crate<br>4) Stroll right past | The camera sweeps floor AND ledge. Need cover. |
| 7 | Побег | rooftop | searchlight mode:leaving | 1) Sprint across now<br>2) Duck behind the chimney<br>3) Slide down the drainpipe | The searchlight swings AWAY across the roof. |
| 8 | Побег | stairwell | chase routes:stairs,elevator,window,chute,free:stairs,freeIfAlarm:chute | 1) Run down the stairs<br>2) Take the elevator<br>3) Jump out the window<br>4) Dive down the chute | Stairs: quiet · Lift: guard inside · Window: barred · Chute: jammed |

Идеальный путь (0 урона): skylight → leave → row0 → jump-floor → mirror → box → sprint → stairs

## 20. Paper King — Royal Paper Court

Экспонат: **Crown of the Paper King**. No desk keycard tonight. Choose your door trick wisely. Решений: 8. Урон: 1/2 HP. Достижимых состояний: 104.

| # | Фаза | Комната | Испытание | Варианты | Подсказка (начальное состояние) |
|---|---|---|---|---|---|
| 1 | Проникновение | office | keycard guard:asleep,desk:false | 1) Lift the guard's keycard<br>2) Search the desk<br>3) Move on | A snoring guard, keycard on the belt. The desk drawer is shut and rusty. |
| 2 | Проникновение | office | cat awake:true | 1) Tiptoe past the cat<br>2) Toss a yarn ball<br>3) Climb over the shelves | The museum cat is WIDE awake, tail twitching. |
| 3 | Проникновение | vault | door lock:magnetic | 1) Swipe a keycard<br>2) Pick the lock<br>3) Crawl the vent | A magnetic lock - no keyhole to pick. You have NO keycard. The vent is noisy. |
| 4 | Кража | gallery | guard mode:statue | 1) Hide behind the statue<br>2) Tiptoe behind the guard<br>3) Wait in the shadows<br>4) Toss a coin to distract | The guard polishes the statue, flashlight sweeping the path. |
| 5 | Кража | vault | case sensor:motion | 1) Swap the weight<br>2) Angle a mirror<br>3) Wait for the blink<br>4) Cool down with the fan | A motion eye blinks off every few seconds. |
| 6 | Побег | gallery | laser mode:low | 1) Jump over<br>2) Slide under<br>3) Wait for a gap<br>4) Walk straight through | Red beams hum at ankle height. |
| 7 | Побег | sculpture | guardPlates guard:away,safe:1 | 1) Cross on back row<br>2) Cross on middle row<br>3) Cross on front row<br>4) Hide behind the statue | The guard strolls away toward the statue. Gold-rimmed tiles are plates. |
| 8 | Побег | corridor | chase routes:stairs,elevator,window,chute,free:elevator,freeIfAlarm:window | 1) Run down the stairs<br>2) Take the elevator<br>3) Jump out the window<br>4) Dive down the chute | Stairs: boots stomping · Lift: empty, waiting · Window: barred · Chute: jammed |

Идеальный путь (0 урона): lift → yarn → swipe → shadow → wait → jump → row1 → elevator

## 21. Laughing Owl — Night Birds Gallery

Экспонат: **Mask of the Laughing Owl**. Nine decisions. Every alert counts. Решений: 9. Урон: 1/2 HP. Достижимых состояний: 77.

| # | Фаза | Комната | Испытание | Варианты | Подсказка (начальное состояние) |
|---|---|---|---|---|---|
| 1 | Проникновение | courtyard | entry safe:dock | 1) Rope down the skylight<br>2) Climb in the window<br>3) Sneak via the dock | Skylight: wet and slippery · Window: sensor blinking red · Dock: empty and dark |
| 2 | Проникновение | basement | fusebox linked:false | 1) Cut the power<br>2) Leave it alone<br>3) Overload the fuses | An old fuse box powers this floor's lasers and cameras. |
| 3 | Проникновение | gallery | laser mode:high | 1) Jump over<br>2) Slide under<br>3) Wait for a gap<br>4) Walk straight through | Beams hang at head height. The floor is clear. |
| 4 | Проникновение | gallery | camera zone:floor | 1) Sneak along the floor<br>2) Climb the ledge<br>3) Hide in a crate<br>4) Stroll right past | The camera stares at the floor path. |
| 5 | Кража | corridor | door lock:brass | 1) Swipe a keycard<br>2) Pick the lock<br>3) Crawl the vent | An old brass lock - pickable. You have NO keycard. The vent is noisy. |
| 6 | Кража | vault | case sensor:heat | 1) Swap the weight<br>2) Angle a mirror<br>3) Wait for the blink<br>4) Cool down with the fan | A heat sensor: a warm robot will trip it. |
| 7 | Побег | corridor | laserCam laser:high,zone:ledge | 1) Jump along the floor<br>2) Slide along the floor<br>3) Jump along the ledge<br>4) Slide along the ledge | Beams hang at head height. The floor is clear. The camera watches the ledge. |
| 8 | Побег | sculpture | guard mode:toward | 1) Hide behind the statue<br>2) Tiptoe behind the guard<br>3) Wait in the shadows<br>4) Toss a coin to distract | A guard walks YOUR way. A big statue offers cover. |
| 9 | Побег | corridor | chase routes:stairs,elevator,window,chute,free:window,freeIfAlarm:elevator | 1) Run down the stairs<br>2) Take the elevator<br>3) Jump out the window<br>4) Dive down the chute | Stairs: boots stomping · Lift: guard inside · Window: soft awning below · Chute: jammed |

Идеальный путь (0 урона): dock → cut → jump → floor → pick → cool → slide-floor → statue → window

## 22. Clockwork — Automaton Hall

Экспонат: **The Clockwork Egg**. A shop decoy and a cranky guard. Решений: 9. Урон: 1/2 HP. Достижимых состояний: 141.

| # | Фаза | Комната | Испытание | Варианты | Подсказка (начальное состояние) |
|---|---|---|---|---|---|
| 1 | Проникновение | shop | giftshop gate:open | 1) Walk in, grab a replica<br>2) Reach through the bars<br>3) Skip the shop | The gift shop is open. Plaster replicas weigh just like the real thing. |
| 2 | Проникновение | library | keycard guard:stirring,desk:false | 1) Lift the guard's keycard<br>2) Search the desk<br>3) Move on | A twitchy, half-awake guard. The desk drawer is shut and rusty. |
| 3 | Проникновение | vault | door lock:brass | 1) Swipe a keycard<br>2) Pick the lock<br>3) Crawl the vent | An old brass lock - pickable. You have NO keycard. The vent is noisy. |
| 4 | Проникновение | atrium | guardPlates guard:away,safe:2 | 1) Cross on back row<br>2) Cross on middle row<br>3) Cross on front row<br>4) Hide behind the statue | The guard strolls away toward the statue. Gold-rimmed tiles are plates. |
| 5 | Кража | gallery | camera zone:ledge | 1) Sneak along the floor<br>2) Climb the ledge<br>3) Hide in a crate<br>4) Stroll right past | The camera watches the high ledge. |
| 6 | Кража | sculpture | case sensor:weight | 1) Swap the weight<br>2) Angle a mirror<br>3) Wait for the blink<br>4) Cool down with the fan | A scale sensor: replace the exhibit with equal weight. No decoy - the backpack will do, noisily. |
| 7 | Побег | atrium | plates safe:3,rows:4 | 1) Cross on back row<br>2) Cross on inner back<br>3) Cross on inner front<br>4) Cross on front row | Pressure plates have gold rims. Find the row with none. |
| 8 | Побег | rooftop | searchlight mode:coming | 1) Sprint across now<br>2) Duck behind the chimney<br>3) Slide down the drainpipe | The searchlight swings TOWARD you. A chimney is close. |
| 9 | Побег | stairwell | chase routes:stairs,elevator,window,chute,free:stairs,freeIfAlarm:chute | 1) Run down the stairs<br>2) Take the elevator<br>3) Jump out the window<br>4) Dive down the chute | Stairs: quiet · Lift: guard inside · Window: barred · Chute: jammed |

Идеальный путь (0 урона): walk → skip → pick → row2 → floor → swap → row3 → duck → stairs

## 23. Glacier Heart — Frost Gallery

Экспонат: **Heart of the Glacier**. Quiet entry, then the hardest tiles yet. Решений: 9. Урон: 1/2 HP. Достижимых состояний: 75.

| # | Фаза | Комната | Испытание | Варианты | Подсказка (начальное состояние) |
|---|---|---|---|---|---|
| 1 | Проникновение | office | cat awake:false | 1) Tiptoe past the cat<br>2) Toss a yarn ball<br>3) Climb over the shelves | The museum cat is fast asleep on a cushion. |
| 2 | Проникновение | basement | fusebox linked:true | 1) Cut the power<br>2) Leave it alone<br>3) Overload the fuses | A red tag: ALARM-LINKED. Cutting it rings the bells. |
| 3 | Проникновение | corridor | laserCam laser:low,zone:ledge | 1) Jump along the floor<br>2) Slide along the floor<br>3) Jump along the ledge<br>4) Slide along the ledge | Red beams hum at ankle height. The camera watches the ledge. |
| 4 | Проникновение | sculpture | guard mode:radio | 1) Hide behind the statue<br>2) Tiptoe behind the guard<br>3) Wait in the shadows<br>4) Toss a coin to distract | The guard stands still, humming to the radio. Coins jingle on the floor. |
| 5 | Кража | gallery | plates safe:1,rows:4 | 1) Cross on back row<br>2) Cross on inner back<br>3) Cross on inner front<br>4) Cross on front row | Pressure plates have gold rims. Find the row with none. |
| 6 | Кража | vault | case sensor:beam | 1) Swap the weight<br>2) Angle a mirror<br>3) Wait for the blink<br>4) Cool down with the fan | A light beam crosses the case. Bounce it away. |
| 7 | Побег | gallery | laser mode:pulse | 1) Jump over<br>2) Slide under<br>3) Wait for a gap<br>4) Walk straight through | The beams blink on and off. Count the gaps. |
| 8 | Побег | gallery | camera zone:both | 1) Sneak along the floor<br>2) Climb the ledge<br>3) Hide in a crate<br>4) Stroll right past | The camera sweeps floor AND ledge. Need cover. |
| 9 | Побег | corridor | chase routes:stairs,elevator,window,chute,free:elevator,freeIfAlarm:stairs | 1) Run down the stairs<br>2) Take the elevator<br>3) Jump out the window<br>4) Dive down the chute | Stairs: boots stomping · Lift: empty, waiting · Window: barred · Chute: jammed |

Идеальный путь (0 урона): tiptoe → leave → jump-floor → coin → row1 → mirror → wait → box → elevator

## 24. Lost Socks — Laundry Museum

Экспонат: **The Saint of Lost Socks**. A keycard waits in a drawer. Do not waste it. Решений: 9. Урон: 1/2 HP. Достижимых состояний: 106.

| # | Фаза | Комната | Испытание | Варианты | Подсказка (начальное состояние) |
|---|---|---|---|---|---|
| 1 | Проникновение | courtyard | entry safe:window | 1) Rope down the skylight<br>2) Climb in the window<br>3) Sneak via the dock | Skylight: wet and slippery · Window: sensor unplugged · Dock: guard on a coffee break |
| 2 | Проникновение | library | keycard guard:asleep,desk:true | 1) Lift the guard's keycard<br>2) Search the desk<br>3) Move on | A snoring guard, keycard on the belt. A keycard glints in an open drawer. |
| 3 | Проникновение | vault | door lock:magnetic | 1) Swipe a keycard<br>2) Pick the lock<br>3) Crawl the vent | A magnetic lock - no keyhole to pick. You have NO keycard. The vent is noisy. |
| 4 | Проникновение | gallery | laser mode:low | 1) Jump over<br>2) Slide under<br>3) Wait for a gap<br>4) Walk straight through | Red beams hum at ankle height. |
| 5 | Кража | sculpture | guardPlates guard:toward,safe:2 | 1) Cross on back row<br>2) Cross on middle row<br>3) Cross on front row<br>4) Hide behind the statue | A guard walks YOUR way! Gold-rimmed tiles are plates. |
| 6 | Кража | sculpture | case sensor:motion | 1) Swap the weight<br>2) Angle a mirror<br>3) Wait for the blink<br>4) Cool down with the fan | A motion eye blinks off every few seconds. |
| 7 | Побег | gallery | laserCam laser:low,zone:floor | 1) Jump along the floor<br>2) Slide along the floor<br>3) Jump along the ledge<br>4) Slide along the ledge | Red beams hum at ankle height. The camera watches the floor. |
| 8 | Побег | rooftop | searchlight mode:sweep | 1) Sprint across now<br>2) Duck behind the chimney<br>3) Slide down the drainpipe | Two searchlights sweep the whole roof. A drainpipe hangs at the edge. |
| 9 | Побег | stairwell | chase routes:stairs,elevator,window,chute,free:chute,freeIfAlarm:window | 1) Run down the stairs<br>2) Take the elevator<br>3) Jump out the window<br>4) Dive down the chute | Stairs: boots stomping · Lift: guard inside · Window: barred · Chute: open |

Идеальный путь (0 урона): window → lift → swipe → jump → statue → wait → jump-ledge → pipe → chute

## 25. Nowhere Map — Cartography Vault

Экспонат: **Map Scroll to Nowhere**. Power cut early, magnetic vault later, no keycard in sight. Решений: 9. Урон: 1/2 HP. Достижимых состояний: 142.

| # | Фаза | Комната | Испытание | Варианты | Подсказка (начальное состояние) |
|---|---|---|---|---|---|
| 1 | Проникновение | atrium | giftshop gate:barred | 1) Walk in, grab a replica<br>2) Reach through the bars<br>3) Skip the shop | Gift shop gate is barred and wired. Replicas sit right behind the bars. |
| 2 | Проникновение | basement | fusebox linked:false | 1) Cut the power<br>2) Leave it alone<br>3) Overload the fuses | An old fuse box powers this floor's lasers and cameras. |
| 3 | Проникновение | atrium | camera zone:both | 1) Sneak along the floor<br>2) Climb the ledge<br>3) Hide in a crate<br>4) Stroll right past | The camera sweeps floor AND ledge. Need cover. |
| 4 | Проникновение | gallery | laserCam laser:high,zone:floor | 1) Jump along the floor<br>2) Slide along the floor<br>3) Jump along the ledge<br>4) Slide along the ledge | Beams hang at head height. The floor is clear. The camera watches the floor. |
| 5 | Кража | corridor | door lock:magnetic | 1) Swipe a keycard<br>2) Pick the lock<br>3) Crawl the vent | A magnetic lock - no keyhole to pick. You have NO keycard. The vent is noisy. |
| 6 | Кража | vault | case sensor:weight | 1) Swap the weight<br>2) Angle a mirror<br>3) Wait for the blink<br>4) Cool down with the fan | A scale sensor: replace the exhibit with equal weight. No decoy - the backpack will do, noisily. |
| 7 | Побег | gallery | guard mode:away | 1) Hide behind the statue<br>2) Tiptoe behind the guard<br>3) Wait in the shadows<br>4) Toss a coin to distract | The guard strolls away toward the statue, back turned. |
| 8 | Побег | sculpture | guardPlates guard:away,safe:0 | 1) Cross on back row<br>2) Cross on middle row<br>3) Cross on front row<br>4) Hide behind the statue | The guard strolls away toward the statue. Gold-rimmed tiles are plates. |
| 9 | Побег | corridor | chase routes:stairs,elevator,window,chute,free:window,freeIfAlarm:stairs | 1) Run down the stairs<br>2) Take the elevator<br>3) Jump out the window<br>4) Dive down the chute | Stairs: boots stomping · Lift: guard inside · Window: soft awning below · Chute: jammed |

Идеальный путь (0 урона): reach → cut → floor → jump-floor → vent → swap → tiptoe → row0 → window

## 26. Midnight Watch — Clock Tower

Экспонат: **The Midnight Pocket Watch**. Final act. Steal and escape mistakes cost 2 HP. Решений: 10. Урон: 1/2 HP. Достижимых состояний: 139.

| # | Фаза | Комната | Испытание | Варианты | Подсказка (начальное состояние) |
|---|---|---|---|---|---|
| 1 | Проникновение | courtyard | entry safe:skylight | 1) Rope down the skylight<br>2) Climb in the window<br>3) Sneak via the dock | Skylight: dry and unlatched · Window: sensor blinking red · Dock: guard on a coffee break |
| 2 | Проникновение | office | cat awake:true | 1) Tiptoe past the cat<br>2) Toss a yarn ball<br>3) Climb over the shelves | The museum cat is WIDE awake, tail twitching. |
| 3 | Проникновение | office | keycard guard:asleep,desk:false | 1) Lift the guard's keycard<br>2) Search the desk<br>3) Move on | A snoring guard, keycard on the belt. The desk drawer is shut and rusty. |
| 4 | Проникновение | corridor | door lock:magnetic | 1) Swipe a keycard<br>2) Pick the lock<br>3) Crawl the vent | A magnetic lock - no keyhole to pick. You have NO keycard. The vent is noisy. |
| 5 | Кража | gallery | laserCam laser:high,zone:ledge | 1) Jump along the floor<br>2) Slide along the floor<br>3) Jump along the ledge<br>4) Slide along the ledge | Beams hang at head height. The floor is clear. The camera watches the ledge. |
| 6 | Кража | sculpture | case sensor:heat | 1) Swap the weight<br>2) Angle a mirror<br>3) Wait for the blink<br>4) Cool down with the fan | A heat sensor: a warm robot will trip it. |
| 7 | Побег | corridor | laser mode:pulse | 1) Jump over<br>2) Slide under<br>3) Wait for a gap<br>4) Walk straight through | The beams blink on and off. Count the gaps. |
| 8 | Побег | gallery | guard mode:statue | 1) Hide behind the statue<br>2) Tiptoe behind the guard<br>3) Wait in the shadows<br>4) Toss a coin to distract | The guard polishes the statue, flashlight sweeping the path. |
| 9 | Побег | rooftop | searchlight mode:leaving | 1) Sprint across now<br>2) Duck behind the chimney<br>3) Slide down the drainpipe | The searchlight swings AWAY across the roof. |
| 10 | Побег | corridor | chase routes:stairs,elevator,window,chute,free:stairs,freeIfAlarm:elevator | 1) Run down the stairs<br>2) Take the elevator<br>3) Jump out the window<br>4) Dive down the chute | Stairs: quiet · Lift: guard inside · Window: barred · Chute: jammed |

Идеальный путь (0 урона): skylight → yarn → lift → swipe → slide-floor → cool → wait → shadow → sprint → stairs

## 27. Thunder Tea — Porcelain Gallery

Экспонат: **The Thunder Teapot**. The fuse box is a trap. The shop is your friend. Решений: 10. Урон: 1/2 HP. Достижимых состояний: 151.

| # | Фаза | Комната | Испытание | Варианты | Подсказка (начальное состояние) |
|---|---|---|---|---|---|
| 1 | Проникновение | atrium | giftshop gate:open | 1) Walk in, grab a replica<br>2) Reach through the bars<br>3) Skip the shop | The gift shop is open. Plaster replicas weigh just like the real thing. |
| 2 | Проникновение | basement | fusebox linked:true | 1) Cut the power<br>2) Leave it alone<br>3) Overload the fuses | A red tag: ALARM-LINKED. Cutting it rings the bells. |
| 3 | Проникновение | gallery | laser mode:high | 1) Jump over<br>2) Slide under<br>3) Wait for a gap<br>4) Walk straight through | Beams hang at head height. The floor is clear. |
| 4 | Проникновение | sculpture | guardPlates guard:toward,safe:1 | 1) Cross on back row<br>2) Cross on middle row<br>3) Cross on front row<br>4) Hide behind the statue | A guard walks YOUR way! Gold-rimmed tiles are plates. |
| 5 | Кража | corridor | door lock:brass | 1) Swipe a keycard<br>2) Pick the lock<br>3) Crawl the vent | An old brass lock - pickable. You have NO keycard. The vent is noisy. |
| 6 | Кража | vault | case sensor:weight | 1) Swap the weight<br>2) Angle a mirror<br>3) Wait for the blink<br>4) Cool down with the fan | A scale sensor: replace the exhibit with equal weight. No decoy - the backpack will do, noisily. |
| 7 | Побег | atrium | camera zone:floor | 1) Sneak along the floor<br>2) Climb the ledge<br>3) Hide in a crate<br>4) Stroll right past | The camera stares at the floor path. |
| 8 | Побег | atrium | plates safe:2,rows:4 | 1) Cross on back row<br>2) Cross on inner back<br>3) Cross on inner front<br>4) Cross on front row | Pressure plates have gold rims. Find the row with none. |
| 9 | Побег | corridor | laserCam laser:low,zone:ledge | 1) Jump along the floor<br>2) Slide along the floor<br>3) Jump along the ledge<br>4) Slide along the ledge | Red beams hum at ankle height. The camera watches the ledge. |
| 10 | Побег | stairwell | chase routes:stairs,elevator,window,chute,free:elevator,freeIfAlarm:chute | 1) Run down the stairs<br>2) Take the elevator<br>3) Jump out the window<br>4) Dive down the chute | Stairs: boots stomping · Lift: empty, waiting · Window: barred · Chute: jammed |

Идеальный путь (0 урона): walk → leave → slide → statue → pick → swap → ledge → row2 → jump-floor → elevator

## 28. Copper Knight — Knights Hall

Экспонат: **Helm of the Copper Knight**. A twitchy guard sleeps next to an open drawer. Решений: 10. Урон: 1/2 HP. Достижимых состояний: 185.

| # | Фаза | Комната | Испытание | Варианты | Подсказка (начальное состояние) |
|---|---|---|---|---|---|
| 1 | Проникновение | courtyard | entry safe:dock | 1) Rope down the skylight<br>2) Climb in the window<br>3) Sneak via the dock | Skylight: wet and slippery · Window: sensor blinking red · Dock: empty and dark |
| 2 | Проникновение | library | keycard guard:stirring,desk:true | 1) Lift the guard's keycard<br>2) Search the desk<br>3) Move on | A twitchy, half-awake guard. A keycard glints in an open drawer. |
| 3 | Проникновение | basement | fusebox linked:false | 1) Cut the power<br>2) Leave it alone<br>3) Overload the fuses | An old fuse box powers this floor's lasers and cameras. |
| 4 | Проникновение | corridor | door lock:magnetic | 1) Swipe a keycard<br>2) Pick the lock<br>3) Crawl the vent | A magnetic lock - no keyhole to pick. You have NO keycard. The vent is noisy. |
| 5 | Кража | gallery | camera zone:ledge | 1) Sneak along the floor<br>2) Climb the ledge<br>3) Hide in a crate<br>4) Stroll right past | The camera watches the high ledge. |
| 6 | Кража | sculpture | case sensor:beam | 1) Swap the weight<br>2) Angle a mirror<br>3) Wait for the blink<br>4) Cool down with the fan | A light beam crosses the case. Bounce it away. |
| 7 | Побег | sculpture | guardPlates guard:away,safe:1 | 1) Cross on back row<br>2) Cross on middle row<br>3) Cross on front row<br>4) Hide behind the statue | The guard strolls away toward the statue. Gold-rimmed tiles are plates. |
| 8 | Побег | gallery | laser mode:low | 1) Jump over<br>2) Slide under<br>3) Wait for a gap<br>4) Walk straight through | Red beams hum at ankle height. |
| 9 | Побег | rooftop | searchlight mode:coming | 1) Sprint across now<br>2) Duck behind the chimney<br>3) Slide down the drainpipe | The searchlight swings TOWARD you. A chimney is close. |
| 10 | Побег | corridor | chase routes:stairs,elevator,window,chute,free:window,freeIfAlarm:stairs | 1) Run down the stairs<br>2) Take the elevator<br>3) Jump out the window<br>4) Dive down the chute | Stairs: boots stomping · Lift: guard inside · Window: soft awning below · Chute: jammed |

Идеальный путь (0 урона): dock → desk → cut → swipe → floor → mirror → row1 → jump → duck → window

## 29. Infinity Coin — Treasury

Экспонат: **The Infinity Coin**. The longest night yet. Patience wins. Решений: 10. Урон: 1/2 HP. Достижимых состояний: 135.

| # | Фаза | Комната | Испытание | Варианты | Подсказка (начальное состояние) |
|---|---|---|---|---|---|
| 1 | Проникновение | office | cat awake:false | 1) Tiptoe past the cat<br>2) Toss a yarn ball<br>3) Climb over the shelves | The museum cat is fast asleep on a cushion. |
| 2 | Проникновение | shop | giftshop gate:barred | 1) Walk in, grab a replica<br>2) Reach through the bars<br>3) Skip the shop | Gift shop gate is barred and wired. Replicas sit right behind the bars. |
| 3 | Проникновение | corridor | laserCam laser:low,zone:floor | 1) Jump along the floor<br>2) Slide along the floor<br>3) Jump along the ledge<br>4) Slide along the ledge | Red beams hum at ankle height. The camera watches the floor. |
| 4 | Проникновение | sculpture | guard mode:radio | 1) Hide behind the statue<br>2) Tiptoe behind the guard<br>3) Wait in the shadows<br>4) Toss a coin to distract | The guard stands still, humming to the radio. Coins jingle on the floor. |
| 5 | Кража | gallery | plates safe:3,rows:4 | 1) Cross on back row<br>2) Cross on inner back<br>3) Cross on inner front<br>4) Cross on front row | Pressure plates have gold rims. Find the row with none. |
| 6 | Кража | vault | case sensor:weight | 1) Swap the weight<br>2) Angle a mirror<br>3) Wait for the blink<br>4) Cool down with the fan | A scale sensor: replace the exhibit with equal weight. No decoy - the backpack will do, noisily. |
| 7 | Побег | atrium | camera zone:both | 1) Sneak along the floor<br>2) Climb the ledge<br>3) Hide in a crate<br>4) Stroll right past | The camera sweeps floor AND ledge. Need cover. |
| 8 | Побег | gallery | laserCam laser:high,zone:floor | 1) Jump along the floor<br>2) Slide along the floor<br>3) Jump along the ledge<br>4) Slide along the ledge | Beams hang at head height. The floor is clear. The camera watches the floor. |
| 9 | Побег | gallery | guard mode:toward | 1) Hide behind the statue<br>2) Tiptoe behind the guard<br>3) Wait in the shadows<br>4) Toss a coin to distract | A guard walks YOUR way. A big statue offers cover. |
| 10 | Побег | stairwell | chase routes:stairs,elevator,window,chute,free:chute,freeIfAlarm:window | 1) Run down the stairs<br>2) Take the elevator<br>3) Jump out the window<br>4) Dive down the chute | Stairs: boots stomping · Lift: guard inside · Window: barred · Chute: open |

Идеальный путь (0 урона): tiptoe → reach → jump-ledge → coin → row3 → swap → box → slide-ledge → statue → chute

## 30. The Star of Everything — Crown Jewel Vault

Экспонат: **The Star of Everything**. The grand finale. Every lesson counts. Решений: 10. Урон: 1/2 HP. Достижимых состояний: 200.

| # | Фаза | Комната | Испытание | Варианты | Подсказка (начальное состояние) |
|---|---|---|---|---|---|
| 1 | Проникновение | courtyard | entry safe:window | 1) Rope down the skylight<br>2) Climb in the window<br>3) Sneak via the dock | Skylight: wet and slippery · Window: sensor unplugged · Dock: guard on a coffee break |
| 2 | Проникновение | library | keycard guard:asleep,desk:true | 1) Lift the guard's keycard<br>2) Search the desk<br>3) Move on | A snoring guard, keycard on the belt. A keycard glints in an open drawer. |
| 3 | Проникновение | basement | fusebox linked:false | 1) Cut the power<br>2) Leave it alone<br>3) Overload the fuses | An old fuse box powers this floor's lasers and cameras. |
| 4 | Проникновение | corridor | door lock:magnetic | 1) Swipe a keycard<br>2) Pick the lock<br>3) Crawl the vent | A magnetic lock - no keyhole to pick. You have NO keycard. The vent is noisy. |
| 5 | Кража | gallery | laserCam laser:low,zone:ledge | 1) Jump along the floor<br>2) Slide along the floor<br>3) Jump along the ledge<br>4) Slide along the ledge | Red beams hum at ankle height. The camera watches the ledge. |
| 6 | Кража | sculpture | case sensor:motion | 1) Swap the weight<br>2) Angle a mirror<br>3) Wait for the blink<br>4) Cool down with the fan | A motion eye blinks off every few seconds. |
| 7 | Побег | sculpture | guardPlates guard:toward,safe:0 | 1) Cross on back row<br>2) Cross on middle row<br>3) Cross on front row<br>4) Hide behind the statue | A guard walks YOUR way! Gold-rimmed tiles are plates. |
| 8 | Побег | gallery | laser mode:high | 1) Jump over<br>2) Slide under<br>3) Wait for a gap<br>4) Walk straight through | Beams hang at head height. The floor is clear. |
| 9 | Побег | rooftop | searchlight mode:sweep | 1) Sprint across now<br>2) Duck behind the chimney<br>3) Slide down the drainpipe | Two searchlights sweep the whole roof. A drainpipe hangs at the edge. |
| 10 | Побег | corridor | chase routes:stairs,elevator,window,chute,free:stairs,freeIfAlarm:elevator | 1) Run down the stairs<br>2) Take the elevator<br>3) Jump out the window<br>4) Dive down the chute | Stairs: quiet · Lift: guard inside · Window: barred · Chute: jammed |

Идеальный путь (0 урона): window → lift → cut → swipe → jump-floor → wait → statue → slide → pipe → stairs

