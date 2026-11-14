extends Node
## Сессия игры. Одинаково работает для:
##  LOCAL  — игра с ботами на телефоне (без сети);
##  HOST   — телефон-хост: ведёт партию, проверяет ходы, управляет ботами;
##  CLIENT — подключённый друг: отправляет действия и получает своё состояние.
## Сеть — ENet (UDP) по локальной сети, интернет не нужен. Хост объявляет
## комнату широковещательным UDP-пакетом, клиенты видят её в списке.

signal lobby_changed
signal view_changed(view: Dictionary, events: Array)
signal toast(text: String)
signal rooms_changed(rooms: Array)
signal closed(reason: String)
signal avatars_changed

enum Role { NONE, LOCAL, HOST, CLIENT }

const PORT := 47420
const DISCOVERY_PORT := 47421
const MAX_PLAYERS := 6
const BOT_NAMES := ["Фаррух", "Шахло", "Далер", "Зарина", "Сухроб", "Мадина", "Бахром", "Нигина", "Рустам"]
const LEVEL_NAMES := ["лёгкий", "нормальный", "сильный"]

var role := Role.NONE
## Места: {name, uid, peer (0 — бот), bot, level, away}
var seats: Array = []
var settings := {"mode": "podkidnoy", "cheats": true, "level": 1}
var running := false
var my_seat := -1
var view: Dictionary = {}
var avatar_bytes := {}   # uid -> PackedByteArray
var avatar_tex := {}     # uid -> Texture2D
var host_name := ""
var host_ip := ""

var game: DurakGame
var rng := RandomNumberGenerator.new()
var _bot_timer := 1.0
var _peer: ENetMultiplayerPeer
var _udp_out: PacketPeerUDP
var _udp_in: PacketPeerUDP
var _announce_timer := 0.0
var _rooms := {}           # ip -> {name, players, running, seen}
var _rooms_emit_timer := 0.0


func _ready() -> void:
	rng.randomize()
	multiplayer.peer_connected.connect(_on_peer_connected)
	multiplayer.peer_disconnected.connect(_on_peer_disconnected)
	multiplayer.connected_to_server.connect(_on_connected)
	multiplayer.connection_failed.connect(_on_connection_failed)
	multiplayer.server_disconnected.connect(_on_server_disconnected)


func is_host_like() -> bool:
	return role == Role.LOCAL or role == Role.HOST


func seat_name(i: int) -> String:
	return seats[i].name if i >= 0 and i < seats.size() else "?"


func seat_uid(i: int) -> String:
	return seats[i].uid if i >= 0 and i < seats.size() else ""


func avatar_for(uid: String) -> Texture2D:
	if avatar_tex.has(uid):
		return avatar_tex[uid]
	if avatar_bytes.has(uid):
		avatar_tex[uid] = Profile.texture_from_bytes(avatar_bytes[uid])
		return avatar_tex[uid]
	return null


func _me_seat() -> Dictionary:
	return {"name": Profile.player_name, "uid": Profile.uid, "peer": 1, "bot": false, "level": 1, "away": false}


func _bot_seat(level: int) -> Dictionary:
	var used := {}
	for s in seats:
		used[s.name] = true
	var pool := BOT_NAMES.filter(func(x: String) -> bool: return not used.has(x))
	var nm: String = pool[rng.randi_range(0, pool.size() - 1)] if not pool.is_empty() else "Бот"
	return {"name": nm, "uid": "bot-%s-%d" % [nm, rng.randi()], "peer": 0, "bot": true, "level": level, "away": false}


func _store_my_avatar() -> void:
	avatar_bytes[Profile.uid] = Profile.avatar
	avatar_tex.erase(Profile.uid)


# ================================================================ локальная игра

func start_local(bots: int, level: int, mode: String, cheats: bool) -> void:
	leave()
	role = Role.LOCAL
	settings = {"mode": mode, "cheats": cheats, "level": level}
	seats = [_me_seat()]
	for i in bots:
		seats.append(_bot_seat(level))
	_store_my_avatar()
	my_seat = 0
	_new_game()


