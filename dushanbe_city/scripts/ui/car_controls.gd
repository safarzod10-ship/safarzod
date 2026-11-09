class_name CarControls
extends Control
## Touch controls while driving the Prado (multitouch: every control tracks its own finger, so gas,
## steering and handbrake can be held together):
##   bottom-left  : steer LEFT / RIGHT arrows (the car's steering returns to centre when released)
##   bottom-right : GAS pedal (tall), BRAKE pedal (brake at standstill = reverse), HANDBRAKE
##   top centre   : КАМЕРА (3rd person / cabin / orbit), ВОССТАНОВИТЬ (repair), ВЫЙТИ (leave the car)
##   above the arrows: ◄ left indicator, ФАРЫ (off / dipped / main beam), АВАР. (hazards), ► right
##   HUD (right, above the pedals): speedometer (real body speed, km/h), tachometer, gear,
##   condition %, telltales: indicators (blinking), dipped / main beam, handbrake (P), check engine
## Free drags elsewhere orbit the camera.

signal exit_pressed
signal repair_pressed
signal orbit_toggled          ## camera button (cycles the camera modes)
signal lights_pressed
signal turn_pressed(dir: int)
signal hazard_pressed

const FONT_PATH := "res://assets/fonts/DejaVuSans-Bold.ttf"
var car: VehiclePrado
var orbit_on := false
var camera_label := "3-Е ЛИЦО"
var touch_mode := true        ## false on desktop: only the speedometer is drawn
var _font: Font
var _fingers := {}          # finger index -> control name


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	set_anchors_preset(Control.PRESET_FULL_RECT)
	_font = load(FONT_PATH) if ResourceLoader.exists(FONT_PATH) else ThemeDB.fallback_font


func _u() -> float:
	return minf(size.x, size.y) / 10.0


func _rects() -> Dictionary:
	var u := _u()
	var w := size.x
	var h := size.y
	return {
		"left": Rect2(0.5 * u, h - 3.1 * u, 2.2 * u, 2.4 * u),
		"right": Rect2(3.0 * u, h - 3.1 * u, 2.2 * u, 2.4 * u),
		"gas": Rect2(w - 2.5 * u, h - 4.6 * u, 1.9 * u, 4.0 * u),
		"brake": Rect2(w - 4.8 * u, h - 3.3 * u, 2.0 * u, 2.7 * u),
		"handbrake": Rect2(w - 4.8 * u, h - 5.5 * u, 2.0 * u, 1.8 * u),
		"orbit": Rect2(w * 0.5 - 4.9 * u, 0.35 * u, 3.0 * u, 0.95 * u),
		"repair": Rect2(w * 0.5 - 1.7 * u, 0.35 * u, 3.4 * u, 0.95 * u),
		"exit": Rect2(w * 0.5 + 1.9 * u, 0.35 * u, 3.0 * u, 0.95 * u),
		"tleft": Rect2(0.5 * u, h - 4.45 * u, 1.05 * u, 1.0 * u),
		"lights": Rect2(1.7 * u, h - 4.45 * u, 1.5 * u, 1.0 * u),
		"hazard": Rect2(3.35 * u, h - 4.45 * u, 1.05 * u, 1.0 * u),
		"tright": Rect2(4.55 * u, h - 4.45 * u, 1.05 * u, 1.0 * u),
	}


func _hit(p: Vector2) -> String:
	var r := _rects()
	for k in r:
		if (r[k] as Rect2).grow(0.15 * _u()).has_point(p):
			return k
	return ""


func _input(event: InputEvent) -> void:
	if not visible or not touch_mode:
		return
	if event is InputEventScreenTouch:
		var p: Vector2 = event.position
		if event.pressed:
			if TouchBlock.hit(get_tree(), p):
				return
			var k := _hit(p)
			if k == "":
				k = "look"
			_fingers[event.index] = k
			match k:
				"orbit":
					orbit_toggled.emit()
				"lights":
					lights_pressed.emit()
				"tleft":
					turn_pressed.emit(-1)
				"tright":
					turn_pressed.emit(1)
				"hazard":
					hazard_pressed.emit()
				"repair":
					repair_pressed.emit()
				"exit":
					exit_pressed.emit()
			get_viewport().set_input_as_handled()
		else:
			_fingers.erase(event.index)
		_apply()
	elif event is InputEventScreenDrag:
		if _fingers.get(event.index, "") == "look":
			VehicleInput.look_delta += event.relative
			get_viewport().set_input_as_handled()
		elif _fingers.has(event.index):
			# sliding a finger from one pedal/arrow to another switches the control
			var k := _hit(event.position)
			if k in ["left", "right", "gas", "brake", "handbrake"] and k != _fingers[event.index]:
				_fingers[event.index] = k
				_apply()
			get_viewport().set_input_as_handled()
	elif event is InputEventMouseMotion and Input.is_mouse_button_pressed(MOUSE_BUTTON_RIGHT):
		VehicleInput.look_delta += event.relative


