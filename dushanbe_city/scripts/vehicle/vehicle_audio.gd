class_name VehicleAudio
extends Node3D
## Prado sound (3D, follows the car). Sources and licences: assets/audio/vehicle/LICENSES.txt.
## Engine: six recorded loops of different engine speeds (firing frequencies 43..77 Hz). Every loop is
## played at the PHYSICALLY correct firing frequency for the current rpm (4-cylinder diesel: f = rpm / 30),
## and the mix weight goes to the loops whose natural speed is closest (log distance) — so the
## timbre changes with rpm like a real engine instead of one sample being stretched. Load (throttle)
## raises level and favours the harsher loops; coasting is quieter. Engine off when nobody drives.
## Tyres: squeal ~ slide amount (also hard ABS stops), rolling road noise ~ speed.
## Suspension knock on sharp compression; impacts: metal hits / heavy crash / glass by hit strength.

const F0 := [43.2, 59.8, 65.1, 69.8, 72.7, 76.7]     ## measured firing frequency of each loop (Hz)
var car: VehiclePrado
var _eng: Array[AudioStreamPlayer3D] = []
var _squeal: AudioStreamPlayer3D
var _road: AudioStreamPlayer3D
var _oneshot: AudioStreamPlayer3D
var _bump: AudioStreamPlayer3D
var _bump_cd := 0.0
var _running := false
var _start_t := 0.0
var _door: AudioStreamPlayer3D
var _last_gear := 1
var _shift_dip := 0.0
var _hb := false


func _ready() -> void:
	for i in F0.size():
		var p := _loop_player("res://assets/audio/vehicle/engine_%d.wav" % i)
		p.unit_size = 9.0
		_eng.append(p)
	_squeal = _loop_player("res://assets/audio/vehicle/tyre_squeal.wav")
	_road = _loop_player("res://assets/audio/vehicle/road_noise.wav")
	_oneshot = AudioStreamPlayer3D.new()
	_oneshot.unit_size = 12.0
	add_child(_oneshot)
	_bump = AudioStreamPlayer3D.new()
	_bump.unit_size = 6.0
	add_child(_bump)
	_door = AudioStreamPlayer3D.new()
	_door.unit_size = 5.0
	add_child(_door)
	if car:
		car.damaged.connect(_on_hit)


func _loop_player(path: String) -> AudioStreamPlayer3D:
	var p := AudioStreamPlayer3D.new()
	var s: AudioStream = load(path)
	if s is AudioStreamWAV:
		var w := s as AudioStreamWAV
		w.loop_mode = AudioStreamWAV.LOOP_FORWARD
		w.loop_begin = 0
		w.loop_end = w.data.size() / (2 if w.format == AudioStreamWAV.FORMAT_16_BITS else 1) / (2 if w.stereo else 1)
	p.stream = s
	p.volume_db = -80.0
	p.unit_size = 8.0
	p.max_db = 3.0
	add_child(p)
	return p


