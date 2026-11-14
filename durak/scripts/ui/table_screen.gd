class_name TableScreen
extends Control
## Игровой стол. Получает от Session состояние игрока и события и анимирует
## их: раздача, ходы, «бито», «беру», добор, поимка на обмане.
## Управление: коснуться карты — выбрать, ещё раз — сыграть; или перетащить
## на стол / на карту, которую бьёте. Коснуться карты на столе — «Обман?».

signal leave_requested

const TS := 0.9           # масштаб карт на столе
const HAND_SCALE := 1.16
const MOVE := 0.55

var view: Dictionary = {}
var me := 0
var nodes := {}            # card -> CardView (известные карты: рука и стол)
var opp_views := {}        # seat -> OpponentView
var selected := -1

var cards_layer: Control
var fx_layer: Control
var deck_cards: Array[CardView] = []
var trump_view: CardView
var deck_label: Label
var discard_cards: Array[CardView] = []
var me_avatar: AvatarView
var me_name: Label
var status_label: Label
var take_btn: Button
var pass_btn: Button
var exit_btn: Button
var info_label: Label
var trump_chip: Control
var toasts: VBoxContainer
var call_pill: Button
var result: Control
var _call_target := {}
var _exit_armed := 0.0

# Геометрия (пересчитывается под экран).
var W := 720.0
var H := 1440.0
var margins := Vector4(32, 48, 32, 32)
var opp_top := 120.0
var hand_y := 1300.0
var bar_y := 1140.0
var table_c := Vector2(360, 700)
var deck_pos := Vector2(30, 700)
var discard_pos := Vector2(690, 700)


func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_PASS
	_metrics()
	var bg := ColorRect.new()
	bg.color = UI.BG
	bg.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	bg.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(bg)
	# Мягкое «сукно» под столом.
	var felt := Felt.new()
	felt.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	felt.mouse_filter = Control.MOUSE_FILTER_IGNORE
	felt.screen = self
	add_child(felt)

	deck_label = UI.label("", 22, UI.MUTED, true, 600)
	add_child(deck_label)
	for i in 3:
		var b := CardView.new()
		b.face_up = false
		b.scale = Vector2(TS, TS)
		b.rotation = PI / 2.0
		add_child(b)
		deck_cards.append(b)
	trump_view = CardView.new()
	trump_view.scale = Vector2(TS, TS)
	add_child(trump_view)
	move_child(trump_view, deck_cards[0].get_index())

	cards_layer = Control.new()
	cards_layer.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	cards_layer.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(cards_layer)

	# Нижняя панель: я, статус, кнопки.
	me_avatar = AvatarView.new(72)
	add_child(me_avatar)
	me_name = UI.label("", 22, UI.TEXT, false, 700)
	add_child(me_name)
	status_label = UI.label("", 26, UI.TEXT, true, 500)
	status_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	add_child(status_label)
	take_btn = UI.button("Беру", "danger", 26)
	take_btn.custom_minimum_size = Vector2(170, 80)
	take_btn.pressed.connect(func() -> void: Session.send_action({"t": "take"}))
	add_child(take_btn)
	pass_btn = UI.button("Бито", "primary", 26)
	pass_btn.custom_minimum_size = Vector2(170, 80)
	pass_btn.pressed.connect(func() -> void: Session.send_action({"t": "pass"}))
	add_child(pass_btn)

	exit_btn = UI.button("✕", "ghost", 26)
	exit_btn.custom_minimum_size = Vector2(72, 72)
	exit_btn.add_theme_stylebox_override("normal", UI.box(Color(0, 0, 0, 0), 999, UI.LINE, 2))
	exit_btn.pressed.connect(_on_exit)
	add_child(exit_btn)
	info_label = UI.label("", 18, UI.MUTED, false, 800)
	add_child(info_label)
	trump_chip = TrumpChip.new()
	add_child(trump_chip)


	fx_layer = Control.new()
	fx_layer.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	fx_layer.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(fx_layer)

	call_pill = UI.button("Обман?", "danger", 24)
	call_pill.custom_minimum_size = Vector2(150, 64)
	call_pill.visible = false
	call_pill.pressed.connect(_confirm_call)
	call_pill.z_index = 450
	add_child(call_pill)

	toasts = VBoxContainer.new()
	toasts.mouse_filter = Control.MOUSE_FILTER_IGNORE
	toasts.alignment = BoxContainer.ALIGNMENT_BEGIN
	toasts.add_theme_constant_override("separation", 8)
	toasts.z_index = 450
	add_child(toasts)

	Session.view_changed.connect(show_view)
	Session.toast.connect(func(t: String) -> void:
		show_toast(t)
		_sync_cards({}, 0.0, false))
	Session.avatars_changed.connect(_update_hud)
	get_viewport().size_changed.connect(_on_resize)
	if not Session.view.is_empty():
		show_view(Session.view, [{"t": "deal"}])


