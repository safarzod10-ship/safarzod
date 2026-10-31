class_name MeshStats
extends RefCounted
## Collects geometry statistics from an instantiated scene (used by the
## AssetValidation scene and automated tests).


static func collect(root: Node) -> Dictionary:
	var names := PackedStringArray()
	var tris := 0
	var verts := 0
	var materials := {}
	var aabb := AABB()
	var first := true
	var skeletons := 0
	var anim_players := 0
	for n in _walk(root):
		if n is Skeleton3D:
			skeletons += 1
		elif n is AnimationPlayer:
			anim_players += 1
		elif n is MeshInstance3D and (n as MeshInstance3D).mesh:
			var mi := n as MeshInstance3D
			names.append(mi.name)
			var mesh := mi.mesh
			for s in mesh.get_surface_count():
				var arr := mesh.surface_get_arrays(s)
				var idx: PackedInt32Array = arr[Mesh.ARRAY_INDEX]
				var pos: PackedVector3Array = arr[Mesh.ARRAY_VERTEX]
				tris += (idx.size() if idx.size() > 0 else pos.size()) / 3
				verts += pos.size()
				var m := mi.get_active_material(s)
				if m:
					materials[m.resource_name if m.resource_name != "" else str(m.get_instance_id())] = true
			var box := mi.global_transform * mi.get_aabb()
			aabb = box if first else aabb.merge(box)
			first = false
	names.sort()
	return {
		"mesh_nodes": names,
		"triangles": tris,
		"vertices": verts,
		"materials": materials.keys(),
		"aabb_size": [snappedf(aabb.size.x, 0.001), snappedf(aabb.size.y, 0.001), snappedf(aabb.size.z, 0.001)],
		"skeletons": skeletons,
		"animation_players": anim_players,
	}


## Compares stats with the "expected" block of an AssetRegistry entry.
static func check(stats: Dictionary, expected: Dictionary) -> PackedStringArray:
	var problems := PackedStringArray()
	if expected.has("triangles") and int(expected["triangles"]) != stats["triangles"]:
		problems.append("triangles %d != expected %d" % [stats["triangles"], expected["triangles"]])
	if expected.has("materials") and int(expected["materials"]) != stats["materials"].size():
		problems.append("materials %d != expected %d" % [stats["materials"].size(), expected["materials"]])
	if expected.has("mesh_nodes"):
		var want := PackedStringArray(expected["mesh_nodes"])
		want.sort()
		if want != stats["mesh_nodes"]:
			problems.append("mesh nodes %s != expected %s" % [stats["mesh_nodes"], want])
	return problems


static func _walk(n: Node) -> Array[Node]:
	var out: Array[Node] = [n]
	for c in n.get_children():
		out.append_array(_walk(c))
	return out
