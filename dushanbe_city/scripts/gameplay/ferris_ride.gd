class_name FerrisRide
extends Node3D
## The Ferris wheel in Rudaki park (replaces the static model): a 34 m wheel built from parts (two rims,
## an inner ring, spokes, the hub, A-frame legs, rim lights) turning slowly all day, 16 gondolas that
## always hang level (floor, coloured body, window frames + glass, two benches, roof with a lamp,
## hanger arms). At the boarding deck a ticket booth: «КОЛЕСО ОБОЗРЕНИЯ · 10 смн» - pay and ride one full
## turn (75 s) in a gondola; the camera sits inside, drag to look round, then you step out on the deck.

const PRICE := 10
const R := 15.0                  ## rim radius (gondola pivots)
const HUB_Y := 18.85
const N := 16
const LAP_S := 75.0
const IDLE_SPEED := TAU / 240.0  ## the wheel keeps turning slowly when nobody rides

var angle := 0.0
var riding := false
var ride_t := 0.0
var _wheel: Node3D
var _gondolas: Array[Node3D] = []
var _ride_g := -1
var _start_angle := 0.0
var _cam: Camera3D
var _yaw := 0.0
var _pitch := -0.1
var _player: Node3D
var _ui: CanvasLayer
var _lbl: Label
var _toast_t := 0.0
var _lights: StandardMaterial3D
var _night_t := 0.0


static func place_in(parent: Node) -> FerrisRide:
	var wd := WorldData.get_instance()
	if wd == null or not wd.ok:
		return null
	var lm: Dictionary = wd.landmark("rudaki_park")
	if lm.is_empty():
		return null
	var L := float(lm["L"])
	var D := float(lm["D"])
	var base := Transform3D(Basis(Vector3.UP, float(lm["yaw"])), Vector3(float(lm["x"]), float(lm["y"]), float(lm["z"])))
	var f := FerrisRide.new()
	f.name = "FerrisRide"
	parent.add_child(f)
	f.global_transform = base * Transform3D(Basis(Vector3.UP, PI * 0.5), Vector3(-L * 0.3, 0.1, D * 0.25))
	return f


func _ready() -> void:
	add_to_group(&"interactable")
	_build()
	_build_ui()


# ------------------------------------------------------------------------------------------ build
func _mat(c: Color, rough := 0.6, metal := 0.0, emit := Color.BLACK, e := 1.0) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = c
	m.roughness = rough
	m.metallic = metal
	if emit != Color.BLACK:
		m.emission_enabled = true
		m.emission = emit
		m.emission_energy_multiplier = e
	return m


## boxes / cylinders merged per material into one mesh (few draw calls)
class _Merge:
	var tools := {}
	var mats := {}

	func add(mesh: Mesh, xf: Transform3D, m: Material) -> void:
		var k := m.get_instance_id()
		if not tools.has(k):
			var st := SurfaceTool.new()
			st.begin(Mesh.PRIMITIVE_TRIANGLES)
			tools[k] = st
			mats[k] = m
		(tools[k] as SurfaceTool).append_from(mesh, 0, xf)

	func box(size: Vector3, xf: Transform3D, m: Material) -> void:
		var b := BoxMesh.new()
		b.size = size
		add(b, xf, m)

	## a bar from a to b (square section t)
	func bar(a: Vector3, b: Vector3, t: float, m: Material) -> void:
		var d := b - a
		var L := d.length()
		if L < 0.001:
			return
		var y := d / L
		var x := y.cross(Vector3.FORWARD if absf(y.dot(Vector3.FORWARD)) < 0.9 else Vector3.RIGHT).normalized()
		var z := x.cross(y)
		box(Vector3(t, L, t), Transform3D(Basis(x, y, z), (a + b) * 0.5), m)

	func commit(mi: MeshInstance3D) -> void:
		var am := ArrayMesh.new()
		for k in tools:
			var st: SurfaceTool = tools[k]
			st.commit(am)
			am.surface_set_material(am.get_surface_count() - 1, mats[k])
		mi.mesh = am


