extends Node
## 0.17 tests: gun shop + weapons (buy, ammo, select), shooting hurts vehicles, burning + explosion
## (wreck, blast kills the player close by, respawn at a hospital, fee), melee, steering wheel sign.
##   godot --headless --fixed-fps 60 --path . res://tests/stage10_tests.tscn -> docs/reports/stage10_tests.txt

var main: Node
var s: CarSession
var lines: Array[String] = []
var ok_all := true
var n := 0


func _ready() -> void:
	Wallet.no_save = true
	main = (load("res://scenes/main/main.tscn") as PackedScene).instantiate()
	add_child(main)
	var t0 := Time.get_ticks_msec()
	while (main.get("bus") == null or main.get_node_or_null("PlayerCombat") == null) and Time.get_ticks_msec() - t0 < 90000:
		await get_tree().physics_frame
	await _frames(30)
	s = main.get("car_session")
	var secs: Array = ["home", "account", "save", "dealer", "doors", "shop", "shoot", "explode", "steer", "fp", "taxi", "amid"]
	if not OS.get_cmdline_user_args().is_empty():
		secs = Array(OS.get_cmdline_user_args())
	for sec in secs:
		await call("_t_" + sec)
	print("STAGE10_TESTS ", "ALL PASS" if ok_all else "SOME FAILED", "  (%d checks)" % n)
	var f := FileAccess.open("res://docs/reports/stage10_tests.txt", FileAccess.WRITE)
	if f:
		f.store_string("\n".join(lines) + "\n")
	get_tree().quit(0 if ok_all else 1)


func _check(msg: String, ok: bool) -> void:
	n += 1
	var l := ("PASS " if ok else "FAIL ") + "%2d. " % n + msg
	print(l)
	lines.append(l)
	ok_all = ok_all and ok


func _frames(k: int) -> void:
	for i in k:
		await get_tree().physics_frame


func _sec(t: float) -> void:
	await _frames(int(t * 60))


func _t_shop() -> void:
	var shop: GunShop = main.get_node("GunShop")
	var hh: HeroHome = main.get_node_or_null("HeroHome")
	var dh := shop.global_position.distance_to(hh.door_point()) if hh else INF
	_check("gun shop across the avenue from the hero's home (%s, %.0f m), on the map" % [str(shop.global_position.round()), dh], dh < 300.0)
	s.player.teleport(shop.door_point(), PI * 0.5)
	await _sec(0.5)
	var it: Variant = s.player.get("interaction")
	var lbl: String = (it as CharacterInteraction).label() if it else ""
	_check("at the door: «%s»" % lbl, lbl == "МАГАЗИН ОРУЖИЯ")
	Wallet.money = 1000
	_check("not enough money for the AK (3 500): refused", not Weapons.buy("ak47") and Wallet.money == 1000)
	Wallet.money = 6000
	var ok := Weapons.buy("pistol") and Weapons.buy("ak47") and Weapons.buy("bat")
	_check("bought bat + pistol + AK: money %s (6000 − 4950 = 1050), ammo %d / %d" % [Wallet.fmt(Wallet.money), Weapons.ammo_of("pistol"), Weapons.ammo_of("ak47")],
		ok and Wallet.money == 1050 and Weapons.ammo_of("pistol") == 24 and Weapons.ammo_of("ak47") == 60)
	_check("buy ammo: +60 AK rounds for 150", Weapons.buy_ammo("ak47") and Weapons.ammo_of("ak47") == 120 and Wallet.money == 900)
	_check("select: unowned weapons can't be taken", Weapons.select("pistol") and Weapons.current == "pistol")


