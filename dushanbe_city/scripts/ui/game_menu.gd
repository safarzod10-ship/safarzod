extends CanvasLayer
## In-game menu (☰): graphics mode Auto/Low/Medium/High/Ultra, FPS cap 30/60, show FPS,
## diagnostics panel, dynamic resolution, re-run auto benchmark, time of day.
## Also draws the FPS counter and the diagnostics overlay.

var _panel: PanelContainer
var _btn: Button
var _fps: Label
var _diag: Label
var _mode_buttons := {}
var _cap_buttons := {}
var _toggles := {}
var _bench_label: Label
var _acc := 0.0
var _frames := 0
var _worst := 0.0
var _fps_val := 0.0
var _avg_ms := 0.0
var _max_ms := 0.0
var _open_on_start := false:
	set(v):
		_open_on_start = v
		if v and _panel:
			_panel.visible = true
			_refresh()


## the round pause button of the HUD (HudStyle.toggle_menu) opens / closes the menu
func toggle_menu() -> void:
	_panel.visible = not _panel.visible
	_layout()
	_refresh()


func _ready() -> void:
	layer = 20
	add_to_group(&"game_menu")
	# top-right: the top-left corner belongs to the round minimap
	_btn = Button.new()
	var btn := _btn
	btn.text = "☰"
	btn.custom_minimum_size = Vector2(72, 72)
	btn.size = Vector2(72, 72)
	btn.add_theme_font_size_override("font_size", 34)
	add_child(btn)
	btn.visible = false               # replaced by the HUD's round pause button
	_fps = _outlined_label(Vector2(0, 0), 22)
	_fps.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	_diag = _outlined_label(Vector2(16, 16), 18)
	_panel = PanelContainer.new()
	_panel.visible = false
	add_child(_panel)
	get_viewport().size_changed.connect(_layout)
	var scroll := ScrollContainer.new()
	scroll.custom_minimum_size = Vector2(620, 560)
	_panel.add_child(scroll)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 10)
	scroll.add_child(v)
	_section(v, "Графика")
	var h := HBoxContainer.new()
	v.add_child(h)
	for m in ["auto", "low", "medium", "high", "ultra"]:
		var b := _button({"auto": "Авто", "low": "Low", "medium": "Medium", "high": "High", "ultra": "Ultra"}[m], 112)
		b.pressed.connect(func() -> void: Settings.set_mode(m); _refresh())
		h.add_child(b)
		_mode_buttons[m] = b
	_bench_label = Label.new()
	_bench_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_bench_label.custom_minimum_size = Vector2(600, 0)
	v.add_child(_bench_label)
	var rb := _button("Повторить тест производительности", 600)
	rb.pressed.connect(_rerun_benchmark)
	v.add_child(rb)
	_section(v, "Частота кадров")
	var h2 := HBoxContainer.new()
	v.add_child(h2)
	for cap in [30, 60]:
		var b := _button("%d FPS" % cap, 150)
		b.pressed.connect(func() -> void:
			Settings.set_fps_cap(cap)
			Settings.bench["cap_set_by_user"] = true
			Settings.save()
			_refresh())
		h2.add_child(b)
		_cap_buttons[cap] = b
	for t in [["show_fps", "Показывать FPS"], ["show_diagnostics", "Диагностика производительности"], ["dynamic_resolution", "Динамическое разрешение 3D"]]:
		var c := CheckButton.new()
		c.text = t[1]
		c.add_theme_font_size_override("font_size", 22)
		c.custom_minimum_size = Vector2(600, 52)
		var key: String = t[0]
		c.toggled.connect(func(on: bool) -> void: Settings.set_flag(key, on); _refresh())
		v.add_child(c)
		_toggles[key] = c
	_section(v, "Время суток")
	var s := HSlider.new()
	s.min_value = 0
	s.max_value = 24
	s.step = 0.25
	s.value = 15.5
	s.custom_minimum_size = Vector2(600, 52)
	s.value_changed.connect(func(x: float) -> void:
		for n in get_tree().get_nodes_in_group(&"time_of_day"):
			n.call("set_hour", x))
	v.add_child(s)
	# touch controls (stage 4): size of the buttons / joystick and camera swipe sensitivity
	for t in [["Размер кнопок управления", 0.75, 1.35, "ui_scale"], ["Чувствительность камеры", 0.4, 2.5, "look_scale"]]:
		_section(v, t[0])
		var sl := HSlider.new()
		sl.min_value = t[1]
		sl.max_value = t[2]
		sl.step = 0.05
		sl.value = PlayerInput.ui_scale if t[3] == "ui_scale" else PlayerInput.look_scale
		sl.custom_minimum_size = Vector2(600, 52)
		var which: String = t[3]
		sl.value_changed.connect(func(x: float) -> void:
			if which == "ui_scale":
				PlayerInput.ui_scale = x
				for ts in get_tree().root.find_children("*", "Control", true, false):
					if ts.has_method("_unit"):
						(ts as Control).queue_redraw()
			else:
				PlayerInput.look_scale = x
			PlayerInput.save_settings())
		v.add_child(sl)
	_section(v, "Prado: режим вождения")
	var am := CheckButton.new()
	am.text = "Аркадная помощь (выкл. = реалистичный)"
	am.add_theme_font_size_override("font_size", 22)
	am.custom_minimum_size = Vector2(600, 52)
	am.button_pressed = PlayerInput.arcade_assist
	am.toggled.connect(func(on: bool) -> void:
		PlayerInput.arcade_assist = on
		for c in get_tree().get_nodes_in_group(&"vehicle"):
			c.set("easy_drift", on)
		PlayerInput.save_settings())
	v.add_child(am)
	btn.pressed.connect(func() -> void:
		_panel.visible = not _panel.visible
		_layout()
		_refresh())
	Settings.settings_changed.connect(_refresh)
	Settings.quality_changed.connect(func(_q: int) -> void: _refresh())
	_refresh()
	_layout.call_deferred()


