class_name CarDealer
extends Node3D
## The car dealership «АВТОСАЛОН» near the start (the reserved lot at the corner of the avenue and
## Gulistan street, 46 x 56 m): a glass
## showroom with a lit sign. At its door «АВТОСАЛОН» opens the catalogue: Toyota Camry 50 000,
## Lexus RX 350 100 000, Toyota Land Cruiser Prado 120 000 somoni. A bought car is delivered to the
## lot in front of the showroom and is the player's for good (Wallet.cars, saved); a car that is not
## the player's cannot be opened («ПРОДАЁТСЯ»). Job vehicles (LakLak van, bus, boats) are free.

const POS := Vector3(-93.0, 0.0, 64.0)        ## showroom centre (reserved lot 2), front faces +X (the avenue)
const SIZE := Vector3(16.0, 7.0, 30.0)
## node name in main -> [main property, display name, price]
const CARS := {
	"Camry": ["camry", "Toyota Camry", 50000],
	"Lexus": ["lexus", "Lexus RX 350", 100000],
	"Prado": ["car", "Toyota Land Cruiser Prado", 120000],
	"W123": ["w123", "Mercedes-Benz W123", 45000],
	"E30": ["e30", "BMW E30", 60000],
	"E30M": ["e30m", "BMW E30 заниженная", 75000],
	"R12": ["r12", "Renault 12", 20000],
	"GLS": ["gls", "Mercedes-Benz GLS 580", 250000],
}
const ORDER := ["R12", "W123", "Camry", "E30", "E30M", "Lexus", "Prado", "GLS"]

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
	return to_global(Vector3(SIZE.x * 0.5 + 2.4, 0.2, 0.0))


