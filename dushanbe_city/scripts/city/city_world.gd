class_name CityWorld
extends Node3D
## Loads the generated 600x600 m district: 36 chunks (100x100 m) of merged building/road
## meshes (+ near-only "detail" meshes), box colliders, and MultiMesh instancing of trees,
## street props, fences and facade attachments (AC units, satellite dishes).
## Categories in the chunk data are mapped to concrete assets through
## res://data/city/category_map.json + the vegetation / props catalogs.

const CITY_JSON := "res://data/city/city.json"
const MAP_JSON := "res://data/city/category_map.json"
const VEG_JSON := "res://data/vegetation_catalog.json"
const PROPS_JSON := "res://data/props_catalog.json"

var city: Dictionary
var category_map: Dictionary
var veg: Dictionary = {}      ## id -> entry
var props: Dictionary = {}    ## id -> entry
var chunks: Array[Node3D] = []
var _mesh_cache := {}
var _missing := {}
var light_pool: LightPool
var stats := {"trees": 0, "props": 0, "multimeshes": 0, "colliders": 0}


func _ready() -> void:
	city = _load_json(CITY_JSON)
	light_pool = LightPool.new()
	light_pool.name = "NightLights"
	add_child(light_pool)
	category_map = _load_json(MAP_JSON)
	_load_catalogs()
	var ground := _make_outer_ground()
	add_child(ground)
	for path in DirAccess.get_files_at("res://data/city/"):
		if path.begins_with("chunk_") and path.ends_with(".json"):
			_load_chunk("res://data/city/" + path)
	_make_bounds()
	_load_backdrop()
	Settings.quality_changed.connect(func(_q: int) -> void: apply_quality())
	apply_quality()
	if not _missing.is_empty():
		print("CityWorld: categories without assets: ", _missing.keys())


static func _load_json(p: String) -> Dictionary:
	if not FileAccess.file_exists(p):
		return {}
	var d: Variant = JSON.parse_string(FileAccess.get_file_as_string(p))
	return d if d is Dictionary else {}


func _load_catalogs() -> void:
	var v := _load_json(VEG_JSON)
	for e in v.get("assets", v.get("species", [])):
		veg[e["id"]] = e
	var p := _load_json(PROPS_JSON)
	for e in p.get("props", p.get("assets", [])):
		props[e["id"]] = e


# ---------------------------------------------------------------------------------------------
func _load_chunk(json_path: String) -> void:
	var J := _load_json(json_path)
	var node := Node3D.new()
	node.name = json_path.get_file().get_basename()
	add_child(node)
	chunks.append(node)
	if ResourceLoader.exists(J["glb"]):
		var inst: Node = (load(J["glb"]) as PackedScene).instantiate()
		for mi in inst.find_children("*", "MeshInstance3D", true, false):
			var m := mi as MeshInstance3D
			CityMaterials.remap_mesh(m.mesh)
			var copy := MeshInstance3D.new()
			copy.name = m.name
			copy.mesh = m.mesh
			copy.transform = m.global_transform if m.is_inside_tree() else m.transform
			if String(m.name).begins_with("detail"):
				copy.add_to_group(&"city_detail")
				copy.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
			node.add_child(copy)
		inst.free()
	# colliders
	var body := StaticBody3D.new()
	body.name = "Colliders"
	node.add_child(body)
	for c in J.get("colliders", []):
		var cs := CollisionShape3D.new()
		var bs := BoxShape3D.new()
		bs.size = Vector3(c[3], c[4], c[5])
		cs.shape = bs
		cs.transform = Transform3D(Basis(Vector3.UP, c[6]), Vector3(c[0], c[1], c[2]))
		body.add_child(cs)
		stats.colliders += 1
	for l in J.get("lights", []):
		light_pool.add_point(Vector3(l[1], l[2], l[3]), 1 if l[0] == "entrance" else 2)
	# instances grouped by category
	var groups := {}
	for t in J.get("trees", []):
		_group(groups, "tree", t[0], Transform3D(Basis(Vector3.UP, t[3]).scaled(Vector3.ONE * t[4]), Vector3(t[1], 0.15, t[2])))
	for p in J.get("props", []):
		_group(groups, "prop", p[0], Transform3D(Basis(Vector3.UP, p[4]), Vector3(p[1], p[2], p[3])))
	for a in J.get("attach", []):
		_group(groups, "prop", a[0], Transform3D(Basis(Vector3.UP, a[4]), Vector3(a[1], a[2], a[3])))
	for l in J.get("lines", []):
		_line_instances(groups, l)
	for key in groups:
		_build_multimesh(node, key, groups[key])


func _group(groups: Dictionary, kind: String, cat: String, xf: Transform3D) -> void:
	var ids: Array = category_map.get(cat, [])
	if ids.is_empty():
		_missing[cat] = true
		return
	# deterministic pick by position (variety without randomness at runtime)
	var h := absi(int(xf.origin.x * 73.0) ^ int(xf.origin.z * 151.0))
	var id: String = ids[h % ids.size()]
	var key := kind + ":" + id
	if not groups.has(key):
		groups[key] = []
	groups[key].append(xf)


