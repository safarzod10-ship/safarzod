class_name Weapons
extends RefCounted
## The player's weapons: fists (always), baseball bat, pistol, assault rifle (AK). Owned weapons and
## ammo are bought in the gun shop (GunShop) for somoni and saved with the wallet (Wallet).

const LIST := ["fist", "bat", "pistol", "ak47"]
const DATA := {
	"fist":   {"name": "Кулаки",  "icon": "fist",   "price": 0,    "damage": 12.0, "range": 1.6,   "rate": 0.45, "melee": true},
	"bat":    {"name": "Бита",    "icon": "bat",    "price": 250,  "damage": 30.0, "range": 2.1,   "rate": 0.7,  "melee": true},
	"pistol": {"name": "Пистолет", "icon": "pistol", "price": 1200, "damage": 34.0, "range": 120.0, "rate": 0.28, "melee": false,
		"mag": 12, "ammo_price": 60, "ammo_pack": 24},
	"ak47":   {"name": "Автомат", "icon": "ak47",   "price": 3500, "damage": 26.0, "range": 220.0, "rate": 0.1,  "melee": false,
		"mag": 30, "ammo_price": 150, "ammo_pack": 60, "auto": true},
}

static var owned := {"fist": true}
static var ammo := {"pistol": 0, "ak47": 0}
static var current := "fist"


static func icon_of(id: String) -> String:
	return String(DATA.get(id, DATA["fist"])["icon"])


static func uses_ammo(id: String) -> bool:
	return not bool(DATA.get(id, DATA["fist"])["melee"])


static func ammo_of(id: String) -> int:
	return int(ammo.get(id, 0))


static func has(id: String) -> bool:
	return bool(owned.get(id, false))


static func select(id: String) -> bool:
	if not has(id):
		return false
	current = id
	Wallet.save_state()
	return true


## buy a weapon (with one pack of ammo for guns); false when not enough money / already owned
static func buy(id: String) -> bool:
	if has(id) or not DATA.has(id):
		return false
	var price := int(DATA[id]["price"])
	if Wallet.money < price:
		return false
	Wallet.money -= price
	owned[id] = true
	if uses_ammo(id):
		ammo[id] = ammo_of(id) + int(DATA[id]["ammo_pack"])
	Wallet.save_state()
	return true


static func buy_ammo(id: String) -> bool:
	if not has(id) or not uses_ammo(id):
		return false
	var price := int(DATA[id]["ammo_price"])
	if Wallet.money < price:
		return false
	Wallet.money -= price
	ammo[id] = ammo_of(id) + int(DATA[id]["ammo_pack"])
	Wallet.save_state()
	return true


static func to_dict() -> Dictionary:
	return {"owned": owned.keys(), "ammo": ammo, "current": current}


static func from_dict(d: Dictionary) -> void:
	owned = {"fist": true}
	for k in d.get("owned", []):
		owned[String(k)] = true
	var a: Dictionary = d.get("ammo", {})
	for k in a:
		ammo[String(k)] = int(a[k])
	current = String(d.get("current", "fist"))
	if not has(current):
		current = "fist"
