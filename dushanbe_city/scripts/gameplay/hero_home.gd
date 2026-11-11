class_name HeroHome
extends Node3D
## The hero's home in Dushanbe, on the west side of Rudaki avenue (world landmark "hero_home"; the
## layout below is in local lot coordinates, front = local -X towards the avenue), after the owner's
## pictures: a single-storey cream villa with a black hip roof and big lit windows, a round paved
## forecourt with a fountain and a flower ring, cream pillars with lanterns and black iron panels with
## gold ornaments, ornate gates, a gazebo with sofas round a fire pit, a swing pergola, a pond with a
## waterfall and a little bridge, cypresses, blossoming trees, flower beds and a dense lawn; the garage
## with the Prado inside (drive out through the gate). The game starts at the front door; at the door
## «ДОМ · ОТДЫХ» saves the game and restores the health. On the map as «Дом».

const LOT := Rect2(-16.5, -296.0, 52.5, 130.0)
const HOUSE := Rect2(10.0, -240.0, 18.0, 32.0)      ## x, z, size x, size z (front faces -X)
const GARAGE := Rect2(12.0, -262.0, 11.0, 9.0)      ## the Prado inside, door on the -X side
const H := 4.4                                      ## a single-storey villa
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
		for ol in _night_lights:
			ol.light_energy = 1.6 * night
			ol.visible = night > 0.01