func _layout() -> void:
	## top-right corner (the top-left one belongs to the round minimap)
	var w := get_viewport().get_visible_rect().size.x
	_btn.position = Vector2(w - 16 - _btn.size.x, 16)
	_fps.size = Vector2(420, 30)
	var vs := get_viewport().get_visible_rect().size
	_fps.position = Vector2(w - 16 - 420, minf(vs.x, vs.y) * 0.19)      # under the money / bars
	_fps.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	_panel.position = Vector2(maxf(16.0, w - 16 - _panel.get_combined_minimum_size().x), 100)


func _outlined_label(pos: Vector2, fs: int) -> Label:
	var l := Label.new()
	l.position = pos
	l.add_theme_font_size_override("font_size", fs)
	l.add_theme_color_override("font_outline_color", Color.BLACK)
	l.add_theme_constant_override("outline_size", 5)
	add_child(l)
	return l


func _section(parent: Control, text: String) -> void:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", 26)
	parent.add_child(l)


func _button(text: String, w: float) -> Button:
	var b := Button.new()
	b.text = text
	b.toggle_mode = false
	b.custom_minimum_size = Vector2(w, 60)
	b.add_theme_font_size_override("font_size", 22)
	return b


func _refresh() -> void:
	for m in _mode_buttons:
		var b: Button = _mode_buttons[m]
		var sel: bool = Settings.mode == m
		b.modulate = Color(1.0, 0.8, 0.35) if sel else Color.WHITE
	for cap in _cap_buttons:
		(_cap_buttons[cap] as Button).modulate = Color(1.0, 0.8, 0.35) if Settings.fps_cap == cap else Color.WHITE
	for k in _toggles:
		(_toggles[k] as CheckButton).set_pressed_no_signal(bool(Settings.get(k)))
	var b := Settings.bench
	var txt := "Сейчас: %s%s, разрешение 3D %d%%." % [Settings.quality_name(), " (авто)" if Settings.mode == "auto" else "", int(Settings.current_scale * 100)]
	if b.has("quality_name"):
		txt += "\nАвтотест: %s (%s). " % [b["quality_name"], b.get("date", "")]
		for t in b.get("tests", []):
			txt += "%s p90 %.0f мс; " % [t["quality"], t["p90_ms"]]
	_bench_label.text = txt


func _rerun_benchmark() -> void:
	_panel.visible = false
	var ag := AutoGraphics.new()
	add_child(ag)
	await ag.run()
	ag.queue_free()
	_refresh()


func _process(delta: float) -> void:
	_acc += delta
	_frames += 1
	_worst = maxf(_worst, delta)
	if _acc >= 0.5:
		_fps_val = _frames / _acc
		_avg_ms = _acc / _frames * 1000.0
		_max_ms = _worst * 1000.0
		_acc = 0.0
		_frames = 0
		_worst = 0.0
		_update_text()


func _update_text() -> void:
	_fps.visible = Settings.show_fps
	_fps.text = "%d FPS · %.1f мс · %s" % [roundi(_fps_val), _avg_ms, Settings.quality_name()]
	_diag.visible = Settings.show_diagnostics and not _panel.visible
	if not _diag.visible:
		return
	var vs := get_viewport().get_visible_rect().size
	_diag.position = Vector2(16, 16 + clampf(minf(vs.x, vs.y) * 0.22, 150.0, 320.0) + 12)   # under the minimap
	var rs := RenderingServer
	var info := AutoGraphics.device_info()
	var lines := [
		"FPS %.0f   кадр %.1f мс (макс %.1f)   лимит %d FPS" % [_fps_val, _avg_ms, _max_ms, Settings.fps_cap],
		"GPU %.1f мс   CPU кадр (process) %.1f мс   физика %.1f мс" % [Settings.gpu_time_ms(), Performance.get_monitor(Performance.TIME_PROCESS) * 1000.0, Performance.get_monitor(Performance.TIME_PHYSICS_PROCESS) * 1000.0],
		"Draw calls %d   треугольники %.2f млн   объекты %d" % [rs.get_rendering_info(rs.RENDERING_INFO_TOTAL_DRAW_CALLS_IN_FRAME), rs.get_rendering_info(rs.RENDERING_INFO_TOTAL_PRIMITIVES_IN_FRAME) / 1e6, rs.get_rendering_info(rs.RENDERING_INFO_TOTAL_OBJECTS_IN_FRAME)],
		"VRAM %.0f МБ (текстуры %.0f, буферы %.0f)   RAM %.0f МБ" % [rs.get_rendering_info(rs.RENDERING_INFO_VIDEO_MEM_USED) / 1048576.0, rs.get_rendering_info(rs.RENDERING_INFO_TEXTURE_MEM_USED) / 1048576.0, rs.get_rendering_info(rs.RENDERING_INFO_BUFFER_MEM_USED) / 1048576.0, Performance.get_monitor(Performance.MEMORY_STATIC) / 1048576.0],
		"Пресет %s (%s)   3D %d%%   %s" % [Settings.quality_name(), Settings.mode, int(Settings.current_scale * 100), info["renderer"]],
		"%s · %s · %d ядер · %d МБ RAM" % [info["model"], info["adapter"], info["cores"], info["ram_mb"]],
		"Сборка: %s" % ("debug" if OS.is_debug_build() else "release"),
	]
	if not Settings.adaptive_log.is_empty():
		lines.append("Адаптация: " + Settings.adaptive_log[-1])
	_diag.text = "\n".join(lines)
