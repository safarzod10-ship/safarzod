class_name HudStyle
extends RefCounted
## The game's HUD look (after the owner's mock-ups): dark translucent round buttons with a white rim
## and a white icon (assets/ui/icons/*.svg, drawn for this project), big round steering arrows,
## pedals with a dotted rubber plate, a dark rounded speed / fuel panel, green money.

const BG := Color(0.06, 0.07, 0.09, 0.72)
const BG_ON := Color(0.32, 0.34, 0.38, 0.85)
const RIM := Color(1, 1, 1, 0.92)
const MONEY := Color(0.36, 0.95, 0.32)

static var _icons := {}
static var _font: Font


static func font() -> Font:
	if _font == null:
		_font = load("res://assets/fonts/DejaVuSans-Bold.ttf") if ResourceLoader.exists("res://assets/fonts/DejaVuSans-Bold.ttf") else ThemeDB.fallback_font
	return _font


static func icon(id: String) -> Texture2D:
	if not _icons.has(id):
		var p := "res://assets/ui/icons/%s.svg" % id
		_icons[id] = load(p) if ResourceLoader.exists(p) else null
	return _icons[id]


## round button: dark disc, white rim, white icon (or text when there is no icon)
static func round_button(ci: CanvasItem, c: Vector2, r: float, icon_id: String, pressed := false, accent := Color(0, 0, 0, 0), text := "") -> void:
	ci.draw_circle(c + Vector2(0, r * 0.06), r * 1.02, Color(0, 0, 0, 0.35))          # soft shadow
	ci.draw_circle(c, r, accent if accent.a > 0.0 else (BG_ON if pressed else BG))
	ci.draw_arc(c, r - r * 0.04, 0, TAU, 64, RIM, maxf(2.0, r * 0.07), true)
	var tex := icon(icon_id) if icon_id != "" else null
	if tex:
		var s := r * 1.15
		ci.draw_texture_rect(tex, Rect2(c - Vector2(s, s) * 0.5, Vector2(s, s)), false)
	elif text != "":
		label(ci, text, c, int(r * 0.7))


## big steering arrow: a disc with a thick white chevron
static func arrow_button(ci: CanvasItem, c: Vector2, r: float, dir: int, pressed := false) -> void:
	ci.draw_circle(c + Vector2(0, r * 0.05), r * 1.02, Color(0, 0, 0, 0.35))
	ci.draw_circle(c, r, BG_ON if pressed else BG)
	ci.draw_arc(c, r - r * 0.03, 0, TAU, 72, RIM, maxf(2.5, r * 0.05), true)
	var s := r * 0.42
	var d := -float(dir)               # chevron tip towards `dir`
	var pts := PackedVector2Array([c + Vector2(d * s * 0.55, -s), c + Vector2(-d * s * 0.45, 0), c + Vector2(d * s * 0.55, s)])
	ci.draw_polyline(pts, Color(0.92, 0.92, 0.94), r * 0.24, true)


## pedal: rounded frame + light plate with a grid of rubber dots + the name under it
static func pedal(ci: CanvasItem, rc: Rect2, name: String, pressed := false) -> void:
	var sb := StyleBoxFlat.new()
	sb.bg_color = BG_ON if pressed else BG
	sb.set_corner_radius_all(int(rc.size.x * 0.22))
	sb.border_color = RIM
	sb.set_border_width_all(int(maxf(2.0, rc.size.x * 0.035)))
	sb.shadow_color = Color(0, 0, 0, 0.35)
	sb.shadow_size = 4
	ci.draw_style_box(sb, rc)
	var inner := Rect2(rc.position + rc.size * Vector2(0.12, 0.08), rc.size * Vector2(0.76, 0.66))
	var pl := StyleBoxFlat.new()
	pl.bg_color = Color(0.78, 0.79, 0.8, 0.95) if not pressed else Color(0.95, 0.95, 0.96)
	pl.set_corner_radius_all(int(rc.size.x * 0.14))
	ci.draw_style_box(pl, inner)
	var cols := 4 if inner.size.x / inner.size.y > 0.75 else 3
	var rows := maxi(3, int(round(inner.size.y / inner.size.x * cols)))
	var dr := minf(inner.size.x / cols, inner.size.y / rows) * 0.2
	for j in rows:
		for i in cols:
			var p := inner.position + Vector2((i + 0.5) * inner.size.x / cols, (j + 0.5) * inner.size.y / rows)
			ci.draw_circle(p, dr, Color(0.12, 0.13, 0.15))
	label(ci, name, Vector2(rc.get_center().x, rc.end.y - rc.size.y * 0.12), int(minf(rc.size.x * 0.15, rc.size.y * 0.11)))


## dark rounded panel
static func panel(ci: CanvasItem, rc: Rect2) -> void:
	var sb := StyleBoxFlat.new()
	sb.bg_color = Color(0.05, 0.06, 0.08, 0.78)
	sb.set_corner_radius_all(int(rc.size.y * 0.32))
	sb.border_color = Color(1, 1, 1, 0.5)
	sb.set_border_width_all(2)
	ci.draw_style_box(sb, rc)


