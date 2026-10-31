extends Node3D
## AssetValidation test scene: instantiates every registered model at its
## real scale, measures it and compares with the AssetRegistry expectations.

const LAYOUT := {
	"monument.ismoili_somoni": Vector3(0, 0, -12),
	"vehicle.prado": Vector3(-8, 0, 14),
	"character.main": Vector3(3, 0, 16),
}

var results: Dictionary = {}

@onready var _models: Node3D = $Models
@onready var _overlay: DiagnosticsOverlay = $Overlay


func _ready() -> void:
	GameManager.set_state(GameManager.State.PLAYING)
	var lines := PackedStringArray(["", "Модели (реальный масштаб, м):"])
	for id: String in LAYOUT:
		var info := AssetRegistry.get_info(id)
		var entry := {"id": id, "ok": false, "problems": PackedStringArray()}
		var path := String(info.get("path", ""))
		var scene := load(path) as PackedScene if ResourceLoader.exists(path) else null
		if scene == null:
			entry["problems"].append("cannot load " + path)
		else:
			var inst := scene.instantiate() as Node3D
			inst.name = id.replace(".", "_")
			inst.position = LAYOUT[id]
			_models.add_child(inst)
			var stats := MeshStats.collect(inst)
			entry["stats"] = stats
			entry["problems"] = MeshStats.check(stats, info.get("expected", {}))
			entry["ok"] = entry["problems"].is_empty()
			lines.append("%s %s: %d треуг., %s, скелетов %d" % [
				"✔" if entry["ok"] else "✘", info.get("name", id), stats["triangles"],
				"×".join(PackedStringArray(stats["aabb_size"].map(func(v: float) -> String: return "%.2f" % v))),
				stats["skeletons"]])
		results[id] = entry
	_overlay.set_extra_lines(lines)
	print("ASSET_VALIDATION ", JSON.stringify(results))