func delivery_point(k: int) -> Vector3:
	return to_global(Vector3(SIZE.x * 0.5 + 6.0 + float(k / 5) * 6.5, 0.3, -6.0 + float(k % 5) * 6.0))


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
		var k := ["Camry", "Lexus", "Prado", "W123", "E30", "E30M", "R12", "GLS"].find(node_name)
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
	## 0.25 after the owner's reference: a black-and-glass showroom — big black fascia with the brand
	## emblem and «АВТОСАЛОН ДУШАНБЕ», full-height glass walls, a black entrance portal with glass
	## doors, granite steps, white planters, flags (Tajikistan + brand), a tall emblem pylon by the road;
	## inside a polished marble floor, white columns, ring ceiling lights, a black feature wall with the
	## emblem, a reception desk with a light strip, sofas, plants and the real cars on display.
	## (Own brand: no third-party logos.) Front = +X (the avenue).
	var sx := SIZE.x * 0.5
	var sz := SIZE.z * 0.5
	var H := SIZE.y
	var black := _mat(Color(0.03, 0.03, 0.035), 0.35, 0.4)
	var grey := _mat(Color(0.42, 0.43, 0.45), 0.6, 0.2)
	var white := _mat(Color(0.94, 0.94, 0.93), 0.4)
	var steel := _mat(Color(0.72, 0.74, 0.77), 0.25, 0.85)
	var glass := _mat(Color(0.12, 0.18, 0.22, 0.28), 0.03, 0.6)
	glass.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	var marble := _mat(Color(0.86, 0.86, 0.85), 0.06, 0.15)
	var granite := _mat(Color(0.55, 0.55, 0.56), 0.5, 0.1)
	var lamp := _mat(Color(1, 1, 1), 0.3, 0.0, Color(1.0, 0.98, 0.94), 3.0)
	var leaf := _mat(Color(0.12, 0.38, 0.12), 0.8)
	var silver_e := _mat(Color(0.9, 0.9, 0.92), 0.2, 0.9, Color(0.6, 0.6, 0.65), 0.6)
	# ---- plaza: granite paving out to the street, the lot, a podium + 3 steps along the front
	_box(Vector3(SIZE.x + 20.0, 0.3, SIZE.z + 16.0), Vector3(6.0, -0.1, 0), granite)
	_box(Vector3(SIZE.x + 1.0, 0.45, SIZE.z + 1.0), Vector3(0, 0.18, 0), granite)
	for k in 3:
		_box(Vector3(0.45, 0.15 * (3 - k), SIZE.z - 4.0), Vector3(sx + 0.7 + k * 0.45, 0.075 * (3 - k) - 0.02, 0), granite)
	_box(Vector3(SIZE.x - 0.2, 0.06, SIZE.z - 0.2), Vector3(0, 0.43, 0), marble)
	# ---- shell: back wall black, side walls glass with black corner piers; roof slab
	_box(Vector3(0.4, H, SIZE.z), Vector3(-sx + 0.2, H * 0.5 + 0.4, 0), black)
	for sgn: float in [-1.0, 1.0]:
		_box(Vector3(SIZE.x, H, 0.12), Vector3(0, H * 0.5 + 0.4, sgn * (sz - 0.06)), glass)
		_box(Vector3(0.6, H + 0.4, 0.6), Vector3(sx - 0.3, (H + 0.4) * 0.5 + 0.2, sgn * (sz - 0.3)), black)
		for k in 4:
			_box(Vector3(0.12, H, 0.16), Vector3(-sx + 2.0 + k * (SIZE.x - 4.0) / 3.0, H * 0.5 + 0.4, sgn * (sz - 0.06)), black)
	_box(Vector3(SIZE.x + 0.8, 0.5, SIZE.z + 0.8), Vector3(0, H + 0.65, 0), black)
	# front glass curtain with black mullions and a transom; the entrance gap in the middle
	var door_w := 5.0
	for sgn: float in [-1.0, 1.0]:
		var w := sz - door_w * 0.5 - 0.6
		_box(Vector3(0.12, H, w), Vector3(sx - 0.06, H * 0.5 + 0.4, sgn * (door_w * 0.5 + w * 0.5)), glass)
		var n := 6
		for k in n + 1:
			_box(Vector3(0.18, H, 0.14), Vector3(sx, H * 0.5 + 0.4, sgn * (door_w * 0.5 + k * w / n)), black)
	_box(Vector3(0.2, 0.14, SIZE.z), Vector3(sx, 3.3, 0), black)
	# ---- the big black fascia (sign band) above the glass + the emblem and the name
	_box(Vector3(1.4, 3.2, SIZE.z + 1.2), Vector3(sx + 0.2, H + 2.1, 0), black)
	_box(Vector3(0.6, 3.2, SIZE.x + 0.8), Vector3(0, H + 2.1, sz + 0.3), black)   # wraps the corner (street side)
	_emblem(Vector3(sx + 0.92, H + 2.1, -sz + 4.0), 1.15, PI * 0.5)
	_sign_text("АВТОСАЛОН ДУШАНБЕ", Vector3(sx + 0.92, H + 2.35, 3.0), PI * 0.5, 120, 0.013, Color(0.96, 0.96, 0.97))
	_sign_text("DUSHANBE MOTORS", Vector3(sx + 0.92, H + 1.35, 3.0), PI * 0.5, 54, 0.011, Color(0.7, 0.72, 0.75))
	_box(Vector3(0.05, 2.2, 0.06), Vector3(sx + 0.9, H + 2.1, -sz + 6.6), silver_e)
	# ---- entrance portal: a black frame stepping out, glass doors (open gap), a light strip
	_box(Vector3(2.0, 0.6, door_w + 2.0), Vector3(sx + 0.9, 4.1, 0), black)
	for sgn: float in [-1.0, 1.0]:
		_box(Vector3(2.0, 3.9, 0.7), Vector3(sx + 0.9, 2.35, sgn * (door_w * 0.5 + 0.65)), black)
	_box(Vector3(0.06, 0.06, door_w), Vector3(sx + 1.9, 3.8, 0), lamp)
	for sgn: float in [-1.0, 1.0]:
		_box(Vector3(0.05, 3.1, 1.2), Vector3(sx + 0.1, 1.95, sgn * (door_w * 0.5 - 0.55)), glass)
	# ---- planters with thujas along the front, flags, the pylon by the road
	for z in [-sz + 2.0, -door_w * 0.5 - 2.4, door_w * 0.5 + 2.4, sz - 2.0]:
		_planter(Vector3(sx + 2.2, 0.0, z), white, leaf)
	var fz := -sz - 3.5
	for k in 3:
		var fp := Vector3(sx + 3.0 + k * 2.2, 0.0, fz)
		_box(Vector3(0.12, 9.0, 0.12), fp + Vector3(0, 4.5, 0), steel)
		if k == 1:
			var tf := Sprite3D.new()
			tf.texture = load("res://assets/models/extra/tajik_flag_0.jpg") if ResourceLoader.exists("res://assets/models/extra/tajik_flag_0.jpg") else null
			if tf.texture:
				tf.pixel_size = 1.6 / float(tf.texture.get_width())
				tf.position = fp + Vector3(0, 8.1, 0.85)
				tf.double_sided = true
				add_child(tf)
		else:
			_box(Vector3(0.03, 2.2, 1.5), fp + Vector3(0, 7.8, 0.82), black)
			_emblem(fp + Vector3(0.03, 7.9, 0.82), 0.42, PI * 0.5)
			_emblem(fp + Vector3(-0.03, 7.9, 0.82), 0.42, -PI * 0.5)
	var py := Vector3(sx + 14.0, 0.0, -sz - 3.0)
	_box(Vector3(0.9, 7.0, 2.4), py + Vector3(0, 3.5, 0), black)
	_box(Vector3(1.4, 0.5, 2.9), py + Vector3(0, 0.25, 0), grey)
	for sgn: float in [-1.0, 1.0]:
		_emblem(py + Vector3(sgn * 0.47, 5.4, 0), 0.8, PI * 0.5 if sgn > 0 else -PI * 0.5)
		_sign_text("АВТОСАЛОН\nДУШАНБЕ", py + Vector3(sgn * 0.47, 3.4, 0), PI * 0.5 if sgn > 0 else -PI * 0.5, 44, 0.01, Color(0.95, 0.95, 0.96))
	for tz in [-sz - 5.5, sz + 4.0]:
		_tree(Vector3(sx + 21.0, 0.0, tz), leaf)
	for tz in [-sz - 6.0, sz + 6.0]:
		_tree(Vector3(-sx + 2.0, 0.0, tz), leaf)
	# ---- interior: white columns, ring ceiling lights, the black feature wall, reception, sofas
	_box(Vector3(SIZE.x - 0.6, 0.1, SIZE.z - 0.6), Vector3(0, H + 0.35, 0), white)      # ceiling
	for cz in [-sz + 7.0, 0.0, sz - 7.0]:
		_box(Vector3(0.7, H, 0.7), Vector3(-1.5, H * 0.5 + 0.4, cz), white)
	for rx in [-3.5, 3.0]:
		for rz in [-9.0, -3.0, 3.0, 9.0]:
			var ring := MeshInstance3D.new()
			var tm := TorusMesh.new()
			tm.inner_radius = 1.05
			tm.outer_radius = 1.2
			tm.rings = 32
			tm.ring_segments = 6
			ring.mesh = tm
			ring.material_override = lamp
			ring.position = Vector3(rx, H + 0.15, rz)
			add_child(ring)
	var ol := OmniLight3D.new()
	ol.position = Vector3(0, H - 0.5, 0)
	ol.omni_range = 18.0
	ol.light_energy = 1.4
	add_child(ol)
	_box(Vector3(0.3, 4.2, 9.0), Vector3(-sx + 0.6, 2.6, 0), black)                        # feature wall
	_emblem(Vector3(-sx + 0.77, 3.2, -3.3), 0.85, PI * 0.5)
	_sign_text("DUSHANBE MOTORS", Vector3(-sx + 0.77, 3.2, 0.9), PI * 0.5, 64, 0.0085, Color(0.95, 0.95, 0.96))
	_box(Vector3(1.0, 1.05, 4.2), Vector3(-sx + 2.8, 0.95, 0), white)                      # reception
	_box(Vector3(1.1, 0.05, 4.3), Vector3(-sx + 2.8, 1.5, 0), black)
	_box(Vector3(0.04, 0.05, 4.0), Vector3(-sx + 3.31, 0.75, 0), lamp)
	for sz2 in [-sz + 3.0, sz - 3.0]:                                                       # sofas
		_box(Vector3(1.0, 0.45, 2.6), Vector3(-sx + 2.0, 0.65, sz2), black)
		_box(Vector3(0.3, 0.5, 2.6), Vector3(-sx + 1.55, 1.05, sz2), black)
		_planter(Vector3(-sx + 1.3, 0.43, sz2 + (1.9 if sz2 < 0 else -1.9)), white, leaf)
	# ---- the cars on show (real models, static): GLS on a lit podium, W123, E30, Camry, Lexus
	var pod := MeshInstance3D.new()
	var cm := CylinderMesh.new()
	cm.top_radius = 3.4
	cm.bottom_radius = 3.5
	cm.height = 0.25
	cm.radial_segments = 40
	pod.mesh = cm
	pod.material_override = steel
	pod.position = Vector3(3.0, 0.55, -7.5)
	add_child(pod)
	_display_car("res://assets/models/cars/gls.glb", Vector3(3.0, 0.67, -7.5), 0.7, PI)
	_display_car("res://assets/models/cars/w123.glb", Vector3(3.0, 0.48, 7.5), -0.6, PI)
	_display_car("res://assets/models/extra/camry.glb", Vector3(3.6, 0.92, 1.8), PI * 0.35, PI)
	_display_car("res://assets/models/cars/e30.glb", Vector3(-4.0, 0.48, -8.5), 1.2, PI)
	_display_car("res://assets/models/extra/lexus_rx.glb", Vector3(-4.0, 0.95, 8.5), 1.9, 0.0)
	# lot markings in front (delivery spots, two columns)
	for c2 in 2:
		for k in 5:
			_box(Vector3(5.0, 0.03, 0.15), Vector3(sx + 6.0 + c2 * 6.5, 0.07, -9.0 + k * 6.0), _mat(Color(1, 1, 1), 0.6))
	# ---- collision: walls, glass, portal (a gap at the doors: the showroom can be entered), plaza
	var body := StaticBody3D.new()
	add_child(body)
	var w2 := sz - door_w * 0.5
	for c in [[Vector3(0.4, H, SIZE.z), Vector3(-sx + 0.2, H * 0.5 + 0.4, 0)],
			[Vector3(SIZE.x, H, 0.3), Vector3(0, H * 0.5 + 0.4, -sz + 0.1)], [Vector3(SIZE.x, H, 0.3), Vector3(0, H * 0.5 + 0.4, sz - 0.1)],
			[Vector3(0.3, H, w2), Vector3(sx, H * 0.5 + 0.4, -(door_w * 0.5 + w2 * 0.5))], [Vector3(0.3, H, w2), Vector3(sx, H * 0.5 + 0.4, door_w * 0.5 + w2 * 0.5)],
			[Vector3(SIZE.x + 20.0, 0.3, SIZE.z + 16.0), Vector3(6.0, -0.1, 0)], [Vector3(SIZE.x + 1.0, 0.45, SIZE.z + 1.0), Vector3(0, 0.18, 0)],
			[Vector3(0.9, 7.0, 2.4), py + Vector3(0, 3.5, 0)], [Vector3(1.0, 1.05, 4.2), Vector3(-sx + 2.8, 0.95, 0)]]:
		var cs := CollisionShape3D.new()
		var sh := BoxShape3D.new()
		sh.size = c[0]
		cs.shape = sh
		cs.position = c[1]
		body.add_child(cs)
	for k in 3:                                    # the steps as a ramp-like stack
		var cs2 := CollisionShape3D.new()
		var sh2 := BoxShape3D.new()
		sh2.size = Vector3(0.45, 0.15 * (3 - k), SIZE.z - 4.0)
		cs2.shape = sh2
		cs2.position = Vector3(sx + 0.7 + k * 0.45, 0.075 * (3 - k) - 0.02, 0)
		body.add_child(cs2)


