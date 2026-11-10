class_name CarDealer
extends Node3D
## The car dealership «АВТОСАЛОН» near the start (the reserved lot at the corner of the avenue and
## Gulistan street, 46 x 56 m): a glass
## showroom with a lit sign. At its door «АВТОСАЛОН» opens the catalogue: Toyota Camry 50 000,
## Lexus RX 350 100 000, Toyota Land Cruiser Prado 120 000 somoni. A bought car is delivered to the
## lot in front of the showroom and is the player's for good (Wallet.cars, saved); a car that is not
## the player's cannot be opened («ПРОДАЁТСЯ»). Job vehicles (LakLak van, bus, boats) are free.

const POS := Vector3(-93.0, 0.0, 64.0)        ## showroom centre (reserved lot 2), front faces +X (the avenue)
const SIZE := Vector3(14.0, 6.0, 20.0)
## node name in main -> [main property, display name, price]
const CARS := {
	"Camry": ["camry", "Toyota Camry", 50000],
	"Lexus": ["lexus", "Lexus RX 350", 100000],
	"Prado": ["car", "Toyota Land Cruiser Prado", 120000],
	"W123": ["w123", "Mercedes-Benz W123", 45000],
	"E30": ["e30", "BMW E30", 60000],
	"E30M": ["e30m", "BMW E30 заниженная", 75000],
	"R12": ["r12", "Renault 12", 20000],
}
const ORDER := ["R12", "W123", "Camry", "E30", "E30M", "Lexus", "Prado"]

static var instance: CarDealer
static var strict := false        ## tests: apply the ownership rule although the save is off

var main: Node
var in_city := false                ## placed on the Dushanbe lot (world landmark "dealer")
var _ui: CanvasLayer
var _panel: PanelContainer
var _rows := {}
var _money: Label
var _msg: Label


func _ready() -> void:
	instance = self
	add_to_group(&"interactable")
	add_to_group(&"car_dealer")
	var wd := WorldData.get_instance()
	var lm: Dictionary = wd.landmark("dealer") if wd and wd.ok else {}
	if lm.is_empty():
		var y := CityWorld.instance.terrain_height(POS.x, POS.z) if CityWorld.instance else 2.4
		global_position = Vector3(POS.x, y, POS.z)
	else:
		# lot centre = local (6, 0, 0): the plaza spans x -12..24 in front of the showroom
		var b := Basis(Vector3.UP, float(lm["yaw"]))
		global_transform = Transform3D(b, Vector3(float(lm["x"]), float(lm["y"]), float(lm["z"])) - b * Vector3(6, 0, 0))
		in_city = true
	_build_house()
	_build_ui()


## owned (or free to use): the job vehicles always; in tests (no save) everything
static func owns(v: Node) -> bool:
	if v == null:
		return false
	var nm := String(v.name)
	if not CARS.has(nm):
		return true
	if Wallet.no_save and not strict:
		return true
	return Wallet.cars.has(String(CARS[nm][0]))


static func price_of(v: Node) -> int:
	return int(CARS[String(v.name)][2]) if v and CARS.has(String(v.name)) else 0


func door_point() -> Vector3:
	return to_global(Vector3(SIZE.x * 0.5 + 1.4, 0.2, 4.0))


func delivery_point(k: int) -> Vector3:
	return to_global(Vector3(SIZE.x * 0.5 + 9.0 + float(k / 4) * 7.5, 0.3, -6.0 + float(k % 4) * 6.0))


func delivery_yaw() -> float:
	return PI * 0.5 + global_rotation.y


# ------------------------------------------------------------------------------------------ interactable
func interaction_label(_player: Node) -> String:
	return "АВТОСАЛОН"


func interaction_point(_player: Node) -> Vector3:
	return door_point()


func can_interact(_player: Node) -> bool:
	return not _panel.visible


func interact(_player: Node) -> void:
	open()


# ------------------------------------------------------------------------------------------ buying
func buy(node_name: String) -> String:
	## "" on success, else the reason
	if not CARS.has(node_name):
		return "Нет такой машины"
	var key := String(CARS[node_name][0])
	var price := int(CARS[node_name][2])
	if Wallet.cars.has(key):
		return "Эта машина уже ваша" + (" — стоит у вас в гараже" if key == "car" else "")
	if Wallet.money < price:
		return "Недостаточно денег: нужно %s" % Wallet.fmt(price)
	Wallet.money -= price
	Wallet.cars.append(key)
	Wallet.save_state()
	# delivered to the lot in front of the showroom
	var car: Node = main.get(key) if main else null
	if car is VehiclePrado and not (car as VehiclePrado).wrecked:
		var k := ["Camry", "Lexus", "Prado", "W123", "E30", "E30M", "R12"].find(node_name)
		var ow: Variant = main.get("open_world")
		var p := delivery_point(k)
		(car as VehiclePrado).place(p, delivery_yaw())
		if ow:
			(ow as OpenWorld).preload_at(p)
	return ""


