class_name Police
extends Node
## Wanted level and police chases (GTA-style, the game's own rules):
##  crimes (CityLife.crime): hitting a pedestrian 1 star, stealing a car 2, killing 3 (+1 each more,
##  max 5). Police cars (white Mercedes with a blue stripe, «ПОЛИЦИЯ», flashing light bar, siren)
##  drive to you along the road graph (RoadNav), 1..4 of them by the stars, and ram / block you.
##  BUSTED: stopped (< 3 km/h) or on foot with a police car within 6 m for 2.5 s -> «ЗАДЕРЖАН», a fine
##  (300 smn per star), you are released at the police station. ESCAPE: no police car within 130 m
##  for 10 + 4 x stars s -> the stars go out.

signal stars_changed(n: int)

const MODEL := "res://assets/models/cars/w123.glb"
const SIREN := "res://assets/audio/vehicle/siren.wav"
const FINE := 300

static var stars := 0
var session: CarSession
var nav: RoadNav
var enabled := true
var cops: Array = []           ## {node, body, path: PackedVector3Array, idx, v, repath, lights: [MeshInstance3D x2], omni}
var _calm := 0.0               ## seconds without a police car near
var _bust := 0.0
var _t := 0.0
var _ui: CanvasLayer
var _stars_lbl: Label
var _msg: Label
var _msg_t := 0.0
var _scene: PackedScene
var _rng := RandomNumberGenerator.new()


func _ready() -> void:
	_rng.randomize()
	_build_ui()
	if ResourceLoader.exists(MODEL):
		_scene = load(MODEL)
	await get_tree().process_frame
	if CityLife.instance:
		CityLife.instance.crime.connect(_on_crime)


func _on_crime(level: int, _at: Vector3) -> void:
	if not enabled:
		return
	var n := stars
	if level >= 3:
		n = maxi(stars + 1, 3)
	else:
		n = maxi(stars, level)
	set_stars(n)


func set_stars(n: int) -> void:
	n = clampi(n, 0, 5)
	if n == stars:
		if n > 0:
			_calm = 0.0
		return
	var up := n > stars
	stars = n
	_calm = 0.0
	stars_changed.emit(stars)
	if n == 0:
		_clear_cops()
		_say("Розыск снят")
	elif up:
		_say("РОЗЫСК: " + "★".repeat(n))


func _target() -> Node3D:
	if session == null:
		return null
	return session.car if session.driving and session.car else session.player as Node3D


func _process(delta: float) -> void:
	_msg_t -= delta
	_msg.visible = _msg_t > 0.0
	_stars_lbl.visible = stars > 0
	if stars > 0:
		var flash := _calm < 1.0 or fmod(Time.get_ticks_msec() / 1000.0, 0.8) < 0.5
		_stars_lbl.text = "★".repeat(stars) + "☆".repeat(5 - stars)
		_stars_lbl.modulate = Color(1, 1, 1, 1.0 if flash else 0.35)
	if stars == 0 or not enabled:
		return
	var tg := _target()
	if tg == null:
		return
	var tp := tg.global_position
	# keep the right number of police cars round the player
	_t -= delta
	if _t <= 0.0:
		_t = 1.0
		var want := mini(stars, 3) + (1 if stars >= 4 else 0)
		for c in cops.duplicate():
			if (c["node"] as Node3D).global_position.distance_to(tp) > 600.0:
				_free_cop(c)
		if cops.size() < want:
			_spawn_cop(tp)
	var near := INF
	for c in cops:
		_drive_cop(c, tp, delta)
		near = minf(near, (c["node"] as Node3D).global_position.distance_to(tp))
	# escape
	if near > 130.0:
		_calm += delta
		if _calm > 10.0 + 4.0 * stars:
			set_stars(0)
			return
	else:
		_calm = 0.0
	# busted
	var still := (session.driving and session.car.speed_kmh < 3.0) or not session.driving
	if near < 6.0 and still and not PlayerLife.dead:
		_bust += delta
		if _bust > 2.5:
			_busted()
	else:
		_bust = maxf(0.0, _bust - delta)


