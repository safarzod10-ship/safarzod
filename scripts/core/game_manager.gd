extends Node
## GameManager — application lifecycle and top-level state.

signal state_changed(old_state: State, new_state: State)

enum State { BOOT, MENU, LOADING, PLAYING, PAUSED }

var state: State = State.BOOT
var boot_errors: PackedStringArray = []


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	get_tree().auto_accept_quit = false
	SceneLoader.load_failed.connect(_on_load_failed)
	InputManager.action_pressed.connect(_on_action)


var _auto_paused := false


func set_state(new_state: State) -> void:
	if new_state == state:
		return
	var old := state
	state = new_state
	get_tree().paused = new_state == State.PAUSED
	state_changed.emit(old, new_state)


func state_name() -> String:
	return State.keys()[state]


func report_error(message: String) -> void:
	boot_errors.append(message)
	push_error(message)


func quit_game() -> void:
	SettingsManager.save()
	get_tree().quit()


func _notification(what: int) -> void:
	match what:
		NOTIFICATION_WM_CLOSE_REQUEST, NOTIFICATION_WM_GO_BACK_REQUEST:
			quit_game()
		NOTIFICATION_APPLICATION_PAUSED, NOTIFICATION_APPLICATION_FOCUS_OUT:
			# Android may kill a backgrounded app without further notice.
			SettingsManager.save()
			if state == State.PLAYING:
				set_state(State.PAUSED)
				_auto_paused = true
		NOTIFICATION_APPLICATION_RESUMED, NOTIFICATION_APPLICATION_FOCUS_IN:
			# Resume only a pause WE made on focus loss (a pause chosen by the player stays).
			# Before this, nothing ever un-paused the tree: the game stayed frozen after app switch.
			if _auto_paused and state == State.PAUSED:
				set_state(State.PLAYING)
			_auto_paused = false


func _on_action(action: StringName) -> void:
	if action == &"pause":
		if state == State.PLAYING:
			set_state(State.PAUSED)
		elif state == State.PAUSED:
			set_state(State.PLAYING)


func _on_load_failed(path: String, reason: String) -> void:
	report_error("Failed to load %s: %s" % [path, reason])
