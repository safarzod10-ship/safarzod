class_name ResultOverlay
extends Control
## Итог партии: победителям — «ГАП НЕСТ!», проигравшему — «ЧУМО».

signal leave

var _avatar: AvatarView


func setup(view: Dictionary, me: int) -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_STOP
	var bg := ColorRect.new()
	bg.color = Color(UI.BG, 0.97)
	bg.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(bg)
	var loser := int(view.loser)
	var i_lost := loser == me
	var m := MarginContainer.new()
	m.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	for side in ["left", "right"]:
		m.add_theme_constant_override("margin_" + side, 40)
	m.add_theme_constant_override("margin_top", 120)
	m.add_theme_constant_override("margin_bottom", 60)
	add_child(m)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 18)
	m.add_child(v)

	var who := loser if loser >= 0 else me
	_avatar = AvatarView.new(220)
	_avatar.display_name = Session.seat_name(who)
	_avatar.texture = Session.avatar_for(Session.seat_uid(who))
	_avatar.ring = UI.ACCENT if loser >= 0 else UI.TEXT
	_avatar.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	var title: Label
	var sub: Label
	if loser < 0:
		title = UI.label("НИЧЬЯ", 110, UI.TEXT, true, 800)
		sub = UI.label("Все вышли одновременно", 28, UI.MUTED)
		_avatar.visible = false
	elif i_lost:
		title = UI.label("ЧУМО", 150, UI.ACCENT, true, 800)
		sub = UI.label("Ты остался с картами.", 28, UI.MUTED)
		Sfx.lose()
		Profile.vibrate(400)
	else:
		title = UI.label("ГАП НЕСТ!", 92, UI.TEXT, true, 800)
		sub = UI.label("Чумо — %s" % Session.seat_name(loser), 32, UI.ACCENT, false, 800)
		Sfx.win()
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	sub.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	title.pivot_offset = Vector2(320, 80)
	v.add_child(_avatar)
	v.add_child(UI.spacer(10))
	v.add_child(title)
	v.add_child(sub)
	v.add_child(UI.spacer(20))
	# Места.
	var places: Array = view.places
	for k in places.size():
		v.add_child(_row("%d" % (k + 1), Session.seat_name(int(places[k])), "гап нест", UI.TEXT))
	if loser >= 0:
		v.add_child(_row("%d" % (places.size() + 1), Session.seat_name(loser), "чумо", UI.ACCENT))
	var sp := Control.new()
	sp.size_flags_vertical = Control.SIZE_EXPAND_FILL
	v.add_child(sp)
	if Session.is_host_like():
		var again := UI.button("Ещё раз", "primary")
		again.pressed.connect(func() -> void: Session.rematch())
		v.add_child(again)
	else:
		var w := UI.label("Ждём, когда хост начнёт снова…", 24, UI.MUTED)
		w.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		v.add_child(w)
	var out := UI.button("В меню", "ghost")
	out.pressed.connect(func() -> void: leave.emit())
	v.add_child(out)

	# Появление.
	modulate.a = 0.0
	var t := create_tween()
	t.tween_property(self, "modulate:a", 1.0, 0.3)
	title.scale = Vector2(0.4, 0.4)
	var t2 := title.create_tween()
	t2.tween_interval(0.15)
	t2.tween_property(title, "scale", Vector2.ONE, 0.5).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	if i_lost:
		_wobble()


func _row(num: String, nm: String, tag: String, col: Color) -> Control:
	var h := HBoxContainer.new()
	h.add_theme_constant_override("separation", 16)
	var n := UI.label(num, 24, UI.MUTED, true, 600)
	n.custom_minimum_size = Vector2(48, 0)
	h.add_child(n)
	var l := UI.label(nm, 28, UI.TEXT, false, 700)
	l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	h.add_child(l)
	h.add_child(UI.label(tag.to_upper(), 20, col, false, 800))
	return h


func _wobble() -> void:
	_avatar.pivot_offset = _avatar.size / 2.0
	var t := _avatar.create_tween().set_loops()
	t.tween_property(_avatar, "rotation", 0.08, 0.18).set_trans(Tween.TRANS_SINE)
	t.tween_property(_avatar, "rotation", -0.08, 0.36).set_trans(Tween.TRANS_SINE)
	t.tween_property(_avatar, "rotation", 0.0, 0.18).set_trans(Tween.TRANS_SINE)
