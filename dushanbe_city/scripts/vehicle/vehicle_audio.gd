class_name VehicleAudio
extends Node3D
## Prado sound, built only from REAL recordings (sources / licences: assets/audio/vehicle/LICENSES.txt,
## cutting tool: dushanbe_city_src/tools/vehicle/cut_prado_audio.py). No synthesised layers.
##
## Engine (4-cylinder turbo-diesel, firing frequency f = rpm / 30):
##   4 steady-rpm loops cut from recordings of real diesels: idle 24.5 Hz and 44.4 Hz from a Toyota
##   Hilux diesel (the Prado 150 shares the 1GD-FTV / KD diesel family; NOT a recording of a Prado),
##   62.7 Hz and 128 Hz from a 1.5 l 4-cylinder diesel. Each loop is played at the firing frequency
##   of the current rpm (pitch = f / f_loop) and weighted by how close its own rpm is (log distance),
##   so the timbre changes with rpm instead of one sample being stretched.
##   Every loop exists twice: on-load (throttle) and off-load (lift-off / engine braking: the same
##   recording muffled and quieter). The throttle/load cross-fades the two sets (equal power).
##   Start (starter + catch) and stop are one-shots of the same Hilux recording; the loops take over
##   when the engine catches. Gear shifts: short torque-cut dip; rev limiter: fuel-cut stutter.
## Tyres: squeal from the real tyre-patch sliding speed on hard surfaces (drift, wheelspin, ABS
##   braking), a skid one-shot when a slide starts; loose surfaces (earth / grass / sand) give gravel /
##   sand scrub instead of squeal. Rolling noise per surface (asphalt roar, gravel, sand) ~ speed.
## Suspension: knock only on real bumps (fast compression of a wheel).
## Collisions: light / medium / heavy (+ glass) by impact speed, material of what was hit (metal pole,
##   concrete, tree, ground) picks the layer; volume grows with the force.
## Doors: handle, open, close, central lock.
## 3D: AudioStreamPlayer3D on the car (distance falloff). Interior camera: everything goes through the
##   "Vehicle" bus whose low-pass is switched on (muffled cabin) and the cabin road roar is added.

const DIR := "res://assets/audio/vehicle/"
const LAYERS := ["eng_idle", "eng_low", "eng_mid", "eng_high"]
const F0 := [24.5, 44.35, 62.65, 128.2]      ## measured firing frequency of each loop (Hz), see cutting tool
const SIGMA := 0.32                           ## log-frequency width of a layer's weight
const BUS := &"Vehicle"
const HARD := [CityWorld.Surface.ASPHALT, CityWorld.Surface.PAVED, CityWorld.Surface.ROCK]

var car: VehiclePrado
var interior := false                         ## set by VehicleCamera (cabin view)
var _bus_owner := false
var running := false
var log_events: Array[String] = []            ## one-shots played (tests / demo)
var levels := {}                              ## current linear gain of every loop (tests / HUD debug)

var _on: Array[AudioStreamPlayer3D] = []
var _off: Array[AudioStreamPlayer3D] = []
var _squeal: AudioStreamPlayer3D
var _roll := {}                               ## "asphalt" / "gravel" / "sand" -> player
var _cabin: AudioStreamPlayer3D
var _engine_fx: AudioStreamPlayer3D           ## start / stop
var _fx: Array[AudioStreamPlayer3D] = []      ## crashes, skids, bumps (round robin)
var _fx_i := 0
var _door: AudioStreamPlayer3D
var _t := 0.0                                 ## time since start (s); < 0 before the engine catches
var _load := 0.0
var _rpm := 800.0
var _last_gear := 1
var _shift_dip := 0.0
var _hb := false
var _bump_cd := 0.0
var _skid_cd := 0.0
var _prev_slip := 0.0
var _door_t := -10.0
var _lpf: AudioEffectLowPassFilter
var _cache := {}