## the showroom's own emblem: a silver ring with a car silhouette (no third-party logos)
func _emblem(p: Vector3, r: float, yaw: float) -> void:
	var holder := Node3D.new()
	holder.position = p
	holder.rotation.y = yaw
	add_child(holder)
	var ring := MeshInstance3D.new()
	var tm := TorusMesh.new()
	tm.inner_radius = r * 0.86
	tm.outer_radius = r
	tm.rings = 40
	tm.ring_segments = 8
	ring.mesh = tm
	ring.rotation.x = PI * 0.5
	ring.material_override = _mat(Color(0.9, 0.9, 0.92), 0.2, 0.9, Color(0.7, 0.7, 0.75), 0.8)
	holder.add_child(ring)
	var ic := Sprite3D.new()
	ic.texture = HudStyle.icon("car")
	if ic.texture:
		ic.pixel_size = r * 1.3 / float(ic.texture.get_width())
		ic.position = Vector3(0, 0, 0.02)
		ic.modulate = Color(0.92, 0.92, 0.95)
		holder.add_child(ic)


func _sign_text(t: String, p: Vector3, yaw: float, size: int, px: float, col: Color) -> void:
	var lb := Label3D.new()
	lb.text = t
	lb.font = HudStyle.font()
	lb.font_size = size
	lb.pixel_size = px
	lb.modulate = col
	lb.outline_size = 0
	lb.double_sided = false
	lb.position = p
	lb.rotation.y = yaw
	add_child(lb)


