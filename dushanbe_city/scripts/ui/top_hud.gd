class_name TopHud
extends Control
## Top of the screen in the style of the owner's mock-ups (HudStyle):
##   top-right : money in somoni (big, green), under it - while driving - two bars: the vehicle's
##               condition (red) and its fuel (white), then the weapon slot (fists: the only weapon)
##   top-left of centre: the game's logo (mountains + «DUSHANBE CITY»)
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
	# weapon slot (fists)
	var box := Rect2(w - 1.75 * u, 0.25 * u, 1.45 * u, 1.45 * u)
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0.08, 0.09, 0.12, 0.75)
	sb.set_corner_radius_all(int(u * 0.22))
	sb.border_color = Color(1, 1, 1, 0.95)
	sb.set_border_width_all(int(maxf(2.0, u * 0.05)))
	draw_style_box(sb, box)
	var fist := HudStyle.icon("fist")
	if fist:
		draw_texture_rect(fist, box.grow(-u * 0.12), false)
	# money
	var mt := HudStyle.money_text(Wallet.money)
	var fs := int(u * 0.62)
	var f := HudStyle.font()
	var tw := f.get_string_size(mt, HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x
	var mx := box.position.x - 0.25 * u - tw
	draw_string_outline(f, Vector2(mx, 0.25 * u + fs * 0.92), mt, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, int(u * 0.12), Color(0.02, 0.12, 0.02))
	draw_string(f, Vector2(mx, 0.25 * u + fs * 0.92), mt, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, HudStyle.MONEY)
	# vehicle bars
	if session and session.driving and session.car:
		var car := session.car
		var bw := maxf(tw, 3.0 * u)
		var bx := box.position.x - 0.25 * u - bw
		_bar(Rect2(bx, 1.05 * u, bw, 0.24 * u), car.health / 100.0, Color(0.85, 0.12, 0.12))
		_bar(Rect2(bx, 1.4 * u, bw, 0.24 * u), car.fuel_l / maxf(car.tank_l, 1.0), Color(0.95, 0.95, 0.95))
	# logo
	_logo(Vector2(w * 0.3, 0.5 * u), u)


func _bar(rc: Rect2, v: float, col: Color) -> void:
	draw_rect(rc.grow(2.0), Color(0, 0, 0, 0.8))
	draw_rect(rc, Color(0.2, 0.2, 0.22, 0.8))
	draw_rect(Rect2(rc.position, Vector2(rc.size.x * clampf(v, 0.0, 1.0), rc.size.y)), col)


func _logo(c: Vector2, u: float) -> void:
	# snowy peaks
	var s := u * 0.55
	var base := c + Vector2(0, s * 0.9)
	var peaks := PackedVector2Array([base + Vector2(-2.2 * s, 0), base + Vector2(-1.2 * s, -0.95 * s), base + Vector2(-0.6 * s, -0.45 * s),
		base + Vector2(0.2 * s, -1.25 * s), base + Vector2(1.2 * s, -0.3 * s), base + Vector2(1.7 * s, -0.7 * s), base + Vector2(2.4 * s, 0)])
	draw_colored_polygon(peaks, Color(0.08, 0.1, 0.14))
	var snow := PackedVector2Array([base + Vector2(-1.45 * s, -0.7 * s), base + Vector2(-1.2 * s, -0.95 * s), base + Vector2(-0.95 * s, -0.7 * s),
		base + Vector2(-0.1 * s, -0.95 * s), base + Vector2(0.2 * s, -1.25 * s), base + Vector2(0.55 * s, -0.9 * s)])
	draw_polyline(snow, Color(1, 1, 1), s * 0.14, true)
	var fs := int(u * 0.5)
	var t1 := "Dushanbe"
	var t2 := " City"
	var f := HudStyle.font()
	var w1 := f.get_string_size(t1, HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x
	var w2 := f.get_string_size(t2, HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x
	var p := Vector2(c.x - (w1 + w2) * 0.5, base.y + fs * 0.85)
	draw_string_outline(f, p, t1 + t2, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, int(u * 0.14), Color(0.05, 0.05, 0.07))
	draw_string(f, p, t1, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, Color(1, 1, 1))
	draw_string(f, p + Vector2(w1, 0), t2, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, Color(0.9, 0.12, 0.12))
