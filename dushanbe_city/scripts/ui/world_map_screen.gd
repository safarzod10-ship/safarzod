class_name WorldMapScreen
extends CanvasLayer
## Full-screen map of the whole game world («КАРТА» button, key M): the open world (tools/world:
## relief, rivers, lakes, roads by class, buildings) + the peninsula (the old minimap image) at their
## real positions, names of regions, villages, landmarks, fuel stations, and the player / car.
## Drag (finger or mouse) to pan, pinch / wheel to zoom; the map follows the real coordinates, so the
## marker moves along the road the player drives on.

var _open := false
var _root: Control
var _canvas: Control
var _btn: Button
var _world_tex: Texture2D
var _pen_tex: Texture2D
var _font: Font
var wd: WorldData
var center := Vector2(0, -3000)      ## world x, z at the screen centre
var mpp := 8.0                        ## metres per pixel
var _drag := {}
var _pinch_d := 0.0


func _ready() -> void:
	layer = 40
	wd = WorldData.get_instance()
	_font = load("res://assets/fonts/DejaVuSans-Bold.ttf") if ResourceLoader.exists("res://assets/fonts/DejaVuSans-Bold.ttf") else ThemeDB.fallback_font
	if ResourceLoader.exists("res://assets/ui/world_map.png"):
		_world_tex = load("res://assets/ui/world_map.png")
	_pen_tex = load("res://assets/ui/minimap.png")
	_btn = Button.new()
	_btn.text = "КАРТА"
	_btn.add_theme_font_size_override("font_size", 22)
	_btn.focus_mode = Control.FOCUS_NONE
	_btn.pressed.connect(toggle)
	add_child(_btn)
	_root = Control.new()
	_root.set_anchors_preset(Control.PRESET_FULL_RECT)
	_root.visible = false
	_root.mouse_filter = Control.MOUSE_FILTER_STOP
	add_child(_root)
	var bg := ColorRect.new()
	bg.color = Color(0.17, 0.38, 0.58)
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	bg.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_root.add_child(bg)
	_canvas = Control.new()
	_canvas.set_anchors_preset(Control.PRESET_FULL_RECT)
	_canvas.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_canvas.draw.connect(_draw_map)
	_root.add_child(_canvas)
	var close := Button.new()
	close.text = "✕ ЗАКРЫТЬ"
	close.add_theme_font_size_override("font_size", 24)
	close.focus_mode = Control.FOCUS_NONE
	close.pressed.connect(toggle)
	close.set_anchors_preset(Control.PRESET_TOP_RIGHT)
	close.position = Vector2(-200, 16)
	_root.add_child(close)
	get_viewport().size_changed.connect(_layout)
	_layout()


func _layout() -> void:
	var vs := get_viewport().get_visible_rect().size
	_btn.position = Vector2(vs.x - 260, 12)
	_btn.size = Vector2(110, 48)


func toggle() -> void:
	_open = not _open
	_root.visible = _open
	if _open:
		var p := _player_pos()
		center = Vector2(p.x, p.z)
		mpp = 8.0
		_refresh_nav()
		_canvas.queue_redraw()


func is_open() -> bool:
	return _open


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and not event.echo and event.physical_keycode == KEY_M:
		toggle()
		get_viewport().set_input_as_handled()


func _input(event: InputEvent) -> void:
	if not _open:
		return
	if event is InputEventScreenTouch:
		if event.pressed:
			_drag[event.index] = event.position
		else:
			_drag.erase(event.index)
			_pinch_d = 0.0
	elif event is InputEventScreenDrag:
		if _drag.size() >= 2:
			var ks := _drag.keys()
			_drag[event.index] = event.position
			var d := (_drag[ks[0]] as Vector2).distance_to(_drag[ks[1]])
			if _pinch_d > 0.0:
				mpp = clampf(mpp * _pinch_d / maxf(d, 1.0), 0.6, 20.0)
			_pinch_d = d
		else:
			center -= event.relative * mpp
			_drag[event.index] = event.position
		_canvas.queue_redraw()
	elif event is InputEventMouseMotion and Input.is_mouse_button_pressed(MOUSE_BUTTON_LEFT):
		center -= event.relative * mpp
		_canvas.queue_redraw()
	elif event is InputEventMouseButton and event.pressed:
		if event.button_index == MOUSE_BUTTON_WHEEL_UP:
			mpp = clampf(mpp / 1.2, 0.6, 20.0)
		elif event.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			mpp = clampf(mpp * 1.2, 0.6, 20.0)
		_canvas.queue_redraw()


