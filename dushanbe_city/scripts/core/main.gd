extends Node3D
## Main game scene: lighting rig, city, player, UI.

const PLAYER_SCENE := "res://scenes/player/player.tscn"
const TOUCH_SCENE := "res://scenes/ui/touch_controls.tscn"

var env_rig: EnvironmentRig
var world: CityWorld
var open_world: OpenWorld
var _top_hud: TopHud
var player: Node3D


var _load_ui: CanvasLayer
var _load_bar: ProgressBar
var _load_lbl: Label


func _ready() -> void:
	PlayerInput.load_settings()
	# loading screen first (it stays until the world round the hero is really ready), build on the next frames
	_make_loading()
	if not Engine.is_editor_hint() and DisplayServer.get_name() != "headless":
		await get_tree().process_frame
		await get_tree().process_frame
	if OS.get_cmdline_user_args().has("loadshots"):
		await RenderingServer.frame_post_draw
		_shot("screen")
	if Settings.needs_benchmark():
		AutoGraphics.quick_pick()             # no camera tour through the city: the device's preset at once
	_build()
	await _wait_ready()
	if _load_ui:
		_load_ui.queue_free()
		_load_ui = null
	if Engine.has_meta(&"preloaded"):
		Engine.remove_meta(&"preloaded")
	print("GAME_READY %d ms" % Time.get_ticks_msec())
	if OS.get_cmdline_user_args().has("loadshots"):     # captures: the first frames of the game
		for k in 3:
			await get_tree().process_frame
		_shot("first_frame")
		await get_tree().create_timer(3.0).timeout
		_shot("after_3s")
		get_tree().quit()


func _shot(n: String) -> void:
	var out := "user://"
	for a in OS.get_cmdline_user_args():
		if a.begins_with("out="):
			out = a.substr(4)
	get_viewport().get_texture().get_image().save_png(out.path_join("load_%s.png" % n))


func _make_loading() -> void:
	_load_ui = CanvasLayer.new()
	_load_ui.layer = 90
	var bg := ColorRect.new()
	bg.color = Color(0.05, 0.06, 0.08)
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	_load_ui.add_child(bg)
	if ResourceLoader.exists("res://assets/ui/menu_main_blur.jpg"):
		var pic := TextureRect.new()
		pic.texture = load("res://assets/ui/menu_main_blur.jpg")
		pic.set_anchors_preset(Control.PRESET_FULL_RECT)
		pic.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		pic.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_COVERED
		pic.modulate = Color(0.55, 0.55, 0.6)
		_load_ui.add_child(pic)
	var box := VBoxContainer.new()
	box.anchor_left = 0.5
	box.anchor_right = 0.5
	box.anchor_top = 0.5
	box.anchor_bottom = 0.5
	box.offset_left = -310
	box.offset_right = 310
	box.offset_top = -80
	box.add_theme_constant_override("separation", 18)
	_load_ui.add_child(box)
	var font: Font = load("res://assets/fonts/game_font.tres")
	var title := Label.new()
	title.text = "DUSHANBE CITY"
	title.add_theme_font_override("font", font)
	title.add_theme_font_size_override("font_size", 56)
	title.add_theme_color_override("font_color", Color(1.0, 0.85, 0.35))
	title.add_theme_color_override("font_outline_color", Color.BLACK)
	title.add_theme_constant_override("outline_size", 10)
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	box.add_child(title)
	_load_bar = ProgressBar.new()
	_load_bar.custom_minimum_size = Vector2(620, 26)
	_load_bar.show_percentage = false
	var bgs := StyleBoxFlat.new()
	bgs.bg_color = Color(0, 0, 0, 0.55)
	bgs.set_corner_radius_all(13)
	var fgs := StyleBoxFlat.new()
	fgs.bg_color = Color(0.95, 0.72, 0.15)
	fgs.set_corner_radius_all(13)
	_load_bar.add_theme_stylebox_override("background", bgs)
	_load_bar.add_theme_stylebox_override("fill", fgs)
	box.add_child(_load_bar)
	_load_lbl = Label.new()
	_load_lbl.add_theme_font_override("font", font)
	_load_lbl.add_theme_font_size_override("font_size", 26)
	_load_lbl.add_theme_color_override("font_outline_color", Color.BLACK)
	_load_lbl.add_theme_constant_override("outline_size", 6)
	_load_lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	box.add_child(_load_lbl)
	add_child(_load_ui)
	_set_load(0.15, "Загрузка города…")


func _set_load(f: float, t: String) -> void:
	if _load_bar:
		if _load_lbl.text != t:
			print("LOAD %d ms %.0f%% %s" % [Time.get_ticks_msec(), f * 100.0, t])
		_load_bar.value = maxf(_load_bar.value, f * 100.0)
		_load_lbl.text = t


