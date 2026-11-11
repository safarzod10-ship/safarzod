class_name CityAudio
extends Node
## City ambience and the car radio (all sounds synthesized for the game:
## dushanbe_city_src/tools/audio/city_ambience.py, radio.py).
##  Ambience: traffic hum in the city, birds by day, crickets at night, now and then a distant horn;
##  quieter inside a car. Radio: «РАДИО» button (key R) while driving cycles
##  Выкл -> Радио Ватан -> Dushanbe FM -> Дутор -> Выкл; stops when you get out.

const DIR := "res://assets/audio/city/"
const STATIONS := ["Радио Ватан", "Dushanbe FM", "Дутор"]
const CITY_C := Vector2(0.0, -2600.0)

var session: CarSession
var station := -1
var _amb := {}
var _radio: AudioStreamPlayer
var _horn: AudioStreamPlayer
var _horn_t := 12.0
var _ui: CanvasLayer
var _btn: Button
var _lbl: Label
var _lbl_t := 0.0


func _ready() -> void:
	for k in ["traffic", "birds", "night"]:
		var p := AudioStreamPlayer.new()
		var st: AudioStream = load(DIR + "amb_%s.ogg" % k) if ResourceLoader.exists(DIR + "amb_%s.ogg" % k) else null
		if st is AudioStreamOggVorbis:
			(st as AudioStreamOggVorbis).loop = true
		p.stream = st
		p.volume_db = -80.0
		add_child(p)
		if st:
			p.play()
		_amb[k] = p
	_horn = AudioStreamPlayer.new()
	_horn.stream = load(DIR + "amb_horn.ogg") if ResourceLoader.exists(DIR + "amb_horn.ogg") else null
	_horn.volume_db = -22.0
	add_child(_horn)
	_radio = AudioStreamPlayer.new()
	_radio.volume_db = -6.0
	add_child(_radio)
	_build_ui()


func _hour() -> float:
	for t in get_tree().get_nodes_in_group(&"time_of_day"):
		return float(t.get("hour"))
	return 12.0


func _process(delta: float) -> void:
	var cam := get_viewport().get_camera_3d()
	var p := cam.global_position if cam else Vector3.ZERO
	var city := clampf(1.0 - (Vector2(p.x, p.z).distance_to(CITY_C) - 2200.0) / 900.0, 0.0, 1.0)
	var h := _hour()
	var day := clampf(minf(h - 5.5, 20.0 - h), 0.0, 1.0)
	var inside := session != null and session.driving
	var damp := 0.35 if inside else 1.0
	_fade("traffic", city * (0.9 if h > 6.0 and h < 23.0 else 0.4) * damp, delta)
	_fade("birds", day * (0.55 + 0.45 * (1.0 - city)) * damp * 0.8, delta)
	_fade("night", (1.0 - day) * damp * 0.7, delta)
	_horn_t -= delta
	if _horn_t <= 0.0:
		_horn_t = randf_range(14.0, 40.0)
		if city > 0.5 and day > 0.3 and _horn.stream:
			_horn.pitch_scale = randf_range(0.9, 1.12)
			_horn.volume_db = randf_range(-26.0, -18.0) + (-6.0 if inside else 0.0)
			_horn.play()
	# radio: only while driving
	_btn.visible = inside
	if not inside and station >= 0:
		set_station(-1)
	_lbl_t -= delta
	_lbl.visible = _lbl_t > 0.0


func _fade(k: String, lin: float, delta: float) -> void:
	var pl: AudioStreamPlayer = _amb[k]
	var target := linear_to_db(maxf(lin, 0.0001)) - 8.0
	pl.volume_db = move_toward(pl.volume_db, target, delta * 20.0)


func set_station(i: int) -> void:
	station = i
	if i < 0:
		_radio.stop()
		_btn.text = "РАДИО"
		return
	var path := DIR + "radio_%d.ogg" % (i + 1)
	if ResourceLoader.exists(path):
		var st: AudioStreamOggVorbis = load(path)
		st.loop = true
		_radio.stream = st
		_radio.play(randf() * 60.0)
	_btn.text = "♪ " + String(STATIONS[i])
	_lbl.text = "📻 " + String(STATIONS[i])
	_lbl_t = 2.5


func next_station() -> void:
	set_station(station + 1 if station + 1 < STATIONS.size() else -1)
	if station < 0:
		_lbl.text = "Радио выключено"
		_lbl_t = 1.5


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo and (event as InputEventKey).keycode == KEY_R:
		if session and session.driving:
			next_station()


func _input(event: InputEvent) -> void:
	TouchBlock.tap(event, [_btn])


func _build_ui() -> void:
	_ui = CanvasLayer.new()
	_ui.layer = 17
	add_child(_ui)
	var font: Font = load("res://assets/fonts/DejaVuSans-Bold.ttf")
	_btn = Button.new()
	_btn.text = "РАДИО"
	_btn.focus_mode = Control.FOCUS_NONE
	_btn.add_theme_font_override("font", font)
	_btn.add_theme_font_size_override("font_size", 20)
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0.12, 0.15, 0.22, 0.85)
	sb.set_corner_radius_all(14)
	sb.content_margin_left = 14
	sb.content_margin_right = 14
	for s in ["normal", "hover", "pressed"]:
		_btn.add_theme_stylebox_override(s, sb)
	_btn.pressed.connect(next_station)
	_btn.add_to_group(TouchBlock.GROUP)
	_btn.visible = false
	_ui.add_child(_btn)
	_lbl = Label.new()
	_lbl.add_theme_font_override("font", font)
	_lbl.add_theme_font_size_override("font_size", 30)
	_lbl.add_theme_color_override("font_color", Color(0.85, 0.95, 1.0))
	_lbl.add_theme_color_override("font_outline_color", Color.BLACK)
	_lbl.add_theme_constant_override("outline_size", 8)
	_lbl.set_anchors_preset(Control.PRESET_CENTER_TOP)
	_lbl.position = Vector2(-250, 70)
	_lbl.size = Vector2(500, 40)
	_lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_lbl.visible = false
	_ui.add_child(_lbl)
	get_viewport().size_changed.connect(_layout)
	_layout()


func _layout() -> void:
	var vs := get_viewport().get_visible_rect().size
	var d := clampf(minf(vs.x, vs.y) * 0.22, 150.0, 320.0)
	# beside the ТАКСИ button (under the minimap's right edge)
	_btn.position = Vector2(16 + d + 190, minf(vs.x, vs.y) * 0.175 + 64)
	_btn.size = Vector2(170, 52)
