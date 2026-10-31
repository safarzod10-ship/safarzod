extends Node
## SceneLoader — threaded scene transitions with progress reporting.
## Designed so that city chunks can later be streamed with the same
## request/poll pattern (load_resource_async) without changing the scene.

signal progress_changed(path: String, progress: float)
signal scene_changed(path: String)
signal load_failed(path: String, reason: String)

var _pending: Dictionary = {}  # path -> {"change_scene": bool, "callback": Callable}


func change_scene(path: String) -> void:
	_request(path, true, Callable())


## Loads any resource in the background; `callback` receives the Resource.
func load_resource_async(path: String, callback: Callable) -> void:
	_request(path, false, callback)


func is_loading() -> bool:
	return not _pending.is_empty()


func _request(path: String, change_scene_after: bool, callback: Callable) -> void:
	if _pending.has(path):
		return
	if not ResourceLoader.exists(path):
		load_failed.emit(path, "resource not found")
		push_error("SceneLoader: not found " + path)
		return
	# use_sub_threads=false: with true, Godot 4.7.2 leaks ~5 RefCounted load tasks at exit (verified with --verbose).
	var err := ResourceLoader.load_threaded_request(path, "", false)
	if err != OK:
		load_failed.emit(path, error_string(err))
		return
	_pending[path] = {"change_scene": change_scene_after, "callback": callback}
	set_process(true)


func _ready() -> void:
	set_process(false)


func _process(_delta: float) -> void:
	for path: String in _pending.keys():
		var progress := []
		var status := ResourceLoader.load_threaded_get_status(path, progress)
		match status:
			ResourceLoader.THREAD_LOAD_IN_PROGRESS:
				progress_changed.emit(path, float(progress[0]) if progress.size() > 0 else 0.0)
			ResourceLoader.THREAD_LOAD_LOADED:
				var job: Dictionary = _pending[path]
				_pending.erase(path)
				var res := ResourceLoader.load_threaded_get(path)
				progress_changed.emit(path, 1.0)
				if job["change_scene"]:
					var err := get_tree().change_scene_to_packed(res as PackedScene)
					if err != OK:
						load_failed.emit(path, error_string(err))
					else:
						scene_changed.emit(path)
				elif job["callback"].is_valid():
					job["callback"].call(res)
			_:
				_pending.erase(path)
				load_failed.emit(path, "threaded load failed (status %d)" % status)
				push_error("SceneLoader: failed to load " + path)
	if _pending.is_empty():
		set_process(false)
