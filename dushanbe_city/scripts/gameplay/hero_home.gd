class_name HeroHome
extends Node3D
## The hero's home in Dushanbe, on the west side of Rudaki avenue (world landmark "hero_home"; the
## layout below is in local lot coordinates, front = local -X towards the avenue): a modern two-storey
## house with a balcony, a garage with the Prado parked inside (raised door, drive out to the
## avenue), a paved drive, a fenced lawn with a pool. The game starts at the front door; at the door
## «ДОМ · ОТДЫХ» saves the game and restores the health. On the map as «Дом».

const LOT := Rect2(-16.5, -296.0, 52.5, 130.0)
const HOUSE := Rect2(6.0, -232.0, 16.0, 20.0)       ## x, z, size x, size z (front faces -X)
const GARAGE := Rect2(-6.0, -249.0, 10.0, 8.0)      ## the Prado inside, door on the -X side
const H := 7.2                                      ## two storeys
const LIFT := 0.14                                  ## the yard's ground over the lot's paving
const FLOOR := LIFT + 0.13                          ## top of the garage floor / drive

static var instance: HeroHome

var _toast: Label
var _toast_t := 0.0


func _ready() -> void:
	instance = self
	add_to_group(&"interactable")
	add_to_group(&"hero_home")
	var c := LOT.get_center()
	var wd := WorldData.get_instance()
	var lm: Dictionary = wd.landmark("hero_home") if wd and wd.ok else {}
	if lm.is_empty():
		# old data: the reserved lot on the peninsula
		var y := CityWorld.instance.terrain_height(c.x, c.y) if CityWorld.instance else 2.4
		global_position = Vector3(0, y, 0)
	else:
		var b := Basis(Vector3.UP, float(lm["yaw"]))
		global_transform = Transform3D(b, Vector3(float(lm["x"]), float(lm["y"]), float(lm["z"])) - b * Vector3(c.x, 0, c.y))
	_build()
	var ui := CanvasLayer.new()
	ui.layer = 31
	add_child(ui)
	_toast = Label.new()
	_toast.add_theme_font_override("font", HudStyle.font())
	_toast.add_theme_font_size_override("font_size", 30)
	_toast.add_theme_color_override("font_color", Color(1, 0.9, 0.5))
	_toast.add_theme_constant_override("outline_size", 6)
	_toast.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.8))
	_toast.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_toast.set_anchors_preset(Control.PRESET_TOP_WIDE)
	_toast.position.y = 140
	_toast.visible = false
	ui.add_child(_toast)


func _process(delta: float) -> void:
	_toast_t -= delta
	_toast.visible = _toast_t > 0.0


## where the hero appears: on the path in front of the door, facing the drive / avenue
func spawn_point() -> Vector3:
	return to_global(Vector3(HOUSE.position.x - 7.5, FLOOR + 0.1, HOUSE.position.y + 6.0))


const SPAWN_YAW := PI * 0.5                           ## local: facing -X (towards the avenue)


func spawn_yaw() -> float:
	return SPAWN_YAW + global_rotation.y


## the Prado's parking place inside the garage, nose to the door (-X)
func garage_point() -> Vector3:
	var g := GARAGE.get_center()
	return to_global(Vector3(g.x + 0.4, 0.0, g.y))


func garage_yaw() -> float:
	return PI * 0.5 + global_rotation.y


## the garage floor height (world)
func floor_y() -> float:
	return global_position.y + FLOOR


func door_point() -> Vector3:
	return to_global(Vector3(HOUSE.position.x - 1.0, 0.2, HOUSE.position.y + 6.0))


# ------------------------------------------------------------------------------------------ interactable
func interaction_label(_player: Node) -> String:
	return "ДОМ · РАЗОБРАТЬ ПАКЕТ" if Food.hand == "bag" else "ДОМ · КУХНЯ"


func interaction_point(_player: Node) -> Vector3:
	return door_point()


func can_interact(_player: Node) -> bool:
	return true