func _process(_d: float) -> void:
	if _open:
		_canvas.queue_redraw()


func _player_pos() -> Vector3:
	if is_instance_valid(Minimap.focus):
		return Minimap.focus.global_position
	var ps := get_tree().get_nodes_in_group(&"player")
	return (ps[0] as Node3D).global_position if not ps.is_empty() else Vector3.ZERO


func w2s(x: float, z: float) -> Vector2:
	var vs := _canvas.size
	return vs * 0.5 + (Vector2(x, z) - center) / mpp


func _draw_map() -> void:
	# peninsula (old map: +-1024 m around the city centre, 1 px = 1 m)
	var a := w2s(-1024, -1024)
	var b := w2s(1024, 1024)
	_canvas.draw_texture_rect(_pen_tex, Rect2(a, b - a), false)
	if _world_tex and wd.ok:
		var wa := w2s(wd.origin.x, wd.origin.y)
		var wb := w2s(wd.origin.x + wd.size, wd.origin.y + wd.size)
		# only the part north of the seam (the peninsula map covers the south)
		var seam_frac := (wd.seam_z - wd.origin.y) / wd.size
		var src := Rect2(Vector2.ZERO, Vector2(_world_tex.get_width(), _world_tex.get_height() * seam_frac))
		var dst := Rect2(wa, Vector2(wb.x - wa.x, (wb.y - wa.y) * seam_frac))
		_canvas.draw_texture_rect_region(_world_tex, dst, src)
		# names: places, landmarks, fuel
		for p in wd.places:
			var sp := w2s(p["x"], p["z"])
			var big: bool = p["kind"] in ["city", "town"]
			var fs := 30 if big else 20
			if p["kind"] == "lake":
				fs = 22
			_label(sp, str(p["name"]), fs, Color(1, 1, 1) if p["kind"] != "lake" else Color(0.85, 0.95, 1.0))
		if mpp < 6.0:
			for lm in wd.landmarks:
				var sp := w2s(lm["x"], lm["z"])
				_canvas.draw_circle(sp, 6, Color(0.95, 0.75, 0.25))
				_label(sp + Vector2(0, -16), str(lm["name"]), 15, Color(1.0, 0.92, 0.7))
		for f in wd.fuel:
			var sp := w2s(f["x"], f["z"])
			_canvas.draw_rect(Rect2(sp - Vector2(9, 9), Vector2(18, 18)), Color(0.1, 0.5, 0.25))
			_label(sp + Vector2(0, 2), "АЗС", 12, Color.WHITE)
		# road names on the big roads (once per road, at the middle)
		if mpp < 10.0:
			for r in wd.roads:
				if str(r["name"]) == "" or r["cls"] in ["street", "lane"]:
					continue
				var pts: Array = r["pts"]
				var m: Array = pts[pts.size() / 2]
				_label(w2s(m[0], m[2]) + Vector2(0, 14), str(r["name"]), 13, Color(1.0, 0.95, 0.75))
	_label(w2s(0, -150), "Душанбе (центр, набережная)", 20, Color.WHITE)
	# always visible: the player's vehicles and the job places (any zoom)
	for poi in pois():
		var pp0: Vector3 = poi[1]
		var ps := w2s(pp0.x, pp0.z)
		_canvas.draw_circle(ps, 12, Color(0.05, 0.05, 0.05, 0.85))
		_canvas.draw_circle(ps, 9, poi[2])
		_label(ps + Vector2(0, -24), String(poi[0]), 17, Color(1, 1, 1))
	if Minimap.target != Vector3.INF:
		var tp := w2s(Minimap.target.x, Minimap.target.z)
		_canvas.draw_circle(tp, 15, Color(0.05, 0.05, 0.05, 0.85))
		_canvas.draw_circle(tp, 11, Color(1.0, 0.6, 0.1))
		_label(tp + Vector2(0, 26), "ЦЕЛЬ", 16, Color(1.0, 0.8, 0.4))
	# player / car marker + north arrow
	var pp := _player_pos()
	var sp2 := w2s(pp.x, pp.z)
	_canvas.draw_circle(sp2, 11, Color(0.1, 0.1, 0.1, 0.8))
	_canvas.draw_circle(sp2, 8, Color(1.0, 0.82, 0.25))
	var vs := _canvas.size
	_label(Vector2(vs.x * 0.5, 40), "КАРТА · масштаб %d м / см" % int(mpp * 38), 22, Color.WHITE)
	_label(Vector2(60, 60), "С ↑", 28, Color.WHITE)