## the loading screen stays until the ground, the trees round the hero and the car are in place, then a
## few frames more behind it (shaders compiled, animations started) - the game opens ready to play
func _wait_ready() -> void:
	var t0 := Time.get_ticks_msec()
	var timeout := 120000 if DisplayServer.get_name() != "headless" else 20000
	while Time.get_ticks_msec() - t0 < timeout:
		await get_tree().process_frame
		if not is_inside_tree():
			return
		var steps := 0
		var msg := "Загрузка города…"
		var pp := player.global_position if player and is_instance_valid(player) else Vector3.INF
		if open_world == null or pp == Vector3.INF or open_world.is_ready_at(pp):
			steps += 1
		else:
			msg = "Земля и дороги…"
		if OpenWorld.instance == null or not OpenWorld.instance._veg.is_empty():
			steps += 1
		elif steps == 1:
			msg = "Деревья и растения…"
		if car != null or not ResourceLoader.exists(PLAYER_SCENE):
			steps += 1
		elif steps == 2:
			msg = "Машина в гараже…"
		_set_load(0.15 + 0.6 * steps / 3.0, msg)
		if steps == 3:
			break
	# rendered frames behind the screen: the materials / shaders in view get compiled, animations start
	var n := 40 if DisplayServer.get_name() != "headless" else 2
	var tw := Time.get_ticks_msec()
	for k in n:
		_set_load(0.75 + 0.25 * k / float(n), "Почти готово…")
		await get_tree().process_frame
		if Time.get_ticks_msec() - tw > 4000:
			break


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
	FerrisRide.place_in(self)
	var grass := GrassField.new()
	grass.name = "Grass"
	grass.city = world.city
	add_child(grass)
	var sp: Array = world.city.get("spawn", [0, 0.15, 0, 0])
	# the hero's home: the game starts at its door, the Prado waits in its garage
	if CityWorld.instance:
		home = HeroHome.new()
		home.name = "HeroHome"
		add_child(home)
		var hp := home.spawn_point()
		open_world.preload_at(hp)                 # ground + collision there before the hero stands on it
		open_world.preload_at(home.garage_point())
		sp = [hp.x, hp.y, hp.z, home.spawn_yaw()]
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
	var top_layer := CanvasLayer.new()
	top_layer.name = "TopHudLayer"
	top_layer.layer = 16
	var top := TopHud.new()
	top.name = "TopHud"
	top_layer.add_child(top)
	add_child(top_layer)
	_top_hud = top
	if OS.get_cmdline_user_args().has("menu"):
		menu.call_deferred("set", "_open_on_start", true)
	if OS.get_cmdline_user_args().has("diag"):
		Settings.show_diagnostics = true
	await get_tree().process_frame
	if not is_inside_tree():
		return
	for c in find_children("*", "Camera3D", true, false):
		(c as Camera3D).far = 9500.0


const CAR_SPAWN := Vector3(-49.0, 0.0, -12.0)    ## (no home) parked on the avenue's northbound lane
var car: VehiclePrado
var home: HeroHome
var car_session: CarSession


