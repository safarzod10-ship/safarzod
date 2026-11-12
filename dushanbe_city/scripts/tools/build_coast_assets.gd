extends Node
## Coast assets: procedural boulders (3 shapes, LOD0 ~500 tris + far ~80 tris) saved as mesh
## resources and registered in data/props_catalog.json (+ category "boulder" in category_map).
## godot --headless --path . res://scenes/testing/build_coast_assets.tscn

const OUT := "res://assets/models/props/meshes/"


func _ready() -> void:
	var cat: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://data/props_catalog.json"))
	var list: Array = cat.get("props", cat.get("assets"))
	list = list.filter(func(e: Dictionary) -> bool: return not String(e["id"]).begins_with("boulder_"))
	var ids: Array = []
	for k in 3:
		var id := "boulder_%s" % ["a", "b", "c"][k]
		var hi := _boulder(3, 101 + k * 7, k)
		var lo := _boulder(1, 101 + k * 7, k)
		ResourceSaver.save(hi, OUT + id + ".res")
		ResourceSaver.save(lo, OUT + id + "_far.res")
		var aabb := hi.get_aabb()
		list.append({"id": id, "ru": "валун", "mesh": OUT + id + ".res", "mesh_far": OUT + id + "_far.res",
			"size": [snappedf(aabb.size.x, 0.01), snappedf(aabb.size.y, 0.01), snappedf(aabb.size.z, 0.01)],
			"tris": hi.surface_get_array_len(0) / 3, "visibility_end": 260, "collision": null})
		ids.append(id)
	if cat.has("props"):
		cat["props"] = list
	else:
		cat["assets"] = list
	FileAccess.open("res://data/props_catalog.json", FileAccess.WRITE).store_string(JSON.stringify(cat, " "))
	var cm: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://data/city/category_map.json"))
	cm["boulder"] = ids
	FileAccess.open("res://data/city/category_map.json", FileAccess.WRITE).store_string(JSON.stringify(cm, " "))
	print("COAST_ASSETS boulders ", ids)
	get_tree().quit()


func _boulder(subdiv: int, seed: int, shape: int) -> ArrayMesh:
	## icosphere, displaced by layered noise, flattened bottom; box-projected UVs (world-ish metres)
	var noise := FastNoiseLite.new()
	noise.seed = seed
	noise.frequency = 0.9
	noise.fractal_octaves = 4
	var t := (1.0 + sqrt(5.0)) / 2.0
	var verts: Array[Vector3] = [Vector3(-1, t, 0), Vector3(1, t, 0), Vector3(-1, -t, 0), Vector3(1, -t, 0),
		Vector3(0, -1, t), Vector3(0, 1, t), Vector3(0, -1, -t), Vector3(0, 1, -t),
		Vector3(t, 0, -1), Vector3(t, 0, 1), Vector3(-t, 0, -1), Vector3(-t, 0, 1)]
	for i in verts.size():
		verts[i] = verts[i].normalized()
	var faces := [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2],
		[10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11],
		[6, 2, 10], [8, 6, 7], [9, 8, 1]]
	for s in subdiv:
		var mid := {}
		var nf := []
		for f in faces:
			var m := []
			for e in 3:
				var a: int = f[e]
				var b: int = f[(e + 1) % 3]
				var key := Vector2i(mini(a, b), maxi(a, b))
				if not mid.has(key):
					verts.append(((verts[a] + verts[b]) * 0.5).normalized())
					mid[key] = verts.size() - 1
				m.append(mid[key])
			nf.append([f[0], m[0], m[2]])
			nf.append([f[1], m[1], m[0]])
			nf.append([f[2], m[2], m[1]])
			nf.append([m[0], m[1], m[2]])
		faces = nf
	var shapes: Array[Vector3] = [Vector3(1.25, 0.8, 1.0), Vector3(1.0, 0.65, 1.35), Vector3(0.95, 1.05, 0.9)]
	var scale: Vector3 = shapes[shape]
	var pos: Array[Vector3] = []
	for v in verts:
		var d := 1.0 + noise.get_noise_3dv(v * 1.3) * 0.35
		var p := v * d * scale * 0.6
		# chunky facets: quantise a little along a few planes
		p.y = maxf(p.y, -0.18)              # flat-ish base that sits on the ground
		pos.append(p)
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	for f in faces:
		var a: Vector3 = pos[f[0]]
		var b: Vector3 = pos[f[1]]
		var c: Vector3 = pos[f[2]]
		var n := (b - a).cross(c - a).normalized()
		if n.dot((a + b + c) / 3.0) < 0.0:   # keep outward winding
			var tmp := b
			b = c
			c = tmp
		for p: Vector3 in [a, c, b]:
			var an := Vector3(absf(n.x), absf(n.y), absf(n.z))
			var uv := Vector2(p.x, p.z) if an.y > maxf(an.x, an.z) else (Vector2(p.z, p.y) if an.x > an.z else Vector2(p.x, p.y))
			st.set_uv(uv * 0.5)
			st.set_color(Color(1, 1, 1))
			st.add_vertex(p)
	st.generate_normals()
	st.generate_tangents()
	var mesh := st.commit()
	mesh.surface_set_material(0, load("res://assets/materials/city/rock.tres"))
	return mesh
