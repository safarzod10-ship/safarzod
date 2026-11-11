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


var _glass: StandardMaterial3D
var _lamps: StandardMaterial3D
var _night_t := 0.0


func _process(delta: float) -> void:
	_toast_t -= delta
	_toast.visible = _toast_t > 0.0
	# evening: warm light in the windows, the garden lamps glow brighter
	_night_t -= delta
	if _night_t <= 0.0 and _glass:
		_night_t = 1.0
		var h := 12.0
		for t in get_tree().get_nodes_in_group(&"time_of_day"):
			h = float(t.get("hour"))
			break
		var night := clampf(minf(h - 18.5, 30.0 - h) if h > 12.0 else 6.5 - h, 0.0, 1.0)
		_glass.emission = Color(0.25, 0.22, 0.15).lerp(Color(1.0, 0.62, 0.3), night)
		_glass.emission_energy_multiplier = lerpf(0.35, 1.1, night)
		_lamps.emission_energy_multiplier = lerpf(2.0, 5.0, night)


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
	var lawn := _mat(Color(0.7, 0.85, 0.55), 1.0)
	if ResourceLoader.exists("res://assets/textures/ground_grass/albedo.jpg"):
		lawn.albedo_texture = load("res://assets/textures/ground_grass/albedo.jpg")
		lawn.uv1_triplanar = true
		lawn.uv1_world_triplanar = true
		lawn.uv1_scale = Vector3(0.25, 0.25, 0.25)
	var water := _mat(Color(0.15, 0.55, 0.75), 0.05, 0.0, Color(0.05, 0.2, 0.3), 0.4)
	var steel := _mat(Color(0.65, 0.66, 0.68), 0.35, 0.8)
	var lamp := _mat(Color(1, 1, 0.95), 0.3, 0.0, Color(1.0, 0.95, 0.8), 2.0)
	_glass = glass
	_lamps = lamp
	var lx0 := LOT.position.x
	var lz0 := LOT.position.y
	var lx1 := LOT.end.x
	var lz1 := LOT.end.y
	var c := LOT.get_center()
	# lawn of the yard, the drive (avenue -> garage), the path to the door
	_box(Vector3(LOT.size.x - 1.0, 0.16, LOT.size.y - 1.0), Vector3(c.x, y0 - 0.06, c.y), lawn, true)
	var g := GARAGE.get_center()
	_box(Vector3(GARAGE.position.x - lx0 + 18.0, 0.16, 7.0), Vector3((lx0 - 18.0 + GARAGE.position.x) * 0.5, y0 + 0.05, g.y), paving)
	_box(Vector3(HOUSE.position.x - lx0 + 18.0, 0.16, 2.4), Vector3((lx0 - 18.0 + HOUSE.position.x) * 0.5, y0 + 0.06, HOUSE.position.y + 6.0), paving)
	# fence: low stone wall + wrought-iron bars between brick pillars, gaps for the drive and the path
	var bars: Array[Transform3D] = []
	var brick := _mat(Color(0.62, 0.36, 0.26), 0.85)
	var cap := _mat(Color(0.8, 0.78, 0.74), 0.7)
	var iron := _mat(Color(0.1, 0.1, 0.11), 0.45, 0.6)
	for seg in [[Vector2(lx0, lz0), Vector2(lx1, lz0)], [Vector2(lx1, lz0), Vector2(lx1, lz1)], [Vector2(lx1, lz1), Vector2(lx0, lz1)],
			[Vector2(lx0, lz1), Vector2(lx0, HOUSE.position.y + 7.4)], [Vector2(lx0, HOUSE.position.y + 4.6), Vector2(lx0, g.y + 3.6)],
			[Vector2(lx0, g.y - 3.6), Vector2(lx0, lz0)]]:
		var a: Vector2 = seg[0]
		var b: Vector2 = seg[1]
		var mid := (a + b) * 0.5
		var L := a.distance_to(b)
		var along_x := absf(b.x - a.x) > absf(b.y - a.y)
		_box(Vector3(L if along_x else 0.4, 0.6, 0.4 if along_x else L), Vector3(mid.x, y0 + 0.3, mid.y), stone, true)
		_box(Vector3(L if along_x else 0.46, 0.06, 0.46 if along_x else L), Vector3(mid.x, y0 + 0.63, mid.y), cap, false)
		# wrought-iron bars on top (one multimesh), rails, brick pillars with caps every ~3 m
		for hh: float in [0.78, 1.62]:
			_box(Vector3(L if along_x else 0.05, 0.05, 0.05 if along_x else L), Vector3(mid.x, y0 + hh, mid.y), iron)
		var nb := int(L / 0.16)
		for k in nb:
			var t := (k + 0.5) / nb
			var bp := a.lerp(b, t)
			bars.append(Transform3D(Basis.IDENTITY, Vector3(bp.x, y0 + 1.15, bp.y)))
		var np := maxi(1, int(round(L / 3.2)))
		for k in np + 1:
			var pp := a.lerp(b, float(k) / np)
			_box(Vector3(0.5, 1.75, 0.5), Vector3(pp.x, y0 + 0.875, pp.y), brick, false)
			_box(Vector3(0.62, 0.1, 0.62), Vector3(pp.x, y0 + 1.8, pp.y), cap, false)
		var wall := CollisionShape3D.new()
		var wsh := BoxShape3D.new()
		wsh.size = Vector3(L if along_x else 0.4, 1.8, 0.4 if along_x else L)
		wall.shape = wsh
		wall.position = Vector3(mid.x, y0 + 0.9, mid.y)
		_body.add_child(wall)
	var bar_mm := MultiMesh.new()
	bar_mm.transform_format = MultiMesh.TRANSFORM_3D
	var bar_mesh := BoxMesh.new()
	bar_mesh.size = Vector3(0.025, 0.95, 0.025)
	bar_mm.mesh = bar_mesh
	bar_mm.instance_count = bars.size()
	for k in bars.size():
		bar_mm.set_instance_transform(k, bars[k])
	var bar_mi := MultiMeshInstance3D.new()
	bar_mi.multimesh = bar_mm
	bar_mi.material_override = iron
	bar_mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(bar_mi)
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
	# window frames (mullions + transoms) so the glass reads as windows, not panels
	for wdef: Array in [[HOUSE.position.x - 0.12, y0 + 1.6, hc.y - 4.5, 6.0, 2.4], [HOUSE.position.x - 1.72, y0 + 5.2, hc.y - 5.0, 4.0, 2.2],
			[HOUSE.position.x - 1.72, y0 + 5.2, hc.y + 3.5, 4.0, 2.2]]:
		var fx: float = wdef[0]
		var fy: float = wdef[1]
		var fz: float = wdef[2]
		var fw: float = wdef[3]
		var fh: float = wdef[4]
		var nm := int(round(fw / 1.3))
		for k in nm + 1:
			_box(Vector3(0.06, fh + 0.1, 0.08), Vector3(fx, fy, fz - fw * 0.5 + k * fw / nm), dark)
		for yy: float in [-fh * 0.5, fh * 0.5, fh * 0.2]:
			_box(Vector3(0.06, 0.08, fw + 0.1), Vector3(fx, fy + yy, fz), dark)
	# balcony on the upper floor with glass railing
	_box(Vector3(2.0, 0.2, 7.0), Vector3(HOUSE.position.x - 2.6, y0 + 3.45, hc.y - 1.0), dark, true)
	var rail_glass := _mat(Color(0.55, 0.7, 0.75), 0.05, 0.3)
	rail_glass.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	rail_glass.albedo_color.a = 0.35
	_box(Vector3(0.06, 1.0, 7.0), Vector3(HOUSE.position.x - 3.55, y0 + 4.05, hc.y - 1.0), rail_glass)
	_box(Vector3(0.08, 0.06, 7.0), Vector3(HOUSE.position.x - 3.55, y0 + 4.58, hc.y - 1.0), dark)
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
	_garden.call_deferred(y0, wood, stone)


