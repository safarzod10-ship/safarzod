class_name CombatAudio
extends RefCounted
## One-shot positional sounds (assets/audio/combat/*.mp3).

static var _cache: Dictionary = {}


static func stream(sound: String) -> AudioStream:
	if not _cache.has(sound):
		var path := "res://assets/audio/combat/%s.mp3" % sound
		_cache[sound] = load(path) if ResourceLoader.exists(path) else null
	return _cache[sound]


static func play(parent: Node, sound: String, pos: Vector3, volume_db := 0.0, pitch := 1.0, max_dist := 120.0) -> AudioStreamPlayer3D:
	var s := stream(sound)
	if s == null or parent == null or not parent.is_inside_tree():
		return null
	var p := AudioStreamPlayer3D.new()
	p.stream = s
	p.volume_db = volume_db
	p.pitch_scale = pitch * randf_range(0.95, 1.05)
	p.max_distance = max_dist
	p.unit_size = 14.0
	p.attenuation_filter_cutoff_hz = 20500.0
	parent.add_child(p)
	p.global_position = pos
	p.finished.connect(p.queue_free)
	p.play()
	return p