## where the hero appears: on the path in front of the door, facing the drive / avenue
func spawn_point() -> Vector3:
	return to_global(Vector3(HOUSE.position.x - 6.2, FLOOR + 0.1, HOUSE.get_center().y))


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
	return to_global(Vector3(HOUSE.position.x - 3.0, 0.6, HOUSE.get_center().y))


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
	var y0 := LIFT
	var cream := _mat(Color(0.93, 0.88, 0.78), 0.45)
	var cream2 := _mat(Color(0.84, 0.78, 0.67), 0.55)
	var stucco := _mat(Color(0.95, 0.91, 0.83), 0.8)
	var dark := _mat(Color(0.12, 0.12, 0.13), 0.5, 0.3)
	var roof := _mat(Color(0.14, 0.15, 0.17), 0.65, 0.1)
	var iron := _mat(Color(0.05, 0.05, 0.06), 0.4, 0.6)
	var gold := _mat(Color(0.92, 0.72, 0.28), 0.25, 1.0, Color(0.35, 0.25, 0.05), 0.4)
	var wood := _mat(Color(0.42, 0.27, 0.16), 0.6)
	var glass := _mat(Color(0.15, 0.2, 0.24), 0.05, 0.4, Color(0.25, 0.22, 0.15), 0.35)
	var paving := PlotPatches.paving_material()
	var lamp := _mat(Color(1, 0.95, 0.85), 0.3, 0.0, Color(1.0, 0.82, 0.5), 2.0)
	var water := _mat(Color(0.2, 0.55, 0.8), 0.03, 0.2, Color(0.05, 0.25, 0.45), 0.6)
	var stone := _mat(Color(0.5, 0.47, 0.42), 0.9)
	_glass = glass
	_lamps = lamp
	_paved.clear()
	var lx0 := LOT.position.x
	var lz0 := LOT.position.y
	var lx1 := LOT.end.x
	var lz1 := LOT.end.y
	var c := LOT.get_center()
	var hc := HOUSE.get_center()
	var g := GARAGE.get_center()
	# lawn of the whole yard (the 3D grass blades are added on it, off the paving)
	var lawn := _mat(Color(0.18, 0.49, 0.2), 1.0)
	if ResourceLoader.exists("res://assets/textures/ground_grass/albedo.jpg"):
		lawn.albedo_texture = load("res://assets/textures/ground_grass/albedo.jpg")
		lawn.albedo_color = Color(0.32, 0.62, 0.3)
		lawn.uv1_triplanar = true
		lawn.uv1_world_triplanar = true
		lawn.uv1_scale = Vector3(0.25, 0.25, 0.25)
	_box(Vector3(LOT.size.x - 0.6, 0.16, LOT.size.y - 0.6), Vector3(c.x, y0 - 0.06, c.y), lawn, true)
	# the paved strip in front of the fence, out to the street's sidewalk (no grass gap)
	var front := _front_depth()
	_pave(Rect2(lx0 - front, lz0, front, LOT.size.y), paving, y0 - 0.02)
	# no wild grass blades through the paving / the yard (the yard gets its own lawn blades)
	var wdg := WorldData.get_instance()
	if wdg and wdg.ok:
		var xl := (lx0 - front + lx1) * 0.5
		wdg.add_no_grass(to_global(Vector3(xl, 0, c.y)), global_basis.x, (lx1 - lx0 + front) * 0.5 + 0.5, LOT.size.y * 0.5 + 0.5)
	# paving: the forecourt with the fountain circle, the drive to the garage, the paths
	_pave(Rect2(lx0, hc.y - 6.0, HOUSE.position.x - lx0, 12.0), paving, y0 + 0.02)            # gate -> door
	_pave(Rect2(-12.0, hc.y - 16.0, HOUSE.position.x + 12.0, 32.0), paving, y0 + 0.02)         # forecourt
	_pave(Rect2(lx0, g.y - 3.8, GARAGE.position.x - lx0, 7.6), paving, y0 + 0.02)            # the drive
	_pave(Rect2(-12.0, g.y - 3.8, 24.0, hc.y - 16.0 - g.y + 3.8), paving, y0 + 0.02)         # drive <-> forecourt
	_pave(Rect2(HOUSE.position.x - 1.0, hc.y + 16.0, 3.0, 30.0), paving, y0 + 0.02)          # north walk to the gazebo
	_pave(Rect2(HOUSE.position.x - 1.0, -194.0, 18.0, 3.0), paving, y0 + 0.02)
	_pave(Rect2(-8.0, -284.0, 3.0, g.y - 3.8 + 284.0), paving, y0 + 0.02)                     # south walk to the swing
	_pave(Rect2(-8.0, -284.0, 24.0, 3.0), paving, y0 + 0.02)                                  # to the bridge
	# fence: cream pillars with lanterns, black iron panels with gold ornaments on a cream base (front);
	# cream walls with pillars and wall lights on the sides and the back
	var gates := [[hc.y, 5.6], [g.y, 7.6]]                                                     # centre z, width
	var runs := [[Vector2(lx0, lz0), Vector2(lx0, lz1), true], [Vector2(lx0, lz1), Vector2(lx1, lz1), false],
			[Vector2(lx1, lz1), Vector2(lx1, lz0), false], [Vector2(lx1, lz0), Vector2(lx0, lz0), false]]
	var bars: Array[Transform3D] = []
	for r in runs:
		var a: Vector2 = r[0]
		var b: Vector2 = r[1]
		var iron_run: bool = r[2]
		var L := a.distance_to(b)
		var d := (b - a) / L
		var yaw := atan2(d.x, d.y)
		var cuts: Array = []                         # [from, to] along the run (gate openings)
		if iron_run:
			for gt in gates:
				var t: float = absf(float(gt[0]) - a.y)
				cuts.append([t - float(gt[1]) * 0.5, t + float(gt[1]) * 0.5])
		var posts: Array[float] = [0.0, L]
		for cu in cuts:
			posts.append(float(cu[0]) - 0.45)
			posts.append(float(cu[1]) + 0.45)
		var t2 := 5.0
		while t2 < L - 2.0:
			var free := true
			for cu2 in cuts:
				if t2 > float(cu2[0]) - 2.5 and t2 < float(cu2[1]) + 2.5:
					free = false
			if free:
				posts.append(t2)
			t2 += 5.0
		posts.sort()
		for t3 in posts:
			var p := a + d * t3
			var big := false
			for cu3 in cuts:
				if absf(t3 - (float(cu3[0]) - 0.45)) < 0.01 or absf(t3 - (float(cu3[1]) + 0.45)) < 0.01:
					big = true
			var w := 1.2 if big else 0.9
			var hgt := 3.2 if big else 2.6
			_box(Vector3(w, hgt, w), Vector3(p.x, y0 + hgt * 0.5, p.y), cream, true)
			_box(Vector3(w + 0.2, 0.2, w + 0.2), Vector3(p.x, y0 + hgt + 0.1, p.y), cream2)
			_box(Vector3(w + 0.16, 0.3, w + 0.16), Vector3(p.x, y0 + 0.15, p.y), cream2)
			_lantern(Vector3(p.x, y0 + hgt + 0.2, p.y), lamp, iron, 1.2 if big else 1.0)
			# wall sconce on the street face
			var out := Vector2(-1, 0) if iron_run else Vector2(d.y, -d.x)
			_box(Vector3(0.3, 0.5, 0.3), Vector3(p.x + out.x * (w * 0.5 + 0.1), y0 + hgt * 0.62, p.y + out.y * (w * 0.5 + 0.1)), lamp)
		for k in posts.size() - 1:
			var s0: float = posts[k] + 0.5
			var s1: float = posts[k + 1] - 0.5
			if s1 - s0 < 0.5:
				continue
			var gap := false
			for cu4 in cuts:
				if s0 >= float(cu4[0]) - 0.6 and s1 <= float(cu4[1]) + 0.6:
					gap = true
			if gap:
				continue
			var m := a + d * (s0 + s1) * 0.5
			var seg := s1 - s0
			if iron_run:
				_box(Vector3(0.5, 0.6, seg) if absf(d.y) > 0.5 else Vector3(seg, 0.6, 0.5), Vector3(m.x, y0 + 0.3, m.y), cream, true)
				for yy: float in [0.75, 2.15]:
					_box(Vector3(0.05, 0.06, seg) if absf(d.y) > 0.5 else Vector3(seg, 0.06, 0.05), Vector3(m.x, y0 + yy, m.y), iron)
				var nb := int(seg / 0.13)
				for i in nb:
					var q := a + d * (s0 + (i + 0.5) * seg / nb)
					bars.append(Transform3D(Basis.IDENTITY, Vector3(q.x, y0 + 1.42, q.y)))
				# the gold ornament in the middle of the panel: a diamond + scrolls
				var orn := Transform3D(Basis(Vector3.UP, yaw + PI * 0.5) * Basis(Vector3.FORWARD, PI * 0.25), Vector3(m.x, y0 + 1.45, m.y))
				var om := MeshInstance3D.new()
				var ob := BoxMesh.new()
				ob.size = Vector3(0.7, 0.7, 0.05)
				om.mesh = ob
				om.material_override = gold
				om.transform = orn
				add_child(om)
				_box(Vector3(0.06, 0.4, 0.4) if absf(d.y) > 0.5 else Vector3(0.4, 0.4, 0.06), Vector3(m.x, y0 + 1.45, m.y), iron)
				var cs := CollisionShape3D.new()
				var sh := BoxShape3D.new()
				sh.size = Vector3(0.3, 2.4, seg) if absf(d.y) > 0.5 else Vector3(seg, 2.4, 0.3)
				cs.shape = sh
				cs.position = Vector3(m.x, y0 + 1.2, m.y)
				_body.add_child(cs)
			else:
				_box(Vector3(0.35, 2.3, seg) if absf(d.y) > 0.5 else Vector3(seg, 2.3, 0.35), Vector3(m.x, y0 + 1.15, m.y), stucco, true)
				_box(Vector3(0.45, 0.12, seg) if absf(d.y) > 0.5 else Vector3(seg, 0.12, 0.45), Vector3(m.x, y0 + 2.36, m.y), cream2)
	_multibox(bars, Vector3(0.026, 1.4, 0.026), iron)
	# the gates: double leaves of black iron with gold scrolls, opened into the yard
	for gt2 in gates:
		var zc: float = gt2[0]
		var gw: float = gt2[1]
		for sgn: float in [-1.0, 1.0]:
			var hinge := Vector3(lx0 + 0.1, y0, zc + sgn * gw * 0.5)
			var dirv := Vector3(sin(1.2), 0, -sgn * cos(1.2))                  # swung ~70 deg into the yard
			var lw := gw * 0.5 - 0.05
			var mid := hinge + dirv * lw * 0.5
			var yaw := atan2(dirv.x, dirv.z)
			var lbars: Array[Transform3D] = []
			for yy3: float in [0.25, 1.3, 2.55]:
				var rl := MeshInstance3D.new()
				var rbm := BoxMesh.new()
				rbm.size = Vector3(0.07, 0.08, lw)
				rl.mesh = rbm
				rl.material_override = iron
				rl.position = mid + Vector3(0, yy3, 0)
				rl.rotation.y = yaw
				add_child(rl)
			var nb2 := int(lw / 0.12)
			for i2 in nb2 + 1:
				var q2 := hinge + dirv * (lw * i2 / nb2)
				lbars.append(Transform3D(Basis.IDENTITY, q2 + Vector3(0, 1.4, 0)))
			_multibox(lbars, Vector3(0.03, 2.4, 0.03), iron)
			for k2 in 3:
				var o := MeshInstance3D.new()
				var ob2 := TorusMesh.new()
				ob2.inner_radius = 0.18
				ob2.outer_radius = 0.26
				o.mesh = ob2
				o.material_override = gold
				o.position = hinge + dirv * lw * (0.25 + k2 * 0.25) + Vector3(0, 1.85 if k2 != 1 else 0.8, 0)
				o.rotation = Vector3(PI * 0.5, yaw + PI * 0.5, 0)
				add_child(o)
			var top := MeshInstance3D.new()
			var tb := BoxMesh.new()
			tb.size = Vector3(0.08, 0.12, lw)
			top.mesh = tb
			top.material_override = gold
			top.position = mid + Vector3(0, 2.66, 0)
			top.rotation.y = yaw
			add_child(top)
	# flower beds outside the front fence (between the gates)
	var beds := [[lz0 + 1.0, g.y - 4.6], [g.y + 4.6, hc.y - 3.6], [hc.y + 3.6, lz1 - 1.0]]
	for bd in beds:
		var z0: float = bd[0]
		var z1: float = bd[1]
		if z1 - z0 < 2.0:
			continue
		_box(Vector3(1.4, 0.3, z1 - z0), Vector3(lx0 - 1.2, y0 + 0.1, (z0 + z1) * 0.5), cream2)
		_box(Vector3(1.2, 0.06, z1 - z0 - 0.2), Vector3(lx0 - 1.2, y0 + 0.27, (z0 + z1) * 0.5), _mat(Color(0.16, 0.12, 0.08), 0.95))
		_flower_rows.append([Vector3(lx0 - 1.2, y0 + 0.3, z0 + 0.3), Vector3(lx0 - 1.2, y0 + 0.3, z1 - 0.3), 2])
	# ----- the villa: single storey, cream walls, big lit windows, a black hip roof
	var hx := HOUSE.size.x
	var hz := HOUSE.size.y
	var fx := HOUSE.position.x
	_box(Vector3(hx, 0.6, hz), Vector3(hc.x, y0 + 0.3, hc.y), cream2, true)                    # plinth
	_box(Vector3(hx, H - 0.6, hz), Vector3(hc.x, y0 + 0.6 + (H - 0.6) * 0.5, hc.y), stucco, true)
	# projecting entrance bay with its own gable-like roof
	_box(Vector3(2.0, H + 0.6, 9.0), Vector3(fx - 1.0, y0 + (H + 0.6) * 0.5, hc.y), cream, true)
	for side: float in [-1.0, 1.0]:
		_box(Vector3(2.2, H + 0.6, 0.6), Vector3(fx - 1.05, y0 + (H + 0.6) * 0.5, hc.y + side * 4.2), cream2)
	# front windows: two big glazed bays either side of the entrance + the glass entrance doors
	for side2: float in [-1.0, 1.0]:
		var wz := hc.y + side2 * 9.5
		_box(Vector3(0.1, 2.9, 8.0), Vector3(fx - 0.05, y0 + 2.15, wz), glass)
		for k3 in 5:
			_box(Vector3(0.12, 3.0, 0.1), Vector3(fx - 0.1, y0 + 2.15, wz - 4.0 + k3 * 2.0), dark)
		for yy2: float in [0.68, 3.62, 2.75]:
			_box(Vector3(0.12, 0.1, 8.1), Vector3(fx - 0.1, y0 + yy2, wz), dark)
		_box(Vector3(0.5, 0.15, 8.4), Vector3(fx - 0.25, y0 + 3.75, wz), cream2)          # lintel
		for k4 in 2:
			_box(Vector3(0.3, 0.6, 0.3), Vector3(fx - 0.2, y0 + 3.0, wz + (k4 * 2 - 1) * 4.5), lamp)   # wall lights
	_box(Vector3(0.1, 3.3, 3.6), Vector3(fx - 2.05, y0 + 2.25, hc.y), glass)                   # entrance glass
	for k5 in 4:
		_box(Vector3(0.12, 3.4, 0.1), Vector3(fx - 2.1, y0 + 2.25, hc.y - 1.8 + k5 * 1.2), dark)
	_box(Vector3(0.12, 0.12, 3.7), Vector3(fx - 2.1, y0 + 3.95, hc.y), dark)
	_box(Vector3(0.12, 0.1, 3.7), Vector3(fx - 2.1, y0 + 0.62, hc.y), dark)
	for k6 in 2:
		_box(Vector3(0.3, 0.6, 0.3), Vector3(fx - 2.25, y0 + 3.0, hc.y + (k6 * 2 - 1) * 2.6), lamp)
	# side + back windows
	for zz: float in [HOUSE.position.y - 0.05, HOUSE.end.y + 0.05]:
		for k7 in 3:
			_box(Vector3(2.4, 2.2, 0.1), Vector3(fx + 3.0 + k7 * 6.0, y0 + 2.2, zz), glass)
	# hip roof (black tiles) + the bay's small hip roof
	_hip_roof(Vector3(hc.x, y0 + H, hc.y), hx + 1.6, hz + 1.6, 2.6, roof)
	_hip_roof(Vector3(fx - 1.0, y0 + H + 0.6, hc.y), 3.4, 10.0, 1.4, roof)
	_box(Vector3(hx + 1.8, 0.3, hz + 1.8), Vector3(hc.x, y0 + H + 0.05, hc.y), cream2)          # eaves band
	# terrace + steps to the door (the door is the kitchen / rest interaction)
	_box(Vector3(4.0, 0.45, 12.0), Vector3(fx - 2.0, y0 + 0.22, hc.y), cream2, true)
	for k8 in 3:
		_box(Vector3(0.45, 0.15 * (3 - k8), 8.0), Vector3(fx - 4.2 - k8 * 0.45, y0 + 0.075 * (3 - k8), hc.y), cream, true)
	for pz: float in [hc.y - 5.5, hc.y + 5.5]:
		_box(Vector3(0.9, 0.9, 0.9), Vector3(fx - 3.5, y0 + 0.9, pz), cream)                  # planters with thujas
		_plants.append(["thuja_cone", Vector3(fx - 3.5, y0 + 1.35, pz), 0.6])
	var lb2 := Label3D.new()
	lb2.text = "ДОМ"
	lb2.font = HudStyle.font()
	lb2.font_size = 64
	lb2.pixel_size = 0.008
	lb2.modulate = Color(1, 0.85, 0.4)
	lb2.outline_size = 8
	lb2.position = Vector3(fx - 2.18, y0 + 4.6, hc.y)
	lb2.rotation.y = -PI * 0.5
	add_child(lb2)
	# ----- the garage (cream, black hip roof, raised door with dark slats, light inside): the Prado inside
	var gx0 := GARAGE.position.x
	var gx1 := GARAGE.end.x
	var gz0 := GARAGE.position.y
	var gz1 := GARAGE.end.y
	_box(Vector3(GARAGE.size.x, 3.4, 0.3), Vector3(g.x, y0 + 1.7, gz0 + 0.15), stucco, true)
	_box(Vector3(GARAGE.size.x, 3.4, 0.3), Vector3(g.x, y0 + 1.7, gz1 - 0.15), stucco, true)
	_box(Vector3(0.3, 3.4, GARAGE.size.y), Vector3(gx1 - 0.15, y0 + 1.7, g.y), stucco, true)
	_box(Vector3(0.4, 0.9, GARAGE.size.y), Vector3(gx0 + 0.2, y0 + 2.95, g.y), cream, true)
	_hip_roof(Vector3(g.x, y0 + 3.4, g.y), GARAGE.size.x + 1.0, GARAGE.size.y + 1.0, 1.5, roof)
	_box(Vector3(GARAGE.size.x + 0.2, 0.2, GARAGE.size.y + 0.2), Vector3(g.x, y0 + 3.4, g.y), cream2, true)
	_box(Vector3(GARAGE.size.x - 0.4, 0.12, GARAGE.size.y - 0.4), Vector3(g.x, y0 + 0.07, g.y), _mat(Color(0.5, 0.5, 0.5), 0.6))
	for k9 in 4:
		_box(Vector3(0.08, 0.16, GARAGE.size.y - 0.8), Vector3(gx0 + 0.4, y0 + 2.6 + k9 * 0.17, g.y), dark)
	_box(Vector3(2.4, 0.06, 0.3), Vector3(g.x, y0 + 3.2, g.y), lamp)
	for zz2: float in [gz0 - 0.2, gz1 + 0.2]:
		_box(Vector3(0.3, 0.6, 0.3), Vector3(gx0 - 0.15, y0 + 2.6, zz2), lamp)
	# ----- the fountain in the round forecourt: basin, flower ring, tiered centre, jets, lights
	var fc := Vector3(-2.0, y0, hc.y)
	_circle_pave(fc, 10.5, paving, y0 + 0.03)
	_ring(fc, 9.2, 7.6, 0.25, _mat(Color(0.16, 0.12, 0.08), 0.95))                            # flower ring soil
	for k10 in 60:
		var a := k10 * TAU / 60.0
		_plants.append([["flowers_salvia", "flowers_petunia", "flowers_marigold", "rose_bush"][k10 % 4], fc + Vector3(sin(a) * 8.4, 0.3, cos(a) * 8.4), 1.2])
	_ring(fc, 5.4, 4.8, 0.75, cream)                                                            # basin rim
	var wdisc := MeshInstance3D.new()
	var wc := CylinderMesh.new()
	wc.top_radius = 4.85
	wc.bottom_radius = 4.85
	wc.height = 0.05
	wc.radial_segments = 40
	wdisc.mesh = wc
	wdisc.material_override = water
	wdisc.position = fc + Vector3(0, 0.6, 0)
	add_child(wdisc)
	var col := CollisionShape3D.new()
	var cy := CylinderShape3D.new()
	cy.radius = 5.4
	cy.height = 0.8
	col.shape = cy
	col.position = fc + Vector3(0, 0.4, 0)
	_body.add_child(col)
	_cyl(1.2, 1.5, 1.4, fc + Vector3(0, 1.0, 0), cream)
	_cyl(2.2, 1.0, 0.35, fc + Vector3(0, 1.85, 0), cream)
	_cyl(0.35, 0.45, 1.0, fc + Vector3(0, 2.5, 0), cream)
	_cyl(1.0, 0.5, 0.25, fc + Vector3(0, 3.1, 0), cream)
	_jets(fc + Vector3(0, 3.3, 0), 0.4, 7.0, 120, Vector3.ZERO)
	for k11 in 10:
		var a2 := k11 * TAU / 10.0
		_jets(fc + Vector3(sin(a2) * 3.4, 0.62, cos(a2) * 3.4), 0.08, 5.0, 26, Vector3.ZERO)
		_box(Vector3(0.18, 0.05, 0.18), fc + Vector3(sin(a2) * 3.4, 0.6, cos(a2) * 3.4), _mat(Color(0.6, 0.85, 1.0), 0.2, 0.0, Color(0.4, 0.75, 1.0), 3.0))
	for k12 in 4:
		var a3 := PI * 0.25 + k12 * PI * 0.5
		_bench(fc + Vector3(sin(a3) * 11.6, y0, cos(a3) * 11.6), a3 + PI, wood, iron)
		_garden_lamp(fc + Vector3(sin(a3 + 0.3) * 11.2, y0, cos(a3 + 0.3) * 11.2), lamp, iron)
	# ----- the gazebo (north): cream pillars, a black hip roof, sofas round a fire pit
	var gc := Vector3(22.0, y0, -184.0)
	_box(Vector3(10.0, 0.3, 9.0), gc + Vector3(0, 0.15, 0), cream2, true)
	for sx: float in [-4.4, 4.4]:
		for sz: float in [-3.9, 3.9]:
			_box(Vector3(0.6, 3.2, 0.6), gc + Vector3(sx, 1.9, sz), cream, true)
			_box(Vector3(0.25, 0.4, 0.25), gc + Vector3(sx, 2.9, sz) + Vector3(-signf(sx) * 0.4, 0, 0), lamp)
	_box(Vector3(10.0, 0.4, 9.0), gc + Vector3(0, 3.7, 0), cream2)
	_hip_roof(gc + Vector3(0, 3.9, 0), 11.0, 10.0, 2.0, roof)
	var sofa := _mat(Color(0.62, 0.52, 0.4), 0.9)
	var cushion := _mat(Color(0.86, 0.8, 0.7), 0.95)
	for seat in [[Vector3(0, 0, -3.0), Vector3(6.0, 0.5, 1.0)], [Vector3(-3.4, 0, 0), Vector3(1.0, 0.5, 5.0)], [Vector3(3.4, 0, 0), Vector3(1.0, 0.5, 5.0)]]:
		var sp: Vector3 = seat[0]
		var ss: Vector3 = seat[1]
		_box(ss, gc + sp + Vector3(0, 0.55, 0), sofa, true)
		_box(Vector3(ss.x * 0.94, 0.15, ss.z * 0.94), gc + sp + Vector3(0, 0.88, 0), cushion)
		var back := Vector3(0, 0, -0.45) if sp.z < 0 else (Vector3(-0.45, 0, 0) if sp.x < 0 else Vector3(0.45, 0, 0))
		_box(Vector3(ss.x if back.x == 0 else 0.25, 0.7, ss.z if back.z == 0 else 0.25), gc + sp + back + Vector3(0, 1.1, 0), sofa)
	_cyl(1.1, 1.2, 0.5, gc + Vector3(0, 0.55, 0.2), stone)
	_cyl(0.8, 0.8, 0.05, gc + Vector3(0, 0.82, 0.2), _mat(Color(1.0, 0.45, 0.1), 0.5, 0.0, Color(1.0, 0.45, 0.1), 4.0))
	var fire := CPUParticles3D.new()
	fire.amount = 40
	fire.lifetime = 0.8
	fire.direction = Vector3.UP
	fire.spread = 12.0
	fire.initial_velocity_min = 0.6
	fire.initial_velocity_max = 1.4
	fire.gravity = Vector3(0, 0.6, 0)
	fire.emission_shape = CPUParticles3D.EMISSION_SHAPE_SPHERE
	fire.emission_sphere_radius = 0.4
	var fq := QuadMesh.new()
	fq.size = Vector2(0.25, 0.25)
	var fm := StandardMaterial3D.new()
	fm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	fm.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED
	fm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	fm.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	fm.albedo_color = Color(1.0, 0.5, 0.15, 0.7)
	fq.material = fm
	fire.mesh = fq
	fire.position = gc + Vector3(0, 0.9, 0.2)
	fire.visibility_range_end = 120.0
	add_child(fire)
	_pave(Rect2(gc.x - 6.0, gc.z - 5.5, 12.0, 11.0), paving, y0 + 0.02)
	# ----- the swing pergola (south-west) and the pond with a waterfall and a little bridge (south-east)
	var sw := Vector3(-6.5, y0, -276.0)
	for sx2: float in [-2.0, 2.0]:
		for sz2: float in [-1.4, 1.4]:
			_box(Vector3(0.25, 3.0, 0.25), sw + Vector3(sx2, 1.5, sz2), cream, true)
	for k13 in 9:
		_box(Vector3(0.12, 0.15, 3.4), sw + Vector3(-2.2 + k13 * 0.55, 3.1, 0), wood)
	_box(Vector3(4.6, 0.2, 0.2), sw + Vector3(0, 3.0, -1.4), wood)
	_box(Vector3(4.6, 0.2, 0.2), sw + Vector3(0, 3.0, 1.4), wood)
	for sx3: float in [-1.0, 1.0]:
		_box(Vector3(0.03, 2.2, 0.03), sw + Vector3(sx3, 2.0, 0), iron)
	_box(Vector3(2.4, 0.2, 0.8), sw + Vector3(0, 0.9, 0), cushion)
	_box(Vector3(2.4, 0.7, 0.15), sw + Vector3(0, 1.3, -0.4), cushion)
	_pave(Rect2(sw.x - 3.0, sw.z - 2.5, 6.0, 5.0), paving, y0 + 0.02)
	var pc := Vector3(24.0, y0, -280.0)
	_circle_water(pc, 7.5, 4.8, water, stone)
	# waterfall: a rock heap at the back with a falling sheet and spray
	var rng := RandomNumberGenerator.new()
	rng.seed = 41
	for k14 in 14:
		var rp := pc + Vector3(rng.randf_range(4.0, 7.5), 0, rng.randf_range(-4.0, 4.0))
		var rr := rng.randf_range(0.7, 1.4)
		var rock := MeshInstance3D.new()
		var sm := SphereMesh.new()
		sm.radius = rr
		sm.height = rr * 1.5
		sm.radial_segments = 8
		sm.rings = 5
		rock.mesh = sm
		rock.material_override = stone
		rock.position = rp + Vector3(0, rr * 0.6 + (1.2 if absf(rp.z - pc.z) < 1.6 and rp.x > pc.x + 5.2 else 0.0), 0)
		add_child(rock)
	var sheet := MeshInstance3D.new()
	var shm := BoxMesh.new()
	shm.size = Vector3(0.1, 2.4, 1.6)
	sheet.mesh = shm
	sheet.material_override = _mat(Color(0.75, 0.9, 1.0, 0.7), 0.05, 0.0, Color(0.3, 0.55, 0.8), 0.8)
	sheet.position = pc + Vector3(5.2, 1.4, 0)
	add_child(sheet)
	_jets(pc + Vector3(5.0, 0.4, 0), 0.4, 1.5, 40, Vector3(-1, 0.5, 0))
	# the bridge: a wooden arch over the narrow part with white rails
	var b0 := pc + Vector3(-1.0, 0, -5.5)
	var b1 := pc + Vector3(-1.0, 0, 5.5)
	for k15 in 10:
		var t4 := (k15 + 0.5) / 10.0
		var p2 := b0.lerp(b1, t4) + Vector3(0, 0.25 + sin(t4 * PI) * 0.6, 0)
		_box(Vector3(2.0, 0.12, 1.15), p2, wood, true)
		for sx4: float in [-1.0, 1.0]:
			_box(Vector3(0.08, 0.8, 0.08), p2 + Vector3(sx4 * 0.95, 0.45, 0), _mat(Color(0.95, 0.95, 0.92), 0.5))
	for sx5: float in [-1.0, 1.0]:
		for k16 in 10:
			var t5 := k16 / 10.0
			var t6 := (k16 + 1) / 10.0
			var q0 := b0.lerp(b1, t5) + Vector3(sx5 * 0.95, 1.1 + sin(t5 * PI) * 0.6, 0)
			var q1 := b0.lerp(b1, t6) + Vector3(sx5 * 0.95, 1.1 + sin(t6 * PI) * 0.6, 0)
			var rail := MeshInstance3D.new()
			var rb := BoxMesh.new()
			rb.size = Vector3(0.08, 0.08, q0.distance_to(q1))
			rail.mesh = rb
			rail.material_override = _mat(Color(0.95, 0.95, 0.92), 0.5)
			rail.position = (q0 + q1) * 0.5
			rail.rotation.x = -atan2(q1.y - q0.y, q1.z - q0.z)
			add_child(rail)
	# garden lamps along the walks
	for lp in [Vector3(-10, y0, -264), Vector3(-10, y0, -276), Vector3(4, y0, -285), Vector3(14, y0, -285), Vector3(8, y0, -198),
			Vector3(14, y0, -190), Vector3(8, y0, -176), Vector3(-14, y0, -205), Vector3(-14, y0, -242)]:
		_garden_lamp(lp, lamp, iron)
	# night lights (no shadows): on at night only (see _process)
	for lpos in [fc + Vector3(0, 4.0, 0), Vector3(fx - 3.0, y0 + 3.5, hc.y), gc + Vector3(0, 2.6, 0), Vector3(lx0 + 1.0, y0 + 3.0, hc.y), pc + Vector3(2, 2.5, 0)]:
		var ol := OmniLight3D.new()
		ol.position = lpos
		ol.omni_range = 14.0
		ol.light_color = Color(1.0, 0.78, 0.5)
		ol.light_energy = 0.0
		ol.shadow_enabled = false
		add_child(ol)
		_night_lights.append(ol)
	_garden.call_deferred(y0)


