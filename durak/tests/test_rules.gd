extends SceneTree
## Автотест правил: godot --headless --path durak -s res://tests/test_rules.gd
## Код выхода 0 — всё прошло.

var fails := 0


func check(cond: bool, msg: String) -> void:
	if not cond:
		fails += 1
		printerr("FAIL: ", msg)


func _init() -> void:
	unit_tests()
	simulate(600)
	print("ИТОГ: ", "OK" if fails == 0 else "%d ошибок" % fails)
	quit(1 if fails > 0 else 0)


func unit_tests() -> void:
	var S := 0
	var H := 3
	check(Cards.beats(Cards.make(S, 7), Cards.make(S, 6), H), "7 бьёт 6 той же масти")
	check(not Cards.beats(Cards.make(S, 6), Cards.make(S, 7), H), "6 не бьёт 7")
	check(Cards.beats(Cards.make(H, 6), Cards.make(S, 14), H), "козырь бьёт туза")
	check(not Cards.beats(Cards.make(1, 14), Cards.make(S, 6), H), "другая масть не бьёт")
	check(not Cards.beats(Cards.make(S, 14), Cards.make(H, 6), H), "некозырь не бьёт козырь")

	# Сценарий шулерства: 6 бьётся «семёркой» наоборот и ловится.
	var g := DurakGame.new()
	g.setup(2, 12345, "podkidnoy", true)
	g.take_events()
	var a := g.attacker
	var d := g.defender
	g.hands[a] = [Cards.make(0, 7), Cards.make(1, 9)]
	g.hands[d] = [Cards.make(0, 6), Cards.make(2, 10), Cards.make(2, 12)]
	g.trump = 3
	check(g.act(a, {"t": "attack", "card": Cards.make(0, 7)}) == "", "атака")
	check(g.act(d, {"t": "defend", "card": Cards.make(0, 6), "slot": 0}) == "", "жульническая защита принята")
	check(g.table[0].d_ok == false, "помечена как обман")
	check(g.act(d, {"t": "call", "slot": 0, "which": "d"}) != "", "себя не ловят")
	check(g.act(a, {"t": "call", "slot": 0, "which": "d"}) == "", "поимка")
	check(g.hands[d].has(Cards.make(0, 6)), "карта вернулась")
	check(g.table[0].d == -1, "атакующая карта снова не побита")
	check(g.act(d, {"t": "call", "slot": 0, "which": "a"}) == "", "ложное обвинение допустимо")
	check(g.false_called.has(d), "штраф за ложное обвинение")
	check(g.act(d, {"t": "call", "slot": 0, "which": "a"}) != "", "второй раз нельзя")
	# Подкинуть не то достоинство — принимается как обман.
	check(g.act(a, {"t": "attack", "card": Cards.make(1, 9)}) == "", "шулерский подкид")
	check(g.table[1].a_ok == false, "подкид помечен")

	# Без шулерства неправильные ходы запрещены.
	var h := DurakGame.new()
	h.setup(2, 777, "podkidnoy", false)
	a = h.attacker
	d = h.defender
	h.hands[a] = [Cards.make(0, 7), Cards.make(1, 9)]
	h.hands[d] = [Cards.make(0, 6), Cards.make(2, 10)]
	h.trump = 3
	h.act(a, {"t": "attack", "card": Cards.make(0, 7)})
	check(h.act(d, {"t": "defend", "card": Cards.make(0, 6), "slot": 0}) != "", "честный режим: 6 не бьёт 7")
	check(h.act(a, {"t": "attack", "card": Cards.make(1, 9)}) != "", "честный режим: не то достоинство")

	# Перевод.
	var p := DurakGame.new()
	p.setup(3, 99, "perevodnoy", false)
	a = p.attacker
	d = p.defender
	var nx := p.next_active(d)
	p.hands[a] = [Cards.make(0, 8)]
	p.hands[d] = [Cards.make(1, 8), Cards.make(2, 9)]
	check(p.act(a, {"t": "attack", "card": Cards.make(0, 8)}) == "", "атака перед переводом")
	check(p.act(d, {"t": "transfer", "card": Cards.make(1, 8)}) == "", "перевод")
	check(p.defender == nx and p.attacker == d, "защищается следующий")

	# Первый отбой — не больше 5 карт.
	var f := DurakGame.new()
	f.setup(2, 5, "podkidnoy", false)
	a = f.attacker
	d = f.defender
	f.hands[a] = [Cards.make(0, 6), Cards.make(1, 6), Cards.make(2, 6), Cards.make(3, 6), Cards.make(0, 7), Cards.make(1, 7)]
	f.hands[d] = [Cards.make(0, 14), Cards.make(1, 14), Cards.make(2, 14), Cards.make(3, 14), Cards.make(0, 13), Cards.make(1, 13)]
	f.trump = 3
	for c in [Cards.make(0, 6), Cards.make(1, 6), Cards.make(2, 6), Cards.make(3, 6)]:
		f.act(a, {"t": "attack", "card": c})
	f.act(d, {"t": "defend", "card": Cards.make(0, 14), "slot": 0})
	f.act(d, {"t": "defend", "card": Cards.make(1, 14), "slot": 1})
	f.act(d, {"t": "defend", "card": Cards.make(2, 14), "slot": 2})
	f.act(d, {"t": "defend", "card": Cards.make(3, 14), "slot": 3})
	check(f.act(a, {"t": "attack", "card": Cards.make(0, 7)}) != "", "5-я карта: нужен ранг на столе")
	f.cheats = true
	f.hands[a].append(Cards.make(2, 13))
	check(f.act(a, {"t": "attack", "card": Cards.make(2, 13)}) == "", "5-я карта")
	f.hands[a].append(Cards.make(3, 13))
	check(f.act(a, {"t": "attack", "card": Cards.make(3, 13)}) != "", "6-я в первом отбое нельзя")


func simulate(games: int) -> void:
	var rng := RandomNumberGenerator.new()
	rng.seed = 42
	var losers := {}
	var bouts := 0
	for gi in games:
		var g := DurakGame.new()
		var players := 2 + gi % 5
		var mode := "perevodnoy" if gi % 2 == 0 else "podkidnoy"
		g.setup(players, 1000 + gi, mode, gi % 3 != 0)
		var steps := 0
		while not g.over and steps < 5000:
			steps += 1
			var acted := false
			# Сначала защитник, затем остальные; иногда кто-то ловит.
			var order := [g.defender]
			for i in players:
				if i != g.defender:
					order.append(i)
			for s in order:
				var lvl: int = (s + gi) % 3
				var act: Dictionary = DurakBot.try_catch(g, s, lvl, rng)
				if act.is_empty():
					act = DurakBot.decide(g, s, lvl, rng)
				if act.is_empty():
					continue
				var err: String = g.act(s, act)
				check(err == "", "игра %d: бот %d сделал недопустимый ход %s: %s" % [gi, s, act, err])
				if err != "":
					g.over = true
				acted = true
				break
			if g.ready_to_resolve():
				g.resolve()
				acted = true
			check(g.total_cards() == 36, "игра %d: карт %d вместо 36" % [gi, g.total_cards()])
			if not acted:
				check(false, "игра %d: тупик (никто не ходит) %s" % [gi, g.view_for(g.attacker)])
				break
		check(g.over, "игра %d не закончилась за %d шагов" % [gi, steps])
		bouts += g.bout
		losers[g.loser] = losers.get(g.loser, 0) + 1
	print("Сыграно партий: %d, конов: %d, распределение дураков: %s" % [games, bouts, losers])
