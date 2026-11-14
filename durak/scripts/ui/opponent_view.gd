class_name OpponentView
extends Control
## Соперник: веер рубашек, аватар, имя, число карт и статус.

const AV := 92.0

var avatar: AvatarView
var name_label: Label
var status_label: Label
var count := 0
var _badge_text := ""


func _init() -> void:
	size = Vector2(160, 210)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	avatar = AvatarView.new(AV)
	avatar.position = Vector2((size.x - AV) / 2.0, 46)
	add_child(avatar)
	name_label = UI.label("", 22, UI.TEXT, false, 700)
	name_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	name_label.position = Vector2(0, 46 + AV + 6)
	name_label.size = Vector2(size.x, 30)
	name_label.clip_text = true
	add_child(name_label)
	status_label = UI.label("", 17, UI.MUTED, false, 800)
	status_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	status_label.position = Vector2(0, 46 + AV + 36)
	status_label.size = Vector2(size.x, 24)
	add_child(status_label)


func center() -> Vector2:
	return position + avatar.position + avatar.size / 2.0


func set_info(nm: String, tex: Texture2D, cards: int, status: String, ring: Color, is_out: bool) -> void:
	name_label.text = nm
	avatar.display_name = nm
	avatar.texture = tex
	avatar.ring = ring
	avatar.dim = is_out
	status_label.text = status.to_upper()
	status_label.add_theme_color_override("font_color", UI.ACCENT if status == "берёт" else (UI.GOLD if is_out else UI.MUTED))
	if cards != count:
		count = cards
		queue_redraw()


func bump() -> void:
	var t := create_tween()
	avatar.scale = Vector2(1.12, 1.12)
	t.tween_property(avatar, "scale", Vector2.ONE, 0.35).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)


func _draw() -> void:
	# Веер рубашек над аватаром.
	var shown := mini(count, 8)
	if shown > 0:
		var c := Vector2(size.x / 2.0, 70)
		var w := 30.0
		var h := 43.0
		for i in shown:
			var t := 0.0 if shown == 1 else (float(i) / (shown - 1) - 0.5)
			var ang := t * 0.9
			var xf := Transform2D(ang, c + Vector2(t * 46.0, -10.0 + absf(t) * 8.0))
			draw_set_transform_matrix(xf)
			var r := Rect2(Vector2(-w / 2.0, -h), Vector2(w, h))
			draw_style_box(UI.box(UI.BACK, 4, Color(UI.BG, 0.9), 1), r)
			draw_style_box(UI.box(Color(0, 0, 0, 0), 3, Color(UI.PAPER, 0.5), 1), r.grow(-4))
		draw_set_transform_matrix(Transform2D.IDENTITY)
	# Счётчик карт.
	if count > 0:
		var bc := Vector2(size.x / 2.0 + AV / 2.0 - 8.0, 46 + AV - 10.0)
		draw_circle(bc, 17, UI.PAPER, true, -1.0, true)
		var f := UI.font(true, 700)
		var txt := str(count)
		var ts := f.get_string_size(txt, HORIZONTAL_ALIGNMENT_LEFT, -1, 18)
		draw_string(f, bc + Vector2(-ts.x / 2.0, 7), txt, HORIZONTAL_ALIGNMENT_LEFT, -1, 18, UI.INK)
