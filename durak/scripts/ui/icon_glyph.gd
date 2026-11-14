class_name IconGlyph
extends Control
## Простые векторные значки (не зависят от шрифтов): close, back, sound_on, sound_off.

var kind := "close":
	set(v):
		kind = v
		queue_redraw()
var color := UI.TEXT


func _init(k: String = "close") -> void:
	kind = k
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)


func _draw() -> void:
	var c := size / 2.0
	var r := minf(size.x, size.y) * 0.18
	var w := 3.0
	match kind:
		"close":
			draw_line(c + Vector2(-r, -r), c + Vector2(r, r), color, w, true)
			draw_line(c + Vector2(-r, r), c + Vector2(r, -r), color, w, true)
		"back":
			draw_line(c + Vector2(-r * 1.2, 0), c + Vector2(r * 1.2, 0), color, w, true)
			draw_polyline(PackedVector2Array([c + Vector2(-r * 0.3, -r), c + Vector2(-r * 1.2, 0), c + Vector2(-r * 0.3, r)]), color, w, true)
		"sound_on", "sound_off":
			var body := PackedVector2Array([c + Vector2(-r * 1.3, -r * 0.45), c + Vector2(-r * 0.6, -r * 0.45),
				c + Vector2(r * 0.2, -r * 1.1), c + Vector2(r * 0.2, r * 1.1), c + Vector2(-r * 0.6, r * 0.45), c + Vector2(-r * 1.3, r * 0.45)])
			draw_colored_polygon(body, color)
			if kind == "sound_on":
				draw_arc(c + Vector2(r * 0.2, 0), r * 0.75, -0.9, 0.9, 16, color, w, true)
				draw_arc(c + Vector2(r * 0.2, 0), r * 1.35, -0.9, 0.9, 16, color, w, true)
			else:
				draw_line(c + Vector2(r * 0.6, -r * 0.5), c + Vector2(r * 1.5, r * 0.5), color, w, true)
				draw_line(c + Vector2(r * 0.6, r * 0.5), c + Vector2(r * 1.5, -r * 0.5), color, w, true)
