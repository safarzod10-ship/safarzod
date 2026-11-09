extends Node3D
## Main game scene: lighting rig, city, player, UI.

const PLAYER_SCENE := "res://scenes/player/player.tscn"
const TOUCH_SCENE := "res://scenes/ui/touch_controls.tscn"

var env_rig: EnvironmentRig
var world: CityWorld
var open_world: OpenWorld
var player: Node3D


func _ready() -> void:
	PlayerInput.load_settings()
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
	open_world = OpenWorld.new()
	open_world.name = "OpenWorld"
	add_child(open_world)
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
		var touch: CanvasLayer = null
		if ResourceLoader.exists(TOUCH_SCENE):
			touch = (load(TOUCH_SCENE) as PackedScene).instantiate()
			add_child(touch)
			if OS.get_cmdline_user_args().has("touchui"):     # captures/testing on desktop
				touch.call("set_shown", true)
		_spawn_car(touch if ResourceLoader.exists(TOUCH_SCENE) else null)
	else:
		var cam := Camera3D.new()
		cam.position = Vector3(sp[0], 1.7, sp[2])
		add_child(cam)
	var menu: CanvasLayer = preload("res://scripts/ui/game_menu.gd").new()
	add_child(menu)
	if WorldData.get_instance().ok:
		var wm := WorldMapScreen.new()
		wm.name = "WorldMap"
		add_child(wm)
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


const CAR_SPAWN := Vector3(-49.0, 0.0, -12.0)    ## parked on the avenue's northbound lane, by the spawn
var car: VehiclePrado
var car_session: CarSession


func _spawn_car(touch: CanvasLayer) -> void:
	car = (load("res://scenes/vehicles/prado.tscn") as PackedScene).instantiate()
	car.name = "Prado"
	car.add_to_group(&"primary_vehicle")
	add_child(car)
	await get_tree().physics_frame
	car.place(CAR_SPAWN, 0.0)
	car_session = CarSession.new()
	car_session.name = "CarSession"
	car_session.player = player
	car_session.car = car
	car_session.walk_touch = touch
	add_child(car_session)
	_spawn_extra_vehicles()
	if OS.get_cmdline_user_args().has("drive"):
		await get_tree().physics_frame
		player.teleport(car.driver_door_point(1.0), 0.0)
		car_session.enter()


var van: VehicleVan
var boats: Array[VehicleBoat] = []
var laklak: LakLakJob
var camry: VehicleCar
var lexus: VehicleCar
var bus: VehicleCar
var bus_job: BusJob
var fuel: FuelService