var _paved: Array = []           ## Rect2 / [Vector2 centre, radius]: no grass blades there
var _plants: Array = []          ## [id, pos, scale]
var _flower_rows: Array = []     ## [from, to, rows]
var _night_lights: Array[OmniLight3D] = []


## the distance from the front fence to the outer edge of the street's sidewalk (paved strip)
func _front_depth() -> float:
	var wd := WorldData.get_instance()
	if wd == null or not wd.ok:
		return 4.0
	var best := 30.0
	for z in [LOT.position.y + 8.0, LOT.get_center().y, LOT.end.y - 8.0]:
		var t := 0.0
		while t < 30.0:
			var p := to_global(Vector3(LOT.position.x - t, 0, z))
			if wd.road_edge_dist(p.x, p.z) < 3.4:
				break
			t += 0.5
		best = minf(best, t + 0.6)
	return best


func _pave(r: Rect2, m: Material, y: float) -> void:
	_box(Vector3(r.size.x, 0.12, r.size.y), Vector3(r.get_center().x, y, r.get_center().y), m, true)
	_paved.append(r)


func _circle_pave(cc: Vector3, r: float, m: Material, y: float) -> void:
	_cyl(r, r, 0.12, Vector3(cc.x, y, cc.z), m)
	_paved.append([Vector2(cc.x, cc.z), r])


