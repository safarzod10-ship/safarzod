class_name CombatHUD
extends CanvasLayer
## Health, ammo, grenades, crosshair, hit marker, damage vignette, wave/kills,
## death screen and on-screen touch controls.

signal restart_requested
signal menu_requested

var player: Player
var touch_forced := false
var _health_bar: ProgressBar
var _health_lbl: Label
var _ammo_lbl: Label
var _gren_lbl: Label
var _info_lbl: Label
var _cross: Control
var _hit_t := 0.0
var _kill_hit := false
var _hurt := 0.0
var _vignette: ColorRect
var _death: Control
var _touch: Control
var _stick_base: Control
var _stick_knob: Control
var _stick_finger := -1
var _banner: Label
var _banner_t := 0.0


func _ready() -> void:
	layer = 5
	var root := Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(root)
	_vignette = ColorRect.new()
	_vignette.set_anchors_preset(Control.PRESET_FULL_RECT)
	_vignette.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var vs := Shader.new()
	vs.code = "shader_type canvas_item;\nuniform float amount = 0.0;\nvoid fragment(){ float d = distance(UV, vec2(0.5)); COLOR = vec4(0.5, 0.0, 0.0, smoothstep(0.35, 0.85, d) * amount * 0.6); }"
	var vm := ShaderMaterial.new()
	vm.shader = vs
	_vignette.material = vm
	root.add_child(_vignette)
	_cross = Control.new()
	_cross.set_anchors_preset(Control.PRESET_FULL_RECT)
	_cross.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_cross.draw.connect(_draw_cross)
	root.add_child(_cross)
	# bottom-left: health
	var hp := VBoxContainer.new()
	hp.set_anchors_preset(Control.PRESET_BOTTOM_LEFT)
	hp.position = Vector2(32, -96)
	hp.grow_vertical = Control.GROW_DIRECTION_BEGIN
	root.add_child(hp)
	_health_lbl = _label("100", 34)
	hp.add_child(_health_lbl)
	_health_bar = ProgressBar.new()
	_health_bar.custom_minimum_size = Vector2(300, 14)
	_health_bar.show_percentage = false
	_health_bar.max_value = 100
	var bg := StyleBoxFlat.new()
	bg.bg_color = Color(0, 0, 0, 0.55)
	bg.set_corner_radius_all(4)
	var fg := StyleBoxFlat.new()
	fg.bg_color = Color(0.85, 0.2, 0.16)
	fg.set_corner_radius_all(4)
	_health_bar.add_theme_stylebox_override("background", bg)
	_health_bar.add_theme_stylebox_override("fill", fg)
	hp.add_child(_health_bar)
	# bottom-right: ammo + grenades
	var am := VBoxContainer.new()
	am.set_anchors_preset(Control.PRESET_TOP_RIGHT)
	am.position = Vector2(-362, 18)
	am.custom_minimum_size = Vector2(330, 0)
	root.add_child(am)
	_ammo_lbl = _label("30 / 150", 40)
	_ammo_lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	am.add_child(_ammo_lbl)
	_gren_lbl = _label("", 20)
	_gren_lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	am.add_child(_gren_lbl)
	_info_lbl = _label("", 22)
	_info_lbl.set_anchors_preset(Control.PRESET_TOP_LEFT)
	_info_lbl.position = Vector2(32, 22)
	root.add_child(_info_lbl)
	_banner = _label("", 44)
	_banner.set_anchors_preset(Control.PRESET_CENTER_TOP)
	_banner.position = Vector2(-400, 110)
	_banner.custom_minimum_size = Vector2(800, 0)
	_banner.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	root.add_child(_banner)
	_build_death(root)
	_build_touch(root)


func _label(text: String, size: int) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.8))
	l.add_theme_constant_override("shadow_offset_x", 2)
	l.add_theme_constant_override("shadow_offset_y", 2)
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return l


