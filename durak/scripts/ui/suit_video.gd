class_name SuitVideo
extends VideoStreamPlayer
## Анимация мастей — исходное видео (assets/video/suits.ogv), зацикленное.
## Фон видео совпадает с фоном игры (UI.BG), поэтому края не видны.

const STREAM := preload("res://assets/video/suits.ogv")

static var _edge_material: ShaderMaterial


## Края кадра плавно растворяются в фоне, чтобы не было видно границы видео.
static func edge_material() -> ShaderMaterial:
	if _edge_material == null:
		var sh := Shader.new()
		sh.code = """
shader_type canvas_item;
void fragment() {
	vec4 c = texture(TEXTURE, UV);
	vec2 d = min(UV, vec2(1.0) - UV);
	COLOR = vec4(c.rgb, c.a * smoothstep(0.0, 0.14, min(d.x, d.y)));
}
"""
		_edge_material = ShaderMaterial.new()
		_edge_material.shader = sh
	return _edge_material


func _init(sz: float = 220.0) -> void:
	stream = STREAM
	loop = true
	autoplay = true
	expand = true
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	material = edge_material()
	set_box(sz)


## Масть в кадре занимает примерно 40% ширины — подбираем размер под нужный.
func set_box(sz: float) -> void:
	custom_minimum_size = Vector2(sz, sz) * 2.2
	size = custom_minimum_size


func _ready() -> void:
	play()
	visibility_changed.connect(func() -> void:
		if is_visible_in_tree():
			if not is_playing():
				play()
		else:
			stop())
