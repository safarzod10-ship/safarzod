extends Node
## SaveManager — persistent storage for settings and (future) game progress.
##
## * Settings: ConfigFile at user://settings.cfg.
## * Progress: JSON slots at user://saves/slot_<n>.json with a format version.
## All writes are atomic: data goes to a temporary file, which is then renamed
## over the target, so a crash mid-write never corrupts the previous save.

const SETTINGS_PATH := "user://settings.cfg"
const SAVE_DIR := "user://saves"
const SAVE_FORMAT_VERSION := 1

signal save_failed(path: String, error: Error)


func load_settings() -> ConfigFile:
	var cfg := ConfigFile.new()
	if FileAccess.file_exists(SETTINGS_PATH):
		var err := cfg.load(SETTINGS_PATH)
		if err != OK:
			push_warning("SaveManager: settings file unreadable (%s), using defaults" % error_string(err))
			cfg = ConfigFile.new()
	return cfg


func save_settings(cfg: ConfigFile) -> Error:
	return _atomic_write(SETTINGS_PATH, cfg.encode_to_text())


func save_slot(slot: int, data: Dictionary) -> Error:
	DirAccess.make_dir_recursive_absolute(SAVE_DIR)
	var payload := {
		"format_version": SAVE_FORMAT_VERSION,
		"game_version": ProjectSettings.get_setting("application/config/version", ""),
		"saved_unix": Time.get_unix_time_from_system(),
		"data": data,
	}
	return _atomic_write(slot_path(slot), JSON.stringify(payload, "\t"))


## Returns {} when the slot is missing or corrupt.
func load_slot(slot: int) -> Dictionary:
	var path := slot_path(slot)
	if not FileAccess.file_exists(path):
		return {}
	var text := FileAccess.get_file_as_string(path)
	var parsed: Variant = JSON.parse_string(text)
	if typeof(parsed) != TYPE_DICTIONARY or not parsed.has("data"):
		push_warning("SaveManager: slot %d is corrupt" % slot)
		return {}
	if int(parsed.get("format_version", 0)) > SAVE_FORMAT_VERSION:
		push_warning("SaveManager: slot %d was written by a newer version" % slot)
		return {}
	return parsed["data"]


func delete_slot(slot: int) -> Error:
	var path := slot_path(slot)
	if not FileAccess.file_exists(path):
		return ERR_FILE_NOT_FOUND
	return DirAccess.remove_absolute(path)


func slot_path(slot: int) -> String:
	return "%s/slot_%d.json" % [SAVE_DIR, slot]


func _atomic_write(path: String, text: String) -> Error:
	var tmp := path + ".tmp"
	var f := FileAccess.open(tmp, FileAccess.WRITE)
	if f == null:
		var err := FileAccess.get_open_error()
		save_failed.emit(path, err)
		return err
	f.store_string(text)
	f.close()
	var rename_err := DirAccess.rename_absolute(tmp, path)
	if rename_err != OK:
		save_failed.emit(path, rename_err)
	return rename_err