func _cyl(rt: float, rb: float, h: float, pos: Vector3, m: Material) -> void:
	var mi := MeshInstance3D.new()
	var cm := CylinderMesh.new()
	cm.top_radius = rt
	cm.bottom_radius = rb
	cm.height = h
	cm.radial_segments = 32
	mi.mesh = cm
	mi.material_override = m
	mi.position = pos
	add_child(mi)


## a flat ring (inner r1 .. outer r0) of boxes, height h
func _ring(cc: Vector3, r0: float, r1: float, h: float, m: Material) -> void:
	var n := 40
	for k in n:
		var a := (k + 0.5) * TAU / n
		var rm := (r0 + r1) * 0.5
		var mi := MeshInstance3D.new()
		var bm := BoxMesh.new()
		bm.size = Vector3(rm * TAU / n + 0.05, h, r0 - r1)
		mi.mesh = bm
		mi.material_override = m
		mi.position = cc + Vector3(sin(a) * rm, h * 0.5 + 0.05, cos(a) * rm)
		mi.rotation.y = a
		add_child(mi)


## an oval pond: water, a dark bed, a stone rim; no grass inside
func _circle_water(cc: Vector3, rx: float, rz: float, water: Material, stone: Material) -> void:
	var w := MeshInstance3D.new()
	var cm := CylinderMesh.new()
	cm.top_radius = 1.0
	cm.bottom_radius = 1.0
	cm.height = 0.05
	cm.radial_segments = 40
	w.mesh = cm
	w.material_override = water
	w.scale = Vector3(rx, 1, rz)
	w.position = cc + Vector3(0, 0.16, 0)
	add_child(w)
	var n := 40
	for k in n:
		var a0 := k * TAU / n
		var a1 := (k + 1) * TAU / n
		var p0 := cc + Vector3(sin(a0) * rx, 0.2, cos(a0) * rz)
		var p1 := cc + Vector3(sin(a1) * rx, 0.2, cos(a1) * rz)
		var mi := MeshInstance3D.new()
		var bm := BoxMesh.new()
		bm.size = Vector3(0.7, 0.4, p0.distance_to(p1) + 0.1)
		mi.mesh = bm
		mi.material_override = stone
		mi.position = (p0 + p1) * 0.5
		mi.rotation.y = atan2(p1.x - p0.x, p1.z - p0.z)
		add_child(mi)
	_paved.append([Vector2(cc.x, cc.z), maxf(rx, rz) + 0.5])