func _build_death(root: Control) -> void:
	_death = ColorRect.new()
	(_death as ColorRect).color = Color(0.1, 0, 0, 0.55)
	_death.set_anchors_preset(Control.PRESET_FULL_RECT)
	_death.visible = false
	root.add_child(_death)
	var box := VBoxContainer.new()
	box.set_anchors_preset(Control.PRESET_CENTER)
	box.position = Vector2(-180, -120)
	box.custom_minimum_size = Vector2(360, 0)
	box.add_theme_constant_override("separation", 18)
	_death.add_child(box)
	var t := _label("ВЫ ПОГИБЛИ", 52)
	t.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	box.add_child(t)
	var again := Button.new()
	again.text = "Заново"
	again.custom_minimum_size = Vector2(0, 64)
	again.add_theme_font_size_override("font_size", 26)
	again.pressed.connect(func() -> void: restart_requested.emit())
	box.add_child(again)
	var menu := Button.new()
	menu.text = "В меню"
	menu.custom_minimum_size = Vector2(0, 64)
	menu.add_theme_font_size_override("font_size", 26)
	menu.pressed.connect(func() -> void: menu_requested.emit())
	box.add_child(menu)


func show_death() -> void:
	_death.visible = true
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE


func banner(text: String, time := 2.5) -> void:
	_banner.text = text
	_banner_t = time


func set_info(text: String) -> void:
	_info_lbl.text = text


func hit_marker(kill: bool) -> void:
	_hit_t = 0.22
	_kill_hit = kill


func hurt(amount: float) -> void:
	_hurt = minf(_hurt + amount / 40.0, 1.0)


func _process(delta: float) -> void:
	if player == null or not is_instance_valid(player):
		return
	_health_bar.value = player.health
	_health_lbl.text = "✚ %d" % int(ceil(player.health))
	_ammo_lbl.text = ("Перезарядка…" if player.reloading else "%d / %d" % [player.ammo, player.reserve])
	var g := WeaponCatalog.grenade(player.grenade_id)
	_gren_lbl.text = "%s ×%d" % [g["name"], int(player.grenades.get(player.grenade_id, 0))]
	_hit_t = maxf(_hit_t - delta, 0.0)
	_hurt = move_toward(_hurt, 0.0, delta * 0.8)
	var low := clampf(1.0 - player.health / 45.0, 0.0, 1.0) * 0.6
	(_vignette.material as ShaderMaterial).set_shader_parameter(&"amount", maxf(_hurt, low))
	_banner_t -= delta
	_banner.modulate.a = clampf(_banner_t, 0.0, 1.0)
	_touch.visible = (InputManager.touch_mode or touch_forced) and not player.dead
	_cross.queue_redraw()


func _draw_cross() -> void:
	if player == null or not is_instance_valid(player) or player.dead:
		return
	var c := _cross.size * 0.5
	var gap := 5.0 + player.current_spread() * 7.0
	var col := Color(1, 1, 1, 0.9)
	for d: Vector2 in [Vector2.RIGHT, Vector2.LEFT, Vector2.UP, Vector2.DOWN]:
		_cross.draw_line(c + d * gap, c + d * (gap + 9.0), Color(0, 0, 0, 0.6), 4.0)
		_cross.draw_line(c + d * gap, c + d * (gap + 9.0), col, 2.0)
	_cross.draw_circle(c, 1.5, col)
	if _hit_t > 0.0:
		var hc := Color(1.0, 0.2, 0.15) if _kill_hit else Color(1, 1, 1)
		hc.a = _hit_t / 0.22
		for d: Vector2 in [Vector2(1, 1), Vector2(-1, 1), Vector2(1, -1), Vector2(-1, -1)]:
			_cross.draw_line(c + d * 7.0, c + d * 15.0, hc, 3.0)


# ------------------------------------------------------------------ touch

