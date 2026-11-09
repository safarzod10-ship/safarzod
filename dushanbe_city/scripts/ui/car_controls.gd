class_name CarControls
extends Control
## Touch controls while driving (look of the owner's mock-ups, HudStyle; multitouch: every control
## tracks its own finger, so gas, steering and handbrake can be held together):
##   bottom-left  : big round steering arrows ◄ ►
##   bottom-right : pedals ТОРМОЗ (at standstill = reverse) and ГАЗ (dotted rubber plates)
##   right        : round DOOR (leave the vehicle) and (P) handbrake; headlights, hazards
##   left column  : camera view, pause (the game menu), repair
##   bottom centre: dashboard panel: speed, gear | fuel % + bar (every vehicle: its own tank),
##                  ◄ ► indicator buttons beside it, condition above it
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


## circle buttons are stored as their bounding squares (hit test = the square grown by 15 %)
func _rects() -> Dictionary:
	var u := _u()
	var w := size.x
	var h := size.y
	var top := 16.0 + clampf(minf(w, h) * 0.22, 150.0, 320.0)     # under the round minimap
	return {
		"left": _sq(Vector2(1.95 * u, h - 1.8 * u), 1.3 * u),
		"right": _sq(Vector2(4.9 * u, h - 1.8 * u), 1.3 * u),
		"gas": Rect2(w - 1.95 * u, h - 3.55 * u, 1.6 * u, 3.2 * u),
		"brake": Rect2(w - 4.2 * u, h - 2.55 * u, 2.05 * u, 2.2 * u),
		"exit": _sq(Vector2(w - 1.35 * u, h - 6.05 * u), 0.72 * u),
		"handbrake": _sq(Vector2(w - 1.35 * u, h - 4.45 * u), 0.72 * u),
		"lights": _sq(Vector2(w - 3.0 * u, h - 6.2 * u), 0.5 * u),
		"hazard": _sq(Vector2(w - 3.0 * u, h - 4.95 * u), 0.5 * u),
		"orbit": _sq(Vector2(0.95 * u, top + 0.75 * u), 0.55 * u),
		"menu": _sq(Vector2(0.95 * u, top + 2.0 * u), 0.55 * u),
		"repair": _sq(Vector2(0.95 * u, top + 3.25 * u), 0.55 * u),
		"tleft": _sq(Vector2(w * 0.5 - 1.75 * u, h - 1.85 * u), 0.4 * u),
		"tright": _sq(Vector2(w * 0.5 + 1.75 * u, h - 1.85 * u), 0.4 * u),
	}


static func _sq(c: Vector2, r: float) -> Rect2:
	return Rect2(c - Vector2(r, r), Vector2(r, r) * 2.0)


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
				"menu":
					HudStyle.toggle_menu(get_tree())
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
	if size.x < 50.0 or size.y < 50.0:
		return
	var r := _rects()
	var held := _fingers.values()
	if not touch_mode:
		if car:
			_dash_panel()
		return
	# steering arrows, pedals
	HudStyle.arrow_button(self, (r["left"] as Rect2).get_center(), (r["left"] as Rect2).size.x * 0.5, -1, held.has("left") or Input.is_action_pressed(&"car_left"))
	HudStyle.arrow_button(self, (r["right"] as Rect2).get_center(), (r["right"] as Rect2).size.x * 0.5, 1, held.has("right") or Input.is_action_pressed(&"car_right"))
	HudStyle.pedal(self, r["brake"], "ТОРМОЗ", held.has("brake"))
	HudStyle.pedal(self, r["gas"], "ГАЗ", held.has("gas"))
	# round buttons
	_rb(r, "exit", "door", false)
	_rb(r, "handbrake", "parking", held.has("handbrake") or (car != null and car.handbrake), Color(0.75, 0.12, 0.1, 0.8) if car != null and car.handbrake else Color(0, 0, 0, 0))
	_rb(r, "orbit", "camera", false)
	_rb(r, "menu", "pause", false)
	_rb(r, "repair", "wrench", false)
	if car and car.lights:
		var L := car.lights
		_rb(r, "lights", "lights", false, Color(0.15, 0.55, 0.25, 0.85) if L.beam == 1 else (Color(0.15, 0.35, 0.85, 0.85) if L.beam == 2 else Color(0, 0, 0, 0)))
		_rb(r, "hazard", "hazard", false, Color(0.85, 0.2, 0.12, 0.85) if L.hazard and L.blink_on else Color(0, 0, 0, 0))
		var amber := Color(1.0, 0.6, 0.1, 0.9)
		var tl := (r["tleft"] as Rect2)
		var tr := (r["tright"] as Rect2)
		HudStyle.round_button(self, tl.get_center(), tl.size.x * 0.5, "", false, amber if L.turn < 0 and L.blink_on else Color(0, 0, 0, 0), "◄")
		HudStyle.round_button(self, tr.get_center(), tr.size.x * 0.5, "", false, amber if L.turn > 0 and L.blink_on else Color(0, 0, 0, 0), "►")
	if car:
		_dash_panel()


