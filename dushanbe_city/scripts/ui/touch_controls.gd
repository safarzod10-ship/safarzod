extends CanvasLayer
## On-screen touch controls: shown automatically on touchscreen devices (or forced).
## Feeds PlayerInput (joystick move vector, RUN toggle, JUMP, right-half swipe camera look).

@export var force_visible := false      ## show even without a touchscreen (desktop testing)
@export var auto_show := true           ## show when DisplayServer reports a touchscreen

@onready var surface: Control = $Surface


func _ready() -> void:
	PlayerInput.ensure_actions()
	set_shown(force_visible or (auto_show and DisplayServer.is_touchscreen_available()))


func set_shown(v: bool) -> void:
	visible = v
	surface.set_process_input(v)
	PlayerInput.touch_active = v
	if not v:
		PlayerInput.touch_move = Vector2.ZERO
