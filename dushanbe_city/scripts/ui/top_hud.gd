class_name TopHud
extends Control
## Top of the screen in the style of the owner's mock-ups (HudStyle):
##   top-right : money in somoni (big, green), under it - while driving - two bars: the vehicle's
##               condition (red) and its fuel (white), then the weapon slot (fists: the only weapon)
##   top-left, right of the minimap: the logo «Dushanbe-X»
## The money / job labels of the jobs move here (LakLak, bus: one line under the logo).

var session: CarSession


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	set_anchors_preset(Control.PRESET_FULL_RECT)


func _process(_d: float) -> void:
	var vs := get_viewport_rect().size
	if size != vs:
		position = Vector2.ZERO
		size = vs
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
	var hp := 1.0
	var fuel := 1.0
	if session and session.driving and session.car:
		hp = session.car.health / 100.0
		fuel = session.car.fuel_l / maxf(session.car.tank_l, 1.0)
	_bar(Rect2(right - bw, 0.8 * u, bw, 0.2 * u), hp, Color(0.86, 0.1, 0.1))
	_bar(Rect2(right - bw, 1.1 * u, bw, 0.2 * u), fuel, Color(0.97, 0.97, 0.97))



func _bar(rc: Rect2, v: float, col: Color) -> void:
	draw_rect(rc.grow(3.0), Color(0.03, 0.03, 0.04, 0.9))
	draw_rect(rc, Color(0.25, 0.25, 0.27, 0.85))
	draw_rect(Rect2(rc.position, Vector2(rc.size.x * clampf(v, 0.0, 1.0), rc.size.y)), col)


## «Dushanbe-X» (HudStyle.logo)
func _logo(p: Vector2, u: float) -> void:
	HudStyle.logo(self, p, u)