func _on_resize() -> void:
	_metrics()
	if not view.is_empty():
		_build_opponents()
		_sync_cards({}, 0.0, false)
		_update_hud()


func _metrics() -> void:
	var vs := get_viewport_rect().size
	W = vs.x
	H = vs.y
	margins = UI.safe_margins(self)
	opp_top = margins.y + 64
	hand_y = H - margins.w - 124
	bar_y = hand_y - 190
	var table_top := opp_top + 230
	table_c = Vector2(W / 2.0, (table_top + bar_y - 50) / 2.0 + 10)
	deck_pos = Vector2(34, table_c.y - 6)
	discard_pos = Vector2(W - 20, table_c.y - 6)


func _process(delta: float) -> void:
	if _exit_armed > 0.0:
		_exit_armed -= delta


# ================================================================ состояние

func show_view(v: Dictionary, events: Array) -> void:
	var rebuild := view.is_empty() or int(view.get("n", 0)) != int(v.n) or int(view.get("seat", -1)) != int(v.seat)
	view = v
	me = int(v.seat)
	if rebuild:
		_build_opponents()
	if result != null and not v.over:
		result.queue_free()
		result = null
	var origin := {}
	var delay := 0.0
	var deal := false
	var played := false
	for e in events:
		match String(e.t):
			"deal":
				deal = true
				_clear_cards()
				selected = -1
			"attack", "defend", "transfer":
				played = true
				if int(e.seat) != me:
					origin[int(e.card)] = _seat_pos(int(e.seat))
				if e.t == "transfer":
					show_toast("%s переводит на %s" % [_name(int(e.seat)), _name(int(e.to))])
			"caught":
				delay = 1.1
				var n: CardView = nodes.get(int(e.card))
				if n != null:
					n.stamp = "ОБМАН"
					_shake(n)
				for b in e.back:
					if int(b.to) != me and nodes.has(int(b.card)):
						_fly_away(nodes[int(b.card)], _seat_pos(int(b.to)), 1.1, 0.35)
				show_toast("%s поймал(а) %s на обмане" % [_name(int(e.seat)), _name(int(e.cheater))], UI.ACCENT)
				Sfx.caught()
				if int(e.cheater) == me:
					Profile.vibrate(220)
			"false_call":
				show_toast("%s: ложная тревога — всё честно" % _name(int(e.seat)))
				var fn: CardView = nodes.get(int(e.card))
				if fn != null:
					_shake(fn)
			"beat":
				var k := 0
				for c in e.cards:
					if nodes.has(int(c)):
						_fly_away(nodes[int(c)], discard_pos + Vector2(randf_range(-10, 10), randf_range(-30, 30)), 0.7 + k * 0.06, TS, true)
						k += 1
				Sfx.card()
			"took":
				if int(e.seat) != me:
					var k := 0
					for c in e.cards:
						if nodes.has(int(c)):
							_fly_away(nodes[int(c)], _seat_pos(int(e.seat)), 0.7 + k * 0.06, 0.3, true)
							k += 1
					_bump(int(e.seat), 1.3)
			"take":
				if int(e.seat) != me:
					show_toast("%s берёт" % _name(int(e.seat)))
			"draw":
				if int(e.seat) != me:
					for k in int(e.n):
						_fly_back(deck_pos, _seat_pos(int(e.seat)), 1.2 + k * 0.14)
					_bump(int(e.seat), 1.8 + int(e.n) * 0.14)
			"out":
				_gap_nest(int(e.seat))
			"over":
				get_tree().create_timer(1.3).timeout.connect(_show_result)
	if played:
		Sfx.card()
	if deal:
		_deal_backs()
	_sync_cards(origin, delay, deal)
	_update_hud()
	if v.over and events.is_empty() and result == null:
		_show_result()