func _t_shoot() -> void:
	var camry: VehiclePrado = main.get("camry")
	var tp := camry.global_position + camry.global_transform.basis.x * 8.0
	var dir := (camry.global_position - tp)
	var yaw := atan2(-dir.x, -dir.z)
	s.player.teleport(tp, yaw)
	s.player.cam_yaw = yaw
	s.player.cam_pitch = deg_to_rad(-4.0)
	await _sec(1.0)
	var h0 := camry.health
	var a0 := Weapons.ammo_of("pistol")
	for k in 5:
		PlayerInput.queue_fire()
		await _sec(0.4)
	_check("pistol: 5 shots fired (ammo %d -> %d)" % [a0, Weapons.ammo_of("pistol")], a0 - Weapons.ammo_of("pistol") == 5)
	_check("bullets hit the Camry: condition %.0f -> %.0f %%" % [h0, camry.health], camry.health < h0 - 10.0)
	Weapons.select("ak47")
	a0 = Weapons.ammo_of("ak47")
	PlayerInput.fire_held = true
	await _sec(1.0)
	PlayerInput.fire_held = false
	var used := a0 - Weapons.ammo_of("ak47")
	_check("AK automatic: %d rounds in 1 s (≈10)" % used, used >= 7 and used <= 11)
	Weapons.ammo["pistol"] = 0
	Weapons.select("pistol")
	PlayerInput.queue_fire()
	await _sec(0.3)
	_check("empty pistol: no shot, ammo stays 0", Weapons.ammo_of("pistol") == 0)


func _t_explode() -> void:
	var camry: VehiclePrado = main.get("camry")
	var vf: VehicleFire = camry.get_node("Fire")
	camry.health = 25.0
	await _sec(0.5)
	_check("condition 25 %%: the engine smokes", vf._smoke != null)
	camry.health = 10.0
	await _sec(0.5)
	_check("condition 10 %%: on fire", vf._fire != null and vf._burn >= 0.0)
	# the player right next to it
	s.player.teleport(camry.global_position + camry.global_transform.basis.x * 2.5, 0.0)
	var m0 := Wallet.money
	await _sec(7.0)
	_check("it explodes after burning: wreck %s, can't get in %s" % [vf.wrecked, not s.can_enter(camry)], vf.wrecked and camry.wrecked and not s.can_enter(camry))
	_check("the blast killed the player standing 2.5 m away (dead %s, health %.0f)" % [PlayerLife.dead, PlayerLife.health], PlayerLife.dead)
	await _sec(5.0)
	_check("respawn: alive at the hospital / start, health %.0f, fee %s" % [PlayerLife.health, Wallet.fmt(m0 - Wallet.money)], not PlayerLife.dead and PlayerLife.health == 100.0)
	vf.restore()
	await _sec(1.0)
	_check("wreck restored at its parking place (condition %.0f %%)" % camry.health, not camry.wrecked and camry.health == 100.0)


func _t_steer() -> void:
	var car: VehiclePrado = main.get("car")
	if s.driving:
		s.exit()
		await _frames(5)
	s.player.teleport(car.driver_door_point(0.7), 0.0)
	await _frames(20)
	s._select(car)
	s.enter()
	await _frames(10)
	var sw: Node3D = car.get("_steering_wheel")
	if sw == null:
		_check("steering wheel node found", false)
		return
	for k in 3:                             # the cabin view
		if s.cam.mode == 1:
			break
		s.cam.cycle()
		await _frames(2)
	VehicleInput.scripted = {"steer": 0.0, "brake": 1.0}
	await _sec(1.0)
	var b0 := car.global_basis.inverse() * sw.global_basis
	# the top point of the rim at rest, fixed in the wheel's own frame
	var rim_local := sw.global_transform.affine_inverse() * (sw.global_position + car.global_basis.y * 0.19)
	var cam := get_viewport().get_camera_3d()
	var c0 := cam.unproject_position(sw.global_position)
	VehicleInput.scripted = {"steer": 1.0, "brake": 1.0}
	await _sec(1.2)
	var b1 := car.global_basis.inverse() * sw.global_basis
	var top_scr := cam.unproject_position(sw.global_transform * rim_local)
	var hub_scr := cam.unproject_position(sw.global_position)
	VehicleInput.scripted = null
	var q := (b1 * b0.inverse()).get_rotation_quaternion()
	_check("cabin view, steer right: the top of the rim moves RIGHT on screen (dx %.1f px)" % (top_scr.x - hub_scr.x), top_scr.x - hub_scr.x > 2.0)
	print("   wheel rotation axis (car space) ", q.get_axis().snapped(Vector3.ONE * 0.01), " angle ", rad_to_deg(q.get_angle()))
	VehicleInput.scripted = {"throttle": 0.6, "steer": 1.0}
	await _sec(2.0)
	print("   steer +1 while driving: yaw rate ", car.angular_velocity.y, " (negative = turning right)")
	VehicleInput.scripted = {"brake": 1.0}
	await _sec(1.5)
	VehicleInput.scripted = null
	var spin := q.get_axis().dot(Vector3.FORWARD) * q.get_angle()
	_check("steer right -> the steering wheel turns clockwise for the driver (%.0f deg)" % rad_to_deg(spin), spin > deg_to_rad(30.0))
	s.exit()


