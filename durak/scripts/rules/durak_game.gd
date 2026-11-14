class_name DurakGame
extends RefCounted
## Правила дурака: подкидной и переводной, с режимом «обман».
## Без графики и сети — чистая логика. Индексы игроков (места) идут по кругу
## по часовой стрелке: следующий за i — (i + 1) % n.
##
## Шулерство: при включённом `cheats` неправильный ход (бить не той картой,
## подкидывать не то достоинство) принимается, но помечается. Пока карты на
## столе, любой другой игрок может «поймать» такую карту — она возвращается
## тому, кто её положил. Ложное обвинение: до конца кона больше нельзя ловить.

const HAND_SIZE := 6

var mode := "podkidnoy"  # или "perevodnoy"
var cheats := true
var n := 0
var hands: Array = []          # Array[Array[int]]
var out: Array = []            # bool на место
var places: Array = []         # места в порядке выхода
var deck: Array = []           # deck[0] — открытый козырь (берётся последним)
var trump := 0
var trump_card := 0
var table: Array = []          # [{a, a_by, a_ok, d, d_by, d_ok}]
var discard: Array = []
var attacker := 0
var defender := 1
var taking := false
var passed := {}
var false_called := {}
var first_bout := true
var over := false
var loser := -1                # -1 — ничья
var bout := 0
var events: Array = []         # журнал для анимаций и сети; хост забирает через take_events()
var rng := RandomNumberGenerator.new()


func setup(players: int, seed_value: int = 0, game_mode: String = "podkidnoy", allow_cheats: bool = true) -> void:
	n = players
	mode = game_mode
	cheats = allow_cheats
	if seed_value != 0:
		rng.seed = seed_value
	else:
		rng.randomize()
	deck = Cards.full_deck()
	for i in range(deck.size() - 1, 0, -1):
		var j := rng.randi_range(0, i)
		var t: int = deck[i]
		deck[i] = deck[j]
		deck[j] = t
	hands = []
	out = []
	for i in n:
		hands.append([])
		out.append(false)
	for k in HAND_SIZE:
		for i in n:
			hands[i].append(deck.pop_back())
	# При 6 игроках колода пуста: козырь — последняя розданная карта.
	trump_card = deck[0] if not deck.is_empty() else hands[n - 1][HAND_SIZE - 1]
	trump = Cards.suit(trump_card)
	# Первым ходит младший козырь.
	var best := 99
	attacker = rng.randi_range(0, n - 1)
	for i in n:
		for c in hands[i]:
			if Cards.suit(c) == trump and Cards.rank(c) < best:
				best = Cards.rank(c)
				attacker = i
	defender = next_active(attacker)
	_ev({"t": "deal", "attacker": attacker, "low_trump": Cards.make(trump, best) if best < 99 else -1})


# ---------------------------------------------------------------- запросы

func next_active(i: int) -> int:
	for k in range(1, n + 1):
		var j := (i + k) % n
		if not out[j]:
			return j
	return -1


func active_count() -> int:
	return out.count(false)


func limit() -> int:
	return 5 if first_bout else HAND_SIZE


func table_ranks() -> Dictionary:
	var r := {}
	for p in table:
		r[Cards.rank(p.a)] = true
		if p.d >= 0:
			r[Cards.rank(p.d)] = true
	return r


func undefended() -> int:
	var k := 0
	for p in table:
		if p.d < 0:
			k += 1
	return k


func all_defended() -> bool:
	return table.size() > 0 and undefended() == 0


## Можно ли этому месту положить ещё одну атакующую карту (без учёта достоинства).
func can_add(seat: int) -> bool:
	if over or seat == defender or out[seat] or hands[seat].is_empty():
		return false
	if table.is_empty():
		return seat == attacker
	if table.size() >= limit():
		return false
	return undefended() + 1 <= hands[defender].size()


func honest_add(seat: int, c: int) -> bool:
	return table.is_empty() or table_ranks().has(Cards.rank(c))


func has_honest_add(seat: int) -> bool:
	if not can_add(seat):
		return false
	for c in hands[seat]:
		if honest_add(seat, c):
			return true
	return false


func can_transfer_with(seat: int, c: int) -> bool:
	if mode != "perevodnoy" or seat != defender or taking or table.is_empty() or over:
		return false
	for p in table:
		if p.d >= 0 or Cards.rank(p.a) != Cards.rank(c):
			return false
	var nxt := next_active(defender)
	if table.size() + 1 > limit():
		return false
	return hands[nxt].size() >= table.size() + 1


