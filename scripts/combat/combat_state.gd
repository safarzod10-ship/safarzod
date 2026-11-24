extends Node
## CombatState (autoload) — chosen character / weapon and career stats.

const PATH := "user://combat.cfg"

var char_id := "swat"
var weapon_id := "aks74"
var kills := 0
var best_wave := 0
## Touch buttons write here; Player reads it (keyboard/mouse is read directly).
var touch := {"fire": false, "aim": false, "sprint": false, "jump": false, "reload": false,
	"grenade": false, "next_grenade": false, "crouch": false}


func _ready() -> void:
	var cfg := ConfigFile.new()
	if cfg.load(PATH) == OK:
		char_id = cfg.get_value("loadout", "character", char_id)
		weapon_id = cfg.get_value("loadout", "weapon", weapon_id)
		kills = cfg.get_value("stats", "kills", 0)
		best_wave = cfg.get_value("stats", "best_wave", 0)


func save() -> void:
	var cfg := ConfigFile.new()
	cfg.set_value("loadout", "character", char_id)
	cfg.set_value("loadout", "weapon", weapon_id)
	cfg.set_value("stats", "kills", kills)
	cfg.set_value("stats", "best_wave", best_wave)
	cfg.save(PATH)


## Returns true once per press for one-shot touch buttons.
func take(action: String) -> bool:
	if touch[action]:
		touch[action] = false
		return true
	return false