func _line_instances(groups: Dictionary, l: Array) -> void:
	var cat: String = l[0]
	var ids: Array = category_map.get(cat, [])
	if ids.is_empty():
		_missing[cat] = true
		return
	var id: String = ids[0]
	var e: Dictionary = props.get(id, veg.get(id, {}))
	var seg: float = float(e.get("segment_length", e.get("size", [2.0])[0] if e.has("size") else 2.0))
	var a := Vector3(l[1], 0.15, l[2])
	var b := Vector3(l[3], 0.15, l[4])
	var dir := b - a
	var L := dir.length()
	if L < 0.3:
		return
	var n := maxi(1, int(round(L / seg)))
	var yaw := atan2(dir.x, dir.z) + PI / 2.0     # segment local +X runs along the line
	var key := ("tree:" if veg.has(id) else "prop:") + id
	if not groups.has(key):
		groups[key] = []
	for i in n:
		var p := a + dir * ((i + 0.5) / n)
		groups[key].append(Transform3D(Basis(Vector3.UP, yaw).scaled(Vector3(L / n / seg, 1, 1)), p))


func _meshes_for(kind: String, id: String) -> Array:
	## Returns [[mesh, visibility_begin, visibility_end], ...] LOD chain for the asset.
	var key := kind + ":" + id
	if _mesh_cache.has(key):
		return _mesh_cache[key]
	var out: Array = []
	var q := Settings
	if kind == "tree":
		var e: Dictionary = veg.get(id, {})
		var files: Dictionary = e.get("files", e.get("meshes", {}))
		var vr: Dictionary = e.get("visibility", e.get("visibility_ranges", {}))
		var l0 := float(vr.get("lod0_end", 60.0)) * (float(q.get_value("tree_lod0_dist")) / 70.0)
		var l1 := float(vr.get("lod1_end", 160.0))
		var lf := minf(float(vr.get("far_end", 700.0)), float(q.get_value("tree_draw_dist")))
		var chain := [["lod0", 0.0, l0], ["lod1", l0, l1], ["far", l1, lf]]
		for c in chain:
			var path: String = str(files.get(c[0], ""))
			if path != "" and ResourceLoader.exists(path):
				out.append([load(path), c[1], c[2]])
		if out.size() == 1:
			out[0][2] = lf
	else:
		var e: Dictionary = props.get(id, {})
		var mesh_path: String = str(e.get("mesh", e.get("mesh_lod0", "")))
		var far_path: String = str(e.get("mesh_lod1", e.get("mesh_far", "")))
		var vend := minf(float(e.get("visibility_end", 120.0)), float(q.get_value("prop_dist")) * float(e.get("visibility_end", 120.0)) / 120.0)
		if mesh_path != "" and ResourceLoader.exists(mesh_path):
			if far_path != "" and ResourceLoader.exists(far_path):
				out.append([load(mesh_path), 0.0, vend * 0.4])
				out.append([load(far_path), vend * 0.4, vend])
			else:
				out.append([load(mesh_path), 0.0, vend])
	_mesh_cache[key] = out
	return out


func _build_multimesh(parent: Node3D, key: String, xfs: Array) -> void:
	var parts := key.split(":", true, 1)
	var chain := _meshes_for(parts[0], parts[1])
	if chain.is_empty():
		_missing[key] = true
		return
	for lod in chain:
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.use_custom_data = true
		mm.mesh = lod[0]
		mm.instance_count = xfs.size()
		for i in xfs.size():
			mm.set_instance_transform(i, xfs[i])
			var o: Vector3 = xfs[i].origin
			mm.set_instance_custom_data(i, Color(fposmod(o.x * 0.37 + o.z * 0.11, 1.0), fposmod(o.z * 0.29, 1.0), 0, 0))
		var mmi := MultiMeshInstance3D.new()
		mmi.name = key.replace(":", "_")
		mmi.multimesh = mm
		mmi.visibility_range_begin = lod[1]
		mmi.visibility_range_end = lod[2]
		mmi.visibility_range_end_margin = 4.0
		mmi.visibility_range_fade_mode = GeometryInstance3D.VISIBILITY_RANGE_FADE_DISABLED
		if parts[0] == "prop":
			mmi.add_to_group(&"city_props")
		else:
			mmi.add_to_group(&"city_trees")
		parent.add_child(mmi)
		stats.multimeshes += 1
	if parts[0] == "prop":
		var e: Dictionary = props.get(parts[1], {})
		for lp in e.get("light_points", []):
			for xf in xfs:
				light_pool.add_point(xf * Vector3(lp[0], lp[1], lp[2]), 0)
	if parts[0] == "tree":
		stats.trees += xfs.size()
		_tree_colliders(parent, parts[1], xfs)
	else:
		stats.props += xfs.size()
		_prop_colliders(parent, parts[1], xfs)


