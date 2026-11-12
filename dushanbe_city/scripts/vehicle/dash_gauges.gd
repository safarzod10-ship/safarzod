class_name DashGauges
extends Node3D
## Working instrument cluster behind the steering wheel (every car): speedometer (0..240 km/h),
## tachometer (0..8 x1000 rpm, red zone), fuel and temperature gauges, a gear indicator and warning
## lamps (handbrake, headlights, indicators). Dial faces are drawn once (Image), needles turn with the
## car's state; the faces glow softly at night (backlight). Built at the wheel; faces the driver.

const R := 0.062                    ## dial radius (m)
static var _face_tex: Dictionary = {}

var car: VehiclePrado
var _speed_n: Node3D
var _rpm_n: Node3D
var _fuel_n: Node3D
var _temp_n: Node3D
var _gear: Label3D
var _lamps := {}
var _temp := 0.0


func setup(c: VehiclePrado) -> void:
	car = c
	var font: Font = load("res://assets/fonts/game_font.tres")
	# hood + black panel behind the dials
	var panel := MeshInstance3D.new()
	var pm := BoxMesh.new()
	pm.size = Vector3(0.36, 0.15, 0.03)
	panel.mesh = pm
	var pmat := StandardMaterial3D.new()
	pmat.albedo_color = Color(0.03, 0.03, 0.035)
	pmat.roughness = 0.6
	panel.material_override = pmat
	panel.position = Vector3(0, 0, -0.02)
	add_child(panel)
	var hood := MeshInstance3D.new()
	var hm := BoxMesh.new()
	hm.size = Vector3(0.38, 0.02, 0.08)
	hood.mesh = hm
	hood.material_override = pmat
	hood.position = Vector3(0, 0.083, 0.02)
	add_child(hood)
	_speed_n = _dial(Vector3(0.085, 0, 0), "speed", 240.0, 20.0, font, [0, 40, 80, 120, 160, 200, 240])
	_rpm_n = _dial(Vector3(-0.085, 0, 0), "rpm", 8.0, 0.5, font, [0, 1, 2, 3, 4, 5, 6, 7, 8])
	_fuel_n = _small(Vector3(0.0, -0.035, 0), "fuel")
	_temp_n = _small(Vector3(0.0, 0.035, 0), "temp")
	_gear = Label3D.new()
	_gear.font = font
	_gear.font_size = 48
	_gear.pixel_size = 0.0005
	_gear.modulate = Color(1.0, 0.75, 0.3)
	_gear.position = Vector3(0.085, -0.03, 0.004)
	_gear.outline_size = 0
	add_child(_gear)
	var lamp_defs := {"hb": [Vector3(-0.03, -0.062, 0.003), Color(1, 0.15, 0.1), "(P)"],
		"beam": [Vector3(0.0, -0.062, 0.003), Color(0.2, 0.5, 1.0), "≡D"],
		"tl": [Vector3(-0.025, 0.062, 0.003), Color(0.2, 1.0, 0.3), "◀"],
		"tr": [Vector3(0.025, 0.062, 0.003), Color(0.2, 1.0, 0.3), "▶"]}
	for k in lamp_defs:
		var d: Array = lamp_defs[k]
		var l := Label3D.new()
		l.font = font
		l.text = d[2]
		l.font_size = 40
		l.pixel_size = 0.00045
		l.modulate = d[1]
		l.outline_size = 0
		l.position = d[0]
		l.visible = false
		add_child(l)
		_lamps[k] = l


func _face(kind: String) -> Texture2D:
	if _face_tex.has(kind):
		return _face_tex[kind]
	var S := 256
	var img := Image.create(S, S, false, Image.FORMAT_RGBA8)
	img.fill(Color(0, 0, 0, 0))
	var c := Vector2(S * 0.5, S * 0.5)
	for y in S:
		for x in S:
			var d := Vector2(x, y).distance_to(c) / (S * 0.5)
			if d <= 1.0:
				var col := Color(0.02, 0.02, 0.025)
				if d > 0.94:
					col = Color(0.55, 0.56, 0.58)              # chrome ring
				img.set_pixel(x, y, col)
	# ticks over 270 degrees (from -135 to +135, 0 = up)
	var n := 48 if kind == "speed" else 40
	for i in n + 1:
		var a := deg_to_rad(-135.0 + 270.0 * float(i) / n)
		var major := i % (4 if kind == "speed" else 5) == 0
		var r0 := 0.78 if major else 0.85
		var red := kind == "rpm" and i >= int(n * 0.8)
		for t in 30:
			var r := lerpf(r0, 0.92, float(t) / 29.0) * S * 0.5
			var p := c + Vector2(sin(a), -cos(a)) * r
			for ox in [-1, 0, 1]:
				for oy in [-1, 0, 1]:
					if not major and (ox != 0 or oy != 0):
						continue
					var q := Vector2i(int(p.x) + ox, int(p.y) + oy)
					if q.x >= 0 and q.y >= 0 and q.x < S and q.y < S:
						img.set_pixelv(q, Color(1, 0.2, 0.15) if red else Color(0.95, 0.95, 0.92))
	img.generate_mipmaps()
	var tex := ImageTexture.create_from_image(img)
	_face_tex[kind] = tex
	return tex