static func label(ci: CanvasItem, t: String, c: Vector2, fs: int, col := Color.WHITE, outline := 5) -> void:
	var f := font()
	var w := f.get_string_size(t, HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x
	var p := c + Vector2(-w * 0.5, fs * 0.36)
	ci.draw_string_outline(f, p, t, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, outline, Color(0, 0, 0, 0.85))
	ci.draw_string(f, p, t, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, col)


static func label_left(ci: CanvasItem, t: String, p: Vector2, fs: int, col := Color.WHITE, outline := 5) -> void:
	var f := font()
	ci.draw_string_outline(f, p, t, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, outline, Color(0, 0, 0, 0.85))
	ci.draw_string(f, p, t, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, col)


## money in somoni, digits grouped: "250 000 смн"
static func money_text(v: int) -> String:
	return Wallet.fmt(v)


## open / close the in-game menu (the pause button)
static func toggle_menu(tree: SceneTree) -> void:
	for m in tree.get_nodes_in_group(&"game_menu"):
		m.call("toggle_menu")


## open the big map (tap on the minimap)
static func open_map(tree: SceneTree) -> void:
	for m in tree.get_nodes_in_group(&"world_map"):
		if not m.call("is_open"):
			m.call("toggle")


## light round button of the on-foot HUD (mock-up 2): light grey disc, dark rim, dark icon
static func light_button(ci: CanvasItem, c: Vector2, r: float, icon_id: String, pressed := false, accent := Color(0, 0, 0, 0)) -> void:
	ci.draw_circle(c + Vector2(0, r * 0.06), r * 1.03, Color(0, 0, 0, 0.3))
	ci.draw_circle(c, r, accent if accent.a > 0.0 else (Color(0.75, 0.76, 0.78, 0.9) if pressed else Color(0.93, 0.93, 0.95, 0.82)))
	ci.draw_arc(c, r - r * 0.04, 0, TAU, 64, Color(0.12, 0.13, 0.15, 0.95), maxf(2.5, r * 0.08), true)
	var tex := icon(icon_id)
	if tex:
		var s := r * 1.2
		# line icons (white strokes) are drawn dark; the fist / door / hand keep their own outline
		var mod := Color.WHITE if icon_id in ["fist", "door", "hand"] else Color(0.1, 0.11, 0.13)
		ci.draw_texture_rect(tex, Rect2(c - Vector2(s, s) * 0.5, Vector2(s, s)), false, mod)


static var _logo_font: FontVariation


## the game's logo «Dushanbe-X»: bold italic white, thick black outline, the X in red; snowy peaks
## behind the first letters (as in the mock-ups). p: top-left, u: size unit
static func logo(ci: CanvasItem, p: Vector2, u: float) -> void:
	if _logo_font == null:
		_logo_font = FontVariation.new()
		_logo_font.base_font = font()
		_logo_font.variation_embolden = 0.7
		_logo_font.variation_transform = Transform2D(Vector2(1, 0), Vector2(-0.25, 1), Vector2.ZERO)
	var fs := int(u * 0.62)
	var t1 := "Dushanbe-"
	var w1 := _logo_font.get_string_size(t1, HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x
	var base := p + Vector2(0, fs * 0.95)
	# peaks over the word
	var s := fs * 0.55
	var b0 := base + Vector2(fs * 0.3, -fs * 0.62)
	ci.draw_colored_polygon(PackedVector2Array([b0, b0 + Vector2(s * 0.9, -s * 0.8), b0 + Vector2(s * 1.4, -s * 0.45),
		b0 + Vector2(s * 2.2, -s * 1.1), b0 + Vector2(s * 3.3, -s * 0.2), b0 + Vector2(s * 3.6, 0)]), Color(0.06, 0.07, 0.1))
	ci.draw_polyline(PackedVector2Array([b0 + Vector2(s * 0.6, -s * 0.55), b0 + Vector2(s * 0.9, -s * 0.8), b0 + Vector2(s * 1.15, -s * 0.6)]), Color.WHITE, s * 0.16, true)
	ci.draw_polyline(PackedVector2Array([b0 + Vector2(s * 1.85, -s * 0.85), b0 + Vector2(s * 2.2, -s * 1.1), b0 + Vector2(s * 2.6, -s * 0.8)]), Color.WHITE, s * 0.16, true)
	var ol := int(u * 0.17)
	ci.draw_string_outline(_logo_font, base, t1 + "X", HORIZONTAL_ALIGNMENT_LEFT, -1, fs, ol, Color(0.03, 0.03, 0.04))
	ci.draw_string(_logo_font, base, t1, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, Color(1, 1, 1))
	ci.draw_string(_logo_font, base + Vector2(w1, 0), "X", HORIZONTAL_ALIGNMENT_LEFT, -1, fs, Color(0.92, 0.1, 0.1))