# ------------------------------------------------------------------------------------------ building
func _mat(col: Color, rough := 0.8, metal := 0.0, emit := Color.BLACK, emit_e := 1.0) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = col
	m.roughness = rough
	m.metallic = metal
	if emit != Color.BLACK:
		m.emission_enabled = true
		m.emission = emit
		m.emission_energy_multiplier = emit_e
	return m


func _box(size: Vector3, pos: Vector3, m: Material, parent: Node3D = null) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = size
	mi.mesh = bm
	mi.material_override = m
	mi.position = pos
	(parent if parent else self).add_child(mi)
	return mi


func _build_house() -> void:
	var sx := SIZE.x * 0.5
	var sz := SIZE.z * 0.5
	var white := _mat(Color(0.93, 0.93, 0.92), 0.5)
	var dark := _mat(Color(0.1, 0.11, 0.13), 0.4, 0.3)
	var steel := _mat(Color(0.7, 0.72, 0.75), 0.3, 0.8)
	var glass := _mat(Color(0.12, 0.2, 0.26, 1.0), 0.05, 0.5, Color(0.05, 0.08, 0.1))
	var floor_m := _mat(Color(0.82, 0.82, 0.8), 0.15, 0.1)
	var lamp := _mat(Color(1, 1, 1), 0.3, 0.0, Color(1.0, 0.97, 0.9), 2.5)
	var gold := _mat(Color(0.95, 0.72, 0.25), 0.3, 0.8, Color(0.4, 0.28, 0.05), 0.6)
	# plaza + polished showroom floor
	_box(Vector3(SIZE.x + 22.0, 0.3, SIZE.z + 8.0), Vector3(6.0, -0.1, 0), _mat(Color(0.6, 0.6, 0.58), 0.9))
	_box(Vector3(SIZE.x, 0.25, SIZE.z), Vector3(0, 0.08, 0), floor_m)
	# back + side walls (white), roof slab with a dark fascia, glass front + glass sides
	_box(Vector3(0.4, SIZE.y, SIZE.z), Vector3(-sx + 0.2, SIZE.y * 0.5, 0), white)
	_box(Vector3(SIZE.x, SIZE.y, 0.4), Vector3(0, SIZE.y * 0.5, -sz + 0.2), white)
	_box(Vector3(SIZE.x * 0.4, SIZE.y, 0.4), Vector3(-sx * 0.6, SIZE.y * 0.5, sz - 0.2), white)
	_box(Vector3(SIZE.x * 0.6, SIZE.y - 0.4, 0.1), Vector3(sx * 0.4, SIZE.y * 0.5, sz - 0.1), glass)
	_box(Vector3(SIZE.x + 1.0, 0.6, SIZE.z + 1.0), Vector3(0, SIZE.y + 0.3, 0), dark)
	_box(Vector3(0.12, SIZE.y - 0.6, SIZE.z - 0.6), Vector3(sx - 0.06, (SIZE.y - 0.6) * 0.5 + 0.2, 0), glass)
	for k in 5:                                   # mullions
		_box(Vector3(0.16, SIZE.y, 0.16), Vector3(sx, SIZE.y * 0.5, -sz + 0.2 + k * (SIZE.z - 0.4) / 4.0), steel)
	# ceiling light strips
	for k in 4:
		_box(Vector3(SIZE.x - 3.0, 0.08, 0.35), Vector3(0, SIZE.y - 0.1, -7.5 + k * 5.0), lamp)
	# show podiums (turntables) with a display car silhouette each + the reception desk
	for k in 2:
		var pod := MeshInstance3D.new()
		var cm := CylinderMesh.new()
		cm.top_radius = 3.2
		cm.bottom_radius = 3.3
		cm.height = 0.3
		cm.radial_segments = 32
		pod.mesh = cm
		pod.material_override = steel
		pod.position = Vector3(-1.0, 0.3, -5.0 + k * 9.0)
		add_child(pod)
	_box(Vector3(1.0, 1.1, 3.4), Vector3(-sx + 2.2, 0.75, 7.0), dark)
	_box(Vector3(1.2, 0.06, 3.6), Vector3(-sx + 2.2, 1.33, 7.0), gold)
	# display cars inside: the real models, static (meshes only)
	_display_car("res://assets/models/extra/camry.glb", Vector3(-1.0, 0.45, -5.0), 0.6, PI)
	_display_car("res://assets/models/extra/lexus_rx.glb", Vector3(-1.0, 0.45, 4.0), -0.5, 0.0)
	# sign: dark board on the fascia, gold letters, both on the front and the side to the street
	var lb := Label3D.new()
	lb.text = "АВТОСАЛОН"
	lb.font = HudStyle.font()
	lb.font_size = 96
	lb.pixel_size = 0.016
	lb.modulate = Color(1.0, 0.82, 0.35)
	lb.outline_size = 12
	lb.position = Vector3(sx + 0.52, SIZE.y + 0.3, 0)
	lb.rotation.y = PI * 0.5
	add_child(lb)
	var sub := Label3D.new()
	sub.text = "DUSHANBE-X MOTORS"
	sub.font = HudStyle.font()
	sub.font_size = 40
	sub.pixel_size = 0.01
	sub.modulate = Color(0.9, 0.9, 0.95)
	sub.position = Vector3(sx + 0.52, SIZE.y - 0.5, 0)
	sub.rotation.y = PI * 0.5
	add_child(sub)
	# a pylon with the car icon by the road
	_box(Vector3(0.4, 7.5, 0.4), Vector3(sx + 17.0, 3.75, -sz - 1.0), steel)
	_box(Vector3(0.5, 2.4, 3.0), Vector3(sx + 17.0, 7.3, -sz - 1.0), dark)
	for side: float in [1.0, -1.0]:
		var ic := Sprite3D.new()
		ic.texture = HudStyle.icon("car")
		ic.pixel_size = 0.007
		ic.position = Vector3(sx + 17.0 + 0.27 * side, 7.6, -sz - 1.0)
		ic.rotation.y = PI * 0.5 if side > 0 else -PI * 0.5
		add_child(ic)
		var pl := Label3D.new()
		pl.text = "АВТО"
		pl.font = HudStyle.font()
		pl.font_size = 64
		pl.pixel_size = 0.01
		pl.modulate = Color(1.0, 0.82, 0.35)
		pl.position = Vector3(sx + 17.0 + 0.27 * side, 6.6, -sz - 1.0)
		pl.rotation.y = PI * 0.5 if side > 0 else -PI * 0.5
		add_child(pl)
	# lot markings in front (delivery spots)
	for k in 3:
		_box(Vector3(5.0, 0.03, 0.15), Vector3(sx + 9.0, 0.07, -9.0 + k * 6.0), _mat(Color(1, 1, 1), 0.6))
	_box(Vector3(5.0, 0.03, 0.15), Vector3(sx + 9.0, 0.07, 9.0), _mat(Color(1, 1, 1), 0.6))
	# collision: the walls and the glass (the plaza is walkable ground)
	var body := StaticBody3D.new()
	add_child(body)
	for c in [[Vector3(0.4, SIZE.y, SIZE.z), Vector3(-sx + 0.2, SIZE.y * 0.5, 0)], [Vector3(SIZE.x, SIZE.y, 0.4), Vector3(0, SIZE.y * 0.5, -sz + 0.2)],
			[Vector3(SIZE.x, SIZE.y, 0.4), Vector3(0, SIZE.y * 0.5, sz - 0.2)], [Vector3(0.3, SIZE.y, SIZE.z), Vector3(sx, SIZE.y * 0.5, 0)],
			[Vector3(SIZE.x + 22.0, 0.3, SIZE.z + 8.0), Vector3(6.0, -0.1, 0)], [Vector3(0.4, 7.5, 0.4), Vector3(sx + 17.0, 3.75, -sz - 1.0)]]:
		var cs := CollisionShape3D.new()
		var sh := BoxShape3D.new()
		sh.size = c[0]
		cs.shape = sh
		cs.position = c[1]
		body.add_child(cs)


