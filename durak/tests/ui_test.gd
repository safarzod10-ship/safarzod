extends Node
## Тест управления как у живого игрока: касания карт через TableScreen.
##   godot --headless --path durak res://tests/ui_test.tscn

var main: Control
var fails := 0
var did := {}


func check(c: bool, msg: String) -> void:
	print(("ok   " if c else "FAIL ") + msg)
	if not c:
		fails += 1


func _ready() -> void:
	Profile.player_name = "Тест"
	Profile.avatar = PackedByteArray()
	Profile.settings.sound = false
	main = load("res://scenes/main.tscn").instantiate()
	add_child(main)
	await wait(6.0)
	Session.start_local(1, 0, "podkidnoy", true)
	await wait(2.0)
	var t: TableScreen = main.table
	check(t != null, "открылся стол")
	var g := Session.game
	var deadline := Time.get_ticks_msec() + 120000
	while Time.get_ticks_msec() < deadline and did.size() < 3:
		await wait(0.3)
		if g.over:
			Session.rematch()
			g = Session.game
			await wait(2.0)
			continue
		var v := Session.view
		var hand: Array = v.hand
		if hand.is_empty():
			continue
		if not did.has("attack") and int(v.attacker) == 0 and v.table.is_empty():
			var c: int = hand[0]
			t._on_card_pressed(t.nodes[c])
			t._on_card_pressed(t.nodes[c])
			check(g.table.size() == 1 and g.table[0].a == c, "ход двойным касанием")
			did["attack"] = true
		elif not did.has("cheat") and int(v.defender) == 0 and not v.taking and g.undefended() > 0:
			var slot := -1
			for i in g.table.size():
				if g.table[i].d < 0:
					slot = i
			var bad := -1
			for c in hand:
				if not Cards.beats(c, g.table[slot].a, g.trump):
					bad = c
			if bad < 0:
				continue
			# Выбрать карту, затем коснуться атакующей карты на столе.
			t._on_card_pressed(t.nodes[bad])
			t._tap_table(t.nodes[g.table[slot].a])
			check(g.table[slot].d == bad and not g.table[slot].d_ok, "побил не той картой — игра пропустила")
			did["cheat"] = true
		elif not did.has("call") and int(v.attacker) == 0 and g.table.size() > 0:
			for i in g.table.size():
				if g.table[i].d >= 0 and g.table[i].d_by != 0:
					var honest: bool = g.table[i].d_ok
					t._tap_table(t.nodes[g.table[i].d])
					check(t.call_pill.visible, "появилась кнопка «Обман?»")
					t._confirm_call()
					if honest:
						check(g.false_called.has(0), "ложное обвинение засчитано")
					else:
						check(g.table[i].d < 0, "обман пойман, карта вернулась")
					did["call"] = true
					break
		elif v.can.pass:
			Session.send_action({"t": "pass"})
		elif int(v.defender) == 0 and v.can.take and did.has("cheat"):
			Session.send_action({"t": "take"})
	check(did.size() == 3, "проверены все три действия: " + str(did.keys()))
	print("ИТОГ: ", "OK" if fails == 0 else "%d ошибок" % fails)
	get_tree().quit(1 if fails > 0 else 0)


func wait(s: float) -> void:
	await get_tree().create_timer(s).timeout
