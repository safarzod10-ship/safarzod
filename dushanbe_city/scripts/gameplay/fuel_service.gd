class_name FuelService
extends Node
## Fuel for every vehicle (VehiclePrado.fuel_l / tank_l, burned while the engine runs):
##  * at a filling station (group "fuel_station", 24 along the roads): stop at the pumps (< 12 m,
##    < 3 km/h) -> «ЗАПРАВИТЬ» (key F): fills at 8 l/s up to the full tank or as much as the money
##    allows, 14 smn per litre;
##  * the tank ran dry anywhere: the engine stops and the car does not go; a window offers fuel
##    delivered on the spot at 18 smn per litre (10 l, 20 l, full tank, or all the money buys);
##  * fuel low (< 15 %): warning + the nearest station marked on the minimap.
## Money: Wallet (saved).

const PRICE_STATION := 14
const PRICE_DELIVERY := 18
const PUMP_RADIUS := 16.0
const FILL_RATE := 8.0                 ## l / s at the pump

var session: CarSession
var _ui: CanvasLayer
var _font: Font
var _btn_fill: Button
var _btn_buy: Button
var _panel: PanelContainer
var _panel_title: Label
var _panel_btns: Array[Button] = []
var _status: Label
var _status_t := 0.0
var _filling := false
var _fill_litres := 0.0
var _fill_target := 0.0
var _station: Node3D = null
var _warned := false
var _last_car: VehiclePrado = null
var _was_fill_vis := false


func _ready() -> void:
	Wallet.load_state()
	_font = load("res://assets/fonts/game_font.tres")
	_ui = CanvasLayer.new()
	_ui.layer = 18
	add_child(_ui)
	_btn_fill = _button("ЗАПРАВИТЬ · 14 смн/л", Color(0.1, 0.55, 0.25))
	_btn_fill.pressed.connect(start_fill)
	_btn_buy = _button("КУПИТЬ БЕНЗИН", Color(0.75, 0.3, 0.05))
	_btn_buy.pressed.connect(open_delivery)
	_status = Label.new()
	_status.add_theme_font_override("font", _font)
	_status.add_theme_font_size_override("font_size", 24)
	_status.add_theme_color_override("font_color", Color(1.0, 0.92, 0.6))
	_status.add_theme_color_override("font_outline_color", Color.BLACK)
	_status.add_theme_constant_override("outline_size", 8)
	_status.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_ui.add_child(_status)
	_build_panel()
	get_viewport().size_changed.connect(_layout)
	_layout()


func _button(text: String, col: Color) -> Button:
	var b := Button.new()
	b.text = text
	b.focus_mode = Control.FOCUS_NONE
	b.add_theme_font_override("font", _font)
	b.add_theme_font_size_override("font_size", 30)
	var sb := StyleBoxFlat.new()
	sb.bg_color = col
	sb.set_corner_radius_all(14)
	sb.content_margin_left = 18
	sb.content_margin_right = 18
	sb.content_margin_top = 10
	sb.content_margin_bottom = 10
	b.add_theme_stylebox_override("normal", sb)
	var sh := sb.duplicate() as StyleBoxFlat
	sh.bg_color = col.lightened(0.15)
	b.add_theme_stylebox_override("hover", sh)
	b.add_theme_stylebox_override("pressed", sh)
	b.custom_minimum_size = Vector2(0, 84)
	b.add_to_group(TouchBlock.GROUP)
	b.visible = false
	_ui.add_child(b)
	return b


func _build_panel() -> void:
	_panel = PanelContainer.new()
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0.06, 0.08, 0.12, 0.92)
	sb.set_corner_radius_all(18)
	sb.border_color = Color(1.0, 0.6, 0.1)
	sb.set_border_width_all(3)
	sb.content_margin_left = 26
	sb.content_margin_right = 26
	sb.content_margin_top = 20
	sb.content_margin_bottom = 20
	_panel.add_theme_stylebox_override("panel", sb)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 12)
	_panel.add_child(v)
	_panel_title = Label.new()
	_panel_title.add_theme_font_override("font", _font)
	_panel_title.add_theme_font_size_override("font_size", 26)
	_panel_title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(_panel_title)
	for i in 4:
		var b := Button.new()
		b.focus_mode = Control.FOCUS_NONE
		b.add_theme_font_override("font", _font)
		b.add_theme_font_size_override("font_size", 28)
		b.custom_minimum_size = Vector2(520, 76)
		b.add_to_group(TouchBlock.GROUP)
		var bi := i
		b.pressed.connect(func() -> void: _panel_choice(bi))
		v.add_child(b)
		_panel_btns.append(b)
	_panel.add_to_group(TouchBlock.GROUP)
	_panel.visible = false
	_ui.add_child(_panel)