func _clear_cards() -> void:
	for c in nodes.keys():
		nodes[c].queue_free()
	nodes.clear()
	for ch in fx_layer.get_children():
		ch.queue_free()


func _name(seat: int) -> String:
	return Session.seat_name(seat)


func _hand() -> Array:
	return view.get("hand", [])


func _can() -> Dictionary:
	return view.get("can", {})


func _seat_pos(seat: int) -> Vector2:
	if seat == me:
		return Vector2(W / 2.0, hand_y)
	if opp_views.has(seat):
		return opp_views[seat].center()
	return Vector2(W / 2.0, opp_top)


# ================================================================ соперники

func _build_opponents() -> void:
	for s in opp_views.keys():
		opp_views[s].queue_free()
	opp_views.clear()
	var n := int(view.n)
	var others := []
	for k in range(1, n):
		others.append((me + k) % n)
	var k := others.size()
	var fr: Array = [[0.5], [0.27, 0.73], [0.17, 0.5, 0.83], [0.12, 0.37, 0.63, 0.88], [0.1, 0.3, 0.5, 0.7, 0.9]][maxi(k - 1, 0)]
	var sc := 1.0 if k <= 3 else (0.86 if k == 4 else 0.78)
	for i in k:
		var ov := OpponentView.new()
		ov.scale = Vector2(sc, sc)
		var f: float = fr[i]
		var lift := pow(absf(f - 0.5) * 2.0, 2.0) * 80.0 if k >= 3 else 0.0
		ov.position = Vector2(W * f - ov.size.x * sc / 2.0, opp_top - 40 + lift)
		add_child(ov)
		move_child(ov, cards_layer.get_index())
		opp_views[others[i]] = ov


func _bump(seat: int, delay: float) -> void:
	if opp_views.has(seat):
		get_tree().create_timer(delay).timeout.connect(opp_views[seat].bump)


# ================================================================ карты

func _slot_pos(i: int, count: int) -> Vector2:
	var rows := 1 if count <= 3 else 2
	var row := i / 3
	var col := i % 3
	var in_row := mini(3, count - row * 3)
	var x := W / 2.0 + (col - (in_row - 1) / 2.0) * minf(172.0, (W - 150) / 3.0) - 10.0
	var y := table_c.y + (row - (rows - 1) / 2.0) * 228.0 - 16.0
	return Vector2(x, y)


func _jitter(c: int) -> float:
	return (((c * 37) % 9) - 4) * 0.012


func _hand_layout(count: int) -> Array:
	var res := []
	var sc := HAND_SCALE if count <= 9 else 1.0
	var cw := CardArt.W * sc
	var usable := W - 30.0
	var step := minf(92.0, (usable - cw) / maxf(1.0, count - 1))
	var total := cw + step * (count - 1)
	var x0 := W / 2.0 - total / 2.0 + cw / 2.0
	for i in count:
		var t := 0.0 if count <= 1 else (float(i) / (count - 1)) * 2.0 - 1.0
		var spread := minf(1.0, count / 8.0)
		res.append({"pos": Vector2(x0 + i * step, hand_y + t * t * 16.0 * spread), "rot": t * 0.13 * spread, "scale": sc})
	return res