func _apply() -> void:
	var held := _fingers.values()
	VehicleInput.touch_left = held.has("left")
	VehicleInput.touch_right = held.has("right")
	VehicleInput.touch_gas = held.has("gas")
	VehicleInput.touch_brake = held.has("brake")
	VehicleInput.touch_handbrake = held.has("handbrake")
	queue_redraw()


func release() -> void:
	_fingers.clear()
	VehicleInput.release_all()


func _process(_d: float) -> void:
	# full-screen overlay (a Control directly under a CanvasLayer: follow the viewport size)
	var vs := get_viewport_rect().size
	if size != vs:
		position = Vector2.ZERO
		size = vs
	if visible:
		queue_redraw()


func _draw() -> void:
	var u := _u()
	var r := _rects()
	var held := _fingers.values()
	if not touch_mode:
		if car:
			_hud(_gauge_center(), 1.3 * u)
		return
	var base := Color(0, 0, 0, 0.34)
	var on := Color(1, 1, 1, 0.32)
	# steering arrows
	for k in ["left", "right"]:
		var rc: Rect2 = r[k]
		draw_rect(rc, on if held.has(k) or (k == "left" and Input.is_action_pressed(&"car_left")) or (k == "right" and Input.is_action_pressed(&"car_right")) else base)
		var c := rc.get_center()
		var s := 0.55 * u * (-1.0 if k == "left" else 1.0)
		draw_colored_polygon(PackedVector2Array([c + Vector2(s, 0), c + Vector2(-s * 0.6, -0.65 * u), c + Vector2(-s * 0.6, 0.65 * u)]), Color(1, 1, 1, 0.9))
	# pedals
	_pedal(r["gas"], "ГАЗ", Color(0.25, 0.75, 0.3, 0.55) if held.has("gas") else base)
	_pedal(r["brake"], "ТОРМОЗ", Color(0.85, 0.25, 0.2, 0.55) if held.has("brake") else base)
	_pedal(r["handbrake"], "РУЧНИК", Color(1.0, 0.6, 0.1, 0.6) if held.has("handbrake") else base)
	# top buttons
	_button(r["orbit"], "ВИД: " + camera_label, base)
	_button(r["repair"], "ВОССТАНОВИТЬ", base)
	_button(r["exit"], "ВЫЙТИ", base)
	if car and car.lights:
		var L := car.lights
		var amber := Color(1.0, 0.6, 0.1, 0.65)
		_button(r["tleft"], "◄", amber if L.turn < 0 else base)
		var bl: String = ["ФАРЫ", "БЛИЖН.", "ДАЛЬН."][L.beam]
		_button(r["lights"], bl, Color(0.2, 0.7, 0.3, 0.6) if L.beam == 1 else (Color(0.2, 0.4, 0.95, 0.65) if L.beam == 2 else base))
		_button(r["hazard"], "АВАР.", Color(0.9, 0.2, 0.15, 0.6) if L.hazard else base)
		_button(r["tright"], "►", amber if L.turn > 0 else base)
	if car:
		_hud(_gauge_center(), 1.3 * u)


func _gauge_center() -> Vector2:
	## right side above the pedals: never covers the car (which sits at the bottom centre)
	var u := _u()
	return Vector2(size.x - 3.7 * u, size.y - 6.9 * u)


func _pedal(rc: Rect2, label: String, col: Color) -> void:
	draw_rect(rc, col)
	draw_rect(rc, Color(1, 1, 1, 0.5), false, 2.0)
	# tread lines
	for i in range(1, 5):
		var y := rc.position.y + rc.size.y * i / 5.0
		draw_line(Vector2(rc.position.x + 8, y), Vector2(rc.end.x - 8, y), Color(1, 1, 1, 0.18), 2.0)
	_text(label, rc.get_center(), int(_u() * 0.32))


