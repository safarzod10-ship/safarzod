class_name SuitVideo
extends VideoStreamPlayer
## Анимация мастей — исходное видео (assets/video/suits.ogv), зацикленное.
## Фон видео совпадает с фоном игры (UI.BG), поэтому края не видны.

const STREAM := preload("res://assets/video/suits.ogv")


func _init(sz: float = 220.0) -> void:
	stream = STREAM
	loop = true
	autoplay = true
	expand = true
	mouse_filter = Control.MOUSE_FILTER_IGNORE
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