## a hip roof over a w x d rectangle (centre c at the eaves, ridge h above), both windings
func _hip_roof(cc: Vector3, w: float, d: float, h: float, m: Material) -> void:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var hw := w * 0.5
	var hd := d * 0.5
	var r := minf(hw, hd)
	var e := [cc + Vector3(-hw, 0, -hd), cc + Vector3(hw, 0, -hd), cc + Vector3(hw, 0, hd), cc + Vector3(-hw, 0, hd)]
	var ra: Vector3
	var rb: Vector3
	if w >= d:
		ra = cc + Vector3(-hw + r, h, 0)
		rb = cc + Vector3(hw - r, h, 0)
	else:
		ra = cc + Vector3(0, h, -hd + r)
		rb = cc + Vector3(0, h, hd - r)
	var faces: Array = []
	if w >= d:
		faces = [[e[0], e[1], rb, ra], [e[2], e[3], ra, rb], [e[3], e[0], ra], [e[1], e[2], rb]]
	else:
		faces = [[e[1], e[2], rb, ra], [e[3], e[0], ra, rb], [e[0], e[1], ra], [e[2], e[3], rb]]
	for f in faces:
		var tris: Array = [[f[0], f[1], f[2]]]
		if f.size() == 4:
			tris.append([f[0], f[2], f[3]])
		for t in tris:
			var a: Vector3 = t[0]
			var b: Vector3 = t[1]
			var c2: Vector3 = t[2]
			var nrm := (b - a).cross(c2 - a).normalized()
			if nrm.y < 0:
				nrm = -nrm
				var tmp := b
				b = c2
				c2 = tmp
			for v in [a, c2, b]:
				st.set_normal(nrm)
				st.set_uv(Vector2(v.x + v.y, v.z + v.y) * 0.5)
				st.add_vertex(v)
	var mi := MeshInstance3D.new()
	mi.mesh = st.commit()
	var m2 := (m as StandardMaterial3D).duplicate() as StandardMaterial3D
	m2.cull_mode = BaseMaterial3D.CULL_DISABLED
	mi.material_override = m2
	add_child(mi)