func _build() -> void:
	var white := _mat(Color(0.93, 0.94, 0.96), 0.4, 0.5)
	var steel := _mat(Color(0.55, 0.57, 0.6), 0.35, 0.8)
	var conc := _mat(Color(0.72, 0.7, 0.66), 0.9)
	var red := _mat(Color(0.75, 0.12, 0.12), 0.5)
	_lights = _mat(Color(1.0, 0.95, 0.8), 0.3, 0.0, Color(1.0, 0.85, 0.55), 1.0)
	var hub := Vector3(0, HUB_Y, 0)
	# ---- static part: deck, stairs, A-frames, axle, booth
	var S := _Merge.new()
	S.box(Vector3(26, 0.4, 12), Transform3D(Basis.IDENTITY, Vector3(0, 0.2, 0)), conc)
	S.box(Vector3(7.0, 0.8, 4.6), Transform3D(Basis.IDENTITY, Vector3(0, 0.4, 3.3)), conc)            # boarding deck
	for k in 4:
		S.box(Vector3(3.0, 0.2 * (k + 1), 0.4), Transform3D(Basis.IDENTITY, Vector3(0, 0.1 * (k + 1), 5.8 + 0.4 * (3 - k))), conc)
	for sx: float in [-3.4, 3.4]:
		S.box(Vector3(0.06, 1.0, 4.0), Transform3D(Basis.IDENTITY, Vector3(sx, 1.3, 3.6)), red)
		S.box(Vector3(0.1, 0.06, 4.0), Transform3D(Basis.IDENTITY, Vector3(sx, 1.8, 3.6)), steel)
	for sz: float in [-2.6, 2.6]:
		for sx2: float in [-9.0, 9.0]:
			S.bar(Vector3(sx2, 0.4, sz), hub + Vector3(0, 0, sz), 0.7, white)
		S.bar(Vector3(-6.0, 6.0, sz), Vector3(6.0, 6.0, sz), 0.4, white)
		S.bar(Vector3(-3.0, 12.0, sz), Vector3(3.0, 12.0, sz), 0.35, white)
		S.bar(Vector3(-6.0, 6.0, sz), Vector3(3.0, 12.0, sz), 0.25, white)
		S.bar(Vector3(6.0, 6.0, sz), Vector3(-3.0, 12.0, sz), 0.25, white)
	var axle := CylinderMesh.new()
	axle.top_radius = 0.45
	axle.bottom_radius = 0.45
	axle.height = 6.2
	S.add(axle, Transform3D(Basis(Vector3.RIGHT, PI * 0.5), hub), steel)
	# ticket booth beside the stairs
	var booth := Vector3(5.5, 0.4, 6.5)
	S.box(Vector3(2.4, 2.6, 2.0), Transform3D(Basis.IDENTITY, booth + Vector3(0, 1.3, 0)), _mat(Color(0.95, 0.85, 0.3), 0.6))
	S.box(Vector3(2.8, 0.2, 2.4), Transform3D(Basis.IDENTITY, booth + Vector3(0, 2.7, 0)), red)
	S.box(Vector3(1.6, 0.9, 0.06), Transform3D(Basis.IDENTITY, booth + Vector3(0, 1.6, 1.01)), _mat(Color(0.2, 0.3, 0.35), 0.1, 0.4))
	var smi := MeshInstance3D.new()
	smi.name = "Frame"
	S.commit(smi)
	add_child(smi)
	var body := StaticBody3D.new()
	add_child(body)
	for spec in [[Vector3(26, 0.4, 12), Vector3(0, 0.2, 0)], [Vector3(7.0, 0.8, 4.6), Vector3(0, 0.4, 3.3)],
			[Vector3(2.4, 2.6, 2.0), booth + Vector3(0, 1.3, 0)]]:
		var cs := CollisionShape3D.new()
		var bs := BoxShape3D.new()
		bs.size = spec[0]
		cs.shape = bs
		cs.position = spec[1]
		body.add_child(cs)
	for k2 in 4:
		var cs2 := CollisionShape3D.new()
		var bs2 := BoxShape3D.new()
		bs2.size = Vector3(0.8, 1.8, 0.8)
		cs2.shape = bs2
		cs2.position = Vector3([-8.6, 8.6][k2 % 2], 1.3, [-2.6, 2.6][k2 / 2])
		body.add_child(cs2)
	var sign := Label3D.new()
	sign.text = "КОЛЕСО ОБОЗРЕНИЯ\n%d смн · 1 круг" % PRICE
	sign.font = load("res://assets/fonts/game_font.tres")
	sign.font_size = 56
	sign.pixel_size = 0.009
	sign.modulate = Color(1.0, 0.9, 0.4)
	sign.outline_size = 10
	sign.position = booth + Vector3(0, 3.4, 0.2)
	add_child(sign)
	# ---- the wheel (turns round the Z axis)
	_wheel = Node3D.new()
	_wheel.position = hub
	add_child(_wheel)
	var W := _Merge.new()
	var seg := 48
	for side: float in [-1.2, 1.2]:
		for i in seg:
			var a0 := i * TAU / seg
			var a1 := (i + 1) * TAU / seg
			for rr: float in [R, R * 0.55]:
				W.bar(Vector3(sin(a0) * rr, -cos(a0) * rr, side), Vector3(sin(a1) * rr, -cos(a1) * rr, side), 0.32 if rr == R else 0.22, white)
			W.box(Vector3(0.12, 0.12, 0.12), Transform3D(Basis.IDENTITY, Vector3(sin(a0) * (R + 0.2), -cos(a0) * (R + 0.2), side)), _lights)
		for i2 in N * 2:
			var a := i2 * TAU / (N * 2)
			W.bar(Vector3(sin(a) * 1.2, -cos(a) * 1.2, side * 0.9), Vector3(sin(a) * R, -cos(a) * R, side), 0.16, steel)
	for i3 in N:
		var a := i3 * TAU / N
		var p := Vector3(sin(a) * R, -cos(a) * R, 0)
		W.bar(p + Vector3(0, 0, -1.25), p + Vector3(0, 0, 1.25), 0.18, steel)               # gondola axle
		var q := Vector3(sin(a + PI / N) * R, -cos(a + PI / N) * R, 0)
		W.bar(p + Vector3(0, 0, -1.2), q + Vector3(0, 0, 1.2), 0.12, white)                 # zig-zag bracing
	var hubm := CylinderMesh.new()
	hubm.top_radius = 1.4
	hubm.bottom_radius = 1.4
	hubm.height = 3.0
	W.add(hubm, Transform3D(Basis(Vector3.RIGHT, PI * 0.5), Vector3.ZERO), red)
	var wmi := MeshInstance3D.new()
	wmi.name = "Wheel"
	W.commit(wmi)
	_wheel.add_child(wmi)
	# ---- gondolas
	var cols := [Color(0.85, 0.15, 0.15), Color(0.1, 0.45, 0.8), Color(0.95, 0.75, 0.1), Color(0.15, 0.6, 0.3)]
	var gmesh := {}
	for ci in cols.size():
		gmesh[ci] = _gondola_mesh(_mat(cols[ci], 0.45, 0.2), white, steel)
	for i4 in N:
		var g := Node3D.new()
		g.name = "Gondola%d" % i4
		add_child(g)
		var mi := MeshInstance3D.new()
		mi.mesh = gmesh[i4 % cols.size()]
		g.add_child(mi)
		_gondolas.append(g)
	_place_gondolas(0.0)