## the garden (0.26): an orchard of mulberries and apricot saplings in the back, roses and thujas along
## the fence, flower beds by the path, a grape pergola and a tapchan (сури) with a carpet and cushions
func _garden(y0: float, wood: Material, stone: Material) -> void:
	for w in 600:
		if OpenWorld.instance and not OpenWorld.instance._veg.is_empty():
			break
		await get_tree().process_frame
	if OpenWorld.instance == null:
		return
	var g := global_transform
	var trees := {"mulberry": [], "sapling": [], "rose_bush": [], "thuja_cone": [], "flowers_petunia": [], "flowers_salvia": [], "flowers_marigold": [], "shrub_lilac": [], "hedge_privet": []}
	var lx0 := LOT.position.x
	var lz0 := LOT.position.y
	var lx1 := LOT.end.x
	var lz1 := LOT.end.y
	var rng := RandomNumberGenerator.new()
	rng.seed = 2026
	# orchard in the back (north part beyond the house) and the south lawn
	for zz in range(int(HOUSE.end.y + 10.0), int(lz1 - 5.0), 9):
		for xx in range(int(lx0 + 6.0), int(lx1 - 4.0), 8):
			var id := "mulberry" if (xx / 8 + zz / 9) % 3 != 0 else "sapling"
			trees[id].append(g * Transform3D(Basis(Vector3.UP, rng.randf() * TAU).scaled(Vector3.ONE * rng.randf_range(0.75, 1.0)), Vector3(xx + rng.randf_range(-1, 1), y0, zz + rng.randf_range(-1, 1))))
	# thujas along the side fences, roses along the front fence
	for zz2 in range(int(lz0 + 3.0), int(lz1 - 2.0), 5):
		for xx2 in [lx1 - 1.2]:
			trees["thuja_cone"].append(g * Transform3D(Basis.IDENTITY.scaled(Vector3.ONE * 0.85), Vector3(xx2, y0, zz2)))
	for xx3 in range(int(lx0 + 2.0), int(lx1 - 2.0), 3):
		trees["rose_bush"].append(g * Transform3D(Basis(Vector3.UP, float(xx3)), Vector3(xx3, y0, lz1 - 1.2)))
		trees["rose_bush"].append(g * Transform3D(Basis(Vector3.UP, float(xx3) * 1.7), Vector3(xx3, y0, lz0 + 1.2)))
	# flower beds both sides of the path to the door
	for side in [-1.5, 1.5]:
		for k in 14:
			var fx := lx0 + 1.5 + k * (HOUSE.position.x - lx0 - 3.0) / 13.0
			var kind: String = ["flowers_petunia", "flowers_salvia", "flowers_marigold"][(k / 3) % 3]
			trees[kind].append(g * Transform3D(Basis.IDENTITY.scaled(Vector3.ONE * 1.3), Vector3(fx, y0 + 0.02, HOUSE.position.y + 6.0 + side)))
	# lilacs at the house corners
	for cpt in [Vector3(HOUSE.position.x - 1.5, y0, HOUSE.position.y - 1.5), Vector3(HOUSE.position.x - 1.5, y0, HOUSE.end.y + 1.5)]:
		trees["shrub_lilac"].append(g * Transform3D(Basis.IDENTITY.scaled(Vector3.ONE * 0.8), cpt))
	# the south part of the yard (beyond the garage): a vineyard on trellises, vegetable beds, a tandoor, a swing
	var soil := _mat(Color(0.3, 0.2, 0.12), 0.95)
	var steel := _mat(Color(0.35, 0.36, 0.38), 0.4, 0.7)
	var vx0 := lx0 + 4.0
	var vx1 := HOUSE.end.x + 2.0
	for row in 5:
		var vz := lz0 + 5.0 + row * 3.4
		_box(Vector3(vx1 - vx0, 0.04, 0.9), Vector3((vx0 + vx1) * 0.5, y0 + 0.03, vz), soil)
		var xx4 := vx0
		while xx4 <= vx1 + 0.01:
			_box(Vector3(0.1, 1.9, 0.1), Vector3(xx4, y0 + 0.95, vz), wood)
			xx4 += 4.0
		for hh: float in [0.9, 1.4, 1.85]:
			_box(Vector3(vx1 - vx0, 0.02, 0.02), Vector3((vx0 + vx1) * 0.5, y0 + hh, vz), steel)
		var xx5 := vx0 + 1.0
		while xx5 < vx1:
			trees["hedge_privet"].append(g * Transform3D(Basis(Vector3.UP, rng.randf() * TAU).scaled(Vector3(0.7, rng.randf_range(1.1, 1.4), 0.55)), Vector3(xx5, y0, vz)))
			xx5 += 1.6
	# vegetable beds (raised, with a wooden edge) between the vineyard and the drive
	for bed in 4:
		var bz := lz0 + 23.0 + bed * 2.2
		_box(Vector3(12.0, 0.25, 1.3), Vector3(HOUSE.end.x - 4.0, y0 + 0.12, bz), wood)
		_box(Vector3(11.8, 0.06, 1.15), Vector3(HOUSE.end.x - 4.0, y0 + 0.26, bz), soil)
		for k3 in 9:
			var kind2: String = ["flowers_marigold", "flowers_salvia", "flowers_petunia", "flowers_marigold"][bed]
			trees[kind2].append(g * Transform3D(Basis.IDENTITY.scaled(Vector3.ONE * 0.9), Vector3(HOUSE.end.x - 9.0 + k3 * 1.25, y0 + 0.3, bz)))
	# tandoor (clay oven) beside the tapchan
	var clay := _mat(Color(0.72, 0.5, 0.33), 0.95)
	var tp := Vector3(HOUSE.end.x + 10.0, y0, HOUSE.end.y + 3.0)
	_box(Vector3(1.8, 0.4, 1.8), tp + Vector3(0, 0.2, 0), _mat(Color(0.6, 0.58, 0.55), 0.9), true)
	var tm := MeshInstance3D.new()
	var tcm := CylinderMesh.new()
	tcm.top_radius = 0.42
	tcm.bottom_radius = 0.7
	tcm.height = 1.1
	tm.mesh = tcm
	tm.material_override = clay
	tm.position = tp + Vector3(0, 0.95, 0)
	add_child(tm)
	_box(Vector3(0.5, 0.03, 0.5), tp + Vector3(0, 1.5, 0), _mat(Color(0.05, 0.04, 0.03), 1.0))
	# a swing for the kids (A-frame)
	var sp := Vector3(lx0 + 8.0, y0, lz0 + 30.0)
	for sz in [-1.4, 1.4]:
		for sx2 in [-0.8, 0.8]:
			var leg := _box(Vector3(0.08, 2.6, 0.08), sp + Vector3(sx2 * 0.5, 1.25, sz), steel)
			leg.rotation.z = sx2 * 0.3
	_box(Vector3(0.1, 0.1, 3.0), sp + Vector3(0, 2.45, 0), steel)
	for sz2 in [-0.5, 0.5]:
		for rz in [-0.22, 0.22]:
			_box(Vector3(0.02, 1.8, 0.02), sp + Vector3(0, 1.55, sz2 + rz), steel)
		_box(Vector3(0.35, 0.05, 0.55), sp + Vector3(0, 0.65, sz2), _mat([Color(0.85, 0.2, 0.15), Color(0.15, 0.45, 0.85)][int(sz2 > 0.0)], 0.6))
	var holder := Node3D.new()
	holder.name = "Garden"
	holder.top_level = true
	add_child(holder)
	holder.global_transform = Transform3D.IDENTITY
	OpenWorld.instance._trees(holder, trees, 0)
	# grape pergola over a tapchan (сури): a raised wooden platform, a red carpet, cushions, a low table
	var pc := Vector3(HOUSE.end.x + 6.0, y0, HOUSE.end.y + 6.0)
	var green := _mat(Color(0.2, 0.42, 0.15), 0.9)
	for cx in [-2.2, 2.2]:
		for cz in [-2.2, 2.2]:
			_box(Vector3(0.18, 2.6, 0.18), pc + Vector3(cx, 1.3, cz), wood, true)
	for k in 7:
		_box(Vector3(4.8, 0.08, 0.12), pc + Vector3(0, 2.62, -2.1 + k * 0.7), wood)
	_box(Vector3(5.0, 0.25, 5.0), pc + Vector3(0, 2.8, 0), green)                       # vine canopy
	_box(Vector3(3.2, 0.5, 2.6), pc + Vector3(0, 0.25, 0), wood, true)                   # the tapchan
	_box(Vector3(3.0, 0.04, 2.4), pc + Vector3(0, 0.52, 0), _mat(Color(0.6, 0.08, 0.1), 0.9))   # carpet
	_box(Vector3(1.0, 0.3, 0.7), pc + Vector3(0, 0.69, 0), wood)                          # low table (дастархан)
	for k2 in 4:
		var cc: Vector3 = [Vector3(-1.2, 0.62, -0.9), Vector3(1.2, 0.62, -0.9), Vector3(-1.2, 0.62, 0.9), Vector3(1.2, 0.62, 0.9)][k2]
		_box(Vector3(0.6, 0.18, 0.4), pc + cc, _mat([Color(0.9, 0.7, 0.1), Color(0.1, 0.4, 0.6), Color(0.7, 0.15, 0.3), Color(0.2, 0.5, 0.25)][k2], 0.9))
	_box(Vector3(0.3, 0.25, 0.3), pc + Vector3(0, 0.96, 0), _mat(Color(0.85, 0.85, 0.9), 0.3, 0.6))   # teapot
