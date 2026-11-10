class_name TopHud
extends Control
## Top of the screen in the style of the owner's mock-ups (HudStyle):
##   top-right : money in somoni (big, green), under it - while driving - two bars: the vehicle's
##               condition (red) and its fuel (white), then the weapon slot (fists: the only weapon)
##   top-left, right of the minimap: the logo «Dushanbe-X»
## The money / job labels of the jobs move here (LakLak, bus: one line under the logo).

var session: CarSession
var wheel_open := false
var _slot_area: Control          ## the weapon slot, kept off the touch controls (TouchBlock)
var _wheel_area: Control         ## the open wheel covers the screen
var _note := ""
var _note_t := 0.0


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	set_anchors_preset(Control.PRESET_FULL_RECT)
	_slot_area = Control.new()
	_slot_area.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_slot_area.add_to_group(TouchBlock.GROUP)
	add_child(_slot_area)
	_wheel_area = Control.new()
	_wheel_area.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_wheel_area.add_to_group(TouchBlock.GROUP)
	_wheel_area.visible = false
	add_child(_wheel_area)


## tap on the weapon slot (top-right) opens the weapon wheel; a tap on a weapon takes it
func _input(event: InputEvent) -> void:
	if not (event is InputEventScreenTouch and event.pressed):
		return
	var p: Vector2 = event.position
	if wheel_open:
		get_viewport().set_input_as_handled()
		for k in Weapons.LIST.size():
			var c := _wheel_slot(k)
			if p.distance_to(c) < _u() * 1.0:
				var id: String = Weapons.LIST[k]
				if Weapons.select(id):
					Wallet.save_state()
					set_wheel(false)
				else:
					_note = "%s — купите в оружейном магазине (%s)" % [Weapons.DATA[id]["name"], Wallet.fmt(int(Weapons.DATA[id]["price"]))]
					_note_t = 3.0
				return
		set_wheel(false)
	elif weapon_rect().grow(8.0).has_point(p) and not (session and session.driving):
		get_viewport().set_input_as_handled()
		set_wheel(true)


func set_wheel(on: bool) -> void:
	wheel_open = on
	_wheel_area.visible = on


func _wheel_slot(k: int) -> Vector2:
	var c := size * 0.5
	var r := _u() * 2.3
	var a := -PI * 0.5 + k * TAU / Weapons.LIST.size()
	return c + Vector2(cos(a), sin(a)) * r


func _process(_d: float) -> void:
	var vs := get_viewport_rect().size
	if size != vs:
		position = Vector2.ZERO
		size = vs
	_slot_area.position = weapon_rect().position
	_slot_area.size = weapon_rect().size
	_wheel_area.size = size
	_note_t -= _d
	queue_redraw()


func weapon_rect() -> Rect2:
	var u := _u()
	return Rect2(size.x - 1.3 * u, 0.22 * u, 1.05 * u, 1.05 * u)


func _u() -> float:
	return minf(size.x, size.y) / 10.0


