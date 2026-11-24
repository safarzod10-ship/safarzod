class_name CharacterCatalog
extends RefCounted
## Playable / enemy characters. All use Mixamo-compatible skeletons; the shared
## animation pack is retargeted at load (AnimRetarget).

const CHARACTERS: Array[Dictionary] = [
	{
		"id": "swat", "name": "Спецназ", "desc": "Штурмовик: шлем, ПНВ, бронежилет",
		"scene": "res://assets/characters/swat/swat.glb",
		"hide": ["part_2_low_101", "Circle_102", "Plane_103"],
	},
	{
		"id": "soldier", "name": "Солдат", "desc": "Пехотинец в цифровом камуфляже",
		"scene": "res://assets/characters/soldier/soldier.glb", "hide": [],
	},
	{
		"id": "frank", "name": "Сержант", "desc": "Тяжёлый боец, кепи и перчатки",
		"scene": "res://assets/characters/frank/frank.glb", "hide": [],
	},
]


static func get_def(id: String) -> Dictionary:
	for c in CHARACTERS:
		if c["id"] == id:
			return c
	return CHARACTERS[0]


static func index_of(id: String) -> int:
	for i in CHARACTERS.size():
		if CHARACTERS[i]["id"] == id:
			return i
	return 0