func _t_home() -> void:
	var hh: HeroHome = main.get_node_or_null("HeroHome")
	_check("the hero's home on the lot by the avenue: %s" % (str(hh.door_point().round()) if hh else "none"), hh != null)
	if hh == null:
		return
	var d := Vector2(s.player.global_position.x - hh.spawn_point().x, s.player.global_position.z - hh.spawn_point().z).length()
	_check("the game starts at the home's door (%.1f m from it)" % d, d < 3.0)
	var car: VehiclePrado = main.get("car")
	var gp := hh.garage_point()
	var dg := Vector2(car.global_position.x - gp.x, car.global_position.z - gp.z).length()
	_check("the Prado stands in the home's garage (%.1f m), it's the hero's own (no purchase)" % dg, dg < 1.5 and Wallet.cars.has("car"))
	# drive it out of the garage onto the drive
	s.player.teleport(car.driver_door_point(0.7), car.rotation.y)
	await _frames(20)
	s._select(car)
	s.enter()
	await _frames(10)
	VehicleInput.scripted = {"throttle": 0.5}
	await _sec(4.0)
	VehicleInput.scripted = {"brake": 1.0}
	await _sec(1.5)
	VehicleInput.scripted = null
	var out := Vector2(car.global_position.x - gp.x, car.global_position.z - gp.z).length()
	_check("drives out of the garage through the gate (%.0f m out, condition %.0f %%)" % [out, car.health], out > 12.0 and car.health > 90.0)
	s.exit()
	await _frames(30)
	var m0 := Wallet.money
	Account.no_save = true
	var r: Variant = Account.redeem("TAJDUSH")
	_check("promo TAJDUSH: +%s" % Wallet.fmt(Wallet.money - m0), r is int and int(r) == 200000)
	Wallet.money = m0


func _t_account() -> void:
	Account.no_save = true
	Account.ensure()
	_check("account ID given automatically: %s (8 digits)" % Account.id, Account.id.length() == 8 and Account.id.is_valid_int())
	# a code as tools/admin/make_code.py makes it (same HMAC)
	var nonce := "A1B2C3"
	var code := "DX-5000-%s-%s" % [nonce, Account.signature(Account.id, 5000, nonce)]
	var m0 := Wallet.money
	var r: Variant = Account.redeem(code)
	_check("top-up code for this ID: +5 000 смн (money %s -> %s)" % [Wallet.fmt(m0), Wallet.fmt(Wallet.money)], r is int and int(r) == 5000 and Wallet.money == m0 + 5000)
	var r2: Variant = Account.redeem(code)
	_check("the same code again: refused (%s)" % str(r2), r2 is String and Wallet.money == m0 + 5000)
	var other := "DX-5000-%s-%s" % [nonce, Account.signature("99999999", 5000, nonce)]
	_check("a code made for another ID: refused (%s)" % str(Account.redeem(other)), Wallet.money == m0 + 5000)
	_check("a forged amount: refused (%s)" % str(Account.redeem("DX-90000-%s-%s" % [nonce, Account.signature(Account.id, 5000, nonce)])), Wallet.money == m0 + 5000)
	Wallet.money = m0


