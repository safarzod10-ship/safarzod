class_name TouchBlock
extends RefCounted
## On-screen GUI (fuel buttons, the fuel window, the map) sits above the driving / walking touch
## controls. Those controls read raw touches in _input and mark them handled, so a Button there would
## only get the mouse click Godot emulates for the FIRST finger (none while the gas pedal is held).
## Controls in the group "touch_block" are skipped by the touch controls and get the tap themselves.

const GROUP := &"touch_block"


## true when p (viewport coordinates) is on a visible control of the group
static func hit(tree: SceneTree, p: Vector2) -> bool:
	for n in tree.get_nodes_in_group(GROUP):
		var c := n as Control
		if c and c.is_visible_in_tree() and c.get_global_rect().has_point(p):
			return true
	return false


## a tap on a Button (ScreenTouch, any finger): emits `pressed` (the emulated mouse click of the
## same tap then lands on a hidden or already-used button and does nothing more)
static func tap(event: InputEvent, buttons: Array) -> bool:
	if not (event is InputEventScreenTouch and event.pressed):
		return false
	for b in buttons:
		var btn := b as BaseButton
		if btn and btn.is_visible_in_tree() and not btn.disabled and btn.get_global_rect().has_point(event.position):
			btn.get_viewport().set_input_as_handled()
			btn.pressed.emit()
			return true
	return false
