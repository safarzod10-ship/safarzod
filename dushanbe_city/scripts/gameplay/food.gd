class_name Food
extends RefCounted
## Groceries, hunger and thirst (0.23). The logical chain:
##   AMID: take a basket at the entrance -> pick goods off the shelves (they go into the basket) ->
##   pay at a till -> a carrier bag in the hand -> put it into a car's boot -> drive home -> «ДОМ»:
##   unpack into the fridge -> cook (plov, shurbo, tea...) -> eat / drink.
## Ready-to-eat goods (non, water, juice...) can also be eaten / drunk straight from the bag.
## Hunger and thirst (100 = full) fall with time; at 0 the health drains, under 15 it does not heal.
## Everything (bag, boots, fridge, needs) is saved with the wallet.

## shape: how the 3D pack looks on the shelf (bottle, can, box, carton, sack, jar, round, loaf)
const ITEMS := {
	# ready to eat / drink
	"non":      {"name": "Нон",            "price": 5,  "hunger": 22.0, "thirst": 0.0,  "heal": 5.0,  "ready": true,  "shape": "loaf",   "color": Color(0.85, 0.6, 0.3)},
	"sambusa":  {"name": "Самбуса",        "price": 8,  "hunger": 28.0, "thirst": 0.0,  "heal": 8.0,  "ready": true,  "shape": "loaf",   "color": Color(0.93, 0.74, 0.42)},
	"water":    {"name": "Вода",           "price": 3,  "hunger": 0.0,  "thirst": 40.0, "heal": 2.0,  "ready": true,  "shape": "bottle", "color": Color(0.55, 0.82, 1.0)},
	"juice":    {"name": "Сок",            "price": 9,  "hunger": 6.0,  "thirst": 30.0, "heal": 4.0,  "ready": true,  "shape": "carton", "color": Color(1.0, 0.6, 0.1)},
	"cola":     {"name": "Газировка",      "price": 7,  "hunger": 4.0,  "thirst": 28.0, "heal": 0.0,  "ready": true,  "shape": "can",    "color": Color(0.85, 0.08, 0.1)},
	"milk":     {"name": "Молоко",         "price": 8,  "hunger": 10.0, "thirst": 20.0, "heal": 4.0,  "ready": true,  "shape": "carton", "color": Color(0.95, 0.96, 0.98)},
	"choco":    {"name": "Шоколад",        "price": 10, "hunger": 12.0, "thirst": 0.0,  "heal": 6.0,  "ready": true,  "shape": "box",    "color": Color(0.42, 0.23, 0.12)},
	"apple":    {"name": "Яблоки",         "price": 6,  "hunger": 10.0, "thirst": 6.0,  "heal": 4.0,  "ready": true,  "shape": "round",  "color": Color(0.85, 0.14, 0.12)},
	"medkit":   {"name": "Аптечка",        "price": 60, "hunger": 0.0,  "thirst": 0.0,  "heal": 100.0, "ready": true, "shape": "box",    "color": Color(0.95, 0.95, 0.95)},
	# groceries (cooked at home)
	"rice":     {"name": "Рис",            "price": 12, "ready": false, "shape": "sack",   "color": Color(0.95, 0.93, 0.85)},
	"meat":     {"name": "Мясо",           "price": 45, "ready": false, "shape": "box",    "color": Color(0.75, 0.2, 0.2)},
	"carrot":   {"name": "Морковь",        "price": 4,  "ready": false, "shape": "round",  "color": Color(1.0, 0.5, 0.08)},
	"onion":    {"name": "Лук",            "price": 3,  "ready": false, "shape": "round",  "color": Color(0.9, 0.78, 0.5)},
	"potato":   {"name": "Картофель",      "price": 4,  "ready": false, "shape": "round",  "color": Color(0.72, 0.55, 0.32)},
	"oil":      {"name": "Масло",          "price": 15, "ready": false, "shape": "bottle", "color": Color(0.98, 0.85, 0.2)},
	"eggs":     {"name": "Яйца (10)",      "price": 12, "ready": false, "shape": "box",    "color": Color(0.95, 0.9, 0.78)},
	"tea":      {"name": "Чай",            "price": 10, "ready": false, "shape": "box",    "color": Color(0.1, 0.45, 0.2)},
	"tomato":   {"name": "Помидоры",       "price": 6,  "ready": false, "shape": "round",  "color": Color(0.9, 0.15, 0.1)},
	"cucumber": {"name": "Огурцы",         "price": 5,  "ready": false, "shape": "round",  "color": Color(0.25, 0.6, 0.2)},
}