# ================================================================ хост

func host_room() -> String:
	leave()
	_peer = ENetMultiplayerPeer.new()
	var err := _peer.create_server(PORT, MAX_PLAYERS)
	if err != OK:
		_peer = null
		return "Не удалось создать комнату (порт занят?)"
	multiplayer.multiplayer_peer = _peer
	role = Role.HOST
	settings = {"mode": Profile.settings.mode, "cheats": Profile.settings.cheats, "level": Profile.settings.level}
	seats = [_me_seat()]
	_store_my_avatar()
	my_seat = 0
	running = false
	host_name = Profile.player_name
	host_ip = ", ".join(local_ips())
	_udp_out = PacketPeerUDP.new()
	_udp_out.set_broadcast_enabled(true)
	_push_lobby()
	return ""


func add_bot() -> void:
	if not is_host_like() or running or seats.size() >= MAX_PLAYERS:
		return
	seats.append(_bot_seat(int(settings.level)))
	_push_lobby()


func remove_seat(i: int) -> void:
	if role != Role.HOST or running or i <= 0 or i >= seats.size():
		return
	var s: Dictionary = seats[i]
	seats.remove_at(i)
	if not s.bot and s.peer > 0:
		_rx_reject.rpc_id(s.peer, "Хост убрал вас из комнаты")
		_peer.disconnect_peer(s.peer)
	_push_lobby()


func set_setting(key: String, value: Variant) -> void:
	if not is_host_like() or running:
		return
	settings[key] = value
	if key == "level":
		for s in seats:
			if s.bot:
				s.level = value
	_push_lobby()


func start_game() -> String:
	if role != Role.HOST:
		return ""
	if seats.size() < 2:
		return "Нужно хотя бы 2 игрока — добавьте бота"
	_new_game()
	return ""


func rematch() -> void:
	if is_host_like():
		_new_game()


func _new_game() -> void:
	game = DurakGame.new()
	game.setup(seats.size(), 0, String(settings.mode), bool(settings.cheats))
	running = true
	_bot_timer = 4.0  # дать время анимации раздачи
	_push_lobby()
	_broadcast()


func _push_lobby() -> void:
	if role == Role.HOST:
		_rx_lobby.rpc(_lobby_info())
	lobby_changed.emit()


func _lobby_info() -> Dictionary:
	var pub := []
	for s in seats:
		pub.append({"name": s.name, "uid": s.uid, "bot": s.bot, "level": s.level, "away": s.away})
	return {"seats": pub, "settings": settings, "running": running, "host": host_name, "ip": host_ip}


## Разослать каждому его состояние и новые события.
func _broadcast() -> void:
	if game == null:
		return
	var events := game.take_events()
	for i in seats.size():
		var s: Dictionary = seats[i]
		if s.bot or s.away:
			continue
		var v := game.view_for(i)
		if s.peer == 1 or role == Role.LOCAL:
			_apply_view(v, events)
		elif role == Role.HOST:
			_rx_view.rpc_id(s.peer, v, events)


## Действие игрока (своё — напрямую, клиента — через RPC хосту).
func send_action(a: Dictionary) -> void:
	if role == Role.CLIENT:
		_rx_action.rpc_id(1, a)
	elif is_host_like():
		_apply_action(my_seat, a)


func _apply_action(seat: int, a: Dictionary) -> void:
	if game == null or not running:
		return
	var err := game.act(seat, a)
	if err != "":
		_send_toast(seat, err)
		return
	_after_change()


## После хода: если все сказали «Пас» — сразу «бито» или «взял».
func _after_change() -> void:
	if game.ready_to_resolve():
		game.resolve()
		_bot_timer = maxf(_bot_timer, 2.4)
	_broadcast()


