class_name CardArt
extends RefCounted
## Векторные масти (рисуются из SVG в текстуры с мипмапами) и общие размеры карт.

const W := 120.0
const H := 172.0
const SUIT_SVG := [
	'<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><path fill="#fff" d="M50 4C78 28 96 43 96 62 96 75 86 84 73.5 84 64.5 84 58 79.5 54 73 55 83 59 90 67 96H33C41 90 45 83 46 73 42 79.5 35.5 84 26.5 84 14 84 4 75 4 62 4 43 22 28 50 4Z"/></svg>',
	'<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><g fill="#fff"><circle cx="50" cy="27" r="20"/><circle cx="27" cy="59" r="20"/><circle cx="73" cy="59" r="20"/><circle cx="50" cy="52" r="13"/><path d="M46 58C46 76 42 88 33 96H67C58 88 54 76 54 58Z"/></g></svg>',
	'<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><path fill="#fff" d="M50 4Q67 30 88 50 67 70 50 96 33 70 12 50 33 30 50 4Z"/></svg>',
	'<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><path fill="#fff" d="M50 90C22 66 4 50 4 31 4 16 15 6 28.5 6 38 6 45 11.5 50 20 55 11.5 62 6 71.5 6 85 6 96 16 96 31 96 50 78 66 50 90Z"/></svg>'
]

static var _tex := {}


static func suit_tex(s: int, px: int = 128) -> Texture2D:
	var key := s * 10000 + px
	if _tex.has(key):
		return _tex[key]
	var img := Image.new()
	img.load_svg_from_string(SUIT_SVG[s], px / 100.0)
	img.generate_mipmaps()
	var t := ImageTexture.create_from_image(img)
	_tex[key] = t
	return t


static func suit_color(s: int) -> Color:
	return UI.CARD_RED if s >= 2 else UI.INK
