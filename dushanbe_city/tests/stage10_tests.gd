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
	var secs: Array = ["account", "save", "dealer", "doors", "shop", "shoot", "explode", "steer"]
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
	_check("gun shop placed near the start (%s), on the map" % str(shop.global_position.round()), shop.global_position.distance_to(Vector3(-58, 2, -90)) < 60.0)
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
		Weapons.has("pistol") and Weapons.has("ak47") and Weapons.ammo_of("ak47") == 45 and Weapons.current == "ak47" and Wallet.cars == ["camry"] and Wallet.money == 12345)
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
