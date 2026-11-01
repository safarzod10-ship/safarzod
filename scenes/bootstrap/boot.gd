extends Control
## Boot scene: verifies core systems, then loads the diagnostics scene.

const NEXT_SCENE := "res://scenes/world/dushanbe_environment.tscn"

@onready var _status: Label = $Center/VBox/Status
@onready var _bar: ProgressBar = $Center/VBox/Progress


func _ready() -> void:
	GameManager.set_state(GameManager.State.LOADING)
	var problems := PackedStringArray()
	if not AssetRegistry.load_error.is_empty():
		problems.append(AssetRegistry.load_error)
	var paths := AssetRegistry.validate_paths()
	for id: String in paths:
		if paths[id] != "ok":
			problems.append("%s: %s" % [id, paths[id]])
	for p in problems:
		GameManager.report_error("Boot: " + p)
	print("DUSHANBE boot: renderer=%s quality=%s assets=%d problems=%d" % [
		SettingsManager.active_rendering_method(), SettingsManager.quality_name(), paths.size(), problems.size()])
	_status.text = "Загрузка…" if problems.is_empty() else "Предупреждения: %d (см. журнал)" % problems.size()
	SceneLoader.progress_changed.connect(_on_progress)
	SceneLoader.load_failed.connect(_on_load_failed)
	SceneLoader.change_scene(NEXT_SCENE)


func _on_progress(_path: String, value: float) -> void:
	_bar.value = value * 100.0


func _on_load_failed(path: String, reason: String) -> void:
	_status.text = "Ошибка загрузки %s: %s" % [path, reason]