func _sync_cards(origin: Dictionary, delay: float, deal: bool) -> void:
	if view.is_empty():
		return
	var keep := {}
	var tbl: Array = view.table
	for i in tbl.size():
		var p: Dictionary = tbl[i]
		var pos := _slot_pos(i, tbl.size())
		_place(int(p.a), pos, -0.04 + _jitter(int(p.a)), TS, 10 + i * 2, origin, delay, false)
		keep[int(p.a)] = true
		if int(p.d) >= 0:
			_place(int(p.d), pos + Vector2(22, 30), 0.07 + _jitter(int(p.d)), TS, 11 + i * 2, origin, delay, false)
			keep[int(p.d)] = true
	var hand := _hand()
	var lay := _hand_layout(hand.size())
	var fresh := 0
	var n := int(view.n)
	var my_order := (me - int(view.attacker) + n) % n
	for i in hand.size():
		var c: int = hand[i]
		var d := delay
		var is_new := not nodes.has(c)
		if is_new:
			if deal:
				d += 0.4 + (fresh * n + my_order) * 0.13
			else:
				d += 1.2 + fresh * 0.14
			fresh += 1
		var pos: Vector2 = lay[i].pos
		if c == selected:
			pos.y -= 42.0
		_place(c, pos, lay[i].rot, lay[i].scale, 100 + i, origin, d, is_new and not origin.has(c))
		keep[c] = true
		nodes[c].selected = c == selected
		nodes[c].stamp = nodes[c].stamp if not keep.has(c) else nodes[c].stamp
	if selected >= 0 and not hand.has(selected):
		selected = -1
	for c in nodes.keys():
		if not keep.has(c):
			_fly_away(nodes[c], discard_pos, delay, TS, true)
	# Подсветка целей, когда выбрана карта и я отбиваюсь.
	var defending := me == int(view.defender) and bool(_can().get("defend", false))
	for i in tbl.size():
		var a: CardView = nodes.get(int(tbl[i].a))
		if a != null:
			a.glow = defending and selected >= 0 and int(tbl[i].d) < 0


func _place(c: int, pos: Vector2, rot: float, sc: float, z: int, origin: Dictionary, delay: float, from_deck: bool) -> void:
	var n: CardView = nodes.get(c)
	if n == null:
		n = CardView.new()
		n.card = c
		n.trump = int(view.trump)
		n.set_interactive(true)
		n.pressed.connect(_on_card_pressed)
		n.drag_started.connect(_on_drag_start)
		n.dragged.connect(_on_drag)
		n.dropped.connect(_on_drop)
		cards_layer.add_child(n)
		nodes[c] = n
		var o: Vector2 = origin.get(c, deck_pos)
		n.position = o - n.size / 2.0
		n.scale = Vector2(0.45, 0.45) if origin.has(c) else Vector2(TS, TS)
		n.rotation = PI / 2.0 if from_deck else 0.0
		if from_deck:
			n.face_up = false
			n.flip_to(true, delay + MOVE * 0.5, 0.36)
		if delay > 0.0:
			n.visible = false
			var wr: WeakRef = weakref(n)
			get_tree().create_timer(delay).timeout.connect(func() -> void:
				var nn: CardView = wr.get_ref()
				if nn != null:
					nn.visible = true
					Sfx.card())
	n.z_index = z
	_move(n, pos, rot, sc, delay)
	if n.stamp != "":
		var wr2: WeakRef = weakref(n)
		get_tree().create_timer(delay + MOVE + 0.1).timeout.connect(func() -> void:
			var nn: CardView = wr2.get_ref()
			if nn != null:
				nn.stamp = "")


func _move(n: CardView, pos: Vector2, rot: float, sc: float, delay: float) -> void:
	if n.tween != null and n.tween.is_valid():
		n.tween.kill()
	n.home_pos = pos
	n.home_rot = rot
	var target := pos - n.size / 2.0
	if n.position.distance_to(target) < 0.5 and absf(n.rotation - rot) < 0.001 and absf(n.scale.x - sc) < 0.001:
		return
	n.tween = n.create_tween().set_parallel(true)
	n.tween.tween_property(n, "position", target, MOVE).set_delay(delay).set_trans(Tween.TRANS_QUART).set_ease(Tween.EASE_OUT)
	n.tween.tween_property(n, "rotation", rot, MOVE).set_delay(delay).set_trans(Tween.TRANS_QUART).set_ease(Tween.EASE_OUT)
	n.tween.tween_property(n, "scale", Vector2(sc, sc), MOVE).set_delay(delay).set_trans(Tween.TRANS_QUART).set_ease(Tween.EASE_OUT)