func _display_car(path: String, pos: Vector3, yaw: float, model_yaw: float) -> void:
	if not ResourceLoader.exists(path):
		return
	var src: Node3D = (load(path) as PackedScene).instantiate()
	var holder := Node3D.new()
	holder.position = pos
	holder.rotation.y = yaw
	add_child(holder)
	var inner := Node3D.new()
	inner.rotation.y = model_yaw
	holder.add_child(inner)
	inner.add_child(src)
	for mi in src.find_children("*", "MeshInstance3D", true, false):
		(mi as MeshInstance3D).cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF


# ------------------------------------------------------------------------------------------ UI
func _btn(t: String, col: Color) -> Button:
	var b := Button.new()
	b.text = t
	b.custom_minimum_size = Vector2(230, 64)
	b.add_theme_font_override("font", HudStyle.font())
	b.add_theme_font_size_override("font_size", 22)
	for st in ["normal", "hover", "pressed", "disabled", "focus"]:
		var sb := StyleBoxFlat.new()
		sb.bg_color = col.darkened(0.25 if st == "pressed" else (0.55 if st == "disabled" else 0.0))
		sb.set_corner_radius_all(12)
		sb.content_margin_left = 14
		sb.content_margin_right = 14
		b.add_theme_stylebox_override(st, sb)
	return b