## one gondola: the pivot at the origin, the cabin hanging below it
func _gondola_mesh(body_m: Material, white: Material, steel: Material) -> Mesh:
	var G := _Merge.new()
	var glass := _mat(Color(0.6, 0.8, 0.9, 0.3), 0.05, 0.3)
	glass.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	var seat := _mat(Color(0.35, 0.2, 0.12), 0.7)
	var top := -0.7                                   # roof under the pivot
	var floor_y := top - 2.3
	# hanger arms from the pivot axle to the roof
	for sz: float in [-0.7, 0.7]:
		G.bar(Vector3(0, 0, sz), Vector3(-0.5, top, sz), 0.08, steel)
		G.bar(Vector3(0, 0, sz), Vector3(0.5, top, sz), 0.08, steel)
	# roof: plate + raised cap + lamp
	G.box(Vector3(2.3, 0.12, 1.9), Transform3D(Basis.IDENTITY, Vector3(0, top, 0)), body_m)
	G.box(Vector3(1.5, 0.22, 1.2), Transform3D(Basis.IDENTITY, Vector3(0, top + 0.16, 0)), body_m)
	G.box(Vector3(0.25, 0.15, 0.25), Transform3D(Basis.IDENTITY, Vector3(0, top + 0.34, 0)), _lights)
	# floor + lower body (coloured)
	G.box(Vector3(2.1, 0.1, 1.7), Transform3D(Basis.IDENTITY, Vector3(0, floor_y, 0)), steel)
	# hollow lower body: four coloured walls, a white sill strip on top of each
	for wz: float in [-0.82, 0.82]:
		G.box(Vector3(2.1, 0.95, 0.06), Transform3D(Basis.IDENTITY, Vector3(0, floor_y + 0.5, wz)), body_m)
		G.box(Vector3(2.16, 0.06, 0.12), Transform3D(Basis.IDENTITY, Vector3(0, floor_y + 1.0, wz)), white)
	for wx: float in [-1.02, 1.02]:
		G.box(Vector3(0.06, 0.95, 1.7), Transform3D(Basis.IDENTITY, Vector3(wx, floor_y + 0.5, 0)), body_m)
		G.box(Vector3(0.12, 0.06, 1.76), Transform3D(Basis.IDENTITY, Vector3(wx, floor_y + 1.0, 0)), white)
	G.box(Vector3(2.0, 0.04, 1.6), Transform3D(Basis.IDENTITY, Vector3(0, floor_y + 0.07, 0)), _mat(Color(0.3, 0.3, 0.32), 0.8))   # rubber floor mat
	G.box(Vector3(2.0, 0.04, 1.6), Transform3D(Basis.IDENTITY, Vector3(0, top - 0.08, 0)), _mat(Color(0.92, 0.92, 0.9), 0.7))     # ceiling
	# window frames: corner posts + middle mullions, glass panes
	for cx: float in [-1.03, 1.03]:
		for cz: float in [-0.83, 0.83]:
			G.box(Vector3(0.07, 1.25, 0.07), Transform3D(Basis.IDENTITY, Vector3(cx, floor_y + 1.65, cz)), white)
	for cz2: float in [-0.83, 0.83]:
		G.box(Vector3(0.05, 1.25, 0.05), Transform3D(Basis.IDENTITY, Vector3(0, floor_y + 1.65, cz2)), white)
	G.box(Vector3(2.0, 1.2, 0.02), Transform3D(Basis.IDENTITY, Vector3(0, floor_y + 1.65, 0.83)), glass)
	G.box(Vector3(2.0, 1.2, 0.02), Transform3D(Basis.IDENTITY, Vector3(0, floor_y + 1.65, -0.83)), glass)
	G.box(Vector3(0.02, 1.2, 1.6), Transform3D(Basis.IDENTITY, Vector3(1.03, floor_y + 1.65, 0)), glass)
	G.box(Vector3(0.02, 1.2, 1.6), Transform3D(Basis.IDENTITY, Vector3(-1.03, floor_y + 1.65, 0)), glass)
	# two benches facing each other
	for sx: float in [-0.7, 0.7]:
		G.box(Vector3(0.45, 0.08, 1.5), Transform3D(Basis.IDENTITY, Vector3(sx, floor_y + 0.5, 0)), seat)
		G.box(Vector3(0.08, 0.5, 1.5), Transform3D(Basis.IDENTITY, Vector3(sx + signf(sx) * 0.22, floor_y + 0.8, 0)), seat)
	var mi := MeshInstance3D.new()
	G.commit(mi)
	return mi.mesh


