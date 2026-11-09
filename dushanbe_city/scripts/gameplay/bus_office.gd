class_name BusOffice
extends Node
## Bus route №1 terminus sign as an interactable: «СТАТЬ ВОДИТЕЛЕМ АВТОБУСА» hires the player.
var job: BusJob


func _ready() -> void:
	add_to_group(&"interactable")


func interaction_label(_player: Node) -> String:
	return "АВТОБУС №1: РАБОТА" if Wallet.bus_hired else "СТАТЬ ВОДИТЕЛЕМ АВТОБУСА"


func interaction_point(_player: Node) -> Vector3:
	return job.office_point()


func can_interact(_player: Node) -> bool:
	return not job.stops.is_empty()


func interact(_player: Node) -> void:
	job.hire()