func _send_toast(seat: int, text: String) -> void:
	var s: Dictionary = seats[seat]
	if s.peer == 1 or role == Role.LOCAL:
		toast.emit(text)
	elif s.peer > 0 and role == Role.HOST:
		_rx_toast.rpc_id(s.peer, text)


func _process(delta: float) -> void:
	_net_discovery(delta)
	if not is_host_like() or game == null or not running:
		return
	if game.over:
		return
	_bot_timer -= delta
	if _bot_timer <= 0.0:
		_bot_timer = rng.randf_range(1.1, 1.7)
		_bot_step()


func _bot_step() -> void:
	var order := [game.defender]
	for k in range(game.n):
		var j := (game.attacker + k) % game.n
		if j != game.defender:
			order.append(j)
	for i in order:
		var s: Dictionary = seats[i]
		if not (s.bot or s.away):
			continue
		var lvl: int = s.level if s.bot else 1
		var a := DurakBot.try_catch(game, i, lvl, rng)
		if a.is_empty():
			a = DurakBot.decide(game, i, lvl, rng)
		if a.is_empty():
			continue
		if game.act(i, a) == "":
			_after_change()
			return


func _apply_view(v: Dictionary, events: Array) -> void:
	view = v
	my_seat = int(v.get("seat", my_seat))
	view_changed.emit(v, events)


# ================================================================ клиент

func join(ip: String) -> String:
	leave()
	_peer = ENetMultiplayerPeer.new()
	var err := _peer.create_client(ip.strip_edges(), PORT)
	if err != OK:
		_peer = null
		return "Не удалось подключиться"
	multiplayer.multiplayer_peer = _peer
	role = Role.CLIENT
	host_ip = ip
	_store_my_avatar()
	return ""


func _on_connected() -> void:
	_rx_hello.rpc_id(1, Profile.player_name, Profile.uid, Profile.avatar)


func _on_connection_failed() -> void:
	var r := role
	leave()
	if r == Role.CLIENT:
		closed.emit("Не удалось подключиться к хосту")


func _on_server_disconnected() -> void:
	leave()
	closed.emit("Хост закрыл комнату")


func leave() -> void:
	if _peer != null:
		_peer.close()
	multiplayer.multiplayer_peer = OfflineMultiplayerPeer.new()
	_peer = null
	_udp_out = null
	role = Role.NONE
	running = false
	game = null
	seats = []
	view = {}


# ================================================================ RPC

@rpc("any_peer", "reliable")
func _rx_hello(nm: String, uid: String, avatar: PackedByteArray) -> void:
	if role != Role.HOST:
		return
	var peer := multiplayer.get_remote_sender_id()
	nm = nm.strip_edges().left(16)
	if nm == "":
		nm = "Игрок"
	avatar_bytes[uid] = avatar
	avatar_tex.erase(uid)
	var idx := -1
	for i in seats.size():
		if seats[i].uid == uid:
			idx = i
	if idx >= 0:
		seats[idx].peer = peer
		seats[idx].away = false
		seats[idx].name = nm
	elif running:
		_rx_reject.rpc_id(peer, "Игра уже идёт")
		return
	elif seats.size() >= MAX_PLAYERS:
		_rx_reject.rpc_id(peer, "Комната заполнена")
		return
	else:
		seats.append({"name": nm, "uid": uid, "peer": peer, "bot": false, "level": 1, "away": false})
	# Аватары: новичку — все, остальным — новичка.
	for k in avatar_bytes.keys():
		if not avatar_bytes[k].is_empty():
			_rx_avatar.rpc_id(peer, k, avatar_bytes[k])
	if not avatar.is_empty():
		for s in seats:
			if s.peer > 1 and s.peer != peer:
				_rx_avatar.rpc_id(s.peer, uid, avatar)
	avatars_changed.emit()
	_push_lobby()
	if idx >= 0 and running:
		_broadcast_toast("%s вернулся" % nm)
		_rx_view.rpc_id(peer, game.view_for(idx), [])