func _place_gondolas(delta: float) -> void:
	var swing := 0.03 * (TAU / LAP_S if riding else IDLE_SPEED) * 40.0
	for i in N:
		var a := angle + i * TAU / N
		var g := _gondolas[i]
		g.position = Vector3(0, HUB_Y, 0) + Vector3(sin(a) * R, -cos(a) * R, 0)
		g.rotation.z = sin(a) * swing * 0.4               # a gentle swing, always (nearly) level


# ------------------------------------------------------------------------------------------ ride
func interaction_label(_p: Node) -> String:
	return "КОЛЕСО ОБОЗРЕНИЯ · %s" % Wallet.fmt(PRICE)


func interaction_point(_p: Node) -> Vector3:
	return to_global(Vector3(5.5, 0.4, 8.0))


func can_interact(_p: Node) -> bool:
	return not riding


func interact(p: Node) -> void:
	if riding:
		return
	if Wallet.money < PRICE:
		_say("Не хватает денег: билет %s" % Wallet.fmt(PRICE))
		return
	Wallet.money -= PRICE
	Wallet.save_state()
	start_ride(p as Node3D)


func start_ride(p: Node3D) -> void:
	_player = p
	# the gondola nearest the bottom takes the passenger; the wheel turns so it stands at the deck
	var best := 0
	var bd := INF
	for i in N:
		var a := fposmod(angle + i * TAU / N, TAU)
		var d := minf(a, TAU - a)
		if d < bd:
			bd = d
			best = i
	_ride_g = best
	angle = -best * TAU / N
	_start_angle = angle
	ride_t = 0.0
	riding = true
	if p:
		p.visible = false
		p.set_physics_process(false)
		p.set_process(false)
	_cam = Camera3D.new()
	_cam.far = 9000.0
	_gondolas[best].add_child(_cam)
	_cam.position = Vector3(0, -0.7 - 2.3 + 1.55, 0.4)
	_yaw = 0.0
	_pitch = -0.22
	_cam.make_current()
	_ui.visible = true
	_say("Приятного полёта! Проведите пальцем, чтобы осмотреться")