func _button(rc: Rect2, label: String, col: Color) -> void:
	draw_rect(rc, col)
	draw_rect(rc, Color(1, 1, 1, 0.45), false, 2.0)
	_text(label, rc.get_center(), int(_u() * 0.34))


func _text(t: String, c: Vector2, fs: int) -> void:
	var w := _font.get_string_size(t, HORIZONTAL_ALIGNMENT_CENTER, -1, fs)
	draw_string_outline(_font, c + Vector2(-w.x * 0.5, fs * 0.35), t, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, 4, Color(0, 0, 0, 0.8))
	draw_string(_font, c + Vector2(-w.x * 0.5, fs * 0.35), t, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, Color.WHITE)


func _hud(c: Vector2, rad: float) -> void:
	_speedometer(c, rad)
	_tachometer(c + Vector2(-rad * 2.25, rad * 0.25), rad * 0.72)
	_fuel_gauge(c + Vector2(rad * 1.72, rad * 0.32), rad * 0.6)
	_telltales(c + Vector2(-rad * 1.15, rad * 1.25), rad)


func _tachometer(c: Vector2, rad: float) -> void:
	## 0..5000 rpm, red zone from the 4400 rpm fuel cut
	draw_circle(c, rad * 1.05, Color(0, 0, 0, 0.45))
	var a0 := PI * 0.8
	var a1 := PI * 2.2
	draw_arc(c, rad * 0.92, a0, a1, 40, Color(1, 1, 1, 0.3), 3.0)
	draw_arc(c, rad * 0.92, lerpf(a0, a1, 4400.0 / 5000.0), a1, 8, Color(0.95, 0.15, 0.1, 0.9), 5.0)
	for k in 6:
		var a := lerpf(a0, a1, k / 5.0)
		var d := Vector2(cos(a), sin(a))
		draw_line(c + d * rad * 0.74, c + d * rad * 0.92, Color(1, 1, 1, 0.75), 2.0)
		_text("%d" % k, c + d * rad * 0.56, int(rad * 0.2))
	var an := lerpf(a0, a1, clampf(car.rpm / 5000.0, 0.0, 1.0))
	draw_line(c, c + Vector2(cos(an), sin(an)) * rad * 0.86, Color(1.0, 0.35, 0.2), 3.0)
	draw_circle(c, rad * 0.08, Color(0.9, 0.9, 0.9))
	_text("об/мин ×1000", c + Vector2(0, rad * 0.45), int(rad * 0.15))