func interact(_player: Node) -> void:
	if Food.hand == "bag":
		var n := Food.unpack()
		_say("Пакет разобран: %d продуктов в холодильнике" % n)
	open_kitchen()


# ------------------------------------------------------------------------------------------ kitchen
## the home kitchen: the fridge (groceries and cooked dishes), recipes, eat / drink, rest + save
var _panel: PanelContainer
var _kbox: VBoxContainer


func _say(t: String) -> void:
	_toast.text = t
	_toast_t = 3.0


func _kbtn(t: String, col: Color, w := 150.0) -> Button:
	var b := Button.new()
	b.text = t
	b.custom_minimum_size = Vector2(w, 50)
	b.add_theme_font_override("font", HudStyle.font())
	b.add_theme_font_size_override("font_size", 18)
	for stl in ["normal", "hover", "pressed", "disabled", "focus"]:
		var sb := StyleBoxFlat.new()
		sb.bg_color = col.darkened(0.25 if stl == "pressed" else (0.6 if stl == "disabled" else 0.0))
		sb.set_corner_radius_all(10)
		sb.content_margin_left = 8
		sb.content_margin_right = 8
		b.add_theme_stylebox_override(stl, sb)
	return b


func _klabel(t: String, size := 18, col := Color.WHITE) -> Label:
	var l := Label.new()
	l.text = t
	l.add_theme_font_override("font", HudStyle.font())
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", col)
	return l


func open_kitchen() -> void:
	if _panel == null:
		_panel = PanelContainer.new()
		var sb := StyleBoxFlat.new()
		sb.bg_color = Color(0.06, 0.05, 0.04, 0.95)
		sb.set_corner_radius_all(16)
		sb.border_color = Color(1.0, 0.75, 0.3)
		sb.set_border_width_all(2)
		sb.content_margin_left = 22
		sb.content_margin_right = 22
		sb.content_margin_top = 14
		sb.content_margin_bottom = 14
		_panel.add_theme_stylebox_override("panel", sb)
		_panel.add_to_group(TouchBlock.GROUP)
		_toast.get_parent().add_child(_panel)
		_kbox = VBoxContainer.new()
		_kbox.add_theme_constant_override("separation", 8)
		_panel.add_child(_kbox)
	_panel.visible = true
	_refresh_kitchen()


func is_kitchen_open() -> bool:
	return _panel != null and _panel.visible


