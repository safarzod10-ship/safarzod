class_name Account
extends RefCounted
## The player's account: an ID given automatically on the first start (8 digits, random, saved in
## user://account.json) and the top-up codes already used.
## Real-money top-up goes through the administrator: the player pays and tells the admin his ID;
## the admin runs tools/admin/make_code.py ID AMOUNT and gives the one-time code; «АКТИВИРОВАТЬ»
## checks it (HMAC-SHA256 of ID|amount|nonce with the project key, first 10 hex digits) and adds the
## game money (Wallet). A code works only for that ID and only once.
## NOTE: without a server the key ships inside the game; a real shop needs a server-side check
## (or Google Play Billing) - see docs/SHOP.md.

const PATH := "user://account.json"
const KEY := "dushanbe-city-topup-2026-key-v1-change-me"
## promo codes typed in the shop: amount, once per account
const PROMOS := {"TAJDUSH": 200000}

static var id := ""
static var used := {}
static var no_save := false
static var _loaded := false


static func ensure() -> void:
	if _loaded:
		return
	_loaded = true
	if not no_save and FileAccess.file_exists(PATH):
		var d: Variant = JSON.parse_string(FileAccess.get_file_as_string(PATH))
		if d is Dictionary:
			id = String(d.get("id", ""))
			used = d.get("used", {})
	if id == "":
		var c := Crypto.new()
		var b := c.generate_random_bytes(8)
		var n := 0
		for k in 8:
			n = (n * 256 + b[k]) % 100000000
		id = "%08d" % maxi(n, 10000000)
		save()


static func save() -> void:
	if no_save:
		return
	var f := FileAccess.open(PATH, FileAccess.WRITE)
	if f:
		f.store_string(JSON.stringify({"id": id, "used": used}))


static func signature(pid: String, amount: int, nonce: String) -> String:
	var h := HMACContext.new()
	h.start(HashingContext.HASH_SHA256, KEY.to_utf8_buffer())
	h.update(("%s|%d|%s" % [pid, amount, nonce]).to_utf8_buffer())
	return h.finish().hex_encode().substr(0, 10).to_upper()


## "DX-<amount>-<nonce>-<sig>" -> the amount added (> 0), or an error message
static func redeem(code: String) -> Variant:
	ensure()
	var c := code.strip_edges().to_upper().replace(" ", "")
	if c == "":
		return "Введите код"
	if PROMOS.has(c):
		if used.has("PROMO:" + c):
			return "Промокод уже использован"
		used["PROMO:" + c] = true
		save()
		Wallet.load_state()
		Wallet.money += int(PROMOS[c])
		Wallet.save_state()
		return int(PROMOS[c])
	var p := c.split("-")
	if p.size() != 4 or p[0] != "DX" or not p[1].is_valid_int():
		return "Неверный формат кода"
	var amount := int(p[1])
	if amount <= 0 or amount > 10000000:
		return "Неверная сумма"
	if used.has(c):
		return "Этот код уже использован"
	if signature(id, amount, p[2]) != p[3]:
		return "Код не подходит к вашему ID"
	used[c] = true
	save()
	Wallet.load_state()
	Wallet.money += amount
	Wallet.save_state()
	return amount
