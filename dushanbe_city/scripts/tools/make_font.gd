extends SceneTree
## builds res://assets/fonts/game_font.tres: Montserrat Bold (Cyrillic + Tajik) with DejaVu Sans Bold as
## the fallback for symbols (★ ♪ ⛽ ...)
func _init() -> void:
	var fv := FontVariation.new()
	var base: FontFile = load("res://assets/fonts/Montserrat-Bold.ttf")
	var fb: FontFile = load("res://assets/fonts/DejaVuSans-Bold.ttf")
	fv.fallbacks = [fb]
	fv.base_font = base
	print(ResourceSaver.save(fv, "res://assets/fonts/game_font.tres"))
	quit()
