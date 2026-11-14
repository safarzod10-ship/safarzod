extends Node
## Звуки синтезируются кодом (без файлов): шлепок карты, поимка, победа.

var _players: Array[AudioStreamPlayer] = []
var _cache := {}
var _next := 0


func _ready() -> void:
	for i in 6:
		var p := AudioStreamPlayer.new()
		add_child(p)
		_players.append(p)


func _play(key: String, gen: Callable, vol_db: float = -6.0) -> void:
	if not Profile.settings.sound:
		return
	if not _cache.has(key):
		_cache[key] = gen.call()
	var p := _players[_next]
	_next = (_next + 1) % _players.size()
	p.stream = _cache[key]
	p.volume_db = vol_db
	p.pitch_scale = randf_range(0.94, 1.06)
	p.play()


func _wav(samples: PackedFloat32Array) -> AudioStreamWAV:
	var w := AudioStreamWAV.new()
	w.format = AudioStreamWAV.FORMAT_16_BITS
	w.mix_rate = 22050
	var data := PackedByteArray()
	data.resize(samples.size() * 2)
	for i in samples.size():
		data.encode_s16(i * 2, int(clampf(samples[i], -1.0, 1.0) * 32000.0))
	w.data = data
	return w


func _gen_snap() -> AudioStreamWAV:
	var n := int(22050 * 0.07)
	var s := PackedFloat32Array()
	s.resize(n)
	var lp := 0.0
	for i in n:
		var t := float(i) / n
		lp = lerpf(lp, randf_range(-1, 1), 0.35)
		s[i] = lp * pow(1.0 - t, 3.0) * 0.9
	return _wav(s)


func _gen_tone(freqs: Array, dur: float, decay: float) -> AudioStreamWAV:
	var n := int(22050 * dur)
	var s := PackedFloat32Array()
	s.resize(n)
	for i in n:
		var t := float(i) / 22050.0
		var seg := mini(int(t / (dur / freqs.size())), freqs.size() - 1)
		var f: float = freqs[seg]
		var env := exp(-decay * fmod(t, dur / freqs.size())) * minf(1.0, t * 200.0)
		s[i] = sin(TAU * f * t) * env * 0.35 + sin(TAU * f * 2.0 * t) * env * 0.08
	return _wav(s)


func card() -> void:
	_play("snap", _gen_snap, -4.0)


func tick() -> void:
	_play("tick", func() -> AudioStreamWAV: return _gen_tone([1400.0], 0.03, 120.0), -16.0)


func caught() -> void:
	_play("caught", func() -> AudioStreamWAV: return _gen_tone([520.0, 390.0, 260.0], 0.36, 9.0), -4.0)


func win() -> void:
	_play("win", func() -> AudioStreamWAV: return _gen_tone([523.0, 659.0, 784.0, 1047.0], 0.6, 6.0), -6.0)


func lose() -> void:
	_play("lose", func() -> AudioStreamWAV: return _gen_tone([392.0, 330.0, 262.0, 196.0], 0.8, 4.0), -6.0)