func _build_ui() -> void:
	_ui = CanvasLayer.new()
	_ui.layer = 30
	add_child(_ui)
	_panel = PanelContainer.new()
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0.05, 0.06, 0.08, 0.95)
	sb.set_corner_radius_all(16)
	sb.border_color = Color(0.95, 0.72, 0.25)
	sb.set_border_width_all(2)
	sb.content_margin_left = 26
	sb.content_margin_right = 26
	sb.content_margin_top = 18
	sb.content_margin_bottom = 18
	_panel.add_theme_stylebox_override("panel", sb)
	_panel.add_to_group(TouchBlock.GROUP)
	_panel.visible = false
	_ui.add_child(_panel)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 12)
	_panel.add_child(v)
	var t := Label.new()
	t.text = "АВТОСАЛОН"
	t.add_theme_font_override("font", HudStyle.font())
	t.add_theme_font_size_override("font_size", 32)
	t.add_theme_color_override("font_color", Color(1.0, 0.82, 0.35))
	t.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(t)
	_money = Label.new()
	_money.add_theme_font_size_override("font_size", 22)
	_money.add_theme_color_override("font_color", HudStyle.MONEY)
	_money.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(_money)
	for nm in ORDER:
		var h := HBoxContainer.new()
		h.add_theme_constant_override("separation", 16)
		v.add_child(h)
		var ic := TextureRect.new()
		ic.texture = HudStyle.icon("car")
		ic.custom_minimum_size = Vector2(44, 44)
		ic.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		ic.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
		h.add_child(ic)
		var lab := Label.new()
		lab.custom_minimum_size = Vector2(330, 0)
		lab.add_theme_font_size_override("font_size", 19)
		h.add_child(lab)
		var b := _btn("", Color(0.15, 0.5, 0.25))
		b.pressed.connect(func() -> void: _buy(nm))
		h.add_child(b)
		_rows[nm] = [lab, b]
	_msg = Label.new()
	_msg.add_theme_font_size_override("font_size", 20)
	_msg.add_theme_color_override("font_color", Color(1, 0.85, 0.4))
	_msg.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(_msg)
	var close := _btn("ЗАКРЫТЬ", Color(0.4, 0.12, 0.1))
	close.pressed.connect(func() -> void: _panel.visible = false)
	close.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	v.add_child(close)


func open() -> void:
	_msg.text = ""
	_refresh()
	_panel.visible = true
	_panel.reset_size()
	var vs := get_viewport().get_visible_rect().size
	_panel.position = (vs - _panel.size) * 0.5


func is_open() -> bool:
	return _panel.visible


func _refresh() -> void:
	_money.text = "У вас: " + Wallet.fmt(Wallet.money)
	for nm in _rows:
		var r: Array = _rows[nm]
		var d: Array = CARS[nm]
		var mine := Wallet.cars.has(String(d[0]))
		(r[0] as Label).text = "%s\n%s" % [String(d[1]), Wallet.fmt(int(d[2]))]
		var b := r[1] as Button
		b.text = "ВАША" if mine else "КУПИТЬ"
		b.disabled = mine


func _buy(nm: String) -> void:
	var err := buy(nm)
	_msg.text = "Поздравляем! %s ждёт вас у салона." % String(CARS[nm][1]) if err == "" else err
	_refresh()