func _ready() -> void:
	_setup_bus()
	for n in LAYERS:
		_on.append(_loop(n, 10.0))
		_off.append(_loop(n + "_off", 10.0))
	_squeal = _loop("tyre_squeal", 9.0)
	for k in ["asphalt", "gravel", "sand"]:
		_roll[k] = _loop("roll_" + k, 7.0)
	_cabin = _loop("road_interior", 4.0)
	_engine_fx = _player(10.0)
	for i in 3:
		_fx.append(_player(12.0))
	_door = _player(5.0)
	if car:
		car.damaged.connect(_on_hit)


func _setup_bus() -> void:
	var i := AudioServer.get_bus_index(BUS)
	if i < 0:
		AudioServer.add_bus()
		i = AudioServer.bus_count - 1
		AudioServer.set_bus_name(i, BUS)
		AudioServer.set_bus_send(i, &"Master")
		var f := AudioEffectLowPassFilter.new()
		f.cutoff_hz = 1500.0
		f.resonance = 0.4
		AudioServer.add_bus_effect(i, f)
		AudioServer.set_bus_effect_enabled(i, 0, false)
	_lpf = AudioServer.get_bus_effect(i, 0) as AudioEffectLowPassFilter


func _stream(name: String) -> AudioStream:
	if not _cache.has(name):
		var p := DIR + name + (".wav" if ResourceLoader.exists(DIR + name + ".wav") else ".ogg")
		_cache[name] = load(p) if ResourceLoader.exists(p) else null
	return _cache[name]


func _player(unit: float) -> AudioStreamPlayer3D:
	var p := AudioStreamPlayer3D.new()
	p.unit_size = unit
	p.max_distance = 160.0
	p.bus = BUS
	p.max_db = 4.0
	add_child(p)
	return p


func _loop(name: String, unit: float) -> AudioStreamPlayer3D:
	var p := _player(unit)
	var s := _stream(name)
	if s is AudioStreamWAV:
		var w := s as AudioStreamWAV
		w.loop_mode = AudioStreamWAV.LOOP_FORWARD
		w.loop_begin = 0
		w.loop_end = w.data.size() / 2              # 16-bit mono
	p.stream = s
	p.volume_db = -80.0
	return p


func _gain(p: AudioStreamPlayer3D, g: float, key: String) -> void:
	levels[key] = g
	if g < 0.003:
		p.volume_db = -80.0
		if p.playing:
			p.stream_paused = true                  # silent layers cost nothing
		return
	p.volume_db = linear_to_db(g)
	if not p.playing:
		p.play(randf() * 0.5)
	p.stream_paused = false


func _process(delta: float) -> void:
	if car == null:
		return
	_skid_cd = maxf(0.0, _skid_cd - delta)
	_bump_cd = maxf(0.0, _bump_cd - delta)
	if car.driven and not running and car.fuel_l > 0.0:
		start_engine()
	elif (not car.driven or car.fuel_l <= 0.0) and running:
		stop_engine()                              # also: the tank ran dry
	# cabin: closed doors / glass / insulation: low-pass + about -9 dB (the listener sits at the engine
	# instead of 6 m away, so without this the cabin would be louder than outside)
	# the shared "Vehicle" bus is set by the vehicle being driven only (parked vans / boats never
	# undo the cabin filter); after getting out it is reset once
	if car.driven or _bus_owner:
		var bi := AudioServer.get_bus_index(BUS)
		var on := interior and car.driven
		AudioServer.set_bus_effect_enabled(bi, 0, on)
		AudioServer.set_bus_volume_db(bi, -9.0 if on else 0.0)
		_bus_owner = car.driven
	_engine(delta)
	_tyres(delta)
	_suspension()


# ------------------------------------------------------------------------------------------- engine
func start_engine() -> void:
	running = true
	_t = -0.85                                    # starter cranks, the engine catches ~0.8 s in
	if Time.get_ticks_msec() * 0.001 - _door_t > 3.0:
		play_door(true)                           # instant entry (no animated door): still a door
	_shot(_engine_fx, "engine_start", 0.0, 1.0)
	_rpm = 800.0


