class_name CharacterInteraction
extends Node
## Generic interactions of the walking character (stage 4). Anything the player can use is a node
## in the group "interactable" implementing:
##   interaction_label(player) -> String     button text ("СЕСТЬ", ...)
##   interaction_point(player) -> Vector3     where the character stands to do it
##   can_interact(player) -> bool             in range / allowed right now
##   interact(player) -> void                 do it (may run an animated sequence)
## Optional: interaction_priority() -> int.
## The nearest usable one (within RANGE of its point) becomes `current`; the touch UI shows its
## label on the ACTION button, the keyboard uses E (action "interact"). New actions in later stages
## only add interactable nodes - the controller does not change.

signal current_changed(target: Node)

const RANGE := 2.2
var player: Node3D
var current: Node = null
var busy := false                  ## an animated interaction is running (input locked)
var _scan := 0.0


func update(delta: float) -> void:
	_scan -= delta
	if _scan > 0.0:
		return
	_scan = 0.1
	var best: Node = null
	var bd := RANGE
	if not busy:
		for n in get_tree().get_nodes_in_group(&"interactable"):
			if not n.has_method("can_interact") or not n.call("can_interact", player):
				continue
			var p: Vector3 = n.call("interaction_point", player)
			var d := p.distance_to(player.global_position)
			if d < bd:
				bd = d
				best = n
	if best != current:
		current = best
		current_changed.emit(current)


func label() -> String:
	return String(current.call("interaction_label", player)) if current else ""


func trigger() -> bool:
	if current == null or busy:
		return false
	current.call("interact", player)
	return true