func _tree_colliders(parent: Node3D, id: String, xfs: Array) -> void:
	var e: Dictionary = veg.get(id, {})
	var r: Variant = e.get("trunk_radius", null)
	if r == null or float(r) <= 0.0:
		return
	var body := StaticBody3D.new()
	parent.add_child(body)
	var shape := CylinderShape3D.new()
	shape.radius = float(r)
	shape.height = 3.0
	for xf in xfs:
		var cs := CollisionShape3D.new()
		cs.shape = shape
		cs.position = xf.origin + Vector3(0, 1.5, 0)
		body.add_child(cs)


func _prop_colliders(parent: Node3D, id: String, xfs: Array) -> void:
	var e: Dictionary = props.get(id, {})
	var c: Variant = e.get("collision", null)
	if not (c is Dictionary):
		return
	var shape: Shape3D
	var off := Vector3.ZERO
	if c.get("offset") is Array:
		off = Vector3(c["offset"][0], c["offset"][1], c["offset"][2])
	if c.get("type") == "box":
		var b := BoxShape3D.new()
		b.size = Vector3(c["size"][0], c["size"][1], c["size"][2])
		shape = b
	elif c.get("type") == "cylinder":
		var cy := CylinderShape3D.new()
		cy.radius = float(c.get("radius", 0.1))
		cy.height = float(c.get("height", 1.0))
		shape = cy
	else:
		return
	var body := StaticBody3D.new()
	parent.add_child(body)
	for xf in xfs:
		var cs := CollisionShape3D.new()
		cs.shape = shape
		cs.transform = Transform3D(xf.basis.orthonormalized(), xf.origin + xf.basis.orthonormalized() * off)
		body.add_child(cs)


# ---------------------------------------------------------------------------------------------
func _make_outer_ground() -> Node3D:
	## Large lawn/loess plane around the district (fades into fog) + floor collision.
	var root := Node3D.new()
	root.name = "OuterGround"
	var mi := MeshInstance3D.new()
	var pm := PlaneMesh.new()
	pm.size = Vector2(3000, 3000)
	mi.mesh = pm
	mi.position.y = -0.06
	mi.material_override = CityMaterials.get_material("lawn_worn")
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	root.add_child(mi)
	var body := StaticBody3D.new()
	var cs := CollisionShape3D.new()
	cs.shape = WorldBoundaryShape3D.new()
	body.add_child(cs)
	root.add_child(body)
	return root


func _load_backdrop() -> void:
	const P := "res://assets/city/backdrop.glb"
	if not ResourceLoader.exists(P):
		return
	var inst: Node3D = (load(P) as PackedScene).instantiate()
	inst.name = "Backdrop"
	add_child(inst)
	CityMaterials.remap_tree(inst)
	for mi in inst.find_children("*", "MeshInstance3D", true, false):
		var m := mi as MeshInstance3D
		m.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		if String(m.name).begins_with("far_city"):
			m.visibility_range_begin = 0.0
	# distant tree canopies: far impostors of the city trees, MultiMesh
	var ft: Variant = JSON.parse_string(FileAccess.get_file_as_string("res://data/city/backdrop_trees.json")) if FileAccess.file_exists("res://data/city/backdrop_trees.json") else null
	if ft is Array:
		var ids: Array = category_map.get("park_tree", [])
		var per := {}
		for t in ft:
			if ids.is_empty():
				break
			var id: String = ids[absi(int(t[0] * 13.0 + t[1] * 7.0)) % ids.size()]
			if not per.has(id):
				per[id] = []
			per[id].append(Transform3D(Basis(Vector3.UP, t[2]).scaled(Vector3.ONE * t[3]), Vector3(t[0], 0.0, t[1])))
		for id in per:
			var e: Dictionary = veg.get(id, {})
			var files: Dictionary = e.get("files", e.get("meshes", {}))
			var path := str(files.get("far", files.get("lod1", "")))
			if path == "" or not ResourceLoader.exists(path):
				continue
			var mm := MultiMesh.new()
			mm.transform_format = MultiMesh.TRANSFORM_3D
			mm.use_custom_data = true
			mm.mesh = load(path)
			mm.instance_count = per[id].size()
			for i in per[id].size():
				mm.set_instance_transform(i, per[id][i])
			var mmi := MultiMeshInstance3D.new()
			mmi.multimesh = mm
			mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
			add_child(mmi)


func _make_bounds() -> void:
	var body := StaticBody3D.new()
	body.name = "Bounds"
	add_child(body)
	for i in 4:
		var cs := CollisionShape3D.new()
		var b := BoxShape3D.new()
		b.size = Vector3(620, 40, 2) if i < 2 else Vector3(2, 40, 620)
		cs.shape = b
		cs.position = [Vector3(0, 20, -301), Vector3(0, 20, 301), Vector3(-301, 20, 0), Vector3(301, 20, 0)][i]
		body.add_child(cs)


func apply_quality() -> void:
	var dd := float(Settings.get_value("building_detail_dist")) + 50.0
	for n in get_tree().get_nodes_in_group(&"city_detail"):
		var gi := n as GeometryInstance3D
		gi.visibility_range_end = dd
		gi.visibility_range_end_margin = 10.0
		gi.visibility_range_fade_mode = GeometryInstance3D.VISIBILITY_RANGE_FADE_SELF
