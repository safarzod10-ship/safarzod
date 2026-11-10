class_name WorldMapScreen
extends CanvasLayer
## Full-screen map of the whole game world («КАРТА» button, key M): the open world (tools/world:
## relief, rivers, lakes, roads by class, buildings) + the peninsula (the old minimap image) at their
## real positions, names of regions, villages, landmarks, fuel stations, and the player / car.
## Drag (finger or mouse) to pan, pinch / wheel to zoom; the map follows the real coordinates, so the
## marker moves along the road the player drives on.
## Tap a place (a vehicle, a job, a landmark, a station, a village or any spot): a marker is set
## there and the navigator (RoadNav) draws the route along the roads - on this map and on the
## minimap; the card shows the name and the length of the route, «ПОЕХАЛИ» closes the map,
## «УБРАТЬ МЕТКУ» clears it. No teleport: you drive / walk there.

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
	_btn.visible = false               # the map opens with a tap on the round minimap
	add_to_group(&"world_map")
	_root = Control.new()
	_root.set_anchors_preset(Control.PRESET_FULL_RECT)
	_root.visible = false
	_root.mouse_filter = Control.MOUSE_FILTER_STOP
	_root.add_to_group(TouchBlock.GROUP)          # the driving / walking touch controls stay off
	add_child(_root)
	var bg := ColorRect.new()
	bg.color = Color(0.08, 0.3, 0.55)
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
	_build_card()
	get_viewport().size_changed.connect(_layout)
	_layout()


func _layout() -> void:
	var vs := get_viewport().get_visible_rect().size
	_btn.position = Vector2(vs.x - 260, 12)
	_btn.size = Vector2(110, 48)


func toggle() -> void:
	_open = not _open
	_root.visible = _open
	_card.visible = false
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
			_tap_start[event.index] = event.position
		else:
			# a short tap (no pan, one finger) on the map itself: pick the place there
			var st: Vector2 = _tap_start.get(event.index, Vector2.INF)
			if _drag.size() == 1 and st != Vector2.INF and st.distance_to(event.position) < 14.0 and not _on_gui(event.position):
				select_at(event.position)
			_tap_start.erase(event.index)
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
		if _card.visible:
			_update_card()


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
		# road names on the big roads (once per road, at the middle)
		if mpp < 5.0:
			for r in wd.roads:
				if str(r["name"]) == "" or r["cls"] in ["street", "lane"]:
					continue
				var pts: Array = r["pts"]
				var m: Array = pts[pts.size() / 2]
				_label(w2s(m[0], m[2]) + Vector2(0, 14), str(r["name"]), 13, Color(1.0, 0.95, 0.75))
		# filling stations, hospitals, schools (closer zooms)
		if mpp < 12.0:
			for f in wd.fuel:
				_badge(w2s(f["x"], f["z"]), "fuel", Color(0.1, 0.55, 0.25), 13.0)
			for sv in get_tree().get_nodes_in_group(&"auto_service"):
				for sp in (sv as AutoService).spots:
					var q: Vector3 = sp["pos"]
					_badge(w2s(q.x, q.z), "wrench", Color(0.15, 0.35, 0.75), 13.0)
			for w in wd.washes:
				_badge(w2s(float(w["ox"]), float(w["oz"])), "water", Color(0.05, 0.55, 0.85), 13.0)
		if mpp < 7.0:
			for bd in wd.buildings:
				if bd[0] == "hospital_m":
					var hp := w2s(bd[1], bd[2])
					_canvas.draw_circle(hp + Vector2(1.5, 2), 13.0, Color(0, 0, 0, 0.45))
					var ct := HudStyle.icon("cross")
					if ct:
						_canvas.draw_texture_rect(ct, Rect2(hp - Vector2(13, 13), Vector2(26, 26)), false)
				elif bd[0] == "school_m":
					_badge(w2s(bd[1], bd[2]), "school", Color(0.15, 0.4, 0.8), 13.0)
		# photo cards of the sights (zoomed out)
		pass
		# places: icon + name (tourist-map style)
		for p in wd.places:
			var sp := w2s(p["x"], p["z"])
			var kind := String(p["kind"])
			var nm := String(p["name"])
			if kind == "city":
				_place(sp + Vector2(-60, 0), "office", nm, 44)
				continue
			var ic: String = {"town": "house", "village": "house", "lake": "waves", "pass": "mountain", "resort": "house"}.get(kind, "mountain")
			if nm.contains("Водопад"):
				ic = "waterfall"
			elif nm.contains("отдыха"):
				ic = "tree"
			_place(sp, ic, nm, 26 if kind == "town" else 21)
		if mpp < 9.0:
			for lm in wd.landmarks:
				var ic2: String = {"somoni": "monument", "rudaki_park": "tree", "flag": "tree", "museum": "museum", "library": "museum",
					"palace": "museum", "opera": "museum", "navruz": "office", "mehrgon": "cart", "laklak": "box",
					"hisor_fort": "museum", "hisor_bazaar": "cart"}.get(String(lm["id"]), "museum")
				_place(w2s(lm["x"], lm["z"]), ic2, String(lm["name"]), 16)
	_place(w2s(0, -150), "anchor", "Душанбе (центр, набережная)", 21)
	# the player's vehicles and the job places (any zoom)
	for poi in pois():
		var pp0: Vector3 = poi[1]
		var ps := w2s(pp0.x, pp0.z)
		_canvas.draw_circle(ps, 12, Color(0.05, 0.05, 0.05, 0.85))
		_canvas.draw_circle(ps, 9, poi[2])
		_label(ps + Vector2(0, -24), String(poi[0]), 17, Color(1, 1, 1))
	# the navigator's route along the roads (blue, with a dark outline)
	var rt := RoadNav.route
	if rt.size() >= 2:
		var line := PackedVector2Array()
		for q in rt:
			line.append(w2s(q.x, q.z))
		_canvas.draw_polyline(line, Color(0.02, 0.1, 0.25, 0.9), 11.0, true)
		_canvas.draw_polyline(line, Color(0.2, 0.6, 1.0), 7.0, true)
	if Minimap.target != Vector3.INF:
		var tp := w2s(Minimap.target.x, Minimap.target.z)
		_canvas.draw_circle(tp, 15, Color(0.05, 0.05, 0.05, 0.85))
		_canvas.draw_circle(tp, 11, Color(1.0, 0.6, 0.1))
		_label(tp + Vector2(0, 26), "ЦЕЛЬ", 16, Color(1.0, 0.8, 0.4))
	if not _sel.is_empty() and _card.visible:
		var sp3 := w2s((_sel["pos"] as Vector3).x, (_sel["pos"] as Vector3).z)
		_canvas.draw_arc(sp3, 20, 0, TAU, 32, Color(1, 1, 1), 4.0)
		_canvas.draw_arc(sp3, 26, 0, TAU, 32, Color(0.1, 0.1, 0.1, 0.7), 3.0)
	# player / car marker
	var pp := _player_pos()
	var sp2 := w2s(pp.x, pp.z)
	_canvas.draw_circle(sp2, 13, Color(0.1, 0.1, 0.1, 0.85))
	_canvas.draw_circle(sp2, 10, Color(1.0, 0.82, 0.25))
	_overlay()


