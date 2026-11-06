extends SceneTree
## Converts the imported prop GLBs (res://assets/models/props/*.glb) into Mesh resources with the
## shared prop materials bound per surface:
##   res://assets/models/props/meshes/<id>.res   (ArrayMesh, keeps importer LODs + shadow mesh)
## Surface material "<name>" -> res://assets/materials/props/<name>.tres (or .../props/ph/<name>.tres).
## Also dumps marker positions (light_point_*, wire_*) and AABBs to the JSON given by out=.
## Run after `godot --headless --import`:
##   godot --headless --path . --script res://scripts/tools/make_props.gd -- out=/abs/godot_report.json

const SRC_DIR := "res://assets/models/props/"
const OUT_DIR := "res://assets/models/props/meshes/"
const MAT_DIR := "res://assets/materials/props/"


func _init() -> void:
	var opt := {}
	for a in OS.get_cmdline_user_args():
		var kv := a.split("=", true, 1)
		opt[kv[0]] = kv[1] if kv.size() > 1 else "1"
	DirAccess.make_dir_recursive_absolute(OUT_DIR)
	var report := {}
	var missing := {}
	var files := DirAccess.get_files_at(SRC_DIR)
	for f in files:
		if not f.ends_with(".glb"):
			continue
		var id := f.get_basename()
		var packed: PackedScene = load(SRC_DIR + f)
		if packed == null:
			push_error("cannot load " + f)
			continue
		var root := packed.instantiate()
		var mis: Array[Node] = root.find_children("*", "MeshInstance3D", true, false)
		if mis.size() != 1:
			push_warning("%s: %d mesh instances" % [id, mis.size()])
		var mi := mis[0] as MeshInstance3D
		var mesh := (mi.mesh as ArrayMesh).duplicate(true) as ArrayMesh
		var xf := mi.transform
		for i in mesh.get_surface_count():
			var old := mesh.surface_get_material(i)
			var mname := old.resource_name if old else mesh.surface_get_name(i)
			var mat: Material = null
			for p in [MAT_DIR + mname + ".tres", MAT_DIR + "ph/" + mname + ".tres"]:
				if ResourceLoader.exists(p):
					mat = load(p)
					break
			if mat == null:
				missing[mname] = id
			mesh.surface_set_material(i, mat)
			mesh.surface_set_name(i, mname)
		if mesh.shadow_mesh:
			mesh.shadow_mesh.resource_name = id + "_shadow"
		mesh.resource_name = id
		var err := ResourceSaver.save(mesh, OUT_DIR + id + ".res", ResourceSaver.FLAG_COMPRESS)
		if err != OK:
			push_error("save failed %s: %d" % [id, err])
		var markers := {}
		for n in root.find_children("*", "Node3D", true, false):
			var nm := String(n.name)
			if nm.begins_with("light_point") or nm.begins_with("wire_"):
				var gp: Vector3 = (n as Node3D).global_transform.origin if (n as Node3D).is_inside_tree() else _local_pos(n as Node3D, root)
				markers[nm] = [snappedf(gp.x, 0.001), snappedf(gp.y, 0.001), snappedf(gp.z, 0.001)]
		var aabb := mesh.get_aabb()
		var tris := 0
		var surf := []
		for i in mesh.get_surface_count():
			tris += mesh.surface_get_array_index_len(i) / 3 if mesh.surface_get_array_index_len(i) > 0 else mesh.surface_get_array_len(i) / 3
			surf.append(mesh.surface_get_name(i))
		report[id] = {"aabb_pos": [aabb.position.x, aabb.position.y, aabb.position.z], "aabb_size": [aabb.size.x, aabb.size.y, aabb.size.z],
			"tris": tris, "surfaces": surf, "markers": markers, "mesh_xform_identity": xf.is_equal_approx(Transform3D.IDENTITY)}
		root.free()
		print("mesh ", id, " tris=", tris, " surfaces=", surf)
	if not missing.is_empty():
		push_warning("materials missing: " + str(missing))
	if opt.has("out"):
		var fa := FileAccess.open(opt["out"], FileAccess.WRITE)
		fa.store_string(JSON.stringify(report, " "))
	print("done ", report.size(), " meshes")
	quit()


func _local_pos(n: Node3D, root: Node) -> Vector3:
	var t := Transform3D.IDENTITY
	var cur: Node = n
	while cur != null and cur != root:
		if cur is Node3D:
			t = (cur as Node3D).transform * t
		cur = cur.get_parent()
	return t.origin
