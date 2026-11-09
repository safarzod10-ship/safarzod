class_name CarDoorInteractable
extends Node
## A vehicle's driver door as an interactable (CharacterInteraction): label «СЕСТЬ» («В ЛОДКУ» for a
## boat), usable when the player is next to it and it is (almost) still; starts the get-in.
var session: CarSession
var vehicle: VehiclePrado


func _ready() -> void:
	add_to_group(&"interactable")


func interaction_label(_player: Node) -> String:
	var v := vehicle if vehicle else session.car
	if not CarDealer.owns(v):
		return "ПРОДАЁТСЯ · %s · АВТОСАЛОН" % Wallet.fmt(CarDealer.price_of(v))
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
	var v := vehicle if vehicle else session.car
	if not CarDealer.owns(v):
		# show the price at the door: the car is sold at the dealership (on the map)
		return not session.driving and session.player and session.player.global_position.distance_to(v.driver_door_point(0.6)) < CarSession.ENTER_DIST
	return session.can_enter(v)


func interact(_player: Node) -> void:
	var v := vehicle if vehicle else session.car
	if not CarDealer.owns(v):
		return
	session.enter_vehicle(v)