## screen-fixed decoration of the map (as in the owner's mock-up): title, flag + slogan, compass,
## legend, scale
func _overlay() -> void:
	var vs := _canvas.size
	var u := minf(vs.x, vs.y) / 10.0
	if not _nav_open:
		_legend(Vector2(14, 1.2 * u), u)
	_canvas.draw_rect(Rect2(vs.x * 0.5 - 300, vs.y - 32, 600, 28), Color(0.03, 0.05, 0.09, 0.7))
	_label(Vector2(vs.x * 0.5, vs.y - 18), "масштаб: %d м / см · нажмите на место — маршрут" % int(mpp * 38), 16, Color(1, 1, 1, 0.9))


func _legend(p: Vector2, u: float) -> void:
	var rows := [["house", "Жилые районы"], ["office", "Бизнес и офисы"], ["cart", "Рынки и магазины"], ["fuel", "АЗС"], ["wrench", "Автосервис"], ["water", "Автомойка"],
		["cross", "Больница"], ["school", "Школа"], ["tree", "Парки и зоны отдыха"], ["monument", "Достопримечательности"],
		["box", "Работа: LakLak"], ["shop", "Оружейный магазин"], ["bus", "Автобус №1"], ["anchor", "Набережная, лодки"]]
	var rh := u * 0.42
	var rc := Rect2(p, Vector2(u * 3.3, rh * rows.size() + u * 0.3))
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0.04, 0.06, 0.1, 0.82)
	sb.set_corner_radius_all(int(u * 0.18))
	sb.border_color = Color(1, 1, 1, 0.35)
	sb.set_border_width_all(2)
	_canvas.draw_style_box(sb, rc)
	for k in rows.size():
		var y := p.y + u * 0.15 + rh * (k + 0.5)
		var t := HudStyle.icon(rows[k][0])
		if t:
			_canvas.draw_texture_rect(t, Rect2(Vector2(p.x + u * 0.15, y - rh * 0.38), Vector2(rh * 0.76, rh * 0.76)), false)
		HudStyle.label_left(_canvas, rows[k][1], Vector2(p.x + u * 0.15 + rh, y + rh * 0.2), int(rh * 0.5), Color(1, 1, 1), 3)