func _layout() -> void:
	var vs := get_viewport().get_visible_rect().size
	for b: Button in [_btn_fill, _btn_buy]:
		b.reset_size()
		b.position = Vector2(vs.x * 0.5 - b.size.x * 0.5, vs.y * 0.6)
	_status.position = Vector2(vs.x * 0.5 - 400, vs.y * 0.5)
	_status.size = Vector2(800, 40)
	_panel.reset_size()
	_panel.position = Vector2(vs.x * 0.5 - _panel.size.x * 0.5, maxf(vs.y * 0.12, 90.0))


func toast(t: String, secs := 3.0) -> void:
	_status.text = t
	_status_t = secs


func current_car() -> VehiclePrado:
	return session.car if session and session.driving else null


## taps (any finger, also while the gas pedal is held) on the fuel buttons / the window
func _input(event: InputEvent) -> void:
	var btns: Array = [_btn_fill, _btn_buy]
	btns.append_array(_panel_btns)
	TouchBlock.tap(event, btns)


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo and event.physical_keycode == KEY_F:
		if _btn_fill.visible:
			start_fill()
		elif _btn_buy.visible:
			open_delivery()


## the nearest filling station whose pumps are within `radius` of p (or null)
func station_near(p: Vector3, radius := PUMP_RADIUS) -> Node3D:
	var best: Node3D = null
	var bd := radius
	for s in get_tree().get_nodes_in_group(&"fuel_station"):
		var pump: Vector3 = (s as Node3D).get_meta("pump", (s as Node3D).global_position)
		var d := Vector2(pump.x - p.x, pump.z - p.z).length()
		if d < bd:
			bd = d
			best = s
	return best


## nearest station anywhere (world data, also unloaded sectors): pump position or INF
func nearest_station_pos(p: Vector3) -> Vector3:
	var best := Vector3.INF
	var bd := INF
	for f in WorldData.get_instance().fuel:
		var yaw := float(f["yaw"])
		var o := Vector3(float(f.get("ox", f["x"])), float(f["y"]), float(f.get("oz", f["z"])))
		var pump := o + Vector3(cos(yaw), 0, -sin(yaw)) * 7.5
		var d := Vector2(pump.x - p.x, pump.z - p.z).length()
		if d < bd:
			bd = d
			best = pump
	return best


func _process(delta: float) -> void:
	_status_t -= delta
	_status.visible = _status_t > 0.0
	var car := current_car()
	if car != _last_car:
		if _last_car and _last_car.out_of_fuel.is_connected(_on_empty):
			_last_car.out_of_fuel.disconnect(_on_empty)
		if car and not car.out_of_fuel.is_connected(_on_empty):
			car.out_of_fuel.connect(_on_empty)
		_last_car = car
		_filling = false
		if car == null or car.fuel_l > 0.0:
			_panel.visible = false
		elif car.fuel_l <= 0.0 and station_near(car.global_position) == null:
			open_delivery()                    # got into a car with an empty tank
	if car == null:
		_btn_fill.visible = false
		_btn_buy.visible = false
		_panel.visible = false
		_set_fuel_marker(Vector3.INF)
		return
	# at the pumps
	_station = station_near(car.global_position) if car.speed_kmh < 3.0 else null
	if _station == null and car.speed_kmh >= 3.0 and car.fuel_l < car.tank_l - 1.0 and station_near(car.global_position) != null:
		if _status_t <= 0.0:
			toast("АЗС: остановитесь у колонок, чтобы заправиться", 1.5)
	var full := car.fuel_l >= car.tank_l - 0.05
	_btn_fill.visible = _station != null and not _filling and not full and not _panel.visible
	# the delivery button: tank empty, or low (< 15 %) away from a station
	_btn_buy.visible = car.fuel_l < car.tank_l * 0.15 and _station == null and not _panel.visible
	if _btn_buy.visible:
		var t := "КУПИТЬ БЕНЗИН · 18 смн/л" if car.fuel_l <= 0.0 else "ДОЗАПРАВКА · 18 смн/л"
		if _btn_buy.text != t:
			_btn_buy.text = t
			_layout()
	if _btn_fill.visible and not _was_fill_vis:
		_layout()
	_was_fill_vis = _btn_fill.visible
	if _filling:
		if _station == null:
			_finish_fill()
		else:
			var step := minf(FILL_RATE * delta, _fill_target - _fill_litres)
			_fill_litres += car.refuel(step)
			toast("Заправка: %.1f л · %s" % [_fill_litres, Wallet.fmt(int(ceil(_fill_litres * PRICE_STATION)))], 0.5)
			if _fill_litres >= _fill_target - 0.01 or car.fuel_l >= car.tank_l - 0.01:
				_finish_fill()
	# low fuel: warning once + the nearest station on the minimap
	var low := car.fuel_l < car.tank_l * 0.15
	if low:
		var sp := nearest_station_pos(car.global_position)
		_set_fuel_marker(sp)
		if not _warned and car.fuel_l > 0.0:
			_warned = true
			toast("Мало топлива: %.0f л. Ближайшая АЗС — %.1f км" % [car.fuel_l, Vector2(sp.x - car.global_position.x, sp.z - car.global_position.z).length() / 1000.0], 5.0)
	else:
		_warned = false
		_set_fuel_marker(Vector3.INF)


