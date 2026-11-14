extends Node
## Визуальная проверка: проходит по экранам и сохраняет PNG.
## xvfb-run godot --path durak --rendering-method gl_compatibility res://tests/screenshots.tscn -- <out_dir>

var out := "user://shots"
var main: Control


func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() > 0:
		out = args[0]
	DirAccess.make_dir_recursive_absolute(out)
	Profile.player_name = "Тимур"
	Profile.avatar = PackedByteArray()
	Profile.settings.sound = false
	main = load("res://scenes/main.tscn").instantiate()
	add_child(main)
	await wait(2.0)
	await shot("01_splash")
	await wait(4.5)
	await shot("02_menu")
	main.go("bots")
	await wait(1.0)
	await shot("03_bots")
	main.go("profile")
	await wait(1.0)
	await shot("04_profile")
	main.go("rules")
	await wait(1.0)
	await shot("05_rules")
	main.go("wifi")
	await wait(1.0)
	await shot("06_wifi")
	Session.host_room()
	Session.add_bot()
	Session.add_bot()
	await wait(1.2)
	await shot("07_lobby")
	Session.leave()
	main.go("menu")
	await wait(0.8)
	Session.start_local(3, 1, "perevodnoy", true)
	await wait(0.9)
	await shot("08_deal")
	await wait(2.5)
	await shot("09_table")
	# Дать ботам поиграть, пока не наступит мой ход атаки или защиты.
	for i in 40:
		await wait(0.5)
		var v := Session.view
		if not v.table.is_empty() and v.defender == 0:
			break
	await shot("10_midgame")
	# Сымитировать шулерство и поимку на столе.
	var g := Session.game
	if g != null and not g.over:
		await play_until_my_defense(g)
		await shot("11_defend")
	# Конец игры.
	if g != null:
		while not g.over:
			force_finish(g)
			await wait(0.1)
		Session._broadcast()
		await wait(2.4)
		await shot("12_result")
	get_tree().quit()


func play_until_my_defense(g: DurakGame) -> void:
	# Выбрать карту в руке и показать её поднятой.
	var t: TableScreen = main.table
	if t == null:
		return
	var hand: Array = Session.view.get("hand", [])
	if not hand.is_empty():
		t.selected = int(hand[0])
		t._sync_cards({}, 0.0, false)
	await wait(0.6)


func force_finish(g: DurakGame) -> void:
	# Все, кроме одного бота, сбрасывают карты — игра заканчивается.
	g.deck.clear()
	g.table.clear()
	g.taking = false
	for i in g.n:
		if i != 2:
			g.discard.append_array(g.hands[i])
			g.hands[i].clear()
	g.table.append({"a": g.hands[2][0], "a_by": 2, "a_ok": true, "d": -1, "d_by": -1, "d_ok": true})
	g.hands[2].remove_at(0)
	g.attacker = 2
	g.defender = 0
	g.hands[0].append(g.discard.pop_back())
	g.table[0].d = g.hands[0][0]
	g.table[0].d_by = 0
	g.hands[0].clear()
	g.resolve()


func wait(s: float) -> void:
	await get_tree().create_timer(s).timeout


func shot(name: String) -> void:
	await RenderingServer.frame_post_draw
	var img := get_viewport().get_texture().get_image()
	img.save_png(out.path_join(name + ".png"))
	print("shot ", name)
