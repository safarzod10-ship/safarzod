class_name CarTrunks
extends Node
## The boot of the hero's own cars (Prado, Camry, Lexus): at the rear of a parked car on foot
## «ПАКЕТ В БАГАЖНИК» (a carrier bag in the hand goes in) or «ВЗЯТЬ ПАКЕТ ИЗ БАГАЖНИКА». The bags in
## a boot are shown in it (Food.trunks, saved by the car's name).

const CARS := ["car", "camry", "lexus"]     ## main properties

var main: Node
var session: CarSession
var _vis := {}                              ## car name -> [Node3D bag meshes]


func _ready() -> void:
	await get_tree().create_timer(3.0, false).timeout
	for key in CARS:
		var v: Variant = main.get(key) if main else null
		if v is VehiclePrado:
			_add_spot(v as VehiclePrado)


func _rear(v: VehiclePrado, back := 0.75, up := 0.0) -> Vector3:
	return v.global_transform * Vector3(0, -0.2 + up, v.body_size.z * 0.5 + back)


func _add_spot(v: VehiclePrado) -> void:
	var s := AmidStores.Spot.new()
	s.label_fn = func() -> String:
		if Food.hand == "bag":
			return "ПАКЕТ В БАГАЖНИК"
		return "ВЗЯТЬ ПАКЕТ ИЗ БАГАЖНИКА (%d)" % Food.trunk_count(String(v.name))
	s.can_fn = func() -> bool:
		if session == null or session.driving or not CarDealer.owns(v) or v.wrecked:
			return false
		s.point = _rear(v)
		return Food.hand == "bag" or (Food.hand == "" and Food.trunk_count(String(v.name)) > 0)
	s.act_fn = func() -> void:
		if Food.hand == "bag":
			Food.to_trunk(String(v.name))
		else:
			Food.from_trunk(String(v.name))
		_sync(v)
	s.point = _rear(v)
	add_child(s)
	_sync(v)


## the bags standing in the boot (just inside the tailgate)
func _sync(v: VehiclePrado) -> void:
	var nm := String(v.name)
	for n in _vis.get(nm, []):
		(n as Node).queue_free()
	var arr: Array = []
	for k in Food.trunk_count(nm):
		var b := AmidStores.bag_mesh()
		b.name = "TrunkBag%d" % k
		v.add_child(b)
		b.position = Vector3(-0.35 + (k % 3) * 0.35, 0.25 + (k / 3) * 0.3, v.body_size.z * 0.5 - 0.65)
		arr.append(b)
	_vis[nm] = arr