func _set_fuel_marker(p: Vector3) -> void:
	Minimap.fuel_marker = p


func start_fill() -> void:
	var car := current_car()
	if car == null or _station == null or _filling:
		return
	var need := car.tank_l - car.fuel_l
	var afford := float(Wallet.money) / PRICE_STATION
	if afford < 0.5:
		toast("Недостаточно денег для заправки (%s)" % Wallet.fmt(Wallet.money))
		return
	_fill_target = minf(need, afford)
	_fill_litres = 0.0
	_filling = true


func _finish_fill() -> void:
	_filling = false
	if _fill_litres <= 0.0:
		return
	var cost := int(ceil(_fill_litres * PRICE_STATION))
	cost = mini(cost, Wallet.money)
	Wallet.money -= cost
	Wallet.save_state()
	toast("Заправлено %.1f л · −%s · бак %.0f / %.0f л" % [_fill_litres, Wallet.fmt(cost), _last_car.fuel_l, _last_car.tank_l], 4.0)
	_fill_litres = 0.0


func _on_empty() -> void:
	var car := current_car()
	if car and station_near(car.global_position) == null:
		open_delivery()
	elif car:
		toast("Бензин закончился — вы на АЗС: нажмите «ЗАПРАВИТЬ»", 4.0)


## the "out of fuel" window: fuel delivered on the spot, 18 smn / l
func open_delivery() -> void:
	var car := current_car()
	if car == null:
		return
	var need := car.tank_l - car.fuel_l
	var afford := floorf(float(Wallet.money) / PRICE_DELIVERY)
	_panel_title.text = "Бензин закончился!\nДоставка топлива: %d смн/л · у вас %s" % [PRICE_DELIVERY, Wallet.fmt(Wallet.money)] if car.fuel_l <= 0.0 \
		else "Доставка топлива: %d смн/л · у вас %s" % [PRICE_DELIVERY, Wallet.fmt(Wallet.money)]
	var opts := [10.0, 20.0, need]
	for i in 3:
		var l: float = minf(opts[i], need)
		var b := _panel_btns[i]
		b.set_meta("litres", l)
		b.text = ("Полный бак: %.0f л — %s" if i == 2 else "%.0f л — %s") % [l, Wallet.fmt(int(ceil(l * PRICE_DELIVERY)))]
		b.disabled = l < 0.5 or ceil(l * PRICE_DELIVERY) > Wallet.money
		if b.disabled and i < 2 and afford >= 1.0 and afford < l:
			b.text = "На все деньги: %.0f л — %s" % [afford, Wallet.fmt(int(afford) * PRICE_DELIVERY)]
			b.set_meta("litres", afford)
			b.disabled = false
	_panel_btns[3].text = "Закрыть" if afford >= 1.0 else "Закрыть · нет денег (работа: LakLak / автобус)"
	_panel_btns[3].set_meta("litres", 0.0)
	_panel.visible = true
	_layout()


func _panel_choice(i: int) -> void:
	var car := current_car()
	var l: float = _panel_btns[i].get_meta("litres", 0.0)
	_panel.visible = false
	if car == null or l <= 0.0:
		return
	var cost := int(ceil(l * PRICE_DELIVERY))
	if cost > Wallet.money:
		toast("Недостаточно денег")
		return
	var added := car.refuel(l)
	cost = int(ceil(added * PRICE_DELIVERY))
	Wallet.money -= cost
	Wallet.save_state()
	toast("Топливо доставлено: %.0f л · −%s" % [added, Wallet.fmt(cost)], 4.0)


## tests: buy delivered fuel without the UI
func buy_delivery(litres: float) -> float:
	var car := current_car()
	if car == null:
		return 0.0
	var cost := int(ceil(litres * PRICE_DELIVERY))
	if cost > Wallet.money:
		return 0.0
	var added := car.refuel(litres)
	Wallet.money -= int(ceil(added * PRICE_DELIVERY))
	return added
