class_name AvatarView
extends Control
## Круглая аватарка: фото или инициалы на цветном круге, с кольцом-статусом.

const TONES := [Color("3d5a4a"), Color("5a4a3d"), Color("4a4f66"), Color("6b4a55"), Color("566b4a"), Color("4a6466"), Color("6b5d3a")]

var texture: Texture2D:
	set(v):
		texture = v
		queue_redraw()
var display_name := "":
	set(v):
		display_name = v
		queue_redraw()
var ring := Color(0, 0, 0, 0):
	set(v):
		ring = v
		queue_redraw()
var dim := false:
	set(v):
		dim = v
		queue_redraw()


func _init(d: float = 96.0) -> void:
	custom_minimum_size = Vector2(d, d)
	size = Vector2(d, d)
	pivot_offset = size / 2.0
	mouse_filter = Control.MOUSE_FILTER_IGNORE


func _draw() -> void:
	var d := minf(size.x, size.y)
	var c := size / 2.0
	var r := d / 2.0 - 5.0
	var mod := Color(1, 1, 1, 0.45 if dim else 1.0)
	if texture != null:
		var pts := PackedVector2Array()
		var uvs := PackedVector2Array()
		for i in 64:
			var a := TAU * i / 64.0
			var v := Vector2(cos(a), sin(a))
			pts.append(c + v * r)
			uvs.append(Vector2(0.5, 0.5) + v * 0.5)
		draw_colored_polygon(pts, mod, uvs, texture)
		draw_arc(c, r, 0, TAU, 64, Color(UI.BG, 0.6), 1.5, true)
	else:
		var tone: Color = TONES[abs(display_name.hash()) % TONES.size()]
		draw_circle(c, r, Color(tone, mod.a), true, -1.0, true)
		var ini := display_name.strip_edges().left(1).to_upper()
		var f := UI.font(true, 600)
		var fs := int(d * 0.38)
		var ts := f.get_string_size(ini, HORIZONTAL_ALIGNMENT_LEFT, -1, fs)
		draw_string(f, Vector2(c.x - ts.x / 2.0, c.y + fs * 0.36), ini, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, Color(UI.PAPER, 0.92 * mod.a))
	if ring.a > 0.0:
		draw_arc(c, r + 3.0, 0, TAU, 72, ring, 4.0, true)