func _fly_away(n: CardView, to: Vector2, delay: float, sc: float, face_down: bool = false) -> void:
	nodes.erase(n.card)
	n.leaving = true
	n.set_interactive(false)
	n.glow = false
	n.selected = false
	n.z_index = 300
	if n.tween != null and n.tween.is_valid():
		n.tween.kill()
	if face_down:
		n.flip_to(false, delay + 0.1, 0.36)
	var t := n.create_tween().set_parallel(true)
	t.tween_property(n, "position", to - n.size / 2.0, 0.65).set_delay(delay).set_trans(Tween.TRANS_QUART).set_ease(Tween.EASE_IN_OUT)
	t.tween_property(n, "rotation", randf_range(-0.3, 0.3), 0.65).set_delay(delay).set_trans(Tween.TRANS_SINE)
	t.tween_property(n, "scale", Vector2(sc, sc), 0.65).set_delay(delay).set_trans(Tween.TRANS_SINE)
	t.tween_property(n, "modulate:a", 0.0, 0.25).set_delay(delay + 0.5)
	t.chain().tween_callback(n.queue_free)


func _fly_back(from: Vector2, to: Vector2, delay: float) -> void:
	var b := CardView.new()
	b.face_up = false
	b.position = from - b.size / 2.0
	b.scale = Vector2(TS, TS)
	b.rotation = PI / 2.0
	b.visible = false
	b.z_index = 250
	fx_layer.add_child(b)
	var t := b.create_tween()
	t.tween_interval(delay)
	t.tween_callback(func() -> void: b.visible = true)
	t.set_parallel(true)
	t.tween_property(b, "position", to - b.size / 2.0, 0.6).set_delay(delay).set_trans(Tween.TRANS_QUART).set_ease(Tween.EASE_OUT)
	t.tween_property(b, "scale", Vector2(0.3, 0.3), 0.6).set_delay(delay).set_trans(Tween.TRANS_SINE)
	t.tween_property(b, "rotation", randf_range(-0.25, 0.25), 0.6).set_delay(delay).set_trans(Tween.TRANS_SINE)
	t.chain().tween_callback(b.queue_free)


func _deal_backs() -> void:
	var n := int(view.n)
	for s in opp_views.keys():
		var order := (int(s) - int(view.attacker) + n) % n
		for k in 6:
			_fly_back(deck_pos, _seat_pos(int(s)), 0.4 + (k * n + order) * 0.13)


func _shake(n: CardView) -> void:
	var r := n.rotation
	var t := n.create_tween()
	for i in 4:
		t.tween_property(n, "rotation", r + (0.08 if i % 2 == 0 else -0.08), 0.09).set_trans(Tween.TRANS_SINE)
	t.tween_property(n, "rotation", r, 0.09).set_trans(Tween.TRANS_SINE)


# ================================================================ ввод

func _on_card_pressed(n: CardView) -> void:
	if view.is_empty() or view.over:
		return
	if _hand().has(n.card):
		if selected == n.card:
			_play_default(n.card)
		else:
			selected = n.card
			Sfx.tick()
			_sync_cards({}, 0.0, false)
	else:
		_tap_table(n)


