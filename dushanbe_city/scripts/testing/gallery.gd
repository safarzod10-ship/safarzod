extends Node3D
## Shows a generated GLB with the city material library, sky and sun, on a ground plane.
@export_file("*.glb") var glb_path := "res://assets/city/test/gallery.glb"


func _ready() -> void:
	add_child(EnvironmentRig.new())
	var ps: PackedScene = load(glb_path)
	var inst := ps.instantiate()
	add_child(inst)
	CityMaterials.remap_tree(inst)
	var ground := MeshInstance3D.new()
	var pm := PlaneMesh.new()
	pm.size = Vector2(600, 600)
	ground.mesh = pm
	ground.position.y = 0.149
	ground.material_override = CityMaterials.get_material("asphalt_yard")
	add_child(ground)
	var cam := Camera3D.new()
	cam.position = Vector3(30, 8, 45)
	cam.rotation_degrees = Vector3(-5, 15, 0)
	cam.far = 3000
	add_child(cam)
