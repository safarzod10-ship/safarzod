extends Node3D
## Main game scene: lighting rig, city, player, UI.

const PLAYER_SCENE := "res://scenes/player/player.tscn"
const TOUCH_SCENE := "res://scenes/ui/touch_controls.tscn"

var env_rig: EnvironmentRig
var world: CityWorld
var player: Node3D


func _ready() -> void:
	env_rig = EnvironmentRig.new()
	env_rig.name = "Environment"
	add_child(env_rig)
	world = CityWorld.new()
	world.name = "City"
	add_child(world)
	var grass := GrassField.new()
	grass.name = "Grass"
	grass.city = world.city
	add_child(grass)
	var sp: Array = world.city.get("spawn", [0, 0.15, 0, 0])
	if ResourceLoader.exists(PLAYER_SCENE):
		player = (load(PLAYER_SCENE) as PackedScene).instantiate()
		add_child(player)
		if player.has_method("teleport"):
			player.call("teleport", Vector3(sp[0], sp[1], sp[2]), sp[3])
		if ResourceLoader.exists(TOUCH_SCENE):
			add_child((load(TOUCH_SCENE) as PackedScene).instantiate())
	else:
		var cam := Camera3D.new()
		cam.position = Vector3(sp[0], 1.7, sp[2])
		add_child(cam)
	add_child(preload("res://scripts/ui/game_menu.gd").new())