## home cooking: ingredients (1 each) -> dishes (portions) in the fridge
const RECIPES := {
	"plov":   {"name": "Плов",        "needs": ["rice", "meat", "carrot", "onion", "oil"], "makes": 4},
	"shurbo": {"name": "Шурбо",       "needs": ["meat", "potato", "carrot", "onion"],       "makes": 3},
	"fried":  {"name": "Яичница",     "needs": ["eggs", "oil"],                              "makes": 2},
	"salad":  {"name": "Салат",       "needs": ["tomato", "cucumber", "onion"],              "makes": 2},
	"chai":   {"name": "Чай",         "needs": ["tea", "water"],                             "makes": 4},
}
const DISHES := {
	"plov":   {"name": "Плов",    "hunger": 70.0, "thirst": 0.0,  "heal": 35.0},
	"shurbo": {"name": "Шурбо",   "hunger": 50.0, "thirst": 20.0, "heal": 25.0},
	"fried":  {"name": "Яичница", "hunger": 35.0, "thirst": 0.0,  "heal": 12.0},
	"salad":  {"name": "Салат",   "hunger": 18.0, "thirst": 12.0, "heal": 10.0},
	"chai":   {"name": "Чай",     "hunger": 0.0,  "thirst": 45.0, "heal": 6.0},
}

const HUNGER_S := 45.0 * 60.0        ## full -> empty in 45 min
const THIRST_S := 30.0 * 60.0        ## full -> empty in 30 min

static var hunger := 100.0
static var thirst := 100.0
static var hand := ""                ## "", "basket", "bag"
static var basket := {}              ## id -> count (in the basket, not paid)
static var bag := {}                 ## id -> count (in the carrier bag in the hand)
static var trunks := {}              ## car node name -> Array of bags (Dictionary id -> count)
static var fridge := {}              ## id or dish id -> count (home)


static func name_of(id: String) -> String:
	if ITEMS.has(id):
		return String(ITEMS[id]["name"])
	return String(DISHES.get(id, {"name": id})["name"])


static func total(d: Dictionary) -> int:
	var n := 0
	for k in d:
		n += int(d[k])
	return n


static func price_of(d: Dictionary) -> int:
	var p := 0
	for k in d:
		p += int(ITEMS[k]["price"]) * int(d[k])
	return p


static func listing(d: Dictionary) -> String:
	var parts: PackedStringArray = []
	for k in d:
		parts.append("%s ×%d" % [name_of(k), int(d[k])])
	return ", ".join(parts)


static func _add(d: Dictionary, id: String, n := 1) -> void:
	d[id] = int(d.get(id, 0)) + n
	if int(d[id]) <= 0:
		d.erase(id)


# ------------------------------------------------------------------------------------------ shopping
static func take_basket() -> bool:
	if hand != "":
		return false
	hand = "basket"
	basket = {}
	return true


static func pick(id: String) -> bool:
	if hand != "basket" or not ITEMS.has(id):
		return false
	_add(basket, id)
	return true


## pay at the till: "" when done (the bag is in the hand), else the reason
static func pay() -> String:
	if hand != "basket" or basket.is_empty():
		return "Корзина пуста"
	var p := price_of(basket)
	if Wallet.money < p:
		return "Недостаточно денег: нужно %s" % Wallet.fmt(p)
	Wallet.money -= p
	bag = basket.duplicate()
	basket = {}
	hand = "bag"
	Wallet.save_state()
	return ""


static func drop_basket() -> void:
	if hand == "basket":
		hand = ""
		basket = {}


# ------------------------------------------------------------------------------------------ the boot
static func to_trunk(car: String) -> bool:
	if hand != "bag" or bag.is_empty():
		return false
	if not trunks.has(car):
		trunks[car] = []
	(trunks[car] as Array).append(bag.duplicate())
	bag = {}
	hand = ""
	Wallet.save_state()
	return true


static func from_trunk(car: String) -> bool:
	if hand != "" or (trunks.get(car, []) as Array).is_empty():
		return false
	bag = (trunks[car] as Array).pop_back()
	hand = "bag"
	Wallet.save_state()
	return true


static func trunk_count(car: String) -> int:
	return (trunks.get(car, []) as Array).size()