func can_pass(seat: int) -> bool:
	return not over and seat != defender and not out[seat] and table.size() > 0 \
		and (taking or all_defended()) and not passed.has(seat)


## Кон готов к завершению: всё отбито (или защитник берёт) и каждый нападающий
## нажал «Пас» — либо ему нечего/некуда подкинуть. Таймера нет.
func ready_to_resolve() -> bool:
	if over or table.is_empty():
		return false
	if not taking and not all_defended():
		return false
	for i in n:
		if i == defender or out[i]:
			continue
		if passed.has(i) or not can_add(i):
			continue
		if not cheats and not has_honest_add(i):
			continue
		return false
	return true


func cheats_on_table() -> int:
	var k := 0
	for p in table:
		if not p.a_ok:
			k += 1
		if p.d >= 0 and not p.d_ok:
			k += 1
	return k


# ---------------------------------------------------------------- действия

## Выполнить действие игрока. Возвращает "" при успехе или текст ошибки.
func act(seat: int, a: Dictionary) -> String:
	if over:
		return "Игра окончена"
	if seat < 0 or seat >= n:
		return "Нет такого игрока"
	match String(a.get("t", "")):
		"attack":
			return _attack(seat, int(a.get("card", -1)))
		"defend":
			return _defend(seat, int(a.get("card", -1)), int(a.get("slot", -1)))
		"transfer":
			return _transfer(seat, int(a.get("card", -1)))
		"take":
			return _take(seat)
		"pass":
			return _pass(seat)
		"call":
			return _call(seat, int(a.get("slot", -1)), String(a.get("which", "a")))
	return "Неизвестное действие"


func _attack(seat: int, c: int) -> String:
	if not hands[seat].has(c):
		return "Нет такой карты"
	if seat == defender:
		return "Вы отбиваетесь"
	if out[seat]:
		return "Вы вышли из игры"
	if table.is_empty() and seat != attacker:
		return "Сейчас не ваш ход"
	if not table.is_empty() and table.size() >= limit():
		return "Больше подкидывать нельзя"
	if not table.is_empty() and undefended() + 1 > hands[defender].size():
		return "У отбивающегося не хватит карт"
	var ok := honest_add(seat, c)
	if not ok and not cheats:
		return "Такого достоинства нет на столе"
	hands[seat].erase(c)
	table.append({"a": c, "a_by": seat, "a_ok": ok, "d": -1, "d_by": -1, "d_ok": true})
	passed.clear()
	_ev({"t": "attack", "seat": seat, "card": c, "slot": table.size() - 1})
	return ""


func _defend(seat: int, c: int, slot: int) -> String:
	if seat != defender:
		return "Вы не отбиваетесь"
	if taking:
		return "Вы уже берёте"
	if not hands[seat].has(c):
		return "Нет такой карты"
	if slot < 0:
		for i in table.size():
			if table[i].d < 0:
				slot = i
				break
	if slot < 0 or slot >= table.size() or table[slot].d >= 0:
		return "Эта карта уже побита"
	var ok := Cards.beats(c, table[slot].a, trump)
	if not ok and not cheats:
		return "Этой картой не побить"
	hands[seat].erase(c)
	table[slot].d = c
	table[slot].d_by = seat
	table[slot].d_ok = ok
	passed.clear()
	_ev({"t": "defend", "seat": seat, "card": c, "slot": slot})
	return ""


func _transfer(seat: int, c: int) -> String:
	if not hands[seat].has(c):
		return "Нет такой карты"
	if not can_transfer_with(seat, c):
		return "Перевести нельзя"
	hands[seat].erase(c)
	table.append({"a": c, "a_by": seat, "a_ok": true, "d": -1, "d_by": -1, "d_ok": true})
	attacker = defender
	defender = next_active(defender)
	passed.clear()
	_ev({"t": "transfer", "seat": seat, "card": c, "slot": table.size() - 1, "to": defender})
	return ""


func _take(seat: int) -> String:
	if seat != defender:
		return "Вы не отбиваетесь"
	if taking:
		return "Уже берёте"
	if undefended() == 0:
		return "Всё отбито"
	taking = true
	passed.clear()
	_ev({"t": "take", "seat": seat})
	return ""


func _pass(seat: int) -> String:
	if not can_pass(seat):
		return "Сейчас нельзя"
	passed[seat] = true
	_ev({"t": "pass", "seat": seat})
	return ""


