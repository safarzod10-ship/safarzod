extends Node
## Сетевой тест на одном компьютере: хост + клиент через 127.0.0.1.
##   godot --headless --path durak res://tests/net_test.tscn -- host
##   godot --headless --path durak res://tests/net_test.tscn -- client
## Клиент играет простыми ходами, хост с ботом доигрывает партию до конца.

var role := "host"
var deadline := 240.0
var acted_version := -1
var views := 0
var events_seen := {}


func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() > 0:
		role = args[0]
	Profile.player_name = "Хост" if role == "host" else "Клиент"
	Profile.uid = role + "-uid"
	Profile.settings.sound = false
	Profile.avatar = PackedByteArray()
	if role == "client":
		# Тестовая «фотка» клиента: проверим, что аватар доходит до хоста.
		var img := Image.create(64, 64, false, Image.FORMAT_RGB8)
		img.fill(Color(0.6, 0.0, 0.2))
		Profile.set_avatar_image(img)
	Session.view_changed.connect(_on_view)
	Session.closed.connect(func(r: String) -> void:
		print(role, ": закрыто: ", r)
		_finish(role == "client" and events_seen.has("over")))
	Session.toast.connect(func(t: String) -> void: print(role, ": тост: ", t))
	if role == "host":
		Session.settings.cheats = true
		var err := Session.host_room()
		print("host: room ", err if err != "" else "ok", " ips=", Session.local_ips())
		Session.add_bot()
	else:
		await get_tree().create_timer(1.0).timeout
		print("client: join ", Session.join("127.0.0.1"))


func _process(delta: float) -> void:
	deadline -= delta
	if deadline < 0:
		print(role, ": ТАЙМАУТ")
		_finish(false)
	if role == "host" and not Session.running and Session.seats.size() == 3:
		print("host: аватар клиента получен: ", Session.avatar_bytes.has("client-uid") and not Session.avatar_bytes["client-uid"].is_empty())
		print("host: старт, места: ", Session.seats.map(func(s: Dictionary) -> String: return s.name))
		Session.start_game()
	if role == "host" and Session.running and Session.game != null and Session.game.over:
		await get_tree().create_timer(0.5).timeout
		print("host: игра окончена, дурак: ", Session.game.loser, " (", Session.seat_name(Session.game.loser) if Session.game.loser >= 0 else "ничья", "), конов: ", Session.game.bout)
		_finish(Session.game.total_cards() == 36)


func _on_view(v: Dictionary, events: Array) -> void:
	views += 1
	for e in events:
		events_seen[e.t] = true
	if v.over:
		if role == "client":
			print("client: получил конец игры, дурак = ", v.loser)
		return
	_auto_play.call_deferred(v)


func _auto_play(v: Dictionary) -> void:
	if Session.view != v:
		return
	var can: Dictionary = v.can
	var me := int(v.seat)
	var hand: Array = v.hand
	if me == int(v.defender) and can.take:
		Session.send_action({"t": "take"})
	elif can.attack and v.table.is_empty() and not hand.is_empty():
		Session.send_action({"t": "attack", "card": hand[0]})
	elif can.pass:
		Session.send_action({"t": "pass"})


func _finish(ok: bool) -> void:
	print(role, ": ИТОГ ", "OK" if ok else "FAIL", " (видов получено: ", views, ")")
	Session.leave()
	get_tree().quit(0 if ok else 1)