func _tap_table(n: CardView) -> void:
	var slot := -1
	var which := "a"
	var tbl: Array = view.table
	for i in tbl.size():
		if int(tbl[i].a) == n.card:
			slot = i
		elif int(tbl[i].d) == n.card:
			slot = i
			which = "d"
	if slot < 0:
		return
	var p: Dictionary = tbl[slot]
	if selected >= 0 and me == int(view.defender) and which == "a" and int(p.d) < 0 and _can().get("defend", false):
		var c := selected
		selected = -1
		Session.send_action({"t": "defend", "card": c, "slot": slot})
		return
	var by := int(p.d_by) if which == "d" else int(p.a_by)
	if not _can().get("call", false) or by == me:
		return
	_call_target = {"slot": slot, "which": which, "card": n.card}
	call_pill.visible = true
	call_pill.position = n.home_pos + Vector2(-75, -120)
	call_pill.scale = Vector2(0.6, 0.6)
	call_pill.pivot_offset = call_pill.size / 2.0
	var t := call_pill.create_tween()
	t.tween_property(call_pill, "scale", Vector2.ONE, 0.18).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	var token := Time.get_ticks_msec()
	call_pill.set_meta("token", token)
	get_tree().create_timer(2.6).timeout.connect(func() -> void:
		if call_pill.get_meta("token", 0) == token:
			call_pill.visible = false)


func _confirm_call() -> void:
	call_pill.visible = false
	if _call_target.is_empty():
		return
	Session.send_action({"t": "call", "slot": _call_target.slot, "which": _call_target.which})
	_call_target = {}


func _undefended_slots() -> Array:
	var res := []
	var tbl: Array = view.table
	for i in tbl.size():
		if int(tbl[i].d) < 0:
			res.append(i)
	return res


func _play_default(c: int) -> void:
	var can := _can()
	selected = -1
	if me == int(view.defender):
		if not can.get("defend", false):
			_sync_cards({}, 0.0, false)
			return
		var open := _undefended_slots()
		var transfer_ok: bool = can.get("transfer", []).has(c)
		if transfer_ok and (open.size() != 1 or not Cards.beats(c, int(view.table[open[0]].a), int(view.trump))):
			Session.send_action({"t": "transfer", "card": c})
		elif open.size() == 1:
			Session.send_action({"t": "defend", "card": c, "slot": open[0]})
		else:
			selected = c
			show_toast("Коснитесь карты на столе, которую бьёте")
			_sync_cards({}, 0.0, false)
	elif can.get("attack", false):
		Session.send_action({"t": "attack", "card": c})
	else:
		_sync_cards({}, 0.0, false)


func _on_drag_start(n: CardView) -> void:
	if not _hand().has(n.card):
		return
	if n.tween != null and n.tween.is_valid():
		n.tween.kill()
	n.z_index = 400
	n.rotation = 0.0
	n.scale = Vector2(1.06, 1.06)
	selected = n.card
	_sync_glow()


func _sync_glow() -> void:
	var defending := me == int(view.defender) and bool(_can().get("defend", false))
	for p in view.table:
		var a: CardView = nodes.get(int(p.a))
		if a != null:
			a.glow = defending and int(p.d) < 0


func _on_drag(n: CardView, pos: Vector2) -> void:
	if _hand().has(n.card):
		n.position = pos - n.size / 2.0 - Vector2(0, 60)


func _on_drop(n: CardView, pos: Vector2) -> void:
	if not _hand().has(n.card):
		return
	var c := n.card
	selected = -1
	var drop := pos - Vector2(0, 60)
	var in_table := drop.y > opp_top + 150 and drop.y < bar_y - 10
	var can := _can()
	if me == int(view.defender) and can.get("defend", false):
		var tbl: Array = view.table
		var best := -1
		var best_d := 120.0
		for i in tbl.size():
			if int(tbl[i].d) >= 0:
				continue
			var a: CardView = nodes.get(int(tbl[i].a))
			if a != null and a.home_pos.distance_to(drop) < best_d:
				best_d = a.home_pos.distance_to(drop)
				best = i
		if best >= 0:
			Session.send_action({"t": "defend", "card": c, "slot": best})
			return
		if in_table and can.get("transfer", []).has(c):
			Session.send_action({"t": "transfer", "card": c})
			return
		if in_table and _undefended_slots().size() == 1:
			Session.send_action({"t": "defend", "card": c, "slot": _undefended_slots()[0]})
			return
	elif in_table and can.get("attack", false):
		Session.send_action({"t": "attack", "card": c})
		return
	_sync_cards({}, 0.0, false)