func stop_engine() -> void:
	running = false
	_shot(_engine_fx, "engine_stop", -1.0, 1.0)


func _engine(delta: float) -> void:
	var start_fade := 0.0
	if running:
		_t += delta
		start_fade = clampf((_t + 0.15) / 0.9, 0.0, 1.0)
	elif _t > -5.0:
		_t = -5.0                                 # fade the loops out under the stop one-shot
	var fade := start_fade if running else 0.0
	_rpm = lerpf(_rpm, car.rpm, clampf(delta * 18.0, 0.0, 1.0))
	var fire := _rpm / 30.0
	var target := clampf(car.engine_load, 0.0, 1.0)
	_load = move_toward(_load, target, delta * (7.0 if target > _load else 3.5))
	if car.gear != _last_gear:
		if car.gear > 0 and _last_gear > 0:
			_shift_dip = 0.16
		_last_gear = car.gear
	_shift_dip = maxf(0.0, _shift_dip - delta)
	if car.handbrake and not _hb and running:
		_shot(_door, "parking_brake", -8.0, 1.0)
	_hb = car.handbrake
	# layer weights by log distance of the firing frequency
	var ws: Array[float] = []
	var tot := 0.0
	for f in F0:
		var d: float = log(fire / float(f))
		var w := exp(-0.5 * pow(d / SIGMA, 2.0))
		ws.append(w)
		tot += w
	var level := db_to_linear(lerpf(-7.0, -1.0, _load) + 5.0 * clampf((_rpm - 800.0) / 3600.0, 0.0, 1.0))
	if _shift_dip > 0.0:
		level *= 0.55
	# fuel-cut limiter: chopping at ~16 Hz when the engine is held at the cut-off under load
	if _rpm > 4250.0 and _load > 0.5:
		level *= 0.35 if fmod(Time.get_ticks_msec() * 0.016, 1.0) < 0.35 else 1.0
	var on_g := sqrt(_load)
	var off_g := sqrt(1.0 - _load)
	for i in F0.size():
		var w: float = ws[i] / maxf(tot, 1e-5) * level * fade
		var pitch := clampf(fire / float(F0[i]), 0.45, 2.6)
		_on[i].pitch_scale = pitch
		_off[i].pitch_scale = pitch
		if i == 0:
			_gain(_on[i], w * maxf(on_g, 0.75), LAYERS[i])           # idle: the plain idle recording
			_gain(_off[i], w * off_g * 0.35, LAYERS[i] + "_off")
		else:
			_gain(_on[i], w * on_g, LAYERS[i])
			_gain(_off[i], w * off_g * 1.2, LAYERS[i] + "_off")


# ------------------------------------------------------------------------------------------- tyres
func _tyres(_delta: float) -> void:
	var spd := car.speed_kmh
	var hard_slip := 0.0
	var loose_slip := 0.0
	var share := {"asphalt": 0.0, "gravel": 0.0, "sand": 0.0}
	var n := 0
	for w in car.wheels:
		if not w["contact"]:
			continue
		n += 1
		var s: int = w["surface"]
		var ss: float = w["slip_speed"]
		if s in HARD:
			hard_slip = maxf(hard_slip, ss)
			share["asphalt"] += 1.0
		else:
			loose_slip = maxf(loose_slip, ss)
			share["sand" if s == CityWorld.Surface.SAND or s == CityWorld.Surface.GRASS else "gravel"] += 1.0
	# squeal: sliding speed of the contact patch (drift, wheelspin, locked wheels); ABS chirp on
	# hard braking (the ABS keeps the tyres at the slip peak, they sing but do not lock)
	var sq := clampf((hard_slip - 0.8) / 6.0, 0.0, 1.0)
	if car.brake > 0.75 and spd > 25.0 and car.forward_speed > 0.0:
		sq = maxf(sq, 0.32 + 0.12 * sin(Time.get_ticks_msec() * 0.05))
	_squeal.pitch_scale = 0.88 + 0.22 * sq
	_gain(_squeal, sq * (1.0 if running or spd > 3.0 else 0.0) * 0.9, "tyre_squeal")
	if sq > 0.45 and _prev_slip <= 0.45 and _skid_cd <= 0.0 and spd > 20.0:
		_shot(_next_fx(), "tyre_skid", lerpf(-8.0, -2.0, sq), randf_range(0.92, 1.05))
		_skid_cd = 1.6
	_prev_slip = sq
	# rolling noise per surface (+ scrub on loose ground when sliding)
	var v := clampf(spd / 100.0, 0.0, 1.0)
	for k in share:
		var frac: float = share[k] / maxf(n, 1)
		var g := frac * sqrt(v) * (0.55 if k == "asphalt" else 0.8)
		if k != "asphalt":
			g += frac * clampf(loose_slip / 5.0, 0.0, 1.0) * 0.8
		_roll[k].pitch_scale = 0.8 + 0.4 * v
		_gain(_roll[k], g if spd > 1.0 else 0.0, "roll_" + k)
	_gain(_cabin, (0.15 + 0.6 * v) if interior and running else 0.0, "road_interior")