func _t_save() -> void:
	# 0.18: bought weapons / ammo / cars survive a restart (the save was written but never read back)
	var keep := [Wallet.no_save, Wallet.money, Weapons.owned.duplicate(), Weapons.ammo.duplicate(), Wallet.cars.duplicate()]
	Wallet.path = "user://test_save_game.json"
	Wallet.no_save = false
	Weapons.owned = {"fist": true, "pistol": true, "ak47": true}
	Weapons.ammo = {"pistol": 17, "ak47": 45}
	Weapons.current = "ak47"
	Wallet.cars = ["camry"]
	Wallet.money = 12345
	Wallet.save_state()
	# "restart": wipe the state in memory, load the file
	Weapons.owned = {"fist": true}
	Weapons.ammo = {"pistol": 0, "ak47": 0}
	Weapons.current = "fist"
	Wallet.cars = []
	Wallet.money = 0
	Wallet._loaded = false
	Wallet.load_state()
	_check("restart: weapons %s, ammo %d / %d, selected %s, cars %s, money %s" % [str(Weapons.owned.keys()), Weapons.ammo_of("pistol"), Weapons.ammo_of("ak47"), Weapons.current, str(Wallet.cars), Wallet.fmt(Wallet.money)],
		Weapons.has("pistol") and Weapons.has("ak47") and Weapons.ammo_of("ak47") == 45 and Weapons.current == "ak47" and Wallet.cars.has("camry") and Wallet.cars.has("car") and Wallet.money == 12345)
	DirAccess.remove_absolute(ProjectSettings.globalize_path(Wallet.path))
	Wallet.path = Wallet.PATH
	Wallet.no_save = keep[0]
	Wallet.money = keep[1]
	Weapons.owned = keep[2]
	Weapons.ammo = keep[3]
	Wallet.cars = keep[4]


func _t_dealer() -> void:
	var dealer: CarDealer = main.get_node_or_null("CarDealer")
	_check("dealership built near the start: %s" % (str(dealer.global_position.round()) if dealer else "none"), dealer != null)
	if dealer == null:
		return
	CarDealer.strict = true
	var camry: VehiclePrado = main.get("camry")
	Wallet.cars = []
	s.player.teleport(camry.driver_door_point(0.7), 0.0)
	await _sec(0.6)
	var it: Variant = s.player.get("interaction")
	var lbl: String = (it as CharacterInteraction).label() if it else ""
	_check("a car that is not yours: can't get in, door says «%s»" % lbl, not s.can_enter(camry) and lbl.begins_with("ПРОДАЁТСЯ"))
	s.player.teleport(dealer.door_point(), PI * 0.5)
	await _sec(0.5)
	it = s.player.get("interaction")
	lbl = (it as CharacterInteraction).label() if it else ""
	_check("at the showroom door: «%s»" % lbl, lbl == "АВТОСАЛОН")
	Wallet.money = 40000
	var e1 := dealer.buy("Camry")
	_check("Camry costs 50 000: with 40 000 refused (%s)" % e1, e1 != "" and Wallet.money == 40000 and not Wallet.cars.has("camry"))
	Wallet.money = 60000
	var e2 := dealer.buy("Camry")
	await _sec(1.0)
	_check("bought the Camry: money 60 000 -> %s, delivered to the lot (%.0f m from the showroom)" % [Wallet.fmt(Wallet.money), camry.global_position.distance_to(dealer.global_position)],
		e2 == "" and Wallet.money == 10000 and Wallet.cars.has("camry") and camry.global_position.distance_to(dealer.global_position) < 30.0)
	s.player.teleport(camry.driver_door_point(0.7), 0.0)
	await _sec(0.6)
	_check("now it's yours: can get in", s.can_enter(camry))
	_check("prices: Camry %s, Lexus %s, Prado %s" % [Wallet.fmt(CarDealer.CARS["Camry"][2]), Wallet.fmt(CarDealer.CARS["Lexus"][2]), Wallet.fmt(CarDealer.CARS["Prado"][2])],
		CarDealer.CARS["Camry"][2] == 50000 and CarDealer.CARS["Lexus"][2] == 100000 and CarDealer.CARS["Prado"][2] == 120000)
	CarDealer.strict = false