func _call(seat: int, slot: int, which: String) -> String:
	if slot < 0 or slot >= table.size():
		return "Нет такой карты"
	if false_called.has(seat):
		return "Вы уже ошиблись в этом коне"
	var p: Dictionary = table[slot]
	var is_def := which == "d"
	if is_def and p.d < 0:
		return "Нет такой карты"
	var by: int = p.d_by if is_def else p.a_by
	if by == seat:
		return "Себя не ловят"
	var ok: bool = p.d_ok if is_def else p.a_ok
	var card: int = p.d if is_def else p.a
	if ok:
		false_called[seat] = true
		_ev({"t": "false_call", "seat": seat, "target": by, "card": card, "slot": slot})
		return ""
	var back := []
	if is_def:
		hands[by].append(p.d)
		back.append({"card": p.d, "to": by})
		p.d = -1
		p.d_by = -1
		p.d_ok = true
		if taking and by == defender:
			pass
	else:
		hands[by].append(p.a)
		back.append({"card": p.a, "to": by})
		if p.d >= 0:
			hands[p.d_by].append(p.d)
			back.append({"card": p.d, "to": p.d_by})
		table.remove_at(slot)
	passed.clear()
	_ev({"t": "caught", "seat": seat, "cheater": by, "card": card, "slot": slot, "back": back})
	return ""


## Завершить кон: «бито» или защитник забирает карты. Затем добор и проверка конца.
func resolve() -> void:
	if not ready_to_resolve():
		return
	var cards: Array = []
	for p in table:
		cards.append(p.a)
		if p.d >= 0:
			cards.append(p.d)
	var took := taking
	var main := attacker
	var def := defender
	if took:
		hands[def].append_array(cards)
		_ev({"t": "took", "seat": def, "cards": cards})
	else:
		discard.append_array(cards)
		_ev({"t": "beat", "cards": cards})
	table = []
	taking = false
	passed.clear()
	false_called.clear()
	first_bout = false
	bout += 1
	# Добор: ходивший, остальные по кругу, защитник последним.
	var order: Array = [main]
	for k in range(1, n):
		var j := (main + k) % n
		if j != def and j != main:
			order.append(j)
	if def != main:
		order.append(def)
	for i in order:
		if out[i]:
			continue
		var got := 0
		while hands[i].size() < HAND_SIZE and not deck.is_empty():
			hands[i].append(deck.pop_back())
			got += 1
		if got > 0:
			_ev({"t": "draw", "seat": i, "n": got})
	# Выход игроков.
	if deck.is_empty():
		for i in order:
			if not out[i] and hands[i].is_empty():
				out[i] = true
				places.append(i)
				_ev({"t": "out", "seat": i, "place": places.size()})
	if active_count() <= 1:
		over = true
		loser = -1
		for i in n:
			if not out[i]:
				loser = i
		_ev({"t": "over", "loser": loser})
		return
	if took:
		attacker = next_active(def)
	else:
		attacker = def if not out[def] else next_active(def)
	defender = next_active(attacker)
	_ev({"t": "turn", "attacker": attacker, "defender": defender})


# ---------------------------------------------------------------- сервис

func _ev(e: Dictionary) -> void:
	events.append(e)


func take_events() -> Array:
	var e := events
	events = []
	return e


func total_cards() -> int:
	var k := deck.size() + discard.size()
	for h in hands:
		k += h.size()
	for p in table:
		k += 1 if p.d < 0 else 2
	return k


## Что видит конкретный игрок (без чужих карт и без отметок о жульничестве).
func view_for(seat: int) -> Dictionary:
	var counts := []
	for h in hands:
		counts.append(h.size())
	var tbl := []
	for p in table:
		tbl.append({"a": p.a, "d": p.d, "a_by": p.a_by, "d_by": p.d_by})
	var v := {
		"seat": seat, "n": n, "mode": mode, "cheats": cheats,
		"counts": counts, "out": out.duplicate(), "places": places.duplicate(),
		"table": tbl, "trump": trump, "trump_card": trump_card,
		"deck": deck.size(), "discard": discard.size(),
		"attacker": attacker, "defender": defender, "taking": taking,
		"passed": passed.keys(), "limit": limit(), "over": over, "loser": loser,
		"bout": bout,
	}
	if seat >= 0 and seat < n:
		v["hand"] = Cards.sort_hand(hands[seat], trump)
		var can_tr := []
		for c in hands[seat]:
			if can_transfer_with(seat, c):
				can_tr.append(c)
		v["can"] = {
			"attack": can_add(seat),
			"defend": seat == defender and not taking and undefended() > 0,
			"transfer": can_tr,
			"take": seat == defender and not taking and undefended() > 0,
			"pass": can_pass(seat) and can_add(seat) and (cheats or has_honest_add(seat)),
			"call": not false_called.has(seat) and cheats,
		}
	return v
