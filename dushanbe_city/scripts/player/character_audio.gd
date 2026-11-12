class_name CharacterAudio
extends Node3D
## Footsteps of the walking character (real CC0 recordings, assets/audio/steps/LICENSES.txt).
## A step sounds when a foot actually touches the ground: the foot bone's height above the body's
## floor level falls below a threshold while it is moving down (both feet tracked from the animated
## skeleton, i.e. phase-exact for walk / run / stops / turning steps). Never while standing still.
## Surface under the foot -> sample set:
##   heightmap (roads, country roads, beach, fields)  -> CityWorld.surface_at: asphalt / grass /
##                                                       sand / earth / rock
##   raised city blocks (GroundCollision)            -> grass on lawns (city.json lawn rects), else tiles
##   anything else (promenade, stairs, porches)      -> hard
## In shallow water PlayerWater plays water steps instead; landing plays a heavier step.

const SETS := ["asphalt", "tiles", "grass", "sand", "earth", "hard"]
var player: CharacterBody3D
var skeleton: Skeleton3D
var enabled := true
var surface := "asphalt"           ## last detected (tests / debug)
var steps_played := 0
var _streams := {}
var _players: Array[AudioStreamPlayer3D] = []
var _next := 0
var _foot := {}                    ## bone -> {"prev": y, "down": bool}
var _lawns: Array = []
var _bones := []


func setup(p: CharacterBody3D, sk: Skeleton3D, city: Dictionary) -> void:
	player = p
	skeleton = sk
	for s in SETS:
		var arr: Array[AudioStream] = []
		for i in 6:
			var path := "res://assets/audio/steps/%s_%d.ogg" % [s, i + 1]
			if ResourceLoader.exists(path):
				arr.append(load(path))
		_streams[s] = arr
	for i in 3:
		var a := AudioStreamPlayer3D.new()
		a.unit_size = 4.0
		a.max_distance = 40.0
		a.bus = &"Master"
		add_child(a)
		_players.append(a)
	_lawns = city.get("lawns", [])
	for b in ["LeftFoot", "RightFoot"]:
		var bi := sk.find_bone(b)
		if bi >= 0:
			_bones.append(bi)
			_foot[bi] = {"prev": 0.0, "down": false, "armed": true, "low": 0.0}


func surface_at(pos: Vector3, collider: Object) -> String:
	if collider == null:
		return "asphalt"
	var n := String((collider as Node).name) if collider is Node else ""
	if (n == "WorldTerrain" or n == "WorldRoad") and WorldData.get_instance().ok:
		var c2: int = WorldData.get_instance().surface_at(pos.x, pos.z)
		if n == "WorldRoad" and c2 != CityWorld.Surface.EARTH:
			return "asphalt"
		return {CityWorld.Surface.GRASS: "grass", CityWorld.Surface.SAND: "sand", CityWorld.Surface.ROCK: "hard",
			CityWorld.Surface.EARTH: "earth", CityWorld.Surface.ASPHALT: "asphalt", CityWorld.Surface.SNOW: "sand"}.get(c2, "grass")
	if n == "TerrainBody" and CityWorld.instance:
		var c: int = CityWorld.instance.surface_at(pos.x, pos.z)
		return {CityWorld.Surface.GRASS: "grass", CityWorld.Surface.SAND: "sand", CityWorld.Surface.ROCK: "hard",
			CityWorld.Surface.EARTH: "earth", CityWorld.Surface.ASPHALT: "asphalt"}.get(c, "asphalt")
	if n == "GroundCollision":
		for l in _lawns:
			var r: Array = l[1]
			if pos.x >= float(r[0]) and pos.x <= float(r[2]) and pos.z >= float(r[1]) and pos.z <= float(r[3]):
				return "grass"
		return "tiles"
	return "hard"


## call every physics frame while walking on the ground (not swimming / wading)
func update(on_floor: bool, speed: float, floor_collider: Object, wading: bool) -> void:
	if not enabled or skeleton == null:
		return
	var base_y := player.global_position.y
	for bi in _bones:
		var st: Dictionary = _foot[bi]
		var p := skeleton.global_transform * skeleton.get_bone_global_pose(bi).origin
		var h := p.y - base_y
		var prev: float = st["prev"]
		# touchdown = the foot stops coming down (local minimum of its height) while low: heel strike
		var was_down: bool = st["down"]
		var going_down := h < prev - 0.0008
		if bool(st["armed"]) and was_down and not going_down and h < 0.22 and on_floor and speed > 0.15 and not wading:
			_play_step(p, floor_collider, clampf(speed / 4.5, 0.0, 1.0))
			st["armed"] = false
			st["low"] = h
		if not bool(st["armed"]) and h > float(st.get("low", h)) + 0.05:
			st["armed"] = true                  # foot lifted again: the next touchdown is a new step
		st["down"] = going_down
		st["prev"] = h


func land(strength: float, floor_collider: Object) -> void:
	_play_step(player.global_position, floor_collider, clampf(0.6 + strength, 0.6, 1.4))


func _play_step(pos: Vector3, collider: Object, loud: float) -> void:
	surface = surface_at(pos, collider)
	var arr: Array = _streams.get(surface, [])
	if arr.is_empty():
		return
	var a := _players[_next % _players.size()]
	_next += 1
	a.global_position = pos
	a.stream = arr[randi() % arr.size()]
	a.volume_db = lerpf(-16.0, -4.0, clampf(loud, 0.0, 1.0)) + (2.0 if loud > 1.0 else 0.0)
	a.pitch_scale = randf_range(0.93, 1.07)
	a.play()
	steps_played += 1