func _compass(c: Vector2, r: float) -> void:
	_canvas.draw_circle(c, r * 0.62, Color(0.04, 0.06, 0.1, 0.55))
	_canvas.draw_arc(c, r * 0.62, 0, TAU, 48, Color(1, 1, 1, 0.8), 2.0, true)
	for k in 4:
		var d := Vector2.from_angle(-PI * 0.5 + k * PI * 0.5)
		var n := Vector2(-d.y, d.x)
		_canvas.draw_colored_polygon(PackedVector2Array([c + d * r * 0.8, c + n * r * 0.13, c - n * r * 0.13]), Color(1, 1, 1) if k == 0 else Color(0.85, 0.87, 0.9))
		_canvas.draw_colored_polygon(PackedVector2Array([c + d * r * 0.8, c + n * r * 0.13, c]), Color(0.25, 0.3, 0.38))
	for k in 4:
		var d := Vector2.from_angle(-PI * 0.5 + k * PI * 0.5)
		HudStyle.label(_canvas, ["N", "E", "S", "W"][k], c + d * r * 1.05, int(r * 0.32))


## the flag of Tajikistan: red / white / green (2:3:2), the crown and seven stars in gold
func _flag(rc: Rect2) -> void:
	_canvas.draw_rect(rc.grow(3.0), Color(0, 0, 0, 0.35))
	var h := rc.size.y
	_canvas.draw_rect(Rect2(rc.position, Vector2(rc.size.x, h * 2.0 / 7.0)), Color(0.8, 0.1, 0.13))
	_canvas.draw_rect(Rect2(rc.position + Vector2(0, h * 2.0 / 7.0), Vector2(rc.size.x, h * 3.0 / 7.0)), Color(1, 1, 1))
	_canvas.draw_rect(Rect2(rc.position + Vector2(0, h * 5.0 / 7.0), Vector2(rc.size.x, h * 2.0 / 7.0)), Color(0.0, 0.53, 0.25))
	var c := rc.get_center() + Vector2(0, h * 0.04)
	var gold := Color(0.97, 0.76, 0.0)
	var cw := h * 0.2
	_canvas.draw_colored_polygon(PackedVector2Array([c + Vector2(-cw, cw * 0.35), c + Vector2(-cw, -cw * 0.15), c + Vector2(-cw * 0.5, cw * 0.05),
		c + Vector2(0, -cw * 0.4), c + Vector2(cw * 0.5, cw * 0.05), c + Vector2(cw, -cw * 0.15), c + Vector2(cw, cw * 0.35)]), gold)
	for k in 7:
		var ang := PI + PI * (k + 0.5) / 7.0
		_canvas.draw_circle(c + Vector2(cos(ang), sin(ang) * 0.75) * h * 0.26 + Vector2(0, h * 0.02), h * 0.025, gold)


## a map icon with a soft shadow on a small coloured disc (fuel, hospital, school)
func _badge(sp: Vector2, icon_id: String, col: Color, r: float) -> void:
	_canvas.draw_circle(sp + Vector2(1.5, 2), r, Color(0, 0, 0, 0.45))
	_canvas.draw_circle(sp, r, col)
	var t := HudStyle.icon(icon_id)
	if t:
		var m := Color(0.1, 0.1, 0.12) if col.v > 0.9 else Color.WHITE
		_canvas.draw_texture_rect(t, Rect2(sp - Vector2(r, r) * 0.75, Vector2(r, r) * 1.5), false, m)


## a place of the map: white icon (dark shadow) + its name to the right, white bold outlined
func _place(sp: Vector2, icon_id: String, text: String, fs: int) -> void:
	var s := fs * 1.5
	var t := HudStyle.icon(icon_id)
	if t:
		_canvas.draw_texture_rect(t, Rect2(sp - Vector2(s, s) * 0.5 + Vector2(2, 2), Vector2(s, s)), false, Color(0, 0, 0, 0.75))
		_canvas.draw_texture_rect(t, Rect2(sp - Vector2(s, s) * 0.5, Vector2(s, s)), false)
	HudStyle.label_left(_canvas, text, sp + Vector2(s * 0.6, fs * 0.35), fs, Color(1, 1, 1), maxi(4, fs / 4))