func _lantern(p: Vector3, glow: Material, iron: Material, s := 1.0) -> void:
	_box(Vector3(0.42, 0.1, 0.42) * s, p + Vector3(0, 0.05, 0) * s, iron)
	_box(Vector3(0.3, 0.46, 0.3) * s, p + Vector3(0, 0.33, 0) * s, glow)
	_box(Vector3(0.48, 0.1, 0.48) * s, p + Vector3(0, 0.61, 0) * s, iron)
	_box(Vector3(0.2, 0.14, 0.2) * s, p + Vector3(0, 0.73, 0) * s, iron)


func _garden_lamp(p: Vector3, glow: Material, iron: Material) -> void:
	_box(Vector3(0.1, 1.6, 0.1), p + Vector3(0, 0.8, 0), iron)
	_lantern(p + Vector3(0, 1.6, 0), glow, iron, 0.7)


func _bench(p: Vector3, yaw: float, wood: Material, iron: Material) -> void:
	var f := Vector3(sin(yaw), 0, cos(yaw))
	var s := Vector3(f.z, 0, -f.x)
	for k in 3:
		var mi := MeshInstance3D.new()
		var bm := BoxMesh.new()
		bm.size = Vector3(1.8, 0.05, 0.14)
		mi.mesh = bm
		mi.material_override = wood
		mi.position = p + Vector3(0, 0.45, 0) + f * (-0.2 + k * 0.17)
		mi.rotation.y = yaw
		add_child(mi)
	var back := MeshInstance3D.new()
	var bb := BoxMesh.new()
	bb.size = Vector3(1.8, 0.45, 0.05)
	back.mesh = bb
	back.material_override = wood
	back.position = p + Vector3(0, 0.75, 0) - f * 0.3
	back.rotation.y = yaw
	add_child(back)
	for sx in [-0.8, 0.8]:
		_box(Vector3(0.06, 0.45, 0.06), p + s * sx + Vector3(0, 0.22, 0), iron)