func _telltales(c: Vector2, rad: float) -> void:
	## indicator arrows (blink), beam, handbrake, damage warning
	var fs := int(rad * 0.3)
	var L := car.lights
	var dim := Color(1, 1, 1, 0.18)
	var x := c.x
	var items := [
		["◄", Color(0.2, 1.0, 0.3) if L and L.blink_on and (L.turn < 0 or L.hazard) else dim],
		["►", Color(0.2, 1.0, 0.3) if L and L.blink_on and (L.turn > 0 or L.hazard) else dim],
		["≡D", (Color(0.3, 0.5, 1.0) if L.beam == 2 else Color(0.3, 1.0, 0.4)) if L and L.beam > 0 else dim],
		["(P)", Color(1.0, 0.2, 0.15) if car.handbrake else dim],
		["!", Color(1.0, 0.7, 0.1) if car.health < 50.0 else dim],
	]
	for it in items:
		var w := _font.get_string_size(it[0], HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x
		draw_string_outline(_font, Vector2(x, c.y), it[0], HORIZONTAL_ALIGNMENT_LEFT, -1, fs, 4, Color(0, 0, 0, 0.7))
		draw_string(_font, Vector2(x, c.y), it[0], HORIZONTAL_ALIGNMENT_LEFT, -1, fs, it[1])
		x += w + rad * 0.22


func _speedometer(c: Vector2, rad: float) -> void:
	## analog arc 0..220 km/h + digital readout of the physical body speed, gear and condition
	draw_circle(c, rad * 1.05, Color(0, 0, 0, 0.45))
	var a0 := PI * 1.05
	var a1 := PI * 1.95
	draw_arc(c, rad * 0.92, a0, a1, 48, Color(1, 1, 1, 0.35), 3.0)
	for k in range(0, 221, 20):
		var a := lerpf(a0, a1, k / 220.0)
		var d := Vector2(cos(a), sin(a))
		draw_line(c + d * rad * 0.8, c + d * rad * 0.92, Color(1, 1, 1, 0.7), 2.0 if k % 40 == 0 else 1.0)
	var v := clampf(car.speed_kmh, 0.0, 220.0)
	var an := lerpf(a0, a1, v / 220.0)
	draw_line(c, c + Vector2(cos(an), sin(an)) * rad * 0.86, Color(1.0, 0.35, 0.2), 3.0)
	var fs := int(rad * 0.42)
	_text("%d" % roundi(car.speed_kmh), c + Vector2(0, -rad * 0.38), fs)
	var g := "R" if car.gear == -1 else ("N" if car.gear == 0 else "D%d" % car.gear)
	_text("км/ч  %s" % g, c + Vector2(0, -rad * 0.05), int(rad * 0.2))
	# condition bar
	var bw := rad * 1.4
	var br := Rect2(c.x - bw * 0.5, c.y + rad * 0.55, bw, rad * 0.09)
	draw_rect(br, Color(0, 0, 0, 0.5))
	var hcol := Color(0.3, 0.85, 0.35).lerp(Color(0.95, 0.25, 0.2), 1.0 - car.health / 100.0)
	draw_rect(Rect2(br.position, Vector2(bw * car.health / 100.0, br.size.y)), hcol)
	_text("состояние %d%%" % roundi(car.health), c + Vector2(0, rad * 0.38), int(rad * 0.16))



## fuel gauge of the vehicle being driven (every car, the van, the bus, the boat): E .. F dial with a
## needle, red zone under 15 %, litres left / tank size; blinks when the tank is (nearly) empty
func _fuel_gauge(c: Vector2, rad: float) -> void:
	var fr := clampf(car.fuel_l / maxf(car.tank_l, 1.0), 0.0, 1.0)
	draw_circle(c, rad * 1.08, Color(0, 0, 0, 0.5))
	var a0 := PI * 0.75
	var a1 := PI * 0.25 + TAU
	draw_arc(c, rad * 0.9, a0, a1, 32, Color(1, 1, 1, 0.35), 3.0)
	draw_arc(c, rad * 0.9, a0, lerpf(a0, a1, 0.15), 8, Color(0.95, 0.15, 0.1, 0.95), 6.0)
	for k in 5:
		var a := lerpf(a0, a1, k / 4.0)
		var d := Vector2(cos(a), sin(a))
		draw_line(c + d * rad * 0.7, c + d * rad * 0.9, Color(1, 1, 1, 0.8), 2.0 if k % 2 == 0 else 1.0)
	_text("E", c + Vector2(cos(a0), sin(a0)) * rad * 0.5, int(rad * 0.28))
	_text("F", c + Vector2(cos(a1), sin(a1)) * rad * 0.5, int(rad * 0.28))
	var low := fr < 0.15
	var blink := low and int(Time.get_ticks_msec() / 400) % 2 == 0
	var an := lerpf(a0, a1, fr)
	draw_line(c, c + Vector2(cos(an), sin(an)) * rad * 0.85, Color(1.0, 0.35, 0.2), 3.0)
	draw_circle(c, rad * 0.1, Color(0.9, 0.9, 0.9))
	var col := Color(1.0, 0.25, 0.2) if blink else (Color(1.0, 0.8, 0.2) if low else Color(0.6, 0.85, 1.0))
	_text_col("БЕНЗИН", c + Vector2(0, rad * 0.42), int(rad * 0.2), col)
	_text("%.0f / %.0f л" % [car.fuel_l, car.tank_l], c + Vector2(0, rad * 0.78), int(rad * 0.22))


func _text_col(t: String, c: Vector2, fs: int, col: Color) -> void:
	var w := _font.get_string_size(t, HORIZONTAL_ALIGNMENT_CENTER, -1, fs)
	draw_string_outline(_font, c + Vector2(-w.x * 0.5, fs * 0.35), t, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, 4, Color(0, 0, 0, 0.8))
	draw_string(_font, c + Vector2(-w.x * 0.5, fs * 0.35), t, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, col)