func _on_exit() -> void:
	if view.get("over", false) or _exit_armed > 0.0:
		leave_requested.emit()
		return
	_exit_armed = 2.2
	show_toast("Нажмите ещё раз, чтобы выйти")


func back_pressed() -> void:
	_on_exit()


# ================================================================ HUD

func _update_hud() -> void:
	if view.is_empty():
		return
	var n := int(view.n)
	var passed: Array = view.passed
	var outs: Array = view.out
	for s in opp_views.keys():
		var st := ""
		var ring := Color(0, 0, 0, 0)
		if outs[s]:
			st = "гап нест"
		elif int(s) == int(view.defender):
			st = "берёт" if view.taking else "отбивается"
			ring = UI.ACCENT
		elif int(s) == int(view.attacker):
			st = "ходит"
			ring = UI.TEXT
		elif passed.has(s):
			st = "пас"
		opp_views[s].set_info(_name(s), Session.avatar_for(Session.seat_uid(s)), int(view.counts[s]), st, ring, outs[s])
	# Колода и козырь.
	var deck_n := int(view.deck)
	deck_label.text = str(deck_n) if deck_n > 0 else ""
	deck_label.position = deck_pos + Vector2(-16, 70)
	for i in deck_cards.size():
		var b := deck_cards[i]
		b.visible = deck_n > i + 1 or (i == 0 and deck_n > 1)
		b.position = deck_pos - b.size / 2.0 + Vector2(-8 + i * 2, -i * 2)
	trump_view.card = int(view.trump_card)
	trump_view.trump = int(view.trump)
	trump_view.visible = deck_n > 0
	trump_view.position = deck_pos - trump_view.size / 2.0 + Vector2(44, 0)
	trump_view.rotation = 0.0
	# Сброс.
	var disc := int(view.discard)
	var want := mini(4, (disc + 5) / 6)
	while discard_cards.size() < want:
		var d := CardView.new()
		d.face_up = false
		d.scale = Vector2(TS, TS)
		d.rotation = randf_range(-0.6, 0.6) + PI / 2.0
		add_child(d)
		move_child(d, cards_layer.get_index())
		discard_cards.append(d)
	while discard_cards.size() > want:
		discard_cards.pop_back().queue_free()
	for d in discard_cards:
		d.position = discard_pos - d.size / 2.0 + Vector2(30, 0)
	# Верхняя строка.
	exit_btn.position = Vector2(margins.x, margins.y - 4)
	trump_chip.set("suit", int(view.trump))
	trump_chip.position = Vector2(W - margins.z - trump_chip.size.x, margins.y)
	trump_chip.queue_redraw()
	var mode_txt := "ПЕРЕВОДНОЙ" if view.mode == "perevodnoy" else "ПОДКИДНОЙ"
	if view.cheats:
		mode_txt += " · С ОБМАНОМ"
	info_label.text = mode_txt
	info_label.position = Vector2(margins.x + 90, margins.y + 18)
	# Я.
	me_avatar.position = Vector2(margins.x, bar_y - 36)
	me_avatar.display_name = Profile.player_name
	me_avatar.texture = Session.avatar_for(Profile.uid)
	var my_ring := Color(0, 0, 0, 0)
	if me == int(view.defender):
		my_ring = UI.ACCENT
	elif me == int(view.attacker):
		my_ring = UI.TEXT
	me_avatar.ring = my_ring
	status_label.text = _status_text()
	status_label.position = Vector2(margins.x + 88, bar_y - 34)
	status_label.size = Vector2(W - margins.x - 88 - 200 - margins.z, 70)
	var can := _can()
	take_btn.visible = can.get("take", false)
	pass_btn.visible = can.get("pass", false) and not take_btn.visible
	pass_btn.text = "Пас"
	for b in [take_btn, pass_btn]:
		b.size = b.custom_minimum_size
		b.position = Vector2(W - margins.z - b.size.x, bar_y - 40)
	toasts.position = Vector2(0, table_c.y - 290)
	toasts.size = Vector2(W, 10)
	_sync_glow_if_selected()


