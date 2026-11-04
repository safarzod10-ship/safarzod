class_name CarDoorInteractable
extends Node
## The Prado's driver door as an interactable (CharacterInteraction): label «СЕСТЬ», usable when
## the player stands near the door and the car is (almost) still; starts the animated get-in.
var session: CarSession


func _ready() -> void:
	add_to_group(&"interactable")


func interaction_label(_player: Node) -> String:
	return "СЕСТЬ"


func interaction_point(_player: Node) -> Vector3:
	return session.car.driver_door_point(0.6)


func can_interact(_player: Node) -> bool:
	return session.can_enter()


func interact(_player: Node) -> void:
	session.enter_animated()