## the LakLak delivery van at its depot, motorboats on the sea by the peninsula and on the lakes,
## and the LakLak delivery job
func _spawn_extra_vehicles() -> void:
	laklak = LakLakJob.new()
	laklak.name = "LakLakJob"
	laklak.session = car_session
	add_child(laklak)
	if not laklak.depot.is_empty():
		van = VehicleVan.new()
		van.name = "LakLakVan"
		van.collision_layer = 1
		van.collision_mask = 1
		add_child(van)
		await get_tree().physics_frame
		var xf := laklak.van_spawn()
		open_world.preload_at(xf.origin)
		van.place(xf.origin, xf.basis.get_euler().y)
		laklak.van = van
		car_session.add_vehicle(van)
	# fuel for every vehicle: filling stations + delivery when the tank runs dry
	var nav := RoadNav.new()
	nav.name = "RoadNav"
	add_child(nav)
	fuel = FuelService.new()
	fuel.name = "FuelService"
	fuel.session = car_session
	add_child(fuel)
	# Toyota Camry + Lexus RX parked on the avenue right by the start point, then the Prado (same physics)
	for spec in [["camry", Vector3(-45.6, 0.0, -102.0)], ["lexus", Vector3(-45.6, 0.0, -116.0)]]:
		var c := VehicleCar.new()
		c.configure(spec[0])
		c.name = "Camry" if spec[0] == "camry" else "Lexus"
		c.collision_layer = 1
		c.collision_mask = 1
		add_child(c)
		await get_tree().physics_frame
		c.place(spec[1], 0.0)
		car_session.add_vehicle(c)
		if spec[0] == "camry":
			camry = c
		else:
			lexus = c
	# city bus route №1: the job, the stops, the bus at the terminus
	bus_job = BusJob.new()
	bus_job.name = "BusJob"
	bus_job.session = car_session
	add_child(bus_job)
	if not bus_job.stops.is_empty():
		var shelter: Mesh = (open_world._props.get("bus_stop_shelter", {}) as Dictionary).get("lod0")
		bus_job.build_stops(shelter)
		bus = VehicleCar.new()
		bus.configure("bus")
		bus.name = "Bus"
		bus.collision_layer = 1
		bus.collision_mask = 1
		add_child(bus)
		await get_tree().physics_frame
		var bxf := bus_job.bus_spawn()
		open_world.preload_at(bxf.origin)
		bus.place(bxf.origin, bxf.basis.get_euler().y)
		bus_job.bus = bus
		car_session.add_vehicle(bus)
	_start_hint()
	var sp: Array = world.city.get("spawn", [0, 0.15, 0, 0])
	for spot in boat_spots(Vector3(sp[0], 0, sp[2])):
		var b := VehicleBoat.new()
		b.name = "Boat%d" % boats.size()
		b.collision_layer = 1
		b.collision_mask = 1
		add_child(b)
		await get_tree().physics_frame
		b.place(spot[0], spot[1])
		boats.append(b)
		car_session.add_vehicle(b)


## where the boats wait: the sea nearest to the spawn (>= 1.6 m deep, close to the shore), the lake
## Iskandar by its western road, the Komsomol lake in the city
func boat_spots(near: Vector3) -> Array:
	var out: Array = []
	var found := false
	for r in range(60, 1800, 20):
		for k in 48:
			var a := TAU * k / 48.0
			var p := near + Vector3(cos(a), 0, sin(a)) * r
			var g := world.terrain_height(p.x, p.z)
			if g > PlayerWater.SEA_LEVEL - 3.0 or is_nan(VehicleBoat.water_level_at(p.x, p.z)):
				continue
			# bow towards deeper water (down the seabed slope), 120 m of open water ahead
			var gx := world.terrain_height(p.x + 4.0, p.z) - world.terrain_height(p.x - 4.0, p.z)
			var gz := world.terrain_height(p.x, p.z + 4.0) - world.terrain_height(p.x, p.z - 4.0)
			var dir := Vector3(-gx, 0, -gz).normalized() if Vector2(gx, gz).length() > 0.001 else Vector3(cos(a), 0, sin(a))
			var clear := true
			for s2 in range(10, 130, 10):
				var q := p + dir * s2
				if world.terrain_height(q.x, q.z) > PlayerWater.SEA_LEVEL - 2.0:
					clear = false
					break
			if not clear:
				continue
			out.append([p, atan2(-dir.x, -dir.z)])
			found = true
			break
		if found:
			break
	var wd := WorldData.get_instance()
	if wd.ok:
		for lk in wd.lakes:
			var c := Vector3(lk["c"][0], 0, lk["c"][1])
			var p2 := c if lk["id"] == "komsomol" else c + Vector3(-float(lk["r"][0]) * 0.72, 0, 0)
			if not is_nan(VehicleBoat.water_level_at(p2.x, p2.z)):
				out.append([p2, PI * 0.5])
	return out



## where everything is (once at the start): the cars by the road, the jobs on the map
func _start_hint() -> void:
	if laklak == null or OS.get_cmdline_user_args().has("nohint"):
		return
	var d := 0.0
	if not laklak.depot.is_empty() and player:
		d = (player as Node3D).global_position.distance_to(laklak.depot_point(Vector3.ZERO)) / 1000.0
	laklak.toast("Рядом на дороге: Toyota Camry, Lexus RX, Land Cruiser.\nСклад LakLak — %.1f км на север. КАРТА → НАВИГАТОР" % d)
	laklak._toast_t = 9.0