func _spawn_cop(tp: Vector3) -> void:
	if _scene == null:
		return
	var start := Vector3.INF
	if nav and nav.ready_graph and nav.nodes.size() > 10:
		for attempt in 40:
			var q := nav.nodes[_rng.randi() % nav.nodes.size()]
			var d := Vector2(q.x - tp.x, q.z - tp.z).length()
			if d > 140.0 and d < 320.0:
				start = q
				break
	if start == Vector3.INF:
		var a := _rng.randf() * TAU
		start = tp + Vector3(sin(a), 0, cos(a)) * 200.0
		var wd := WorldData.get_instance()
		if wd:
			start.y = wd.height_at(start.x, start.z)
	var n := Node3D.new()
	n.name = "PoliceCar"
	add_child(n)
	n.global_position = start
	var model: Node3D = _scene.instantiate()
	model.rotation.y = PI
	n.add_child(model)
	for mi in model.find_children("*", "MeshInstance3D", true, false):
		(mi as MeshInstance3D).cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	# livery: blue stripe along both sides, «ПОЛИЦИЯ», light bar on the roof
	var blue := StandardMaterial3D.new()
	blue.albedo_color = Color(0.05, 0.2, 0.62)
	var font: Font = load("res://assets/fonts/DejaVuSans-Bold.ttf")
	for sx in [-1.0, 1.0]:
		var st := MeshInstance3D.new()
		var bm := BoxMesh.new()
		bm.size = Vector3(0.02, 0.16, 3.6)
		st.mesh = bm
		st.material_override = blue
		st.position = Vector3(sx * 0.91, 0.72, 0.0)
		n.add_child(st)
		var lb := Label3D.new()
		lb.text = "ПОЛИЦИЯ"
		lb.font = font
		lb.font_size = 64
		lb.pixel_size = 0.005
		lb.modulate = Color(0.05, 0.2, 0.62)
		lb.outline_size = 0
		lb.position = Vector3(sx * 0.925, 0.92, 0.2)
		lb.rotation.y = sx * PI * 0.5
		n.add_child(lb)
	var bar := MeshInstance3D.new()
	var bb := BoxMesh.new()
	bb.size = Vector3(1.1, 0.12, 0.28)
	bar.mesh = bb
	var dark := StandardMaterial3D.new()
	dark.albedo_color = Color(0.08, 0.08, 0.1)
	bar.material_override = dark
	bar.position = Vector3(0, 1.5, 0.15)
	n.add_child(bar)
	var lights: Array = []
	for k in 2:
		var lm := MeshInstance3D.new()
		var lbm := BoxMesh.new()
		lbm.size = Vector3(0.48, 0.13, 0.3)
		lm.mesh = lbm
		var em := StandardMaterial3D.new()
		em.albedo_color = Color(0.9, 0.05, 0.05) if k == 0 else Color(0.1, 0.25, 1.0)
		em.emission_enabled = true
		em.emission = em.albedo_color
		em.emission_energy_multiplier = 4.0
		lm.material_override = em
		lm.position = Vector3(-0.27 if k == 0 else 0.27, 1.52, 0.15)
		n.add_child(lm)
		lights.append(lm)
	var omni := OmniLight3D.new()
	omni.position = Vector3(0, 1.9, 0.15)
	omni.omni_range = 12.0
	omni.light_energy = 2.5
	omni.shadow_enabled = false
	n.add_child(omni)
	var body := AnimatableBody3D.new()
	body.sync_to_physics = false
	var cs := CollisionShape3D.new()
	var bx := BoxShape3D.new()
	bx.size = Vector3(1.8, 1.4, 4.8)
	cs.shape = bx
	cs.position.y = 0.8
	body.add_child(cs)
	n.add_child(body)
	var sir := AudioStreamPlayer3D.new()
	if ResourceLoader.exists(SIREN):
		sir.stream = load(SIREN)          # looped in its import settings
	sir.unit_size = 18.0
	sir.max_distance = 400.0
	sir.volume_db = -4.0
	n.add_child(sir)
	sir.play()
	cops.append({"node": n, "body": body, "path": PackedVector3Array(), "idx": 0, "v": 8.0, "repath": 0.0,
			"lights": lights, "omni": omni})


