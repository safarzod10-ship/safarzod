extends Node3D
## Engine diagnostics test scene. Contains ONLY explicit technical test
## primitives (ground plane, PBR spheres) — no final game content.


func _ready() -> void:
	GameManager.set_state(GameManager.State.PLAYING)