func _build_touch(root: Control) -> void:
	_touch = Control.new()
	_touch.set_anchors_preset(Control.PRESET_FULL_RECT)
	_touch.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(_touch)
	_stick_base = _circle(170, Color(1, 1, 1, 0.13))
	_stick_base.set_anchors_preset(Control.PRESET_BOTTOM_LEFT)
	_stick_base.position = Vector2(90, -330)
	_touch.add_child(_stick_base)
	_stick_knob = _circle(74, Color(1, 1, 1, 0.4))
	_stick_knob.position = Vector2(48, 48)
	_stick_base.add_child(_stick_knob)
	_stick_base.gui_input.connect(_on_stick)
	_stick_base.mouse_filter = Control.MOUSE_FILTER_STOP
	# right cluster (anchored bottom-right)
	_button("ОГОНЬ", "fire", Vector2(-230, -270), 150, true, Color(0.9, 0.25, 0.2, 0.5))
	_button("ПРИЦЕЛ", "aim", Vector2(-390, -200), 104, true)
	_button("ПРЫЖОК", "jump", Vector2(-120, -420), 96, false)
	_button("ПЕРЕЗ.", "reload", Vector2(-270, -400), 96, false)
	_button("ГРАНАТА", "grenade", Vector2(-420, -340), 104, false, Color(0.95, 0.6, 0.15, 0.5))
	_button("ТИП", "next_grenade", Vector2(-540, -250), 84, false)
	_button("ПРИСЕД", "crouch", Vector2(-520, -130), 96, false)


func _circle(d: float, color: Color) -> Panel:
	var p := Panel.new()
	p.custom_minimum_size = Vector2(d, d)
	p.size = Vector2(d, d)
	var sb := StyleBoxFlat.new()
	sb.bg_color = color
	sb.set_corner_radius_all(int(d / 2))
	sb.border_color = Color(1, 1, 1, 0.35)
	sb.set_border_width_all(2)
	p.add_theme_stylebox_override("panel", sb)
	return p


func _button(text: String, action: String, pos: Vector2, d: float, hold: bool, color := Color(1, 1, 1, 0.16)) -> void:
	var p := _circle(d, color)
	p.set_anchors_preset(Control.PRESET_BOTTOM_RIGHT)
	p.position = pos
	p.mouse_filter = Control.MOUSE_FILTER_STOP
	var l := _label(text, 15 if d < 100 else 18)
	l.set_anchors_preset(Control.PRESET_FULL_RECT)
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	l.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	p.add_child(l)
	_touch.add_child(p)
	p.gui_input.connect(func(ev: InputEvent) -> void:
		if ev is InputEventScreenTouch:
			var t := ev as InputEventScreenTouch
			if hold:
				CombatState.touch[action] = t.pressed
			elif t.pressed:
				CombatState.touch[action] = true
		elif ev is InputEventScreenDrag and hold:
			# dragging on FIRE / AIM keeps turning the camera
			InputManager.add_look_delta((ev as InputEventScreenDrag).relative))


func _on_stick(ev: InputEvent) -> void:
	var r := _stick_base.size.x * 0.5
	if ev is InputEventScreenTouch:
		var t := ev as InputEventScreenTouch
		if t.pressed:
			_stick_finger = t.index
			_set_stick(t.position, r)
		elif t.index == _stick_finger:
			_stick_finger = -1
			InputManager.virtual_stick = Vector2.ZERO
			_stick_knob.position = Vector2(r, r) - _stick_knob.size * 0.5
	elif ev is InputEventScreenDrag and (ev as InputEventScreenDrag).index == _stick_finger:
		_set_stick((ev as InputEventScreenDrag).position, r)


func _set_stick(local: Vector2, r: float) -> void:
	var v := ((local - Vector2(r, r)) / r).limit_length(1.0)
	InputManager.virtual_stick = v
	_stick_knob.position = Vector2(r, r) + v * r - _stick_knob.size * 0.5