func _process(delta: float) -> void:
	if car == null:
		return
	var on := car.driven
	if on and not _running:
		_running = true
		_start_t = -0.75                               # door, then the starter cranks before the engine catches
		_play(_door, "res://assets/audio/vehicle/door_close.ogg", -4.0, 1.0)
		_play(_oneshot, "res://assets/audio/vehicle/engine_start_up.ogg", -2.0, 0.85)
		for p in _eng:
			p.play(randf() * 0.3)
		_road.play()
		_squeal.play()
	elif not on and _running:
		_running = false
		_play(_oneshot, "res://assets/audio/vehicle/engine_turning_off.ogg", -4.0, 0.85)
		_play(_door, "res://assets/audio/vehicle/door_open.ogg", -4.0, 1.0)
		for p in _eng:
			p.stop()
		_road.stop()
		_squeal.stop()
	if not _running:
		return
	_start_t += delta
	var rpm := car.rpm
	var fire := rpm / 30.0
	var load := car.engine_load
	# weights: closeness of each loop's natural frequency to the current firing frequency
	var ws: Array[float] = []
	var total := 0.0
	for i in F0.size():
		var d: float = absf(log(fire / float(F0[i])))
		var w := exp(-pow(d / 0.16, 2.0))
		if i >= 3:
			w *= lerpf(0.6, 1.3, load)               # harsher loops under load
		ws.append(w)
		total += w
	var start_fade := clampf(_start_t / 0.8, 0.0, 1.0)  # engine start (after the starter)
	# automatic gearbox: a short torque cut / dip at every shift, handbrake ratchet click
	if car.gear != _last_gear:
		if car.gear > 0 and _last_gear > 0:
			_shift_dip = 0.18
		_last_gear = car.gear
	_shift_dip = maxf(0.0, _shift_dip - delta)
	if car.handbrake and not _hb:
		_play(_door, "res://assets/audio/vehicle/parking_brake.ogg", -6.0, 1.0)
	_hb = car.handbrake
	var level := lerpf(-9.0, -1.0, load) + 4.0 * clampf((rpm - 800.0) / 3600.0, 0.0, 1.0)
	for i in F0.size():
		var p := _eng[i]
		var w: float = ws[i] / maxf(total, 1e-4)
		p.pitch_scale = clampf(fire / float(F0[i]), 0.5, 2.2)
		p.volume_db = (linear_to_db(maxf(w, 1e-4)) + level) if w > 0.01 else -80.0
		p.volume_db += linear_to_db(maxf(start_fade, 1e-3)) - (5.0 if _shift_dip > 0.0 else 0.0)
		p.stream_paused = w <= 0.01                   # inaudible layers cost nothing
	# tyres
	var spd := car.speed_kmh
	var slip := car.slip_amount * clampf(spd / 15.0, 0.0, 1.0)
	var abs_squeal := 0.35 if car.brake > 0.8 and spd > 20.0 else 0.0
	var sq := maxf(slip, abs_squeal)
	_squeal.volume_db = linear_to_db(maxf(sq, 1e-4)) - 3.0 if sq > 0.05 else -80.0
	_squeal.pitch_scale = 0.9 + 0.2 * sq
	_road.volume_db = linear_to_db(maxf(clampf(spd / 110.0, 0.0, 1.0), 1e-4)) - 6.0 if spd > 2.0 else -80.0
	_road.pitch_scale = 0.75 + spd / 260.0
	# suspension knock
	_bump_cd = maxf(0.0, _bump_cd - delta)
	if _bump_cd <= 0.0:
		for w in car.wheels:
			if float(w["offset_vel"]) > 1.1 and w["contact"]:
				_play(_bump, "res://assets/audio/vehicle/bump_%d.ogg" % (1 + randi() % 2), -6.0 + minf(float(w["offset_vel"]) - 1.1, 2.0) * 4.0, 0.8)
				_bump_cd = 0.25
				break


func _on_hit(_health: float) -> void:
	var dv := car.last_impact
	if dv > 7.0:
		_play(_oneshot, "res://assets/audio/vehicle/crash_heavy.ogg", 3.0, 1.0)
		if dv > 9.0:
			var g := AudioStreamPlayer3D.new()
			add_child(g)
			_play(g, "res://assets/audio/vehicle/glass_hit.ogg", -2.0, 1.0)
			g.finished.connect(g.queue_free)
	else:
		_play(_oneshot, "res://assets/audio/vehicle/hit_metal_%d.ogg" % (1 + randi() % 2), lerpf(-10.0, 0.0, clampf((dv - 1.6) / 5.0, 0.0, 1.0)), randf_range(0.85, 1.0))


func _play(p: AudioStreamPlayer3D, path: String, db: float, pitch: float) -> void:
	p.stream = load(path)
	p.volume_db = db
	p.pitch_scale = pitch
	p.play()
