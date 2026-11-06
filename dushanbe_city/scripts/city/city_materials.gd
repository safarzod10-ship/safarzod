class_name CityMaterials
extends RefCounted
## Replaces placeholder glTF materials (named in the generator) with the project's material
## library res://assets/materials/city/<name>.tres. Cached per name.

const DIR := "res://assets/materials/city/"
static var _cache := {}


static func get_material(mat_name: String) -> Material:
	if _cache.has(mat_name):
		return _cache[mat_name]
	var path := DIR + mat_name + ".tres"
	var m: Material = load(path) if ResourceLoader.exists(path) else null
	if m == null:
		push_warning("CityMaterials: no material for '%s'" % mat_name)
	_cache[mat_name] = m
	return m


## Returns a copy of `mesh` with library materials set on each surface.
static func remap_mesh(mesh: Mesh) -> Mesh:
	for i in mesh.get_surface_count():
		var cur := mesh.surface_get_material(i)
		var mname := cur.resource_name if cur else ""
		var lib := get_material(mname)
		if lib:
			mesh.surface_set_material(i, lib)
	return mesh


static func remap_tree(root: Node) -> void:
	for n in root.find_children("*", "MeshInstance3D", true, false):
		var mi := n as MeshInstance3D
		if mi.mesh:
			remap_mesh(mi.mesh)