func _end_ride() -> void:
	riding = false
	_ui.visible = false
	if _cam:
		_cam.queue_free()
		_cam = null
	if _player and is_instance_valid(_player):
		_player.set_physics_process(true)
		_player.set_process(true)
		_player.visible = true
		if _player.has_method("teleport"):
			var out := to_global(Vector3(0, 0.9, 4.2))
			_player.call("teleport", out, global_rotation.y)
		if _player.has_method("get_camera"):
			(_player.call("get_camera") as Camera3D).make_current()
	_say("Круг окончен. Спасибо!")


func _process(delta: float) -> void:
	_toast_t -= delta
	if riding:
		ride_t += delta
		angle = _start_angle - TAU * clampf(ride_t / LAP_S, 0.0, 1.0)
		_lbl.text = "КОЛЕСО ОБОЗРЕНИЯ · высота %d м · %d%%" % [int((_gondolas[_ride_g].global_position.y - global_position.y)), int(ride_t / LAP_S * 100.0)]
		if _cam:
			_cam.rotation = Vector3(_pitch, _yaw, -_gondolas[_ride_g].rotation.z)
		if ride_t >= LAP_S:
			_end_ride()
	else:
		angle -= IDLE_SPEED * delta
	_wheel.rotation.z = angle
	_place_gondolas(delta)
	if _toast_t > 0.0 and not riding:
		_lbl.visible = true
		_ui.visible = true
	elif not riding:
		_ui.visible = false
	# rim and roof lamps brighter at night
	_night_t -= delta
	if _night_t <= 0.0:
		_night_t = 1.0
		var h := 12.0
		for t in get_tree().get_nodes_in_group(&"time_of_day"):
			h = float(t.get("hour"))
			break
		var night := clampf(minf(h - 18.5, 30.0 - h) if h > 12.0 else 6.5 - h, 0.0, 1.0)
		_lights.emission_energy_multiplier = lerpf(0.6, 4.0, night)


func _input(event: InputEvent) -> void:
	if not riding:
		return
	var rel := Vector2.ZERO
	if event is InputEventScreenDrag:
		rel = (event as InputEventScreenDrag).relative
	elif event is InputEventMouseMotion and ((event as InputEventMouseMotion).button_mask & MOUSE_BUTTON_MASK_LEFT) != 0:
		rel = (event as InputEventMouseMotion).relative
	if rel != Vector2.ZERO:
		_yaw -= rel.x * 0.005
		_pitch = clampf(_pitch - rel.y * 0.005, -1.1, 0.6)
		get_viewport().set_input_as_handled()


func _say(t: String) -> void:
	_lbl.text = t
	_toast_t = 3.0
	_ui.visible = true


func _build_ui() -> void:
	_ui = CanvasLayer.new()
	_ui.layer = 18
	add_child(_ui)
	_lbl = Label.new()
	_lbl.add_theme_font_override("font", load("res://assets/fonts/game_font.tres"))
	_lbl.add_theme_font_size_override("font_size", 28)
	_lbl.add_theme_color_override("font_color", Color(1.0, 0.9, 0.45))
	_lbl.add_theme_color_override("font_outline_color", Color.BLACK)
	_lbl.add_theme_constant_override("outline_size", 8)
	_lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_lbl.set_anchors_preset(Control.PRESET_TOP_WIDE)
	_lbl.position.y = 110
	_ui.add_child(_lbl)
	_ui.visible = false