func _drive_cop(c: Dictionary, tp: Vector3, delta: float) -> void:
	var n: Node3D = c["node"]
	var pos := n.global_position
	c["repath"] = float(c["repath"]) - delta
	if float(c["repath"]) <= 0.0 and nav and nav.ready_graph:
		c["repath"] = 1.5
		c["path"] = nav.find_path(pos, tp)
		c["idx"] = 0
	var path: PackedVector3Array = c["path"]
	var goal := tp
	var direct := pos.distance_to(tp) < 30.0 or path.size() < 2
	if not direct:
		var idx: int = c["idx"]
		while idx < path.size() - 1 and Vector2(path[idx].x - pos.x, path[idx].z - pos.z).length() < 8.0:
			idx += 1
		c["idx"] = idx
		goal = path[idx]
	var to := goal - pos
	to.y = 0.0
	var dist := pos.distance_to(tp)
	var vmax := (75.0 if stars < 2 else 105.0) / 3.6
	var want := vmax
	if dist < 12.0:
		want = maxf(0.0, (dist - 5.0) * 1.5)          # pull up next to the player
	c["v"] = move_toward(float(c["v"]), want, delta * (6.0 if want > float(c["v"]) else 12.0))
	if to.length() > 0.2:
		var dir := to.normalized()
		var fwd := -n.global_basis.z
		var cur := atan2(-fwd.x, -fwd.z)
		var tgt := atan2(-dir.x, -dir.z)
		var yaw := lerp_angle(cur, tgt, clampf(delta * 3.0, 0.0, 1.0))
		var step := -Vector3(sin(yaw), 0, cos(yaw)) * float(c["v"]) * delta
		var np := pos + step
		var y := goal.y if not direct else tp.y
		var wd := WorldData.get_instance()
		if wd:
			y = maxf(wd.height_at(np.x, np.z), y - 1.0) if direct else y
		np.y = lerpf(pos.y, y + 0.05, clampf(delta * 6.0, 0.0, 1.0))
		n.global_transform = Transform3D(Basis(Vector3.UP, yaw), np)
	# light bar: alternate red / blue
	var ph := fmod(Time.get_ticks_msec() / 1000.0, 0.5) < 0.25
	var ls: Array = c["lights"]
	(ls[0] as MeshInstance3D).visible = ph
	(ls[1] as MeshInstance3D).visible = not ph
	(c["omni"] as OmniLight3D).light_color = Color(1, 0.1, 0.1) if ph else Color(0.2, 0.3, 1)


func _busted() -> void:
	_bust = 0.0
	var fine := mini(Wallet.money, FINE * stars)
	Wallet.money -= fine
	var n := stars
	stars = 0
	stars_changed.emit(0)
	_clear_cops()
	if session and session.driving:
		var v := session.car
		v.linear_velocity = Vector3.ZERO
		session.exit()
	# released at the police station
	var pp: Node = get_tree().root.find_child("PhotoPlaces", true, false)
	if pp and session and session.player:
		for site in (pp as PhotoPlaces).sites:
			if site["id"] == "police":
				var xf: Transform3D = site["xf"]
				session.player.teleport(xf * Vector3(0, 0.4, 30), xf.basis.get_euler().y)
	Wallet.save_state()
	_say("ЗАДЕРЖАН!  " + "★".repeat(n) + "\nШтраф %s" % Wallet.fmt(fine))


func _clear_cops() -> void:
	for c in cops.duplicate():
		_free_cop(c)


func _free_cop(c: Dictionary) -> void:
	(c["node"] as Node).queue_free()
	cops.erase(c)


func _say(t: String) -> void:
	_msg.text = t
	_msg_t = 3.5


func _build_ui() -> void:
	_ui = CanvasLayer.new()
	_ui.layer = 19
	add_child(_ui)
	var font: Font = load("res://assets/fonts/DejaVuSans-Bold.ttf")
	_stars_lbl = Label.new()
	_stars_lbl.add_theme_font_override("font", font)
	_stars_lbl.add_theme_font_size_override("font_size", 40)
	_stars_lbl.add_theme_color_override("font_color", Color(1.0, 0.85, 0.2))
	_stars_lbl.add_theme_color_override("font_outline_color", Color.BLACK)
	_stars_lbl.add_theme_constant_override("outline_size", 8)
	_stars_lbl.set_anchors_preset(Control.PRESET_CENTER_TOP)
	_stars_lbl.position = Vector2(-120, 12)
	_stars_lbl.size = Vector2(240, 50)
	_stars_lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_stars_lbl.visible = false
	_ui.add_child(_stars_lbl)
	_msg = Label.new()
	_msg.add_theme_font_override("font", font)
	_msg.add_theme_font_size_override("font_size", 46)
	_msg.add_theme_color_override("font_color", Color(1.0, 0.3, 0.25))
	_msg.add_theme_color_override("font_outline_color", Color.BLACK)
	_msg.add_theme_constant_override("outline_size", 10)
	_msg.set_anchors_preset(Control.PRESET_CENTER)
	_msg.offset_left = -500
	_msg.offset_right = 500
	_msg.offset_top = -40
	_msg.offset_bottom = 80
	_msg.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_msg.visible = false
	_ui.add_child(_msg)