func _draw() -> void:
	if size.x < 50.0 or size.y < 50.0:
		return
	var u := _u()
	var w := size.x
	# weapon slot: the current weapon (tap -> the weapon wheel)
	var box := weapon_rect()
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0.02, 0.02, 0.03, 0.45)
	sb.set_corner_radius_all(int(u * 0.14))
	sb.border_color = Color(1, 1, 1, 0.55)
	sb.set_border_width_all(2)
	draw_style_box(sb, box)
	var wi := HudStyle.icon(Weapons.icon_of(Weapons.current))
	if wi:
		draw_texture_rect(wi, box.grow(-u * 0.14), false)
	if Weapons.uses_ammo(Weapons.current):
		HudStyle.label(self, "%d" % Weapons.ammo_of(Weapons.current), box.get_center() + Vector2(0, box.size.y * 0.62), int(u * 0.22))
	# money: green, heavy dark outline (somoni)
	var mt := HudStyle.money_text(Wallet.money)
	var fs := int(u * 0.4)
	var f := HudStyle.font()
	var tw := f.get_string_size(mt, HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x
	var right := box.position.x - 0.2 * u
	var bw := maxf(tw, 2.3 * u)
	var mx := right - tw
	var my := 0.22 * u + fs * 0.85
	draw_string_outline(f, Vector2(mx, my), mt, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, int(u * 0.13), Color(0.02, 0.08, 0.02))
	draw_string(f, Vector2(mx, my), mt, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, HudStyle.MONEY)
	# two bars under the money: red / white. Driving: the vehicle's condition / fuel; on foot: full
	# (no health system for the character yet)
	# driving: the vehicle's condition / fuel; on foot: the hero's health / (white) the stronger need
	var hp := PlayerLife.health / 100.0
	var fuel := 1.0
	if session and session.driving and session.car:
		hp = session.car.health / 100.0
		fuel = session.car.fuel_l / maxf(session.car.tank_l, 1.0)
	_bar(Rect2(right - bw, 0.8 * u, bw, 0.2 * u), hp, Color(0.86, 0.1, 0.1))
	_bar(Rect2(right - bw, 1.1 * u, bw, 0.2 * u), fuel, Color(0.97, 0.97, 0.97))
	# hunger (orange) and thirst (blue), with their icons; blink when low
	var low := Engine.get_frames_drawn() % 40 < 20
	for k in 2:
		var v: float = (Food.hunger if k == 0 else Food.thirst) / 100.0
		var col: Color = Color(1.0, 0.6, 0.12) if k == 0 else Color(0.3, 0.7, 1.0)
		if v < 0.15 and low:
			col = Color(1, 0.15, 0.1)
		var y := 1.4 * u + k * 0.3 * u
		_bar(Rect2(right - bw + 0.34 * u, y, bw - 0.34 * u, 0.16 * u), v, col)
		var ic := HudStyle.icon("food" if k == 0 else "water")
		if ic:
			draw_texture_rect(ic, Rect2(Vector2(right - bw - 0.04 * u, y - 0.06 * u), Vector2(0.28, 0.28) * u), false, col)
		else:
			HudStyle.label_left(self, "Е" if k == 0 else "В", Vector2(right - bw, y + 0.14 * u), int(u * 0.2), col)
	# crosshair while a gun is out (on foot)
	if Weapons.uses_ammo(Weapons.current) and not (session and session.driving):
		var cc := size * 0.5
		for dvec: Vector2 in [Vector2(1, 0), Vector2(-1, 0), Vector2(0, 1), Vector2(0, -1)]:
			draw_line(cc + dvec * 6.0, cc + dvec * 16.0, Color(0, 0, 0, 0.6), 4.0)
			draw_line(cc + dvec * 6.0, cc + dvec * 16.0, Color(1, 1, 1, 0.95), 2.0)
	if wheel_open:
		_draw_wheel(u)
	if _note_t > 0.0:
		HudStyle.label(self, _note, Vector2(size.x * 0.5, size.y * 0.85), int(u * 0.3), Color(1, 0.85, 0.4))



func _bar(rc: Rect2, v: float, col: Color) -> void:
	draw_rect(rc.grow(3.0), Color(0.03, 0.03, 0.04, 0.9))
	draw_rect(rc, Color(0.25, 0.25, 0.27, 0.85))
	draw_rect(Rect2(rc.position, Vector2(rc.size.x * clampf(v, 0.0, 1.0), rc.size.y)), col)


## «Dushanbe-X» (HudStyle.logo)
func _logo(p: Vector2, u: float) -> void:
	HudStyle.logo(self, p, u)


func _draw_wheel(u: float) -> void:
	draw_rect(Rect2(Vector2.ZERO, size), Color(0, 0, 0, 0.45))
	var c := size * 0.5
	draw_arc(c, u * 2.3, 0, TAU, 96, Color(1, 1, 1, 0.25), u * 1.7, true)
	for k in Weapons.LIST.size():
		var id: String = Weapons.LIST[k]
		var p := _wheel_slot(k)
		var own := Weapons.has(id)
		var cur := Weapons.current == id
		draw_circle(p, u * 0.85, Color(0.95, 0.75, 0.2, 0.9) if cur else Color(0.03, 0.03, 0.05, 0.75))
		draw_arc(p, u * 0.85, 0, TAU, 48, Color(1, 1, 1, 0.8 if own else 0.3), 2.0, true)
		var t := HudStyle.icon(Weapons.icon_of(id))
		if t:
			draw_texture_rect(t, Rect2(p - Vector2(u, u) * 0.55, Vector2(u, u) * 1.1), false, Color(1, 1, 1, 1.0 if own else 0.3))
		var wname: String = Weapons.DATA[id]["name"]
		var sub := ("патр. %d" % Weapons.ammo_of(id)) if own and Weapons.uses_ammo(id) else ("" if own else Wallet.fmt(int(Weapons.DATA[id]["price"])))
		HudStyle.label(self, wname, p + Vector2(0, u * 1.12), int(u * 0.28))
		if sub != "":
			HudStyle.label(self, sub, p + Vector2(0, u * 1.45), int(u * 0.22), Color(0.8, 0.9, 1.0) if own else Color(1, 0.6, 0.5))
	HudStyle.label(self, "ОРУЖИЕ", c, int(u * 0.36))
