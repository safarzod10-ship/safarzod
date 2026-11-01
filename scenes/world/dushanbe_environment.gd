extends Node3D
## Stage-2 environment scene: real-data terrain (SRTM + OSM), mountain backdrop,
## vegetation, sky / day-night / weather, Ismoili Somoni monument at the origin.
## No roads, buildings or NPCs yet (their zones are reserved in world_config.json).

@export var start_hour := 10.5
@export var start_bookmark := "square"

@onready var day_night: DayNightCycle = $EnvironmentRig/DayNightCycle
@onready var weather: WeatherManager = $WeatherManager
@onready var camera: DevCamera = $DevCamera


func _ready() -> void:
	GameManager.set_state(GameManager.State.PLAYING)
	var mount := $Mountains
	var mat := load("res://assets/materials/mountains/mountains.tres") as Material
	for mi: MeshInstance3D in mount.find_children("*", "MeshInstance3D", true, false):
		mi.material_override = mat
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		mi.extra_cull_margin = 0.0
	var cfg := WorldConfig.data()
	var m: Dictionary = cfg.get("monument", {})
	$Monument.position = Vector3(m.get("position", [0, 0, 0])[0], WorldConfig.height_at(0, 0), m.get("position", [0, 0, 0])[2])
	$Monument.rotation_degrees.y = float(m.get("rotation_y_deg", -90.0))
	day_night.paused = false
	day_night.time_scale = 30.0
	day_night.set_time(start_hour)
	camera.go_bookmark(start_bookmark)
	print("DUSHANBE environment: chunks=%d trees=%d shrubs=%d" % [$Terrain.chunks.size(),
		$Vegetation.counts["trees"], $Vegetation.counts["shrubs"]])