func _t_doors() -> void:
	# Camry / Lexus: the driver's door is cut out of the body and swings on its hinge like the Prado's
	for key in ["camry", "lexus"]:
		var c: VehiclePrado = main.get(key)
		var hinge: Node3D = c.model.get_node_or_null("door_lf_dummy")
		var parts := hinge.get_child_count() if hinge else 0
		if hinge == null:
			_check("%s: door part found" % key, false)
			continue
		var r0 := hinge.transform.basis
		await c.swing_door("door_lf_dummy", true)
		var ang := rad_to_deg((r0.inverse() * hinge.transform.basis).get_euler().y)
		await c.swing_door("door_lf_dummy", false)
		var cab := c.model.find_child("Cabin", true, false)
		_check("%s: door (%d mesh parts) opens %.0f deg and closes; real cabin fitted %s" % [key, parts, absf(ang), cab != null], parts > 0 and absf(ang) > 50.0 and cab != null)


func _t_fp() -> void:
	# 0.24: first-person view on foot - the camera sits at the hero's eyes, the body follows the look
	CharacterCamera.first_person = true
	s.player.set_camera_angles(1.0, 0.0)
	await _sec(1.0)
	var cam: Camera3D = s.player.get_viewport().get_camera_3d()
	var head_d := cam.global_position.distance_to(s.player.global_position + Vector3(0, 1.65, 0))
	var face_d := absf(wrapf(float(s.player.get("facing")) - 1.0, -PI, PI))
	_check("first person: camera at the eyes (%.2f m from head height), body turned with the look (%.2f rad)" % [head_d, face_d], head_d < 0.4 and face_d < 0.15)
	CharacterCamera.first_person = false
	await _sec(1.5)
	var back_d := cam.global_position.distance_to(s.player.global_position)
	_check("third person again: camera behind the hero (%.1f m)" % back_d, back_d > 2.0)


func _t_taxi() -> void:
	# 0.25: taxi shift in an own car - client at a kerb, ride to the address, fare 20 + 15/km
	var taxi: TaxiJob = main.get_node_or_null("TaxiJob")
	_check("taxi job present", taxi != null)
	if taxi == null:
		return
	var car: VehiclePrado = main.get("car")
	if s.driving:
		s.exit()
		await _frames(5)
	s.player.teleport(car.driver_door_point(0.7), 0.0)
	await _frames(20)
	s._select(car)
	s.enter()
	await _sec(0.5)
	taxi.toggle()
	await _frames(5)
	_check("shift on: client waiting at %s (%.0f m away), figure at the kerb" % [str(taxi.pickup.round()), car.global_position.distance_to(taxi.pickup)],
		taxi.on and taxi.stage == "pickup" and taxi.pickup != Vector3.INF and taxi._client != null)
	var ow: OpenWorld = main.get("open_world")
	ow.preload_at(taxi.pickup)
	car.place(taxi.pickup + Vector3(0, 0.6, 0), 0.0)
	await _sec(2.0)
	_check("stopped by the client: boarded, going to «%s» (%.1f km, fare %s)" % [taxi.addr, taxi.km, Wallet.fmt(taxi.fare())],
		taxi.stage == "ride" and taxi.dest != Vector3.INF and taxi.fare() == 20 + int(round(taxi.km * 15.0)))
	var m0 := Wallet.money
	var fare := taxi.fare()
	ow.preload_at(taxi.dest)
	car.place(taxi.dest + Vector3(0, 0.6, 0), 0.0)
	await _sec(2.0)
	_check("arrived: paid %s (fare %s), next client offered" % [Wallet.fmt(Wallet.money - m0), Wallet.fmt(fare)],
		Wallet.money - m0 >= fare and taxi.rides == 1 and taxi.stage == "pickup")
	s.exit()
	await _sec(1.0)
	_check("got out: shift over, no client left", not taxi.on and taxi._client == null)


