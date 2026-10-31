class_name DiagnosticsOverlay
extends CanvasLayer
## On-screen diagnostics: real performance samples, active renderer, graphics
## quality switch (Low / Medium / Ultra, persisted), renderer choice and
## scene navigation. Built in code so every test scene can reuse it.

@export var title: String = "DUSHANBE — диагностика"
@export var nav_target: String = ""
@export var nav_label: String = ""

var _info: Label
var _quality_buttons: Dictionary = {}
var _renderer_select: OptionButton
var _notice: Label
var _extra_lines: PackedStringArray = []


func _ready() -> void:
	layer = 10
	_build()
	PerformanceMonitor.sample_ready.connect(_refresh)
	SettingsManager.graphics_applied.connect(_on_graphics_applied)
	SettingsManager.renderer_change_pending.connect(_on_renderer_pending)
	_sync_buttons()
	_refresh(PerformanceMonitor.take_sample())


## Scenes can append their own lines (e.g. asset statistics).
func set_extra_lines(lines: PackedStringArray) -> void:
	_extra_lines = lines
	_refresh(PerformanceMonitor.take_sample())


func _build() -> void:
	var margin := MarginContainer.new()
	margin.set_anchors_preset(Control.PRESET_FULL_RECT)
	margin.mouse_filter = Control.MOUSE_FILTER_IGNORE
	for side in ["left", "top", "right", "bottom"]:
		margin.add_theme_constant_override("margin_" + side, 24)
	add_child(margin)

	var info_panel := PanelContainer.new()
	info_panel.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	info_panel.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	info_panel.mouse_filter = Control.MOUSE_FILTER_IGNORE
	margin.add_child(info_panel)
	_info = Label.new()
	_info.add_theme_font_size_override("font_size", 18)
	info_panel.add_child(_info)

	var controls := VBoxContainer.new()
	controls.size_flags_horizontal = Control.SIZE_SHRINK_END
	controls.size_flags_vertical = Control.SIZE_SHRINK_BEGIN
	controls.add_theme_constant_override("separation", 10)
	margin.add_child(controls)

	var ql := Label.new()
	ql.text = "Качество графики"
	controls.add_child(ql)
	var row := HBoxContainer.new()
	controls.add_child(row)
	var group := ButtonGroup.new()
	for q: int in [GraphicsPresets.Quality.LOW, GraphicsPresets.Quality.MEDIUM, GraphicsPresets.Quality.ULTRA]:
		var b := Button.new()
		b.text = String(GraphicsPresets.NAMES[q]).to_upper()
		b.toggle_mode = true
		b.button_group = group
		b.custom_minimum_size = Vector2(120, 64)  # finger-sized
		b.pressed.connect(SettingsManager.set_quality.bind(q))
		row.add_child(b)
		_quality_buttons[q] = b

	var rl := Label.new()
	rl.text = "Рендерер (после перезапуска)"
	controls.add_child(rl)
	_renderer_select = OptionButton.new()
	_renderer_select.custom_minimum_size = Vector2(0, 56)
	for r: String in GraphicsPresets.RENDERERS:
		_renderer_select.add_item(r)
	_renderer_select.select(GraphicsPresets.RENDERERS.find(SettingsManager.renderer))
	_renderer_select.item_selected.connect(_on_renderer_selected)
	controls.add_child(_renderer_select)

	if not nav_target.is_empty():
		var nav := Button.new()
		nav.text = nav_label
		nav.custom_minimum_size = Vector2(0, 64)
		nav.pressed.connect(SceneLoader.change_scene.bind(nav_target))
		controls.add_child(nav)

	_notice = Label.new()
	_notice.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_notice.custom_minimum_size = Vector2(380, 0)
	controls.add_child(_notice)


func _on_graphics_applied(_quality: int, _preset: Dictionary) -> void:
	_sync_buttons()


func _on_renderer_pending(renderer: String) -> void:
	_notice.text = "Рендерер «%s» будет применён после перезапуска." % renderer


func _on_renderer_selected(index: int) -> void:
	SettingsManager.set_renderer(GraphicsPresets.RENDERERS[index])


func _sync_buttons() -> void:
	for q: int in _quality_buttons:
		_quality_buttons[q].set_pressed_no_signal(q == SettingsManager.quality)


func _refresh(s: Dictionary) -> void:
	if _info == null:
		return
	var caps := SettingsManager.get_capabilities()
	var p := SettingsManager.current_preset()
	var lines := PackedStringArray([
		title,
		"FPS: %d   кадр (худший): %.1f мс" % [s["fps"], s["frame_ms_worst"]],
		"Draw calls: %d   примитивы: %d   объекты: %d" % [s["draw_calls"], s["primitives"], s["objects"]],
		"Видеопамять: %.1f МБ   статич. память: %.1f МБ" % [s["video_mem_mb"], s["static_mem_mb"]],
		"Рендерер: %s (%s)   устройство: %s" % [caps["rendering_method"], caps["rendering_driver"], caps["adapter"]],
		"Качество: %s   масштаб 3D: %.2f   тени: %d px   дальность: %d м" % [
			SettingsManager.quality_name().to_upper(), p["render_scale"], p["directional_shadow_size"], p["view_distance"]],
		"Состояние: %s" % GameManager.state_name(),
	])
	if caps["headless"]:
		lines.append("HEADLESS: изображение не рисуется, FPS не отражает GPU")
	lines.append_array(_extra_lines)
	_info.text = "\n".join(lines)