## photo cards (in-game pictures of the sights, assets/ui/cards) pinned beside their places
const CARDS := [["iskandar", "Озеро Искандар", -3300.0, -8300.0, Vector2(-330, -200), -0.08],
	["hisor", "Крепость Гиссар", -4500.0, -2900.0, Vector2(-320, 40), -0.06],
	["romit", "Ромит", 4200.0, -2300.0, Vector2(110, 40), 0.06],
	["embankment", "Душанбе, набережная", 0.0, -150.0, Vector2(140, 20), 0.05]]
var _card_tex := {}


func _cards() -> void:
	for cd in CARDS:
		var id: String = cd[0]
		if not _card_tex.has(id):
			var p := "res://assets/ui/cards/%s.jpg" % id
			_card_tex[id] = load(p) if ResourceLoader.exists(p) else null
		var tex: Texture2D = _card_tex[id]
		if tex == null:
			continue
		var anchor := w2s(cd[2], cd[3]) + (cd[4] as Vector2)
		var w := 230.0
		var h := w * 0.62
		_canvas.draw_set_transform(anchor, float(cd[5]), Vector2.ONE)
		_canvas.draw_rect(Rect2(Vector2(-6, -6) + Vector2(4, 5), Vector2(w + 12, h + 44)), Color(0, 0, 0, 0.35))
		_canvas.draw_rect(Rect2(Vector2(-6, -6), Vector2(w + 12, h + 44)), Color(0.98, 0.97, 0.94))
		_canvas.draw_texture_rect(tex, Rect2(Vector2.ZERO, Vector2(w, h)), false)
		var f := HudStyle.font()
		var tw := f.get_string_size(String(cd[1]), HORIZONTAL_ALIGNMENT_LEFT, -1, 17).x
		_canvas.draw_string(f, Vector2((w - tw) * 0.5, h + 26), String(cd[1]), HORIZONTAL_ALIGNMENT_LEFT, -1, 17, Color(0.12, 0.12, 0.14))
		_canvas.draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)


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
	for gs in get_tree().get_nodes_in_group(&"gun_shop"):
		out.append(["Оружейный магазин", (gs as Node3D).global_position, Color(0.9, 0.2, 0.15)])
	for hh in get_tree().get_nodes_in_group(&"hero_home"):
		out.append(["Дом", (hh as HeroHome).door_point(), Color(0.3, 1.0, 0.5)])
	for am in get_tree().get_nodes_in_group(&"amid_stores"):
		for st in (am as AmidStores).stores:
			out.append(["Супермаркет АМИД", (am as AmidStores).door_point(st), Color(0.2, 1.0, 0.35)])
	for cd in get_tree().get_nodes_in_group(&"car_dealer"):
		out.append(["Автосалон", (cd as Node3D).global_position, Color(1.0, 0.8, 0.3)])
	var boats: Variant = main.get("boats")
	if boats is Array and not (boats as Array).is_empty():
		out.append(["Лодка", ((boats as Array)[0] as Node3D).global_position, Color(0.4, 0.9, 1.0)])
	return out


# ------------------------------------------------------------------------------------------ navigator
var _nav_box: VBoxContainer
var _nav_target := Vector3.INF


var _nav_open := false
var _nav_btn: Button


func _build_nav() -> void:
	var vs := get_viewport().get_visible_rect().size
	var u := minf(vs.x, vs.y) / 10.0
	_nav_btn = Button.new()
	_nav_btn.text = "НАВИГАТОР ▾"
	_nav_btn.focus_mode = Control.FOCUS_NONE
	_nav_btn.add_theme_font_size_override("font_size", 20)
	_nav_btn.position = Vector2(16, 16)
	_nav_btn.pressed.connect(func() -> void:
		_nav_open = not _nav_open
		_nav_box.visible = _nav_open
		_nav_btn.text = "НАВИГАТОР ▴" if _nav_open else "НАВИГАТОР ▾")
	_root.add_child(_nav_btn)
	_nav_box = VBoxContainer.new()
	_nav_box.position = Vector2(16, 66)
	_nav_box.visible = false
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
		var nm: String = poi[0]
		b.pressed.connect(func() -> void: select_place(nm, p))
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


# ------------------------------------------------------------------------------------------ marker card
var _tap_start := {}
var _card: PanelContainer
var _card_label: Label
var _btn_go: Button
var _btn_route: Button
var _sel := {}                       ## {"name": String, "pos": Vector3}