func _suspension() -> void:
	if _bump_cd > 0.0:
		return
	for w in car.wheels:
		var ov: float = w["offset_vel"]
		if ov > 1.1 and w["contact"]:
			_shot(_next_fx(), "bump_%d" % (1 + randi() % 2), -8.0 + minf(ov - 1.1, 2.0) * 4.0, randf_range(0.8, 0.95))
			_bump_cd = 0.25
			return


# ------------------------------------------------------------------------------------------- doors
func play_door(close: bool) -> void:
	_door_t = Time.get_ticks_msec() * 0.001
	_shot(_door, "door_close" if close else "door_open", -2.0, randf_range(0.97, 1.03))


func play_handle() -> void:
	_shot(_door, "door_handle", -6.0, 1.0)


func play_lock() -> void:
	_shot(_door, "door_lock", -6.0, 1.0)


# ------------------------------------------------------------------------------------------- impacts
func _on_hit(_health: float) -> void:
	play_impact(car.last_impact, car.last_impact_material)


## dv = velocity change of the hit (m/s); material of the other body: metal / concrete / wood / ground / soft
func play_impact(dv: float, material: String) -> void:
	var loud := clampf((dv - 1.5) / 9.0, 0.0, 1.0)
	var db := lerpf(-14.0, 2.0, loud)
	if material == "soft" or material == "ground":
		_shot(_next_fx(), "bump_%d" % (1 + randi() % 2), db - 2.0, 0.75)
		return
	if dv < 3.5:                                                   # light: a knock / scrape
		_shot(_next_fx(), "hit_metal_%d" % (1 + randi() % 2) if material == "metal" else "bump_1", db, randf_range(0.9, 1.1))
	elif dv < 7.0:                                                 # medium
		_shot(_next_fx(), "crash_medium", db, randf_range(0.95, 1.05))
		if material == "metal":
			_shot(_next_fx(), "hit_metal_%d" % (1 + randi() % 2), db - 3.0, 0.9)
	else:                                                          # heavy
		_shot(_next_fx(), "crash_heavy", db, randf_range(0.95, 1.02))
		if dv > 9.5:
			_shot(_next_fx(), "crash_glass", db - 4.0, 1.0)
		elif material == "metal":
			_shot(_next_fx(), "hit_metal_1", db - 2.0, 0.8)
	if material == "wood":
		_shot(_next_fx(), "bump_2", db - 4.0, 0.7)


func _next_fx() -> AudioStreamPlayer3D:
	_fx_i = (_fx_i + 1) % _fx.size()
	return _fx[_fx_i]


func _shot(p: AudioStreamPlayer3D, name: String, db: float, pitch: float) -> void:
	var s := _stream(name)
	if s == null:
		push_warning("VehicleAudio: missing sound " + name)
		return
	p.stream = s
	p.volume_db = db
	p.pitch_scale = pitch
	p.play()
	log_events.append(name)
	if log_events.size() > 64:
		log_events.remove_at(0)
