class_name Plates
extends RefCounted
## 0.25 Tajik number plates: "1234 AB 01" (4 digits, 2 letters, region 01 = Dushanbe). Every car gets
## one (stable per car until changed), saved with the game (Wallet.plates). At an auto service:
## «НОВЫЙ НОМЕР» (random) or «КРАСИВЫЙ НОМЕР» (repeated digits like 7777, 0001, 1111).

const PRICE := 300
const PRICE_VIP := 5000
const LETTERS := "ABCEHKMOPTX"          ## letters that read the same in Latin and Cyrillic


static func number_for(car: String) -> String:
	if Wallet.plates.has(car):
		return String(Wallet.plates[car])
	var rng := RandomNumberGenerator.new()
	rng.seed = car.hash()
	var t := _random(rng)
	Wallet.plates[car] = t
	return t


static func _random(rng: RandomNumberGenerator) -> String:
	return "%04d %s%s 01" % [rng.randi_range(1, 9999), LETTERS[rng.randi() % LETTERS.length()], LETTERS[rng.randi() % LETTERS.length()]]


static func _vip(rng: RandomNumberGenerator) -> String:
	var d := str(rng.randi_range(0, 9))
	var digits: String = [d + d + d + d, "000" + str(rng.randi_range(1, 9)), "0" + d + d + d, d + "00" + d][rng.randi() % 4]
	if digits == "0000":
		digits = "0007"
	var l := LETTERS[rng.randi() % LETTERS.length()]
	return "%s %s%s 01" % [digits, l, l]


## buys a new number for the car (vehicle node), "" or the reason it failed
static func buy(car: Node, vip := false) -> String:
	var cost := PRICE_VIP if vip else PRICE
	if Wallet.money < cost:
		return "Недостаточно денег: нужно %s" % Wallet.fmt(cost)
	var rng := RandomNumberGenerator.new()
	rng.randomize()
	var t := _vip(rng) if vip else _random(rng)
	Wallet.money -= cost
	Wallet.plates[String(car.name)] = t
	Wallet.save_state()
	if car.has_method("set_plate"):
		car.call("set_plate", t)
	return ""
