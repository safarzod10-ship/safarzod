class_name Wallet
extends RefCounted
## The player's money (somoni, «смн») and the LakLak job record, saved in user://save_game.json.

const PATH := "user://save_game.json"
static var path := PATH               ## tests point it to a scratch file
static var money := 500                 ## a new game starts with 500 smn (fuel, until the first job)
static var laklak_hired := false
static var bus_hired := false
static var deliveries := 0
static var earned_total := 0
static var paints := {}               ## vehicle node name -> paint colour (html), garage repaints
static var cars := ["car"]            ## cars the player owns (main properties: car = Prado, camry, lexus): the hero's
                                      ## Prado in his garage from the start, the others bought at the dealership
static var fuel := {}                 ## vehicle node name -> litres in the tank
static var _loaded := false
static var no_save := false          ## tests: never touch the real save file


static func load_state() -> void:
	if _loaded:
		return
	_loaded = true
	if no_save or not FileAccess.file_exists(path):
		return
	var d: Variant = JSON.parse_string(FileAccess.get_file_as_string(path))
	if d is Dictionary:
		money = int(d.get("money", 500))
		laklak_hired = bool(d.get("laklak_hired", false))
		bus_hired = bool(d.get("bus_hired", false))
		deliveries = int(d.get("deliveries", 0))
		earned_total = int(d.get("earned_total", 0))
		if d.get("weapons") is Dictionary:
			Weapons.from_dict(d["weapons"])
		if d.get("paints") is Dictionary:
			paints = d["paints"]
		cars = ["car"]                        # the hero's own Prado, always
		if d.get("cars") is Array:
			for c in d["cars"]:
				if not cars.has(String(c)):
					cars.append(String(c))
		if d.get("fuel") is Dictionary:
			fuel = d["fuel"]


static func save_state() -> void:
	if no_save:
		return
	var f := FileAccess.open(path, FileAccess.WRITE)
	if f:
		f.store_string(JSON.stringify({"money": money, "laklak_hired": laklak_hired, "bus_hired": bus_hired, "deliveries": deliveries, "earned_total": earned_total, "weapons": Weapons.to_dict(), "paints": paints, "cars": cars, "fuel": fuel}))


static func earn(amount: int) -> void:
	money += amount
	earned_total += amount
	save_state()


static func fmt(v: int) -> String:
	var s := str(absi(v))
	var out := ""
	while s.length() > 3:
		out = " " + s.substr(s.length() - 3) + out
		s = s.substr(0, s.length() - 3)
	return ("-" if v < 0 else "") + s + out + " смн"
