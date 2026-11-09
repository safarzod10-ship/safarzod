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


func _u() -> float:
	return minf(size.x, size.y) / 10.0


func _draw() -> void:
	if size.x < 50.0 or size.y < 50.0:
		return
	var u := _u()
	var w := size.x
	# weapon slot (fists): white rounded square, dark frame, the fist inside
	var box := Rect2(w - 1.5 * u, 0.22 * u, 1.25 * u, 1.25 * u)
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0.93, 0.94, 0.96, 0.95)
	sb.set_corner_radius_all(int(u * 0.18))
	sb.border_color = Color(0.08, 0.09, 0.11)
	sb.set_border_width_all(int(maxf(3.0, u * 0.07)))
	draw_style_box(sb, box)
	var fist := HudStyle.icon("fist")
	if fist:
		draw_texture_rect(fist, box.grow(-u * 0.1), false)
	# money: green, heavy dark outline (somoni)
	var mt := HudStyle.money_text(Wallet.money)
	var fs := int(u * 0.46)
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
	# logo right of the minimap
	var d := clampf(minf(size.x, size.y) * 0.22, 150.0, 320.0)
	_logo(Vector2(16.0 + d + 0.3 * u, 0.3 * u), u)


func _bar(rc: Rect2, v: float, col: Color) -> void:
	draw_rect(rc.grow(3.0), Color(0.03, 0.03, 0.04, 0.9))
	draw_rect(rc, Color(0.25, 0.25, 0.27, 0.85))
	draw_rect(Rect2(rc.position, Vector2(rc.size.x * clampf(v, 0.0, 1.0), rc.size.y)), col)


## «Dushanbe-X» (HudStyle.logo)
func _logo(p: Vector2, u: float) -> void:
	HudStyle.logo(self, p, u)
