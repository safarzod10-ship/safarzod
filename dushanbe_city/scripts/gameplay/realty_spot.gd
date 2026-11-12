class_name RealtySpot
extends Node3D
## the interactable of one Realty board (group "interactable", see CharacterInteraction)

var realty: Realty
var prop: Dictionary


func _ready() -> void:
	add_to_group(&"interactable")


func interaction_label(_player: Node) -> String:
	return realty.label_for(prop)


func interaction_point(_player: Node) -> Vector3:
	return global_position + global_basis.z * 1.0


func can_interact(_player: Node) -> bool:
	return true


func interact(_player: Node) -> void:
	realty.use(prop)
