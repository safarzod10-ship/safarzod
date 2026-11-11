class_name TaxiJob
extends Node
## 0.25: taxi work in any owned car (not the LakLak van, not the bus / boat). The ТАКСИ button
## (or key T) while driving switches the shift on: a client waits at the kerb of a street 0.3 .. 1.5 km
## away (a person waving, a green beacon); stop next to them (< 6 km/h, 9 m) and they get in; then the
## destination 0.6 .. 3 km away (an orange beacon, the navigator route). Stop there: the fare
## 20 смн + 15 смн/км (+ a tip for a car without damage). The shift ends with the button again
## or when you get out (the passenger leaves; no fare).

const RADIUS := 9.0
const BASE := 20
const PER_KM := 15.0
const CLIENT := "res://assets/characters/player/player.glb"

var session: CarSession
var laklak: LakLakJob
var wd: WorldData
var on := false
var stage := ""                 ## "" / "pickup" / "ride"
var pickup := Vector3.INF
var dest := Vector3.INF
var addr := ""
var km := 0.0
var rides := 0
var _rng := RandomNumberGenerator.new()
var _ui: CanvasLayer
var _btn: Button
var _line: Label
var _beacon: Node3D
var _beam_mat: StandardMaterial3D
var _client: Node3D


func _ready() -> void:
	_rng.randomize()
	_build_ui()
	_beacon = Node3D.new()
	_beacon.name = "TaxiBeacon"
	add_child(_beacon)
	_beam_mat = StandardMaterial3D.new()
	_beam_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	_beam_mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	_beam_mat.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	_beam_mat.cull_mode = BaseMaterial3D.CULL_DISABLED
	var col := MeshInstance3D.new()
	var cm := CylinderMesh.new()
	cm.top_radius = 1.4
	cm.bottom_radius = 2.2
	cm.height = 60.0
	cm.cap_top = false
	cm.cap_bottom = false
	col.mesh = cm
	col.material_override = _beam_mat
	col.position.y = 30.0
	col.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_beacon.add_child(col)
	_beacon.visible = false


func can_drive_taxi() -> bool:
	if session == null or not session.driving or session.car == null:
		return false
	var c := session.car
	if laklak and c == laklak.van:
		return false
	return not (c is VehicleBoat) and not (c is VehicleCar and (c as VehicleCar).preset == "bus")


func toggle() -> void:
	if on:
		stop("Смена такси окончена. Поездок: %d" % rides)
		return
	if not can_drive_taxi():
		_say("Такси: сядьте в свою машину")
		return
	on = true
	rides = 0
	_say("Смена такси начата! Ищем клиента…")
	_new_pickup()


func stop(msg: String = "") -> void:
	on = false
	stage = ""
	_remove_client()
	_beacon.visible = false
	if Minimap.target_owner == self:
		Minimap.target = Vector3.INF
		Minimap.target_owner = null
	if msg != "":
		_say(msg)


func _input(event: InputEvent) -> void:
	TouchBlock.tap(event, [_btn])


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo and (event as InputEventKey).keycode == KEY_T:
		if can_drive_taxi() or on:
			toggle()


func _process(_delta: float) -> void:
	var can := can_drive_taxi()
	_btn.visible = can or on
	_btn.text = "ТАКСИ: ВКЛ" if on else "ТАКСИ"
	_btn.modulate = Color(1.0, 0.85, 0.2) if on else Color.WHITE
	if not on:
		_line.visible = false
		return
	if not can:
		stop("Такси: вы вышли из машины — смена окончена")
		return
	var car := session.car
	var at := car.global_position
	var target := pickup if stage == "pickup" else dest
	var d := Vector2(at.x - target.x, at.z - target.z).length()
	_beacon.visible = true
	_beacon.global_position = target
	Minimap.target = target
	Minimap.target_owner = self
	if stage == "pickup":
		_line.text = "ТАКСИ · клиент ждёт: %s · %.1f км" % [addr, d / 1000.0]
		if d < RADIUS and car.speed_kmh < 6.0:
			_board()
	else:
		_line.text = "ТАКСИ · везём: %s · %.1f км · %s" % [addr, d / 1000.0, Wallet.fmt(fare())]
		if d < RADIUS and car.speed_kmh < 6.0:
			_arrive()
	_line.visible = true


func fare() -> int:
	return BASE + int(round(km * PER_KM))


func _new_pickup() -> void:
	var from := session.car.global_position
	var p := _random_kerb(from, 300.0, 1500.0)
	if p == Vector3.INF:
		stop("Такси: рядом нет клиентов — поезжайте в город")
		return
	stage = "pickup"
	pickup = p
	addr = laklak._address(p, "house") if laklak else "Душанбе"
	_beam_mat.albedo_color = Color(0.25, 1.0, 0.35, 0.35)
	_spawn_client(p, from)
	_say("Новый клиент: %s" % addr)