func _t_amid() -> void:
	# 0.23: the whole shopping chain - basket, shelves, till, bag in the hand, the car's boot, home
	# kitchen (unpack, cook plov), eat; hunger / thirst
	var am: AmidStores = main.get_node_or_null("AmidStores")
	_check("AMID supermarkets in the city: %d" % (am.stores.size() if am else 0), am != null and am.stores.size() >= 8)
	if am == null or am.stores.is_empty():
		return
	Food.hand = ""
	Food.basket = {}
	Food.bag = {}
	Food.fridge = {}
	Food.trunks = {}
	var st: Dictionary = am.stores[0]
	var ow: OpenWorld = main.get("open_world")
	ow.preload_at(am.door_point(st))
	ow.hold = am.door_point(st)
	s.player.teleport(am.door_point(st) + Vector3(0, 0.5, 0), 0.0)
	await _sec(2.0)
	_check("interior built when the player is near", st["node"] != null)
	var xf0: Transform3D = st["xf"]
	# sliding doors: shut with nobody near, open for the hero at the entrance
	s.player.teleport(xf0 * Vector3(18, 0.3, 40), 0.0)
	await _sec(2.5)
	var shut := am.door_open(st)
	s.player.teleport(am.door_point(st) + Vector3(0, 0.5, 0), 0.0)
	await _sec(1.5)
	_check("entrance doors: shut when nobody is near (%.2f), open for the hero (%.2f)" % [shut, am.door_open(st)], shut < 0.01 and am.door_open(st) > 0.99)
	var it: CharacterInteraction = s.player.get("interaction")
	# 1. the basket stand inside the entrance
	await s.player.walk_to(am.basket_point(st), null, 12.0)
	await _sec(0.4)
	_check("at the basket stand: «%s»" % it.label(), it.label() == "ВЗЯТЬ КОРЗИНУ")
	it.trigger()
	await _sec(0.2)
	_check("basket in the hand", Food.hand == "basket")
	# 2. shelves: rice, oil; meat from the fridge; carrot, onion from the stands; water; non
	var xf: Transform3D = st["xf"]
	var picks := [[am.shelf_point(st, 2), "rice"], [am.shelf_point(st, 3), "oil"],
		[xf * Vector3(-30.0, 0.3, -AmidStores.HZ + 2.7), "meat"],
		[xf * Vector3(-36.0 + 3 * 4.4, 0.3, 15.4), "carrot"],
		[xf * Vector3(-36.0 + 4 * 4.4, 0.3, 15.4), "onion"],
		[am.shelf_point(st, 9), "water"], [am.shelf_point(st, 0), "non"]]
	var got: PackedStringArray = []
	for pk in picks:
		s.player.teleport(pk[0] + Vector3(0, 0.2, 0), 0.0)        # (a player walks around the shelves)
		await _sec(0.5)
		if it.label().begins_with("ВЗЯТЬ · " + Food.name_of(pk[1])):
			it.trigger()
			await _sec(0.1)
			got.append(pk[1])
		else:
			print("   pick %s: label «%s», %.1f m" % [pk[1], it.label(), s.player.global_position.distance_to(pk[0])])
	_check("walked the aisles, took %s: basket %s" % [str(got), Food.listing(Food.basket)], got.size() == picks.size() and Food.total(Food.basket) == picks.size())
	# 3. the till
	Wallet.money = 500
	var price := Food.price_of(Food.basket)
	s.player.teleport(am.till_point(st, 0) + Vector3(0, 0.2, 0), 0.0)
	await _sec(0.5)
	_check("at the till: «%s»" % it.label(), it.label().begins_with("КАССА · ОПЛАТИТЬ"))
	it.trigger()
	await _sec(0.2)
	_check("paid %s: bag in the hand (%s), money %s" % [Wallet.fmt(price), Food.listing(Food.bag), Wallet.fmt(Wallet.money)],
		Food.hand == "bag" and Food.total(Food.bag) == got.size() and Wallet.money == 500 - price)
	# 4. drink straight from the bag
	Food.hunger = 30.0
	Food.thirst = 20.0
	var m1 := Food.consume("water", Food.bag)
	_check("drank the water from the bag: thirst 20 -> %d (%s)" % [int(Food.thirst), m1], Food.thirst >= 59.0)
	# 5. the boot of the Prado
	var car: VehiclePrado = main.get("car")
	car.place(am.door_point(st) + xf.basis * Vector3(10, 0, 12), 0.0)
	await _sec(1.0)
	var rear := car.global_transform * Vector3(0, -0.2, car.body_size.z * 0.5 + 0.75)
	s.player.teleport(rear, 0.0)
	await _sec(0.6)
	_check("at the Prado's boot: «%s»" % it.label(), it.label() == "ПАКЕТ В БАГАЖНИК")
	it.trigger()
	await _sec(0.2)
	var shown := car.find_children("TrunkBag*", "", true, false).size()
	_check("the bag is in the boot (hands free, %d shown in the car)" % shown, Food.hand == "" and Food.trunk_count("Prado") == 1 and shown == 1)
	ow.hold = Vector3.INF
	# 6. take it out, home: unpack, cook plov, eat
	s.player.teleport(rear, 0.0)
	await _sec(0.4)
	it.trigger()
	await _sec(0.2)
	_check("took the bag out of the boot", Food.hand == "bag" and Food.trunk_count("Prado") == 0)
	var hh: HeroHome = main.get_node("HeroHome")
	ow.preload_at(hh.door_point())
	s.player.teleport(hh.spawn_point(), 0.0)
	await _sec(0.2)
	s.player.global_position = hh.door_point() + Vector3.UP * 0.05
	await _sec(0.8)
	_check("at home: «%s»" % it.label(), it.label() == "ДОМ · РАЗОБРАТЬ ПАКЕТ")
	it.trigger()
	await _sec(0.3)
	_check("unpacked into the fridge: %s" % Food.listing(Food.fridge), Food.hand == "" and Food.fridge.has("rice") and Food.fridge.has("meat"))
	_check("plov can be cooked (rice, meat, carrot, onion, oil)", Food.can_cook("plov"))
	Food.cook("plov")
	_check("cooked plov ×4: fridge %s" % Food.listing(Food.fridge), int(Food.fridge.get("plov", 0)) == 4 and not Food.fridge.has("rice"))
	PlayerLife.health = 50.0
	Food.consume("plov", Food.fridge)
	_check("ate plov: hunger 30 -> %d, health 50 -> %d" % [int(Food.hunger), int(PlayerLife.health)], Food.hunger >= 99.0 and PlayerLife.health >= 84.0)
	# 7. needs fall with time; empty needs drain health
	Food.hunger = 0.0
	Food.thirst = 50.0
	var h0 := PlayerLife.health
	Food.tick(10.0)
	_check("starving: health falls (%.1f -> %.1f), no regeneration" % [h0, PlayerLife.health], PlayerLife.health < h0 and not Food.ok_to_heal())
	Food.hunger = 100.0
	Food.thirst = 100.0
	PlayerLife.health = 100.0
	if hh.is_kitchen_open():
		hh._panel.visible = false
	Wallet.money = 500