func _build_card() -> void:
	_card = PanelContainer.new()
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0.05, 0.07, 0.11, 0.93)
	sb.set_corner_radius_all(16)
	sb.border_color = Color(1.0, 0.75, 0.25)
	sb.set_border_width_all(3)
	sb.content_margin_left = 22
	sb.content_margin_right = 22
	sb.content_margin_top = 14
	sb.content_margin_bottom = 14
	_card.add_theme_stylebox_override("panel", sb)
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 10)
	_card.add_child(v)
	_card_label = Label.new()
	_card_label.add_theme_font_override("font", _font)
	_card_label.add_theme_font_size_override("font_size", 24)
	_card_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	v.add_child(_card_label)
	var h := HBoxContainer.new()
	h.add_theme_constant_override("separation", 14)
	h.alignment = BoxContainer.ALIGNMENT_CENTER
	v.add_child(h)
	_btn_go = _card_button("ПОЕХАЛИ", Color(0.1, 0.55, 0.25))
	_btn_go.pressed.connect(func() -> void: if _open: toggle())
	h.add_child(_btn_go)
	_btn_route = _card_button("УБРАТЬ МЕТКУ", Color(0.55, 0.18, 0.12))
	_btn_route.pressed.connect(clear_target)
	h.add_child(_btn_route)
	_card.visible = false
	_root.add_child(_card)


func _card_button(t: String, col: Color) -> Button:
	var b := Button.new()
	b.text = t
	b.focus_mode = Control.FOCUS_NONE
	b.add_theme_font_override("font", _font)
	b.add_theme_font_size_override("font_size", 28)
	b.custom_minimum_size = Vector2(250, 78)
	var sb := StyleBoxFlat.new()
	sb.bg_color = col
	sb.set_corner_radius_all(14)
	b.add_theme_stylebox_override("normal", sb)
	var sh := sb.duplicate() as StyleBoxFlat
	sh.bg_color = col.lightened(0.2)
	b.add_theme_stylebox_override("hover", sh)
	b.add_theme_stylebox_override("pressed", sh)
	return b


## is p on a visible button / the card of the map (not a tap on the map itself)
func _on_gui(p: Vector2) -> bool:
	if _card.visible and _card.get_global_rect().has_point(p):
		return true
	for b in _root.find_children("*", "BaseButton", true, false):
		if (b as Control).is_visible_in_tree() and (b as Control).get_global_rect().has_point(p):
			return true
	return false


## the place under a screen point: the nearest named thing within 40 px, else the spot itself
func select_at(sp: Vector2) -> void:
	var best := 40.0
	var nm := ""
	var pos := Vector3.INF
	var cands: Array = pois()
	for f in wd.fuel:
		cands.append(["АЗС", Vector3(float(f["x"]), float(f["y"]), float(f["z"]))])
	for lm in wd.landmarks:
		cands.append([str(lm["name"]), Vector3(float(lm["x"]), float(lm["y"]), float(lm["z"]))])
	for pl in wd.places:
		if pl["kind"] != "lake":
			cands.append([str(pl["name"]), Vector3(float(pl["x"]), 0.0, float(pl["z"]))])
	for c in cands:
		var q: Vector3 = c[1]
		var d := w2s(q.x, q.z).distance_to(sp)
		if d < best:
			best = d
			nm = c[0]
			pos = q
	if pos == Vector3.INF:
		var vs := _canvas.size
		var w := center + (sp - vs * 0.5) * mpp
		pos = Vector3(w.x, 0.0, w.y)
		nm = "Точка на карте"
	select_place(nm, pos)


func select_place(nm: String, p: Vector3) -> void:
	_sel = {"name": nm, "pos": p}
	set_target(p)
	_update_card()
	_card.visible = true
	_card.reset_size()
	var vs := _canvas.size
	_card.position = Vector2(vs.x * 0.5 - _card.size.x * 0.5, vs.y - _card.size.y - 24.0)
	_canvas.queue_redraw()


## the card text: name + the route length along the roads (straight line while it is being built)
func _update_card() -> void:
	if _sel.is_empty():
		return
	var p: Vector3 = _sel["pos"]
	var pp := _player_pos()
	var d := Vector2(p.x - pp.x, p.z - pp.z).length()
	var by_road := RoadNav.route.size() >= 2 and Minimap.target == p
	if by_road:
		d = RoadNav.length_of(RoadNav.route)
	_card_label.text = "%s\n%s %s" % [String(_sel["name"]), ("%.1f км" % (d / 1000.0)) if d >= 1000.0 else ("%d м" % int(d)), "по дорогам" if by_road else "(прямо)"]


## marker + route (the navigator follows Minimap.target)
func set_target(p: Vector3) -> void:
	Minimap.target = p
	Minimap.target_owner = self
	_nav_target = p


func clear_target() -> void:
	if Minimap.target_owner == self:
		Minimap.target = Vector3.INF
		Minimap.target_owner = null
	_nav_target = Vector3.INF
	_sel = {}
	_card.visible = false
