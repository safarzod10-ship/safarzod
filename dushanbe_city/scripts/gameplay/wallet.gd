class_name Wallet
extends RefCounted
## The player's money (somoni, «смн») and the LakLak job record, saved in user://save_game.json.

const PATH := "user://save_game.json"
static var money := 500                 ## a new game starts with 500 smn (fuel, until the first job)
static var laklak_hired := false
static var bus_hired := false
static var deliveries := 0
static var earned_total := 0
static var _loaded := false
static var no_save := false          ## tests: never touch the real save file


static func load_state() -> void:
	if _loaded:
		return
	_loaded = true
	if no_save or not FileAccess.file_exists(PATH):
		return
	var d: Variant = JSON.parse_string(FileAccess.get_file_as_string(PATH))
	if d is Dictionary:
		money = int(d.get("money", 500))
		laklak_hired = bool(d.get("laklak_hired", false))
		bus_hired = bool(d.get("bus_hired", false))
		deliveries = int(d.get("deliveries", 0))
		earned_total = int(d.get("earned_total", 0))


static func save_state() -> void:
	if no_save:
		return
	var f := FileAccess.open(PATH, FileAccess.WRITE)
	if f:
		f.store_string(JSON.stringify({"money": money, "laklak_hired": laklak_hired, "bus_hired": bus_hired, "deliveries": deliveries, "earned_total": earned_total}))


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
