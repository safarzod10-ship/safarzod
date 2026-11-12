class_name LakLakOffice
extends Node
## The LakLak depot office door as an interactable (CharacterInteraction): «УСТРОИТЬСЯ В LAKLAK»
## hires the player; once hired, «LAKLAK: РАБОТА» reminds where the van is.
var job: LakLakJob


func _ready() -> void:
	add_to_group(&"interactable")


func interaction_label(_player: Node) -> String:
	return "LAKLAK: РАБОТА" if Wallet.laklak_hired else "УСТРОИТЬСЯ В LAKLAK"


func interaction_point(_player: Node) -> Vector3:
	return job.depot_point(LakLakJob.DEPOT_JOB_POINT)


func can_interact(_player: Node) -> bool:
	return not job.depot.is_empty()


func interact(_player: Node) -> void:
	job.hire()
