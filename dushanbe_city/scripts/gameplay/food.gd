class_name Food
extends RefCounted
## Food bought at the AMID supermarkets: kept in the bag (saved with the wallet), eaten from the HUD
## button «ЕДА» or at the till; every item restores health (PlayerLife, max 100).

const ITEMS := {
	"non":      {"name": "Нон (лепёшка)",  "price": 5,  "heal": 15.0, "color": Color(0.85, 0.62, 0.32)},
	"water":    {"name": "Вода 0,5 л",     "price": 3,  "heal": 8.0,  "color": Color(0.55, 0.8, 1.0)},
	"juice":    {"name": "Сок",            "price": 9,  "heal": 15.0, "color": Color(1.0, 0.6, 0.1)},
	"sambusa":  {"name": "Самбуса",        "price": 8,  "heal": 25.0, "color": Color(0.92, 0.72, 0.4)},
	"apple":    {"name": "Яблоки",         "price": 6,  "heal": 12.0, "color": Color(0.85, 0.15, 0.12)},
	"choco":    {"name": "Шоколад",        "price": 10, "heal": 18.0, "color": Color(0.4, 0.22, 0.12)},
	"plov":     {"name": "Плов (порция)",  "price": 25, "heal": 50.0, "color": Color(0.95, 0.75, 0.35)},
	"medkit":   {"name": "Аптечка",        "price": 60, "heal": 100.0, "color": Color(0.9, 0.1, 0.1)},
}
const ORDER := ["non", "water", "juice", "sambusa", "apple", "choco", "plov", "medkit"]

static var bag := {}                 ## item id -> count


static func count() -> int:
	var n := 0
	for k in bag:
		n += int(bag[k])
	return n


static func buy(id: String) -> bool:
	if not ITEMS.has(id):
		return false
	var price := int(ITEMS[id]["price"])
	if Wallet.money < price:
		return false
	Wallet.money -= price
	bag[id] = int(bag.get(id, 0)) + 1
	Wallet.save_state()
	return true


## eat one item (a given one, or the one that fits the missing health best); returns the health gained
static func eat(id := "") -> float:
	if PlayerLife.dead:
		return 0.0
	if id == "":
		var missing := 100.0 - PlayerLife.health
		var best := ""
		var score := INF
		for k in bag:
			if int(bag[k]) <= 0:
				continue
			var s := absf(float(ITEMS[k]["heal"]) - missing)
			if s < score:
				score = s
				best = k
		id = best
	if id == "" or int(bag.get(id, 0)) <= 0:
		return 0.0
	bag[id] = int(bag[id]) - 1
	if int(bag[id]) <= 0:
		bag.erase(id)
	var before := PlayerLife.health
	PlayerLife.health = minf(100.0, PlayerLife.health + float(ITEMS[id]["heal"]))
	Wallet.save_state()
	return PlayerLife.health - before


static func to_dict() -> Dictionary:
	return bag.duplicate()


static func from_dict(d: Dictionary) -> void:
	bag = {}
	for k in d:
		if ITEMS.has(String(k)) and int(d[k]) > 0:
			bag[String(k)] = int(d[k])
