class_name DurakBot
extends RefCounted
## Бот. Видит только свою руку и стол (как живой игрок); отметки о
## жульничестве использует лишь для «поимки», с вероятностью по уровню —
## человек тоже видит стол и может заметить неправильную карту.
## Уровни: 0 — лёгкий, 1 — нормальный, 2 — сильный.

const CATCH_CHANCE := [0.15, 0.4, 0.75]
const CHEAT_CHANCE := [0.05, 0.15, 0.25]


## Попытка поймать шулера. Возвращает действие или {}.
static func try_catch(g: DurakGame, seat: int, level: int, rng: RandomNumberGenerator) -> Dictionary:
	if not g.cheats or g.false_called.has(seat) or g.out[seat]:
		return {}
	for i in g.table.size():
		var p: Dictionary = g.table[i]
		if not p.a_ok and p.a_by != seat and rng.randf() < CATCH_CHANCE[level]:
			return {"t": "call", "slot": i, "which": "a"}
		if p.d >= 0 and not p.d_ok and p.d_by != seat and rng.randf() < CATCH_CHANCE[level]:
			return {"t": "call", "slot": i, "which": "d"}
	return {}


static func decide(g: DurakGame, seat: int, level: int, rng: RandomNumberGenerator) -> Dictionary:
	if g.over or g.out[seat]:
		return {}
	var hand: Array = g.hands[seat]
	var tr := g.trump
	if seat == g.defender:
		if g.taking or g.undefended() == 0:
			return {}
		return _defend(g, seat, level, rng)
	# Нападение / подкидывание.
	if g.table.is_empty():
		if seat != g.attacker:
			return {}
		return {"t": "attack", "card": _lead_card(g, hand, level)}
	if g.can_add(seat):
		var best := -1
		for c in hand:
			if not g.honest_add(seat, c):
				continue
			if _worth_throwing(g, c, level) and (best < 0 or Cards.value(c, tr) < Cards.value(best, tr)):
				best = c
		if best >= 0:
			return {"t": "attack", "card": best}
		# Шулерство: подкинуть мелкую карту берущему.
		if g.cheats and g.taking and level > 0 and rng.randf() < CHEAT_CHANCE[level]:
			var junk := _lowest(hand, tr, false)
			if junk >= 0 and not g.honest_add(seat, junk):
				return {"t": "attack", "card": junk}
	if g.can_pass(seat):
		return {"t": "pass"}
	return {}


static func _lead_card(g: DurakGame, hand: Array, level: int) -> int:
	var tr := g.trump
	if level == 0 and g.rng.randf() < 0.3:
		return hand[g.rng.randi_range(0, hand.size() - 1)]
	# Сильный: предпочитает достоинство, которого у него пара (можно подкинуть).
	if level == 2:
		var counts := {}
		for c in hand:
			if Cards.suit(c) != tr:
				counts[Cards.rank(c)] = counts.get(Cards.rank(c), 0) + 1
		var best := -1
		for c in hand:
			if Cards.suit(c) == tr or counts[Cards.rank(c)] < 2 or Cards.rank(c) > 11:
				continue
			if best < 0 or Cards.rank(c) < Cards.rank(best):
				best = c
		if best >= 0:
			return best
	return _lowest(hand, tr, true)


static func _worth_throwing(g: DurakGame, c: int, level: int) -> bool:
	var tr := g.trump
	if level == 0:
		return true
	if g.deck.is_empty():
		return Cards.suit(c) != tr or g.hands[g.defender].size() <= 2 or g.taking
	if Cards.suit(c) == tr:
		return false
	return Cards.rank(c) <= (11 if not g.taking else 10)


static func _lowest(hand: Array, tr: int, allow_trump: bool) -> int:
	var best := -1
	for c in hand:
		if not allow_trump and Cards.suit(c) == tr:
			continue
		if best < 0 or Cards.value(c, tr) < Cards.value(best, tr):
			best = c
	return best


static func _defend(g: DurakGame, seat: int, level: int, rng: RandomNumberGenerator) -> Dictionary:
	var hand: Array = g.hands[seat]
	var tr := g.trump
	# Перевод.
	if g.mode == "perevodnoy" and level > 0:
		for c in hand:
			if g.can_transfer_with(seat, c) and (Cards.suit(c) != tr or g.deck.is_empty()):
				var nxt := g.next_active(seat)
				if level < 2 or g.hands[nxt].size() >= 3 or g.deck.size() > 0:
					return {"t": "transfer", "card": c}
	# Жадный план: старшие атакующие карты закрываем первыми, самой дешёвой бьющей.
	var slots: Array = []
	for i in g.table.size():
		if g.table[i].d < 0:
			slots.append(i)
	slots.sort_custom(func(x: int, y: int) -> bool:
		return Cards.value(g.table[x].a, tr) > Cards.value(g.table[y].a, tr))
	var used := {}
	var plan := {}
	var cost := 0
	var missing: Array = []
	for s in slots:
		var a: int = g.table[s].a
		var best := -1
		for c in hand:
			if used.has(c) or not Cards.beats(c, a, tr):
				continue
			if best < 0 or Cards.value(c, tr) < Cards.value(best, tr):
				best = c
		if best >= 0:
			used[best] = true
			plan[s] = best
			if Cards.suit(best) == tr:
				cost += 5 + Cards.rank(best)
		else:
			missing.append(s)
	if missing.is_empty():
		# Слишком дорого отбиваться в начале игры — лучше взять мелочь.
		if level > 0 and g.deck.size() > 8 and cost >= 30 and g.table.size() <= 2:
			return {"t": "take"}
		var s0: int = plan.keys()[0]
		return {"t": "defend", "card": plan[s0], "slot": s0}
	# Не отбиться честно. Может, смухлевать?
	if g.cheats and missing.size() == 1 and rng.randf() < CHEAT_CHANCE[level] * 2.0:
		var s: int = missing[0]
		var a: int = g.table[s].a
		var fake := -1
		for c in hand:  # правдоподобно: та же масть, но младше
			if used.has(c) or Cards.suit(c) != Cards.suit(a) or Cards.suit(c) == tr:
				continue
			if fake < 0 or Cards.rank(c) > Cards.rank(fake):
				fake = c
		if fake < 0:
			for c in hand:
				if not used.has(c) and Cards.suit(c) != tr and (fake < 0 or Cards.rank(c) < Cards.rank(fake)):
					fake = c
		if fake >= 0:
			return {"t": "defend", "card": fake, "slot": s}
	return {"t": "take"}