func _board() -> void:
	_remove_client()
	var p := _random_kerb(pickup, 600.0, 3000.0)
	if p == Vector3.INF:
		p = _random_kerb(pickup, 300.0, 5000.0)
	if p == Vector3.INF:
		stop("Такси: клиент передумал")
		return
	stage = "ride"
	dest = p
	km = Vector2(dest.x - pickup.x, dest.z - pickup.z).length() / 1000.0
	addr = laklak._address(p, "house") if laklak else "Душанбе"
	_beam_mat.albedo_color = Color(1.0, 0.62, 0.15, 0.35)
	_say("Клиент сел. Едем: %s\n%.1f км · %s" % [addr, km, Wallet.fmt(fare())])


func _arrive() -> void:
	var pay := fare()
	var tip := 0
	var car := session.car
	if car and car.health > 90.0:
		tip = 5 + int(km * 3.0)
	Wallet.earn(pay + tip)
	rides += 1
	_say("Приехали! +%s%s" % [Wallet.fmt(pay + tip), (" (чаевые %s)" % Wallet.fmt(tip)) if tip > 0 else ""])
	_new_pickup()


func _random_kerb(from: Vector3, rmin: float, rmax: float) -> Vector3:
	if wd == null or laklak == null:
		return Vector3.INF
	for attempt in 300:
		var b: Array = wd.buildings[_rng.randi() % wd.buildings.size()]
		var bp := Vector3(float(b[1]), float(b[8]), float(b[2]))
		var dist := Vector2(bp.x - from.x, bp.z - from.z).length()
		if dist < rmin or dist > rmax:
			continue
		var k := laklak._kerb_near(bp)
		if k != Vector3.INF:
			return k
	return Vector3.INF


## the client: the city's character model standing at the kerb, facing the street, idle animation
func _spawn_client(p: Vector3, look_from: Vector3) -> void:
	_remove_client()
	if not ResourceLoader.exists(CLIENT):
		return
	_client = (load(CLIENT) as PackedScene).instantiate()
	_client.name = "TaxiClient"
	add_child(_client)
	var y := p.y
	if wd:
		var h := wd.height_at(p.x, p.z)
		if not is_nan(h):
			y = maxf(y, h)
	_client.global_position = Vector3(p.x, y + 0.15, p.z)
	var to := Vector3(look_from.x - p.x, 0, look_from.z - p.z)
	if to.length() > 0.1:
		_client.rotation.y = atan2(to.x, to.z)
	var ap: AnimationPlayer = _client.find_child("AnimationPlayer", true, false)
	var lib := "res://assets/characters/animations/player_mocap.res"
	if ap and ResourceLoader.exists(lib):
		if not ap.has_animation_library(&"m"):
			ap.add_animation_library(&"m", load(lib))
		if ap.has_animation(&"m/idle"):
			ap.play(&"m/idle")
	var tag := Label3D.new()
	tag.text = "ТАКСИ!"
	tag.font_size = 64
	tag.pixel_size = 0.006
	tag.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	tag.modulate = Color(1.0, 0.85, 0.2)
	tag.outline_size = 12
	tag.position.y = 2.3
	tag.no_depth_test = true
	_client.add_child(tag)


func _remove_client() -> void:
	if _client and is_instance_valid(_client):
		_client.queue_free()
	_client = null


func _say(t: String) -> void:
	if laklak:
		laklak.toast(t)


func _build_ui() -> void:
	_ui = CanvasLayer.new()
	_ui.layer = 17
	add_child(_ui)
	var font: Font = load("res://assets/fonts/game_font.tres")
	_btn = Button.new()
	_btn.text = "ТАКСИ"
	_btn.focus_mode = Control.FOCUS_NONE
	_btn.add_theme_font_override("font", font)
	_btn.add_theme_font_size_override("font_size", 22)
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0.95, 0.75, 0.1, 0.9)
	sb.set_corner_radius_all(14)
	sb.content_margin_left = 16
	sb.content_margin_right = 16
	_btn.add_theme_stylebox_override("normal", sb)
	_btn.add_theme_stylebox_override("hover", sb)
	_btn.add_theme_stylebox_override("pressed", sb)
	_btn.add_theme_color_override("font_color", Color(0.08, 0.08, 0.08))
	_btn.add_theme_color_override("font_hover_color", Color(0.08, 0.08, 0.08))
	_btn.pressed.connect(toggle)
	_btn.visible = false
	_btn.add_to_group(TouchBlock.GROUP)
	_ui.add_child(_btn)
	_line = Label.new()
	_line.add_theme_font_override("font", font)
	_line.add_theme_font_size_override("font_size", 17)
	_line.add_theme_color_override("font_color", Color(1.0, 0.88, 0.35))
	_line.add_theme_color_override("font_outline_color", Color.BLACK)
	_line.add_theme_constant_override("outline_size", 6)
	_line.visible = false
	_ui.add_child(_line)
	get_viewport().size_changed.connect(_layout)
	_layout()


func _layout() -> void:
	var vs := get_viewport().get_visible_rect().size
	var d := clampf(minf(vs.x, vs.y) * 0.22, 150.0, 320.0)
	# the button sits under the job line, right of the round minimap (clear of the car buttons)
	_btn.position = Vector2(16 + d + 24, minf(vs.x, vs.y) * 0.175 + 64)
	_btn.size = Vector2(150, 52)
	_line.position = Vector2(16 + d + 24, minf(vs.x, vs.y) * 0.175 + 124)
	_line.size = Vector2(minf(vs.x * 0.45, 620.0), 40)
