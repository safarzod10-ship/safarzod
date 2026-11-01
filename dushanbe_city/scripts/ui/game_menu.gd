extends CanvasLayer
## Small in-game menu: quality preset (Low/Medium/High), time of day, FPS / draw-call overlay.

var _panel: PanelContainer
var _info: Label


func _ready() -> void:
	layer = 20
	var btn := Button.new()
	btn.text = "☰"
	btn.custom_minimum_size = Vector2(64, 64)
	btn.position = Vector2(16, 16)
	btn.add_theme_font_size_override("font_size", 30)
	add_child(btn)
	_info = Label.new()
	_info.position = Vector2(92, 22)
	_info.add_theme_color_override("font_outline_color", Color.BLACK)
	_info.add_theme_constant_override("outline_size", 4)
	add_child(_info)
	_panel = PanelContainer.new()
	_panel.position = Vector2(16, 90)
	_panel.visible = false
	add_child(_panel)
	var v := VBoxContainer.new()
	_panel.add_child(v)
	var l := Label.new()
	l.text = "Графика"
	v.add_child(l)
	var h := HBoxContainer.new()
	v.add_child(h)
	for i in 3:
		var b := Button.new()
		b.text = ["Low", "Medium", "High"][i]
		b.custom_minimum_size = Vector2(110, 56)
		b.pressed.connect(func() -> void: Settings.set_quality(i))
		h.add_child(b)
	var l2 := Label.new()
	l2.text = "Время суток"
	v.add_child(l2)
	var s := HSlider.new()
	s.min_value = 0
	s.max_value = 24
	s.step = 0.25
	s.value = 15.5
	s.custom_minimum_size = Vector2(340, 48)
	s.value_changed.connect(func(x: float) -> void:
		for n in get_tree().get_nodes_in_group(&"time_of_day"):
			n.call("set_hour", x))
	v.add_child(s)
	btn.pressed.connect(func() -> void: _panel.visible = not _panel.visible)


func _process(_d: float) -> void:
	_info.text = "%d FPS · %s · DC %d" % [Engine.get_frames_per_second(), Settings.quality_name(),
		RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_DRAW_CALLS_IN_FRAME)]