func _spawn_car(touch: CanvasLayer) -> void:
	car = (load("res://scenes/vehicles/prado.tscn") as PackedScene).instantiate()
	car.name = "Prado"
	car.add_to_group(&"primary_vehicle")
	add_child(car)
	await get_tree().physics_frame
	if home:
		# in the hero's garage, nose to the door: on the floor (place() would land on the roof)
		car.place(home.garage_point(), home.garage_yaw())
		var gp := car.global_position
		gp.y = home.floor_y() + 0.02 - float(car.get("_ground_y"))
		car.global_position = gp
		car.reset_physics_interpolation()
	else:
		car.place(CAR_SPAWN, 0.0)
	car_session = CarSession.new()
	car_session.name = "CarSession"
	car_session.player = player
	var life := PlayerLife.new()
	life.name = "PlayerLife"
	life.session = car_session
	add_child(life)
	if CityWorld.instance:
		var shop := GunShop.new()
		shop.name = "GunShop"
		add_child(shop)
		for br in ["", "mb", "bmw"]:              # general + the Mercedes and BMW showrooms
			var dealer := CarDealer.new()
			dealer.name = "CarDealer" if br == "" else "CarDealer_" + br
			dealer.brand = br
			dealer.main = self
			add_child(dealer)
	var trunks := CarTrunks.new()
	trunks.name = "CarTrunks"
	trunks.main = self
	trunks.session = car_session
	add_child(trunks)
	var amid := AmidStores.new()
	amid.name = "AmidStores"
	amid.session = car_session
	add_child(amid)
	var svc := AutoService.new()
	svc.name = "AutoService"
	svc.session = car_session
	add_child(svc)
	var wash := CarWash.new()
	wash.name = "CarWash"
	wash.session = car_session
	add_child(wash)
	var combat := PlayerCombat.new()
	combat.name = "PlayerCombat"
	combat.player = player
	add_child(combat)
	if _top_hud:
		_top_hud.session = car_session
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
var w123: VehicleCar                ## 0.25: the owner's car pack (dealership)
var e30: VehicleCar
var e30m: VehicleCar
var r12: VehicleCar
var gls: VehicleCar
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
	# 0.25: taxi shifts in any own car
	var taxi := TaxiJob.new()
	taxi.name = "TaxiJob"
	taxi.session = car_session
	taxi.laklak = laklak
	taxi.wd = laklak.wd
	add_child(taxi)
	# 0.25: houses / apartments / garages for sale
	var realty := Realty.new()
	realty.name = "Realty"
	realty.session = car_session
	realty.laklak = laklak
	add_child(realty)
	# 0.25: police station and the park with the arch (reference photos)
	var photo := PhotoPlaces.new()
	photo.name = "PhotoPlaces"
	add_child(photo)
	# GTA pass: working traffic lights (2-phase cycle per junction), traffic stops at red
	var signals := TrafficSignals.new()
	signals.name = "TrafficSignals"
	add_child(signals)
	# 0.25: traffic and pedestrians near the camera (off in tests unless asked)
	var life := CityLife.new()
	life.name = "CityLife"
	life.session = car_session
	life.enabled = not Wallet.no_save or OS.get_cmdline_user_args().has("life")
	add_child(life)
	# fuel for every vehicle: filling stations + delivery when the tank runs dry
	var nav := RoadNav.new()
	nav.name = "RoadNav"
	add_child(nav)
	# GTA pass: wanted stars and police chases
	var police := Police.new()
	police.name = "Police"
	police.session = car_session
	police.nav = nav
	add_child(police)
	# armed people on foot: police officers out of their cars, the gangs in their districts
	var cmb := Combatants.new()
	cmb.name = "Combatants"
	cmb.session = car_session
	cmb.police = police
	add_child(cmb)
	# city ambience + car radio (own synthesized sounds)
	var caud := CityAudio.new()
	caud.name = "CityAudio"
	caud.session = car_session
	add_child(caud)
	# GTA-style missions (markers «M» in the centre)
	var mis := Missions.new()
	mis.name = "Missions"
	mis.session = car_session
	mis.laklak = laklak
	add_child(mis)
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
		var dealer: CarDealer = get_node_or_null("CarDealer")
		if dealer and dealer.in_city:
			var k := 0 if spec[0] == "camry" else 1
			open_world.preload_at(dealer.delivery_point(k))
			c.place(dealer.delivery_point(k), dealer.delivery_yaw())     # for sale on the dealership's lot
		else:
			c.place(spec[1], 0.0)
		car_session.add_vehicle(c)
		if spec[0] == "camry":
			camry = c
		else:
			lexus = c
	# 0.25: the owner's car pack, for sale on the dealership's lot (slots 3..6)
	var pack_names := {"w123": "W123", "e30": "E30", "e30m": "E30M", "r12": "R12", "gls": "GLS"}
	var slot := 3
	for key in ["w123", "e30", "e30m", "r12", "gls"]:
		var pc := VehicleCar.new()
		pc.configure(key)
		pc.name = pack_names[key]
		pc.collision_layer = 1
		pc.collision_mask = 1
		add_child(pc)
		await get_tree().physics_frame
		var dlr: CarDealer = CarDealer.for_car(get_tree(), String(pc.name)) if get_node_or_null("CarDealer") else null
		if dlr and dlr.in_city:
			var ls := dlr.lot_slot(String(pc.name))
			open_world.preload_at(dlr.delivery_point(ls))
			pc.place(dlr.delivery_point(ls), dlr.delivery_yaw())
		else:
			pc.place(Vector3(-52.0, 0.0, -102.0 - slot * 7.0), 0.0)
		car_session.add_vehicle(pc)
		set(key, pc)
		slot += 1
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
	_restore_fuel()
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
	laklak.toast("Вы дома. Ваш Land Cruiser Prado — в гараже.\nАвтосалон и склад LakLak (%.1f км) — на КАРТЕ → НАВИГАТОР" % d)
	laklak._toast_t = 9.0


# ------------------------------------------------------------------------------------------ saving
## everything is kept between sessions: money / weapons / ammo / paints / cars (Wallet) and the
## litres in every vehicle's tank, written whenever the game goes to the background or quits
func _notification(what: int) -> void:
	if what in [NOTIFICATION_WM_CLOSE_REQUEST, NOTIFICATION_APPLICATION_PAUSED, NOTIFICATION_APPLICATION_FOCUS_OUT, NOTIFICATION_WM_GO_BACK_REQUEST]:
		save_all()


func save_all() -> void:
	for v in get_tree().get_nodes_in_group(&"vehicle"):
		if v is VehiclePrado:
			Wallet.fuel[String(v.name)] = snappedf((v as VehiclePrado).fuel_l, 0.1)
	Wallet.save_state()


func _restore_fuel() -> void:
	for v in get_tree().get_nodes_in_group(&"vehicle"):
		if v is VehiclePrado and Wallet.fuel.has(String(v.name)):
			(v as VehiclePrado).fuel_l = clampf(float(Wallet.fuel[String(v.name)]), 0.0, (v as VehiclePrado).tank_l)