func _refresh_kitchen() -> void:
	for c in _kbox.get_children():
		c.queue_free()
	var t := _klabel("ДОМ · КУХНЯ", 28, Color(1.0, 0.8, 0.35))
	t.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_kbox.add_child(t)
	var st := _klabel("Голод %d · Жажда %d · Здоровье %d" % [int(Food.hunger), int(Food.thirst), int(PlayerLife.health)], 18, Color(0.85, 0.9, 1.0))
	st.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_kbox.add_child(st)
	# the fridge
	_kbox.add_child(_klabel("Холодильник:", 20, Color(0.6, 0.85, 1.0)))
	var grid := GridContainer.new()
	grid.columns = 3
	grid.add_theme_constant_override("h_separation", 10)
	grid.add_theme_constant_override("v_separation", 4)
	_kbox.add_child(grid)
	if Food.fridge.is_empty():
		_kbox.add_child(_klabel("пусто — купите продукты в супермаркете АМИД", 17, Color(0.7, 0.7, 0.7)))
	for id in Food.fridge:
		var row := HBoxContainer.new()
		row.add_child(_klabel("%s ×%d" % [Food.name_of(id), int(Food.fridge[id])], 17))
		row.custom_minimum_size = Vector2(280, 0)
		if Food.edible(id):
			var b := _kbtn("СЪЕСТЬ" if not (id in ["water", "juice", "cola", "milk", "chai"]) else "ВЫПИТЬ", Color(0.75, 0.45, 0.1), 110)
			var iid: String = id
			b.pressed.connect(func() -> void:
				_say(Food.consume(iid, Food.fridge))
				_refresh_kitchen())
			row.add_child(b)
		grid.add_child(row)
	# recipes
	_kbox.add_child(_klabel("Приготовить:", 20, Color(1.0, 0.75, 0.4)))
	var rg := GridContainer.new()
	rg.columns = 2
	rg.add_theme_constant_override("h_separation", 12)
	rg.add_theme_constant_override("v_separation", 4)
	_kbox.add_child(rg)
	for rid in Food.RECIPES:
		var r: Dictionary = Food.RECIPES[rid]
		var names: PackedStringArray = []
		for n in r["needs"]:
			names.append(Food.name_of(n))
		var b2 := _kbtn("%s ×%d  (%s)" % [String(r["name"]), int(r["makes"]), ", ".join(names)], Color(0.15, 0.5, 0.25), 430)
		b2.disabled = not Food.can_cook(rid)
		var rid2: String = rid
		b2.pressed.connect(func() -> void:
			if Food.cook(rid2):
				_say("Приготовлено: %s" % String(Food.RECIPES[rid2]["name"]))
			_refresh_kitchen())
		rg.add_child(b2)
	var h := HBoxContainer.new()
	h.add_theme_constant_override("separation", 16)
	h.alignment = BoxContainer.ALIGNMENT_CENTER
	_kbox.add_child(h)
	var rest := _kbtn("ОТДОХНУТЬ И СОХРАНИТЬ", Color(0.2, 0.35, 0.65), 280)
	rest.pressed.connect(func() -> void:
		PlayerLife.health = minf(100.0, PlayerLife.health + 25.0) if Food.ok_to_heal() else PlayerLife.health
		var m: Node = get_parent()
		if m and m.has_method("save_all"):
			m.call("save_all")
		else:
			Wallet.save_state()
		_say("Отдохнули, игра сохранена" + ("" if Food.ok_to_heal() else " (поешьте, чтобы восстановить здоровье)"))
		_refresh_kitchen())
	h.add_child(rest)
	var close := _kbtn("ЗАКРЫТЬ", Color(0.4, 0.12, 0.1), 180)
	close.pressed.connect(func() -> void: _panel.visible = false)
	h.add_child(close)
	await get_tree().process_frame
	_panel.reset_size()
	var vs := get_viewport().get_visible_rect().size
	_panel.position = (vs - _panel.size) * 0.5


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


var _body: StaticBody3D


func _box(size: Vector3, pos: Vector3, m: Material, solid := false) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = size
	mi.mesh = bm
	mi.material_override = m
	mi.position = pos
	add_child(mi)
	if solid:
		var cs := CollisionShape3D.new()
		var sh := BoxShape3D.new()
		sh.size = size
		cs.shape = sh
		cs.position = pos
		_body.add_child(cs)
	return mi