func _planter(p: Vector3, pot: Material, leaf: Material) -> void:
	var pm := MeshInstance3D.new()
	var cm := CylinderMesh.new()
	cm.top_radius = 0.42
	cm.bottom_radius = 0.32
	cm.height = 0.8
	pm.mesh = cm
	pm.material_override = pot
	pm.position = p + Vector3(0, 0.4, 0)
	add_child(pm)
	_veg("thuja_cone", Transform3D(Basis.IDENTITY.scaled(Vector3.ONE * 0.6), p + Vector3(0, 0.75, 0)))


## vegetation through the open world's own placer (its foliage shaders, LODs); queued until it exists
var _veg_queue := {}


func _veg(id: String, xf: Transform3D) -> void:
	if not _veg_queue.has(id):
		_veg_queue[id] = []
	(_veg_queue[id] as Array).append(xf)
	if _veg_queue.size() == 1 and (_veg_queue[id] as Array).size() == 1:
		_flush_veg.call_deferred()


func _flush_veg() -> void:
	var ow: OpenWorld = OpenWorld.instance
	if ow == null:
		return
	var holder := Node3D.new()
	holder.name = "Greenery"
	add_child(holder)
	ow._trees(holder, _veg_queue, 0)
	_veg_queue = {}


func _tree(p: Vector3, _leaf: Material) -> void:
	_veg("chinar_middle", Transform3D(Basis.IDENTITY.scaled(Vector3.ONE * 0.9), p))


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
