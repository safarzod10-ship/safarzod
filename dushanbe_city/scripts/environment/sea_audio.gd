class_name SeaAudio
extends Node3D
## Sea soundscape (real CC0 recordings, assets/audio/sea/LICENSES.txt):
## * SURF - recorded beach waves (6 takes) played one after another with random gaps/overlaps from
##   two 3D players that sit on the shoreline point nearest to the listener (data/terrain/shore_points.json,
##   24 m spacing). Distance attenuation makes it loud on the beach, faint in the streets, silent far inland.
## * COASTAL WIND - looped recording, non-positional, its volume follows the distance to the shore.
## The listener is the active camera.

var _pts := PackedVector2Array()
var _surf: Array[AudioStreamPlayer3D] = []
var _waves: Array[AudioStream] = []
var _wind: AudioStreamPlayer
var _next := 0.5
var _k := 0
var _scan := 0.0
var shore_distance := 1e9          ## listener -> nearest shoreline point (m), for tests / debug


func _ready() -> void:
	var f := "res://data/terrain/shore_points.json"
	if FileAccess.file_exists(f):
		var d: Variant = JSON.parse_string(FileAccess.get_file_as_string(f))
		if d is Dictionary:
			for p in d["points"]:
				_pts.append(Vector2(p[0], p[1]))
	for i in 6:
		var p := "res://assets/audio/sea/surf_%d.ogg" % (i + 1)
		if ResourceLoader.exists(p):
			_waves.append(load(p))
	for i in 2:
		var a := AudioStreamPlayer3D.new()
		a.unit_size = 22.0
		a.max_distance = 420.0
		a.attenuation_model = AudioStreamPlayer3D.ATTENUATION_INVERSE_DISTANCE
		a.volume_db = 2.0
		a.panning_strength = 0.6
		add_child(a)
		_surf.append(a)
	_wind = AudioStreamPlayer.new()
	var w: AudioStream = load("res://assets/audio/sea/coast_wind.ogg") if ResourceLoader.exists("res://assets/audio/sea/coast_wind.ogg") else null
	if w is AudioStreamOggVorbis:
		(w as AudioStreamOggVorbis).loop = true
	_wind.stream = w
	_wind.volume_db = -40.0
	add_child(_wind)
	if w:
		_wind.play()


func _process(delta: float) -> void:
	var cam := get_viewport().get_camera_3d()
	if cam == null or _pts.is_empty():
		return
	var lp := Vector2(cam.global_position.x, cam.global_position.z)
	_scan -= delta
	if _scan <= 0.0:
		_scan = 0.25
		var best := 1e18
		var bp := Vector2.ZERO
		for p in _pts:
			var d := p.distance_squared_to(lp)
			if d < best:
				best = d
				bp = p
		shore_distance = sqrt(best)
		global_position = Vector3(bp.x, -1.2, bp.y)
	# wind: strong on the beach, a breeze in the first streets, gone further inland / up high
	var near := clampf(1.0 - shore_distance / 260.0, 0.0, 1.0)
	_wind.volume_db = lerpf(-38.0, -11.0, near * near)
	_next -= delta
	if _next <= 0.0 and not _waves.is_empty() and shore_distance < 500.0:
		var a := _surf[_k % 2]
		_k += 1
		a.stream = _waves[randi() % _waves.size()]
		a.pitch_scale = randf_range(0.92, 1.06)
		a.play()
		_next = (a.stream.get_length() if a.stream else 3.0) * randf_range(0.55, 0.95) + randf_range(0.2, 1.4)