func _rb(r: Dictionary, key: String, icon_id: String, pressed: bool, accent := Color(0, 0, 0, 0)) -> void:
	var rc: Rect2 = r[key]
	HudStyle.round_button(self, rc.get_center(), rc.size.x * 0.5, icon_id, pressed, accent)


## the dashboard panel at the bottom centre (as in the mock-up): speedometer icon + km/h + gear |
## fuel pump icon + % + bar (red and blinking when low); the camera view name above it
func _dash_panel() -> void:
	var u := _u()
	var pw := 4.6 * u
	var ph := 1.05 * u
	var rc := Rect2(size.x * 0.5 - pw * 0.5, size.y - ph - 0.25 * u, pw, ph)
	HudStyle.panel(self, rc)
	var cy := rc.get_center().y
	var x0 := rc.position.x
	var ic := ph * 0.72
	var sp := HudStyle.icon("speed")
	if sp:
		draw_texture_rect(sp, Rect2(Vector2(x0 + ph * 0.18, cy - ic * 0.5), Vector2(ic, ic)), false)
	HudStyle.label(self, "%d" % roundi(car.speed_kmh), Vector2(x0 + pw * 0.33, cy - ph * 0.1), int(ph * 0.5))
	var g := "R" if car.gear == -1 else ("N" if car.gear == 0 else "D%d" % car.gear)
	HudStyle.label(self, "КМ/Ч · %s" % g, Vector2(x0 + pw * 0.33, cy + ph * 0.3), int(ph * 0.2))
	draw_line(Vector2(x0 + pw * 0.52, rc.position.y + ph * 0.18), Vector2(x0 + pw * 0.52, rc.end.y - ph * 0.18), Color(1, 1, 1, 0.45), 2.0)
	var fr := clampf(car.fuel_l / maxf(car.tank_l, 1.0), 0.0, 1.0)
	var low := fr < 0.15
	var blink := low and int(Time.get_ticks_msec() / 400) % 2 == 0
	var fu := HudStyle.icon("fuel")
	if fu:
		draw_texture_rect(fu, Rect2(Vector2(x0 + pw * 0.56, cy - ic * 0.5), Vector2(ic, ic)), false, Color(1.0, 0.35, 0.3) if blink else Color.WHITE)
	HudStyle.label(self, "%d%%" % roundi(fr * 100.0), Vector2(x0 + pw * 0.82, cy - ph * 0.17), int(ph * 0.36), Color(1.0, 0.4, 0.35) if low else Color.WHITE)
	var bar := Rect2(x0 + pw * 0.69, cy + ph * 0.14, pw * 0.27, ph * 0.17)
	draw_rect(bar, Color(0, 0, 0, 0.6))
	var fcol := Color(0.95, 0.2, 0.15) if low else (Color(1.0, 0.75, 0.15) if fr < 0.3 else Color(0.2, 0.85, 0.3))
	draw_rect(Rect2(bar.position, Vector2(bar.size.x * fr, bar.size.y)), fcol)
	draw_rect(bar, Color(1, 1, 1, 0.5), false, 1.5)
	# condition / telltales line above the panel
	var tt := "состояние %d%%" % roundi(car.health)
	if car.handbrake:
		tt += "  ·  (P)"
	HudStyle.label(self, tt, Vector2(size.x * 0.5, rc.position.y - ph * 0.3), int(ph * 0.2), Color(1, 0.75, 0.3) if car.health < 50.0 else Color(1, 1, 1, 0.9))
