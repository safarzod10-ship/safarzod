class_name CarDoorInteractable
extends Node
## A vehicle's driver door as an interactable (CharacterInteraction): label «СЕСТЬ» («В ЛОДКУ» for a
## boat), usable when the player is next to it and it is (almost) still; starts the get-in.
var session: CarSession
var vehicle: VehiclePrado


func _ready() -> void:
	add_to_group(&"interactable")


func interaction_label(_player: Node) -> String:
	return "В ЛОДКУ" if vehicle is VehicleBoat else "СЕСТЬ"


func interaction_point(_player: Node) -> Vector3:
	var v := vehicle if vehicle else session.car
	if v is VehicleBoat:
		# anywhere along the hull: the point of the hull side nearest to the player
		var p: Vector3 = _player.global_position if _player is Node3D else v.global_position
		var local := v.global_transform.affine_inverse() * p
		local.z = clampf(local.z, -2.6, 2.6)
		local.x = signf(local.x) * 1.4 if absf(local.x) > 0.01 else 1.4
		local.y = 0.0
		return v.global_transform * local
	return v.driver_door_point(0.6)


func can_interact(_player: Node) -> bool:
	return session.can_enter(vehicle if vehicle else session.car)


func interact(_player: Node) -> void:
	session.enter_vehicle(vehicle if vehicle else session.car)