## many identical boxes as one MultiMesh
func _multibox(xfs: Array[Transform3D], size: Vector3, m: Material) -> void:
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	var bm := BoxMesh.new()
	bm.size = size
	mm.mesh = bm
	mm.instance_count = xfs.size()
	for i in xfs.size():
		mm.set_instance_transform(i, xfs[i])
	var mi := MultiMeshInstance3D.new()
	mi.multimesh = mm
	mi.material_override = m
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(mi)


## water jets (CPU particles, round soft drops)
func _jets(p: Vector3, spread: float, speed: float, amount: int, dir: Vector3) -> void:
	var cp := CPUParticles3D.new()
	cp.position = p
	cp.amount = amount
	cp.lifetime = 1.2
	cp.direction = (Vector3.UP * 1.5 + dir).normalized()
	cp.spread = 10.0 if dir != Vector3.ZERO else 18.0
	cp.initial_velocity_min = speed * 0.85
	cp.initial_velocity_max = speed
	cp.gravity = Vector3(0, -9.8, 0)
	cp.emission_shape = CPUParticles3D.EMISSION_SHAPE_SPHERE
	cp.emission_sphere_radius = spread * 0.3
	var qm := QuadMesh.new()
	qm.size = Vector2(0.12, 0.12)
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED
	m.albedo_color = Color(0.85, 0.93, 1.0, 0.65)
	var gt := GradientTexture2D.new()
	gt.width = 32
	gt.height = 32
	gt.fill = GradientTexture2D.FILL_RADIAL
	gt.fill_from = Vector2(0.5, 0.5)
	gt.fill_to = Vector2(1.0, 0.5)
	var gr := Gradient.new()
	gr.set_color(0, Color(1, 1, 1, 1))
	gr.set_color(1, Color(1, 1, 1, 0))
	gt.gradient = gr
	m.albedo_texture = gt
	qm.material = m
	cp.mesh = qm
	cp.visibility_range_end = 150.0
	add_child(cp)


func _paved_at(p: Vector2) -> bool:
	for s in _paved:
		if s is Rect2:
			if (s as Rect2).grow(0.15).has_point(p):
				return true
		elif p.distance_to(s[0]) < float(s[1]) + 0.15:
			return true
	return HOUSE.grow(0.6).has_point(p) or GARAGE.grow(0.6).has_point(p)