@rpc("authority", "reliable")
func _rx_lobby(info: Dictionary) -> void:
	seats = info.seats
	settings = info.settings
	host_name = info.host
	var was := running
	running = info.running
	for i in seats.size():
		if seats[i].uid == Profile.uid:
			my_seat = i
	lobby_changed.emit()
	if was and not running:
		view = {}


@rpc("authority", "reliable")
func _rx_avatar(uid: String, bytes: PackedByteArray) -> void:
	avatar_bytes[uid] = bytes
	avatar_tex.erase(uid)
	avatars_changed.emit()


@rpc("authority", "reliable")
func _rx_view(v: Dictionary, events: Array) -> void:
	_apply_view(v, events)


@rpc("authority", "reliable")
func _rx_toast(text: String) -> void:
	toast.emit(text)


@rpc("authority", "reliable")
func _rx_reject(reason: String) -> void:
	leave()
	closed.emit(reason)


@rpc("any_peer", "reliable")
func _rx_action(a: Dictionary) -> void:
	if role != Role.HOST:
		return
	var peer := multiplayer.get_remote_sender_id()
	for i in seats.size():
		if seats[i].peer == peer and not seats[i].bot:
			_apply_action(i, a)
			return


func _broadcast_toast(text: String) -> void:
	toast.emit(text)
	if role == Role.HOST:
		_rx_toast.rpc(text)


func _on_peer_connected(_id: int) -> void:
	pass


func _on_peer_disconnected(peer: int) -> void:
	if role != Role.HOST:
		return
	for i in seats.size():
		if seats[i].peer == peer and not seats[i].bot:
			if running:
				seats[i].away = true
				seats[i].peer = -1
				_broadcast_toast("%s отключился — пока играет бот" % seats[i].name)
			else:
				seats.remove_at(i)
			_push_lobby()
			return


# ================================================================ поиск комнат

func local_ips() -> Array:
	var res := []
	for a in IP.get_local_addresses():
		if a.contains(":") or a.begins_with("127.") or a.begins_with("169.254"):
			continue
		if a.begins_with("192.168.") or a.begins_with("10.") or a.begins_with("172."):
			res.append(a)
	return res


func start_scan() -> void:
	stop_scan()
	_rooms = {}
	_udp_in = PacketPeerUDP.new()
	if _udp_in.bind(DISCOVERY_PORT) != OK:
		_udp_in = null


func stop_scan() -> void:
	if _udp_in != null:
		_udp_in.close()
	_udp_in = null


func _net_discovery(delta: float) -> void:
	if role == Role.HOST and _udp_out != null:
		_announce_timer -= delta
		if _announce_timer <= 0.0:
			_announce_timer = 1.0
			var msg := JSON.stringify({"durak": 1, "name": host_name, "players": seats.size(), "running": running}).to_utf8_buffer()
			var targets := ["255.255.255.255"]
			for ip in local_ips():
				var parts: PackedStringArray = ip.split(".")
				targets.append("%s.%s.%s.255" % [parts[0], parts[1], parts[2]])
			for t in targets:
				_udp_out.set_dest_address(t, DISCOVERY_PORT)
				_udp_out.put_packet(msg)
	if _udp_in != null:
		var now := Time.get_ticks_msec()
		while _udp_in.get_available_packet_count() > 0:
			var pkt := _udp_in.get_packet()
			var ip := _udp_in.get_packet_ip()
			var d: Variant = JSON.parse_string(pkt.get_string_from_utf8())
			if d is Dictionary and d.has("durak"):
				_rooms[ip] = {"ip": ip, "name": str(d.get("name", "?")), "players": int(d.get("players", 1)),
					"running": bool(d.get("running", false)), "seen": now}
		_rooms_emit_timer -= delta
		if _rooms_emit_timer <= 0.0:
			_rooms_emit_timer = 0.5
			var list := []
			for ip in _rooms.keys():
				if now - int(_rooms[ip].seen) < 3500:
					list.append(_rooms[ip])
			rooms_changed.emit(list)
