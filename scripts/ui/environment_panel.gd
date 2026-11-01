class_name EnvironmentPanel
extends CanvasLayer
## Touch-friendly development panel for the environment scene: time of day
## (slider + speed), weather states, camera bookmarks, camera up/down.
## Graphics quality / renderer switching stays in DiagnosticsOverlay.

@export var day_night: DayNightCycle
@export var weather: WeatherManager
@export var camera: DevCamera

var _time_label: Label
var _slider: HSlider
var _weather_buttons := {}


func _ready() -> void:
	layer = 11
	var root := MarginContainer.new()
	root.set_anchors_preset(Control.PRESET_BOTTOM_WIDE)
	root.offset_top = -250
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	for side in ["left", "right", "bottom"]:
		root.add_theme_constant_override("margin_" + side, 20)
	add_child(root)
	var panel := PanelContainer.new()
	panel.size_flags_vertical = Control.SIZE_SHRINK_END
	root.add_child(panel)
	var v := VBoxContainer.new()
	panel.add_child(v)

	var row1 := HBoxContainer.new()
	v.add_child(row1)
	_time_label = Label.new()
	_time_label.custom_minimum_size = Vector2(150, 0)
	row1.add_child(_time_label)
	_slider = HSlider.new()
	_slider.min_value = 0.0
	_slider.max_value = 24.0
	_slider.step = 0.05
	_slider.custom_minimum_size = Vector2(420, 48)
	_slider.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_slider.value_changed.connect(func(val: float) -> void:
		if day_night and absf(day_night.time_of_day - val) > 0.02:
			day_night.set_time(val))
	row1.add_child(_slider)
	for spec in [["06:00", 6.0], ["12:00", 12.0], ["18:00", 18.0], ["00:00", 0.0]]:
		_button(row1, spec[0], func() -> void: day_night.set_time(spec[1]))
	for spec in [["⏸", 0.0], ["×60", 60.0], ["×600", 600.0]]:
		_button(row1, spec[0], func() -> void:
			day_night.paused = spec[1] == 0.0
			day_night.time_scale = maxf(spec[1], 60.0))

	var row2 := HBoxContainer.new()
	v.add_child(row2)
	for st: String in WeatherManager.STATES:
		_weather_buttons[st] = _button(row2, st, func() -> void: weather.set_state(st))
	var sep := VSeparator.new()
	row2.add_child(sep)
	for bm: String in WorldConfig.data().get("camera_bookmarks", {}):
		_button(row2, bm, func() -> void: camera.go_bookmark(bm))

	var row3 := HBoxContainer.new()
	v.add_child(row3)
	var up := _button(row3, "▲ вверх", func() -> void: pass)
	up.button_down.connect(func() -> void: camera.vertical_input = 1.0)
	up.button_up.connect(func() -> void: camera.vertical_input = 0.0)
	var down := _button(row3, "▼ вниз", func() -> void: pass)
	down.button_down.connect(func() -> void: camera.vertical_input = -1.0)
	down.button_up.connect(func() -> void: camera.vertical_input = 0.0)
	for spec in [["скорость ×1", 1.0], ["×4", 4.0], ["×15", 15.0]]:
		_button(row3, spec[0], func() -> void: camera.speed_mult = spec[1])


func _button(parent: Control, text: String, cb: Callable) -> Button:
	var b := Button.new()
	b.text = text
	b.custom_minimum_size = Vector2(76, 52)
	b.pressed.connect(cb)
	parent.add_child(b)
	return b


func _process(_d: float) -> void:
	if day_night:
		_time_label.text = "%s  солнце %.0f°" % [day_night.hour_string(), day_night.sun_elevation_deg]
		_slider.set_value_no_signal(day_night.time_of_day)
	if weather:
		for st: String in _weather_buttons:
			(_weather_buttons[st] as Button).modulate = Color(1, 0.85, 0.4) if st == weather.state else Color(1, 1, 1)