# ------------------------------------------------------------------------------------------ home
static func unpack() -> int:
	if hand != "bag":
		return 0
	var n := total(bag)
	for k in bag:
		_add(fridge, k, int(bag[k]))
	bag = {}
	hand = ""
	Wallet.save_state()
	return n


static func can_cook(rid: String) -> bool:
	for need in RECIPES[rid]["needs"]:
		if int(fridge.get(need, 0)) <= 0:
			return false
	return true


static func cook(rid: String) -> bool:
	if not can_cook(rid):
		return false
	for need in RECIPES[rid]["needs"]:
		_add(fridge, need, -1)
	_add(fridge, rid, int(RECIPES[rid]["makes"]))
	Wallet.save_state()
	return true


# ------------------------------------------------------------------------------------------ eating
static func edible(id: String) -> bool:
	return DISHES.has(id) or (ITEMS.has(id) and bool(ITEMS[id]["ready"]))


## eat / drink one portion from a store (the bag in the hand or the fridge); returns a message
static func consume(id: String, from: Dictionary) -> String:
	if PlayerLife.dead or int(from.get(id, 0)) <= 0 or not edible(id):
		return ""
	var d: Dictionary = DISHES[id] if DISHES.has(id) else ITEMS[id]
	_add(from, id, -1)
	hunger = minf(100.0, hunger + float(d.get("hunger", 0.0)))
	thirst = minf(100.0, thirst + float(d.get("thirst", 0.0)))
	PlayerLife.health = minf(100.0, PlayerLife.health + float(d.get("heal", 0.0)))
	if hand == "bag" and from == bag and bag.is_empty():
		hand = ""
	Wallet.save_state()
	return "%s: голод %d · жажда %d · здоровье %d" % [name_of(id), int(hunger), int(thirst), int(PlayerLife.health)]


## the best ready item in a store for the current needs (thirst first when it is lower)
static func best_in(from: Dictionary) -> String:
	var best := ""
	var score := -INF
	for k in from:
		if not edible(k) or int(from[k]) <= 0:
			continue
		var d: Dictionary = DISHES[k] if DISHES.has(k) else ITEMS[k]
		var s := minf(float(d.get("hunger", 0.0)), 100.0 - hunger) + minf(float(d.get("thirst", 0.0)), 100.0 - thirst) \
			+ minf(float(d.get("heal", 0.0)), 100.0 - PlayerLife.health) * 0.5
		if s > score:
			score = s
			best = k
	return best


## time passes: hunger / thirst fall, an empty need drains the health
static func tick(delta: float) -> void:
	if PlayerLife.dead:
		return
	hunger = maxf(0.0, hunger - delta * 100.0 / HUNGER_S)
	thirst = maxf(0.0, thirst - delta * 100.0 / THIRST_S)
	if hunger <= 0.0 or thirst <= 0.0:
		PlayerLife.health = maxf(1.0, PlayerLife.health - delta * 0.25 * (2.0 if hunger <= 0.0 and thirst <= 0.0 else 1.0))


static func ok_to_heal() -> bool:
	return hunger > 15.0 and thirst > 15.0


# ------------------------------------------------------------------------------------------ save
static func to_dict() -> Dictionary:
	return {"hunger": hunger, "thirst": thirst, "hand": hand if hand == "bag" else "", "bag": bag,
		"trunks": trunks, "fridge": fridge}


static func from_dict(d: Dictionary) -> void:
	hunger = clampf(float(d.get("hunger", 100.0)), 0.0, 100.0)
	thirst = clampf(float(d.get("thirst", 100.0)), 0.0, 100.0)
	bag = _clean(d.get("bag", {}))
	hand = "bag" if String(d.get("hand", "")) == "bag" and not bag.is_empty() else ""
	fridge = _clean(d.get("fridge", {}))
	trunks = {}
	var t: Variant = d.get("trunks", {})
	if t is Dictionary:
		for car in t:
			var arr: Array = []
			for b in (t[car] as Array):
				var cb := _clean(b)
				if not cb.is_empty():
					arr.append(cb)
			trunks[String(car)] = arr


static func _clean(v: Variant) -> Dictionary:
	var out := {}
	if v is Dictionary:
		for k in v:
			var id := String(k)
			if (ITEMS.has(id) or DISHES.has(id)) and int(v[k]) > 0:
				out[id] = int(v[k])
	return out