func _label(p: Vector2, t: String, fs: int, col: Color) -> void:
	var w := _font.get_string_size(t, HORIZONTAL_ALIGNMENT_LEFT, -1, fs)
	_canvas.draw_string_outline(_font, p - Vector2(w.x * 0.5, -fs * 0.35), t, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, 5, Color(0, 0, 0, 0.75))
	_canvas.draw_string(_font, p - Vector2(w.x * 0.5, -fs * 0.35), t, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, col)



## [name, position, colour] of the player's vehicles and the job places
func pois() -> Array:
	var out: Array = []
	var main := get_parent()
	if main == null:
		return out
	for spec in [["car", "Land Cruiser", Color(1.0, 1.0, 1.0)], ["camry", "Toyota Camry", Color(0.9, 0.9, 0.95)],
			["lexus", "Lexus RX", Color(0.8, 0.85, 0.9)], ["van", "Фургон LakLak", Color(0.2, 0.5, 1.0)], ["bus", "Автобус №1", Color(0.25, 0.55, 1.0)]]:
		var v: Variant = main.get(spec[0])
		if v is Node3D and is_instance_valid(v):
			out.append([spec[1], (v as Node3D).global_position, spec[2]])
	var job: Variant = main.get("laklak")
	if job is LakLakJob and not (job as LakLakJob).depot.is_empty():
		out.append(["Склад LakLak (работа)", (job as LakLakJob).depot_point(Vector3.ZERO), Color(1.0, 0.75, 0.1)])
	var bj: Variant = main.get("bus_job")
	if bj is BusJob and not (bj as BusJob).stops.is_empty():
		out.append(["Конечная автобуса №1 (работа)", (bj as BusJob).office_point(), Color(0.3, 0.9, 0.4)])
	var boats: Variant = main.get("boats")
	if boats is Array and not (boats as Array).is_empty():
		out.append(["Лодка", ((boats as Array)[0] as Node3D).global_position, Color(0.4, 0.9, 1.0)])
	return out


# ------------------------------------------------------------------------------------------ navigator
var _nav_box: VBoxContainer
var _nav_target := Vector3.INF


func _build_nav() -> void:
	_nav_box = VBoxContainer.new()
	_nav_box.position = Vector2(16, 90)
	_nav_box.add_theme_constant_override("separation", 6)
	_root.add_child(_nav_box)
	var t := Label.new()
	t.text = "НАВИГАТОР — куда ехать:"
	t.add_theme_font_size_override("font_size", 20)
	t.add_theme_color_override("font_outline_color", Color.BLACK)
	t.add_theme_constant_override("outline_size", 6)
	_nav_box.add_child(t)


func _refresh_nav() -> void:
	if _nav_box == null:
		_build_nav()
	for c in _nav_box.get_children().slice(1):
		c.queue_free()
	var items := pois()
	var near := _nearest_fuel()
	if near != Vector3.INF:
		items.append(["Ближайшая АЗС", near, Color(0.2, 0.9, 0.35)])
	for poi in items:
		var b := Button.new()
		var p: Vector3 = poi[1]
		var d := Vector2(p.x - _player_pos().x, p.z - _player_pos().z).length()
		b.text = "%s · %s" % [poi[0], ("%.1f км" % (d / 1000.0)) if d >= 1000.0 else ("%d м" % int(d))]
		b.focus_mode = Control.FOCUS_NONE
		b.add_theme_font_size_override("font_size", 19)
		b.alignment = HORIZONTAL_ALIGNMENT_LEFT
		b.pressed.connect(func() -> void: navigate_to(p))
		_nav_box.add_child(b)


func _nearest_fuel() -> Vector3:
	var best := Vector3.INF
	var bd := INF
	var pp := _player_pos()
	for f in wd.fuel:
		var q := Vector3(float(f["x"]), float(f["y"]), float(f["z"]))
		var d := Vector2(q.x - pp.x, q.z - pp.z).length()
		if d < bd:
			bd = d
			best = q
	return best


## set a waypoint (orange marker / arrow on the minimap) and close the map
func navigate_to(p: Vector3) -> void:
	Minimap.target = p
	Minimap.target_owner = self
	_nav_target = p
	if _open:
		toggle()


func _physics_process(_d: float) -> void:
	# waypoint reached (or a job took over the marker): clear it
	if _nav_target != Vector3.INF:
		if Minimap.target_owner != self:
			_nav_target = Vector3.INF
		else:
			var pp := _player_pos()
			if Vector2(pp.x - _nav_target.x, pp.z - _nav_target.z).length() < 25.0:
				Minimap.target = Vector3.INF
				Minimap.target_owner = null
				_nav_target = Vector3.INF
