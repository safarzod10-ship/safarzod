extends Node
## AssetRegistry — documented inventory of game assets (source, licence,
## expected technical characteristics). Data lives in assets/asset_registry.json
## and mirrors docs/ASSET_REGISTRY.md.

const REGISTRY_PATH := "res://assets/asset_registry.json"

var assets: Dictionary = {}
var load_error: String = ""


func _ready() -> void:
	reload()


func reload() -> bool:
	assets.clear()
	load_error = ""
	if not FileAccess.file_exists(REGISTRY_PATH):
		load_error = "registry file missing: " + REGISTRY_PATH
		push_error("AssetRegistry: " + load_error)
		return false
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(REGISTRY_PATH))
	if typeof(parsed) != TYPE_DICTIONARY or typeof(parsed.get("assets")) != TYPE_DICTIONARY:
		load_error = "registry JSON is invalid"
		push_error("AssetRegistry: " + load_error)
		return false
	assets = parsed["assets"]
	return true


func has_asset(id: String) -> bool:
	return assets.has(id)


func get_info(id: String) -> Dictionary:
	return assets.get(id, {})


func get_path_for(id: String) -> String:
	return String(get_info(id).get("path", ""))


func ids_in_category(category: String) -> PackedStringArray:
	var out := PackedStringArray()
	for id: String in assets:
		if assets[id].get("category", "") == category:
			out.append(id)
	return out


## Checks that every registered resource exists and is loadable by Godot.
## Returns {id: "ok" | error text}.
func validate_paths() -> Dictionary:
	var result := {}
	for id: String in assets:
		var path := get_path_for(id)
		if path.is_empty():
			result[id] = "no path"
		elif not ResourceLoader.exists(path):
			result[id] = "missing or not imported: " + path
		else:
			result[id] = "ok"
	return result