## the garden: cypresses along the walls, blossoming trees, flower beds, shrubs, boulders, and dense
## 3D grass blades on all the lawns (not on the paving)
func _garden(y0: float) -> void:
	for w in 600:
		if OpenWorld.instance and not OpenWorld.instance._veg.is_empty():
			break
		await get_tree().process_frame
	if OpenWorld.instance == null or not is_inside_tree():
		return
	var g := global_transform
	var trees := {"thuja_cone": [], "shrub_lilac": [], "rose_bush": [], "flowers_petunia": [], "flowers_salvia": [],
			"flowers_marigold": [], "chinar_middle": [], "hedge_privet": []}
	var lx0 := LOT.position.x
	var lz0 := LOT.position.y
	var lx1 := LOT.end.x
	var lz1 := LOT.end.y
	# cypresses along the side and back walls and inside the front fence (not in front of the gates)
	var zz := lz0 + 2.5
	while zz < lz1 - 2.0:
		trees["thuja_cone"].append(g * Transform3D(Basis.IDENTITY.scaled(Vector3(0.9, 1.25, 0.9)), Vector3(lx1 - 1.6, y0, zz)))
		zz += 3.5
	for xx: float in range(int(lx0 + 3), int(lx1 - 2), 4):
		for zb: float in [lz0 + 1.6, lz1 - 1.6]:
			trees["thuja_cone"].append(g * Transform3D(Basis.IDENTITY.scaled(Vector3(0.9, 1.2, 0.9)), Vector3(xx, y0, zb)))
	zz = lz0 + 3.0
	while zz < lz1 - 2.0:
		var near_gate := absf(zz - HOUSE.get_center().y) < 6.5 or absf(zz - GARAGE.get_center().y) < 7.5
		if not near_gate and not _paved_at(Vector2(lx0 + 1.6, zz)):
			trees["thuja_cone"].append(g * Transform3D(Basis.IDENTITY.scaled(Vector3(0.75, 0.9, 0.75)), Vector3(lx0 + 1.6, y0, zz)))
		zz += 5.0
	# blossoming trees (lilac, pink-purple) at the corners and by the gazebo / pond, roses, flower beds
	for bp in [Vector3(lx0 + 4, y0, lz1 - 4), Vector3(lx0 + 4, y0, lz0 + 4), Vector3(14, y0, -176), Vector3(31, y0, -196),
			Vector3(14, y0, -290), Vector3(32, y0, -268), Vector3(-12, y0, -190), Vector3(-12, y0, -266)]:
		if not _paved_at(Vector2(bp.x, bp.z)):
			trees["shrub_lilac"].append(g * Transform3D(Basis(Vector3.UP, bp.x).scaled(Vector3(1.9, 2.2, 1.9)), bp))
	for pl in _plants:
		if trees.has(pl[0]):
			trees[pl[0]].append(g * Transform3D(Basis(Vector3.UP, (pl[1] as Vector3).x * 3.1).scaled(Vector3.ONE * float(pl[2])), pl[1]))
	for row in _flower_rows:
		var a: Vector3 = row[0]
		var b: Vector3 = row[1]
		var n := int(a.distance_to(b) / 0.3)
		for i in n:
			for j in int(row[2]):
				var p := a.lerp(b, (i + 0.5) / n) + Vector3((j - 0.5) * 0.45, 0, 0)
				trees[["flowers_petunia", "flowers_salvia", "flowers_marigold"][(i / 6 + j) % 3]].append(g * Transform3D(Basis(Vector3.UP, i * 1.3).scaled(Vector3.ONE * 1.25), p))
	# flower beds along the house front and round the lawns' corners
	for fz: float in [HOUSE.get_center().y - 11.0, HOUSE.get_center().y + 11.0]:
		for i2 in 24:
			for j2 in 3:
				var p2 := Vector3(HOUSE.position.x - 1.2 - j2 * 0.4, y0 + 0.05, fz - 3.6 + i2 * 0.3)
				trees[["flowers_salvia", "flowers_petunia", "flowers_marigold"][(i2 / 6 + j2) % 3]].append(g * Transform3D(Basis(Vector3.UP, i2 * 1.7).scaled(Vector3.ONE * 1.25), p2))
	var holder := Node3D.new()
	holder.name = "Garden"
	holder.top_level = true
	add_child(holder)
	holder.global_transform = Transform3D.IDENTITY
	OpenWorld.instance._trees(holder, trees, 0)
	_grass_blades(y0)


## dense 3D grass on every lawn of the yard (the game's grass clump, the shared lawn palette)
func _grass_blades(y0: float) -> void:
	if RenderingServer.get_current_rendering_method() == "gl_compatibility" or Settings.quality == 0:
		return
	var gf := GrassField.new()
	var mesh: Mesh = gf._grass_mesh()
	gf.free()
	if mesh == null:
		return
	var gm := mesh.surface_get_material(0) as ShaderMaterial
	if gm:
		gm.set_shader_parameter("palette_noise", load("res://assets/textures/noise_macro.png"))
	var step := 0.27 if Settings.quality >= 2 else 0.36
	var xfs: Array[Transform3D] = []
	var x := LOT.position.x + 0.6
	var rng := RandomNumberGenerator.new()
	rng.seed = 99
	while x < LOT.end.x - 0.6:
		var z := LOT.position.y + 0.6
		while z < LOT.end.y - 0.6:
			var px := x + rng.randf_range(-0.14, 0.14)
			var pz := z + rng.randf_range(-0.14, 0.14)
			if not _paved_at(Vector2(px, pz)):
				var s := rng.randf_range(1.3, 2.0)
				xfs.append(Transform3D(Basis(Vector3.UP, rng.randf() * TAU).scaled(Vector3(s, s * rng.randf_range(0.9, 1.25), s)), Vector3(px, y0 + 0.02, pz)))
			z += step
		x += step
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_colors = true
	mm.mesh = mesh
	mm.instance_count = xfs.size()
	for i in xfs.size():
		mm.set_instance_transform(i, xfs[i])
		mm.set_instance_color(i, Color.WHITE)
	var mi := MultiMeshInstance3D.new()
	mi.name = "YardGrass"
	mi.multimesh = mm
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.visibility_range_end = 140.0
	add_child(mi)