func _build() -> void:
	_body = StaticBody3D.new()
	add_child(_body)
	var y0 := LIFT                         # above the city's paving of the lot
	var stucco := _mat(Color(0.95, 0.93, 0.88), 0.85)
	var stone := _mat(Color(0.45, 0.42, 0.38), 0.9)
	var wood := _mat(Color(0.42, 0.27, 0.16), 0.6)
	var dark := _mat(Color(0.12, 0.12, 0.13), 0.5, 0.3)
	var glass := _mat(Color(0.15, 0.24, 0.3), 0.05, 0.4, Color(0.25, 0.22, 0.15), 0.35)
	var paving := _mat(Color(0.62, 0.6, 0.56), 0.9)
	var lawn := _mat(Color(0.28, 0.5, 0.2), 1.0)
	var water := _mat(Color(0.15, 0.55, 0.75), 0.05, 0.0, Color(0.05, 0.2, 0.3), 0.4)
	var steel := _mat(Color(0.65, 0.66, 0.68), 0.35, 0.8)
	var lamp := _mat(Color(1, 1, 0.95), 0.3, 0.0, Color(1.0, 0.95, 0.8), 2.0)
	var lx0 := LOT.position.x
	var lz0 := LOT.position.y
	var lx1 := LOT.end.x
	var lz1 := LOT.end.y
	var c := LOT.get_center()
	# lawn of the yard, the drive (avenue -> garage), the path to the door
	_box(Vector3(LOT.size.x - 1.0, 0.16, LOT.size.y - 1.0), Vector3(c.x, y0 - 0.06, c.y), lawn, true)
	var g := GARAGE.get_center()
	_box(Vector3(GARAGE.position.x - lx0 + 18.0, 0.16, 7.0), Vector3((lx0 - 18.0 + GARAGE.position.x) * 0.5, y0 + 0.05, g.y), paving)
	_box(Vector3(HOUSE.position.x - lx0, 0.16, 2.4), Vector3((lx0 + HOUSE.position.x) * 0.5, y0 + 0.06, HOUSE.position.y + 6.0), paving)
	# fence: low stone wall + steel bars, gaps for the drive and the path
	for seg in [[Vector2(lx0, lz0), Vector2(lx1, lz0)], [Vector2(lx1, lz0), Vector2(lx1, lz1)], [Vector2(lx1, lz1), Vector2(lx0, lz1)],
			[Vector2(lx0, lz1), Vector2(lx0, HOUSE.position.y + 7.4)], [Vector2(lx0, HOUSE.position.y + 4.6), Vector2(lx0, g.y + 3.6)],
			[Vector2(lx0, g.y - 3.6), Vector2(lx0, lz0)]]:
		var a: Vector2 = seg[0]
		var b: Vector2 = seg[1]
		var mid := (a + b) * 0.5
		var L := a.distance_to(b)
		var along_x := absf(b.x - a.x) > absf(b.y - a.y)
		_box(Vector3(L if along_x else 0.4, 0.8, 0.4 if along_x else L), Vector3(mid.x, y0 + 0.4, mid.y), stone, true)
		_box(Vector3(L if along_x else 0.08, 0.7, 0.08 if along_x else L), Vector3(mid.x, y0 + 1.15, mid.y), steel, true)
	# the house: ground floor (stone base), upper floor (stucco, overhanging), flat roof
	var hc := HOUSE.get_center()
	var hx := HOUSE.size.x
	var hz := HOUSE.size.y
	_box(Vector3(hx, 3.4, hz), Vector3(hc.x, y0 + 1.7, hc.y), stucco, true)
	_box(Vector3(hx + 1.6, 3.4, hz + 0.6), Vector3(hc.x - 0.8, y0 + 5.2, hc.y), stucco, true)
	_box(Vector3(hx + 2.4, 0.3, hz + 1.4), Vector3(hc.x - 0.8, y0 + H + 0.05, hc.y), dark)
	_box(Vector3(0.3, 3.4, hz * 0.45), Vector3(HOUSE.position.x - 0.15, y0 + 1.7, hc.y + hz * 0.27), stone)   # stone cladding
	# big windows on the front (ground: living room; upper: two bedrooms) + the door
	_box(Vector3(0.1, 2.4, 6.0), Vector3(HOUSE.position.x - 0.05, y0 + 1.6, hc.y - 4.5), glass)
	_box(Vector3(0.1, 2.2, 4.0), Vector3(HOUSE.position.x - 1.65, y0 + 5.2, hc.y - 5.0), glass)
	_box(Vector3(0.1, 2.2, 4.0), Vector3(HOUSE.position.x - 1.65, y0 + 5.2, hc.y + 3.5), glass)
	_box(Vector3(0.12, 2.4, 1.4), Vector3(HOUSE.position.x - 0.06, y0 + 1.2, HOUSE.position.y + 6.0), wood)
	_box(Vector3(1.6, 0.12, 2.6), Vector3(HOUSE.position.x - 0.8, y0 + 2.9, HOUSE.position.y + 6.0), dark)   # door canopy
	_box(Vector3(0.12, 0.3, 0.3), Vector3(HOUSE.position.x - 0.2, y0 + 2.6, HOUSE.position.y + 7.0), lamp)
	# balcony on the upper floor with glass railing
	_box(Vector3(2.0, 0.2, 7.0), Vector3(HOUSE.position.x - 2.6, y0 + 3.45, hc.y - 1.0), dark, true)
	_box(Vector3(0.06, 1.0, 7.0), Vector3(HOUSE.position.x - 3.55, y0 + 4.05, hc.y - 1.0), glass)
	# side windows
	for z: float in [HOUSE.position.y + 0.02, HOUSE.end.y - 0.02]:
		_box(Vector3(5.0, 1.6, 0.1), Vector3(hc.x, y0 + 1.8, z), glass)
		_box(Vector3(5.0, 1.6, 0.1), Vector3(hc.x, y0 + 5.2, z), glass)
	# the house number + name plate by the door
	var lb := Label3D.new()
	lb.text = "ДОМ"
	lb.font = HudStyle.font()
	lb.font_size = 64
	lb.pixel_size = 0.008
	lb.modulate = Color(1, 0.85, 0.4)
	lb.outline_size = 8
	lb.position = Vector3(HOUSE.position.x - 0.14, y0 + 3.1, HOUSE.position.y + 6.0)
	lb.rotation.y = -PI * 0.5
	add_child(lb)
	# garage: walls, roof, the raised door (dark slats under the lintel), light inside
	var gx0 := GARAGE.position.x
	var gx1 := GARAGE.end.x
	var gz0 := GARAGE.position.y
	var gz1 := GARAGE.end.y
	_box(Vector3(GARAGE.size.x, 3.2, 0.3), Vector3(g.x, y0 + 1.6, gz0 + 0.15), stucco, true)
	_box(Vector3(GARAGE.size.x, 3.2, 0.3), Vector3(g.x, y0 + 1.6, gz1 - 0.15), stucco, true)
	_box(Vector3(0.3, 3.2, GARAGE.size.y), Vector3(gx1 - 0.15, y0 + 1.6, g.y), stucco, true)
	_box(Vector3(0.3, 0.9, GARAGE.size.y), Vector3(gx0 + 0.15, y0 + 2.75, g.y), stucco, true)            # lintel
	_box(Vector3(GARAGE.size.x + 0.6, 0.3, GARAGE.size.y + 0.6), Vector3(g.x, y0 + 3.35, g.y), dark, true)
	_box(Vector3(GARAGE.size.x - 0.4, 0.12, GARAGE.size.y - 0.4), Vector3(g.x, y0 + 0.07, g.y), _mat(Color(0.5, 0.5, 0.5), 0.6))
	for k in 4:
		_box(Vector3(0.08, 0.16, GARAGE.size.y - 0.8), Vector3(gx0 + 0.4, y0 + 2.4 + k * 0.17, g.y), steel)
	_box(Vector3(2.4, 0.06, 0.3), Vector3(g.x, y0 + 3.15, g.y), lamp)
	_box(Vector3(0.4, 1.0, 1.6), Vector3(gx1 - 0.5, y0 + 0.5, gz0 + 1.2), _mat(Color(0.7, 0.1, 0.08), 0.5))   # tool chest
	# pool + loungers behind the house
	_box(Vector3(5.0, 0.3, 11.0), Vector3(HOUSE.end.x + 6.0, y0 + 0.1, hc.y + 2.0), paving)
	_box(Vector3(4.0, 0.06, 10.0), Vector3(HOUSE.end.x + 6.0, y0 + 0.26, hc.y + 2.0), water)
	for k in 2:
		_box(Vector3(0.7, 0.35, 1.9), Vector3(HOUSE.end.x + 10.0, y0 + 0.2, hc.y - 1.0 + k * 2.4), wood)
	# garden lamps along the path
	for k in 4:
		var px := lx0 + 2.5 + k * (HOUSE.position.x - lx0 - 3.0) / 3.0
		_box(Vector3(0.12, 1.0, 0.12), Vector3(px, y0 + 0.5, HOUSE.position.y + 7.6), dark)
		_box(Vector3(0.25, 0.2, 0.25), Vector3(px, y0 + 1.05, HOUSE.position.y + 7.6), lamp)