func _sync_glow_if_selected() -> void:
	if selected >= 0:
		_sync_glow()


func _status_text() -> String:
	if view.over:
		return ""
	if view.out[me]:
		return "Вы вышли. Гап нест!"
	var def := int(view.defender)
	var att := int(view.attacker)
	var tbl: Array = view.table
	if me == def:
		if view.taking:
			return "Берёте карты"
		if _undefended_slots().size() > 0:
			return "Отбивайтесь"
		return "Отбились, ждём"
	if tbl.is_empty():
		return "Ваш ход" if me == att else "Ходит %s" % _name(att)
	if view.taking:
		return "%s берёт — подкиньте" % _name(def)
	if _can().get("attack", false) and _undefended_slots().is_empty():
		return "Подкинуть?"
	return "%s отбивается" % _name(def)


func show_toast(text: String, color: Color = UI.TEXT) -> void:
	var pc := PanelContainer.new()
	var sb := UI.box(UI.SURFACE, 999, UI.LINE, 2)
	sb.content_margin_left = 26
	sb.content_margin_right = 26
	sb.content_margin_top = 12
	sb.content_margin_bottom = 12
	pc.add_theme_stylebox_override("panel", sb)
	pc.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	pc.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var l := UI.label(text, 22, color, false, 700)
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	pc.add_child(l)
	toasts.add_child(pc)
	while toasts.get_child_count() > 3:
		toasts.get_child(0).free()
	pc.modulate.a = 0.0
	var t := pc.create_tween()
	t.tween_property(pc, "modulate:a", 1.0, 0.15)
	t.tween_interval(2.2)
	t.tween_property(pc, "modulate:a", 0.0, 0.3)
	t.tween_callback(pc.queue_free)


## Игрок вышел из игры.
func _gap_nest(seat: int) -> void:
	if seat != me:
		show_toast("%s — гап нест!" % _name(seat), UI.GOLD)
		return
	Sfx.win()
	Profile.vibrate(80)
	var l := UI.label("ГАП НЕСТ!", 84, UI.GOLD, true, 800)
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	l.size = Vector2(W, 120)
	l.position = Vector2(0, table_c.y - 60)
	l.pivot_offset = l.size / 2.0
	l.scale = Vector2(0.3, 0.3)
	fx_layer.add_child(l)
	var t := l.create_tween()
	t.tween_property(l, "scale", Vector2.ONE, 0.4).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	t.tween_interval(1.2)
	t.tween_property(l, "modulate:a", 0.0, 0.4)
	t.tween_callback(l.queue_free)


func _show_result() -> void:
	if result != null or view.is_empty() or not view.over:
		return
	result = ResultOverlay.new()
	result.setup(view, me)
	result.leave.connect(func() -> void: leave_requested.emit())
	add_child(result)
	result.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	result.z_index = 500


# ================================================================ мелкие виджеты

class Felt extends Control:
	var screen: TableScreen

	func _draw() -> void:
		if screen == null:
			return
		var c := screen.table_c
		for i in 6:
			var r := 380.0 - i * 40.0
			draw_circle(c, r, Color(0.14, 0.13, 0.1, 0.018), true, -1.0, true)


class TrumpChip extends Control:
	var suit := 0

	func _init() -> void:
		size = Vector2(150, 56)
		mouse_filter = Control.MOUSE_FILTER_IGNORE

	func _draw() -> void:
		draw_style_box(UI.box(Color(0, 0, 0, 0), 999, UI.LINE, 2), Rect2(Vector2.ZERO, size))
		var col := UI.CARD_RED if suit >= 2 else UI.TEXT
		draw_texture_rect(CardArt.suit_tex(suit, 64), Rect2(Vector2(16, 14), Vector2(28, 28)), false, col)
		draw_string(UI.font(false, 800), Vector2(54, 36), "КОЗЫРЬ", HORIZONTAL_ALIGNMENT_LEFT, -1, 18, UI.MUTED)
