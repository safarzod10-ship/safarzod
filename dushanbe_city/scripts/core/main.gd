extends Node3D
## Main game scene: lighting rig, city, player, UI.

const PLAYER_SCENE := "res://scenes/player/player.tscn"
const TOUCH_SCENE := "res://scenes/ui/touch_controls.tscn"

var env_rig: EnvironmentRig
var world: CityWorld
var player: Node3D


func _ready() -> void:
	# loading screen first, build the city on the next frames
	var ui := CanvasLayer.new()
	ui.layer = 50
	var bg := ColorRect.new()
	bg.color = Color(0.07, 0.08, 0.1)
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	ui.add_child(bg)
	var lbl := Label.new()
	lbl.text = "DUSHANBE\nЗагрузка города…"
	lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	lbl.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	lbl.set_anchors_preset(Control.PRESET_FULL_RECT)
	lbl.add_theme_font_size_override("font_size", 42)
	ui.add_child(lbl)
	add_child(ui)
	if not Engine.is_editor_hint() and DisplayServer.get_name() != "headless":
		await get_tree().process_frame
		await get_tree().process_frame
	_build()
	ui.queue_free()


func _build() -> void:
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
			var touch := (load(TOUCH_SCENE) as PackedScene).instantiate()
			add_child(touch)
			if OS.get_cmdline_user_args().has("touchui"):     # captures/testing on desktop
				touch.call("set_shown", true)
	else:
		var cam := Camera3D.new()
		cam.position = Vector3(sp[0], 1.7, sp[2])
		add_child(cam)
	var menu: CanvasLayer = preload("res://scripts/ui/game_menu.gd").new()
	add_child(menu)
	var map_layer := CanvasLayer.new()
	map_layer.name = "MinimapLayer"
	map_layer.layer = 15
	map_layer.add_child(Minimap.new())
	add_child(map_layer)
	if OS.get_cmdline_user_args().has("menu"):
		menu.call_deferred("set", "_open_on_start", true)
	if OS.get_cmdline_user_args().has("diag"):
		Settings.show_diagnostics = true
	await get_tree().process_frame
	if not is_inside_tree():
		return
	for c in find_children("*", "Camera3D", true, false):
		(c as Camera3D).far = 9500.0
	if Settings.needs_benchmark():
		await get_tree().create_timer(0.5).timeout
		var ag := AutoGraphics.new()
		add_child(ag)
		await ag.run()
		ag.queue_free()