func _dial(pos: Vector3, kind: String, vmax: float, _step: float, font: Font, nums: Array) -> Node3D:
	var root := Node3D.new()
	root.position = pos
	add_child(root)
	var q := MeshInstance3D.new()
	var qm := QuadMesh.new()
	qm.size = Vector2(R * 2.0, R * 2.0)
	q.mesh = qm
	var m := StandardMaterial3D.new()
	m.albedo_texture = _face(kind)
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED       # backlit dial, readable in any light
	q.material_override = m
	root.add_child(q)
	for v in nums:
		var a := deg_to_rad(-135.0 + 270.0 * float(v) / vmax)
		var l := Label3D.new()
		l.font = font
		l.text = str(v)
		l.font_size = 32
		l.pixel_size = 0.00042
		l.outline_size = 0
		l.modulate = Color(0.95, 0.95, 0.92)
		l.position = Vector3(sin(a), cos(a), 0) * R * 0.62 + Vector3(0, 0, 0.001)
		root.add_child(l)
	var cap := Label3D.new()
	cap.font = font
	cap.text = "км/ч" if kind == "speed" else "x1000"
	cap.font_size = 24
	cap.pixel_size = 0.00042
	cap.outline_size = 0
	cap.modulate = Color(0.7, 0.7, 0.7)
	cap.position = Vector3(0, -R * 0.35, 0.001)
	root.add_child(cap)
	return _needle(root, R * 0.85, Color(1.0, 0.35, 0.1))


func _small(pos: Vector3, kind: String) -> Node3D:
	var root := Node3D.new()
	root.position = pos
	add_child(root)
	var q := MeshInstance3D.new()
	var qm := QuadMesh.new()
	qm.size = Vector2(0.05, 0.05)
	q.mesh = qm
	var m := StandardMaterial3D.new()
	m.albedo_texture = _face("small")
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED       # backlit dial, readable in any light
	q.material_override = m
	root.add_child(q)
	var l := Label3D.new()
	l.text = "⛽" if kind == "fuel" else "°C"
	l.font_size = 22
	l.pixel_size = 0.0004
	l.outline_size = 0
	l.position = Vector3(0, -0.012, 0.001)
	root.add_child(l)
	return _needle(root, 0.02, Color(1.0, 0.35, 0.1))


func _needle(root: Node3D, ln: float, col: Color) -> Node3D:
	var pivot := Node3D.new()
	pivot.position.z = 0.002
	root.add_child(pivot)
	var nd := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = Vector3(0.0025, ln, 0.001)
	nd.mesh = bm
	var m := StandardMaterial3D.new()
	m.albedo_color = col
	m.emission_enabled = true
	m.emission = col
	m.emission_energy_multiplier = 1.5
	nd.material_override = m
	nd.position.y = ln * 0.5
	pivot.add_child(nd)
	var hub := MeshInstance3D.new()
	var cm := CylinderMesh.new()
	cm.top_radius = 0.006
	cm.bottom_radius = 0.006
	cm.height = 0.004
	hub.mesh = cm
	hub.rotation.x = PI * 0.5
	var hm := StandardMaterial3D.new()
	hm.albedo_color = Color(0.1, 0.1, 0.1)
	hub.material_override = hm
	pivot.add_child(hub)
	return pivot


func _needle_to(n: Node3D, k: float, span := 270.0) -> void:
	# k 0..1 over the dial, clockwise from -135 deg (needle up = 0); looking at the face from +Z
	n.rotation.z = -deg_to_rad(-span * 0.5 + span * clampf(k, 0.0, 1.0))


func _process(delta: float) -> void:
	if car == null:
		return
	# only worth updating when somebody can see it (driving this car)
	var cam := get_viewport().get_camera_3d()
	if cam == null or cam.global_position.distance_to(global_position) > 6.0:
		return
	var running := car.driven
	_needle_to(_speed_n, car.speed_kmh / 240.0)
	_needle_to(_rpm_n, (car.rpm if running else 0.0) / 8000.0)
	_needle_to(_fuel_n, car.fuel_l / maxf(car.tank_l, 1.0), 120.0)
	_temp = move_toward(_temp, 0.55 if running else 0.0, delta * 0.02)
	_needle_to(_temp_n, _temp, 120.0)
	_gear.text = ("R" if car.gear < 0 else ("N" if car.gear == 0 else "D%d" % car.gear)) if running else ""
	(_lamps["hb"] as Label3D).visible = car.handbrake
	var L: VehicleLights = car.lights
	if L:
		(_lamps["beam"] as Label3D).visible = L.beam != VehicleLights.Beam.OFF
		var blink := fmod(Time.get_ticks_msec() / 1000.0, 0.8) < 0.4
		(_lamps["tl"] as Label3D).visible = blink and (L.turn == -1 or L.hazard)
		(_lamps["tr"] as Label3D).visible = blink and (L.turn == 1 or L.hazard)
