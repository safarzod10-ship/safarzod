class_name LightPool
extends Node3D
## Night lighting without hundreds of real lights: all lamp points of the city (street lamps,
## entrance lamps, shop signs) are known; a small pool of OmniLight3D is moved to the points
## nearest to the camera. Emissive materials make every lamp glow regardless of the pool.
## Active only when TimeOfDay.night > 0.

var points: PackedVector3Array = []
var kinds: PackedByteArray = []      ## 0 street, 1 entrance, 2 sign
var _pool: Array[OmniLight3D] = []
var _t := 0.0


func _ready() -> void:
	add_to_group(&"light_pool")


func add_point(p: Vector3, kind: int) -> void:
	points.append(p)
	kinds.append(kind)


func _ensure_pool(n: int) -> void:
	while _pool.size() < n:
		var l := OmniLight3D.new()
		l.shadow_enabled = false
		l.omni_attenuation = 1.4
		add_child(l)
		_pool.append(l)
	for i in _pool.size():
		_pool[i].visible = i < n


func _process(delta: float) -> void:
	_t -= delta
	if _t > 0.0:
		return
	_t = 0.4
	var night := 0.0
	for n in get_tree().get_nodes_in_group(&"time_of_day"):
		night = float(n.get("night"))
	var cam := get_viewport().get_camera_3d()
	var n_lights: int = [8, 16, 24][Settings.quality] if night > 0.01 else 0
	_ensure_pool(n_lights)
	if n_lights == 0 or cam == null:
		return
	var c := cam.global_position
	var best: Array = []
	for i in points.size():
		var d := points[i].distance_squared_to(c)
		if d < 90.0 * 90.0:
			best.append([d, i])
	best.sort_custom(func(a: Array, b: Array) -> bool: return a[0] < b[0])
	for k in n_lights:
		var l := _pool[k]
		if k >= best.size():
			l.visible = false
			continue
		var i: int = best[k][1]
		l.visible = true
		l.global_position = points[i]
		match kinds[i]:
			0:
				l.light_color = Color(1.0, 0.82, 0.58); l.light_energy = 2.2 * night; l.omni_range = 16.0
			1:
				l.light_color = Color(1.0, 0.86, 0.66); l.light_energy = 0.9 * night; l.omni_range = 6.0
			_:
				l.light_color = Color(0.95, 0.95, 1.0); l.light_energy = 0.7 * night; l.omni_range = 7.0
