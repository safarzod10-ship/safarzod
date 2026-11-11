class_name OpenWorld
extends Node3D
## DUSHANBE-X open world (north of the peninsula): seamless sector streaming.
## * focus points: the active camera, the player and every vehicle (a parked car keeps the ground
##   under it). Nothing is ever moved: sectors appear / disappear around the focus.
## * near square: sectors within NEAR (Chebyshev) of the camera sector are loaded; the inner ring
##   (<= 1) with 8 m terrain + collision + detailed buildings / trees, the outer ring with 16 m
##   terrain (no collision, simple trees). Sectors around other focus points get collision too.
## * far mesh: the whole world at 64 m, always drawn; it discards the loaded square (near_rect is
##   switched only when every sector of the new square is ready -> no holes, no overlap).
## * sectors are built on WorkerThreadPool (WorldSectorBuilder), meshes are created on the main
##   thread a few per frame.

const SECTOR := 512.0
const NEAR := 2
const FAR_STEP := 64.0
static var instance: OpenWorld

var wd: WorldData
var builder: WorldSectorBuilder
var mats := {}
var sectors := {}                 ## Vector2i -> {"node": Node3D, "lod": int, "col": bool}
var _jobs := {}                   ## Vector2i -> task id
var _results := {}                ## Vector2i -> Dictionary (built, waiting for instancing)
var _mutex := Mutex.new()
var _far: MeshInstance3D
var _rect := Rect2()              ## current near square (world xz)
var _want_center := Vector2i(-999, -999)
var _veg := {}                    ## species id -> {"lod0": Mesh, "lod1": Mesh, "far": Mesh}
var _sign_font: Font
var ready_count := 0
var _landmarks: Dictionary = {}   ## id -> PackedScene path
var enabled := true
var _props := {}                  ## prop id -> {"lod0": Mesh, "lod1": Mesh, "end": float}
var lights: LightPool             ## night lamps of the loaded sectors


func _ready() -> void:
	instance = self
	wd = WorldData.get_instance()
	if not wd.ok:
		enabled = false
		return
	builder = WorldSectorBuilder.new(wd)
	_make_materials()
	_load_veg()
	_load_props()
	lights = LightPool.new()
	lights.name = "WorldLights"
	add_child(lights)
	_sign_font = load("res://assets/fonts/game_font.tres") if ResourceLoader.exists("res://assets/fonts/game_font.tres") else ThemeDB.fallback_font
	_build_far()
	var patches := PlotPatches.new()
	patches.name = "PlotPatches"
	add_child(patches)
	patches.build(wd, mats["terrain"])
	var decor := PlazaDecor.new()
	decor.name = "PlazaDecor"
	add_child(decor)
	decor.build(patches, self)
	PlayerWater.ensure_index()
	_build_lakes()
	_build_edges()
	_waterfalls()
	print("OpenWorld: %d roads, %d buildings, %d sectors" % [wd.roads.size(), wd.buildings.size(), builder.sectors_x() * builder.sectors_x()])


func _make_materials() -> void:
	var tm := ShaderMaterial.new()
	tm.shader = load("res://assets/shaders/world_terrain.gdshader")
	var tex := "res://assets/textures/"
	tm.set_shader_parameter("splat_tex", ImageTexture.create_from_image(wd.splat_image()))
	tm.set_shader_parameter("world_rect", Vector4(wd.origin.x, wd.origin.y, wd.size, wd.size))
	tm.set_shader_parameter("grass_alb", load(tex + "ground_grass/albedo.jpg"))
	tm.set_shader_parameter("grass_nrm", load(tex + "ground_grass/normal.png"))
	tm.set_shader_parameter("sand_alb", load(tex + "sand/albedo.jpg"))
	tm.set_shader_parameter("rock_alb", load(tex + "rock_cliff/albedo.jpg"))
	tm.set_shader_parameter("rock_nrm", load(tex + "rock_cliff/normal.png"))
	tm.set_shader_parameter("earth_alb", load(tex + "soil/albedo.jpg"))
	tm.set_shader_parameter("macro_tex", load(tex + "noise_macro.png"))
	mats["terrain"] = tm
	var fm := tm.duplicate() as ShaderMaterial
	fm.set_shader_parameter("is_far", true)
	fm.set_shader_parameter("far_drop", 1.5)
	fm.set_shader_parameter("near_rect", Vector4(0, 0, 0, 0))
	mats["far"] = fm
	var rm := ShaderMaterial.new()
	rm.shader = load("res://assets/shaders/world_road.gdshader")
	rm.set_shader_parameter("asphalt_alb", load(tex + "asphalt_road/albedo.jpg"))
	rm.set_shader_parameter("dirt_alb", load(tex + "soil/albedo.jpg"))
	rm.set_shader_parameter("gravel_alb", load(tex + "gravel/albedo.jpg") if ResourceLoader.exists(tex + "gravel/albedo.jpg") else load(tex + "soil/albedo.jpg"))
	rm.set_shader_parameter("macro_tex", load(tex + "noise_macro.png"))
	mats["road"] = rm
	var bm := ShaderMaterial.new()
	bm.shader = load("res://assets/shaders/world_building.gdshader")
	bm.set_shader_parameter("plaster_alb", load(tex + "plaster/albedo.jpg"))
	bm.set_shader_parameter("panel_alb", load(tex + "concrete_panel/albedo.jpg"))
	bm.set_shader_parameter("brick_alb", load(tex + "brick_buff/albedo.jpg"))
	bm.set_shader_parameter("interior_tex", load(tex + "windows_atlas.png"))
	bm.set_shader_parameter("sign_tex", load(tex + "signs_atlas.png"))
	bm.set_shader_parameter("macro_tex", load(tex + "noise_macro.png"))
	mats["building"] = bm
	mats["roof"] = _vc_mat(CityMaterials.get_material("roof_metal"))
	mats["wall"] = _vc_mat(CityMaterials.get_material("wall_plaster"))
	# 0.24: beige pavers with terracotta bands (as on Dushanbe's sidewalks), not the dark grey herringbone
	mats["side"] = PlotPatches.paving_material()
	# 0.26: sidewalk verges: lawn (the terrain shader shows soil on such steep short slopes)
	var vg := StandardMaterial3D.new()
	var gtex := "res://assets/textures/ground_grass/albedo.jpg"
	if ResourceLoader.exists(gtex):
		vg.albedo_texture = load(gtex)
	vg.albedo_color = Color(0.78, 0.92, 0.62)
	vg.uv1_triplanar = true
	vg.uv1_world_triplanar = true
	vg.uv1_scale = Vector3(0.25, 0.25, 0.25)
	vg.roughness = 0.95
	mats["verge"] = vg
	mats["conc"] = CityMaterials.get_material("concrete")
	var lm := StandardMaterial3D.new()
	lm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	lm.albedo_color = Color(1.0, 0.86, 0.6)
	mats["lamp"] = lm
	var wm := ShaderMaterial.new()
	wm.shader = load("res://assets/shaders/world_water.gdshader")
	wm.set_shader_parameter("noise_tex", load(tex + "noise_macro.png"))
	mats["water"] = wm
	var zb := ShaderMaterial.new()
	zb.shader = load("res://assets/shaders/zebra.gdshader")
	zb.set_shader_parameter("macro_tex", load(tex + "noise_macro.png"))
	mats["zebra"] = zb


static func _vc_mat(m: Material) -> Material:
	return m


func _load_veg() -> void:
	var cat: Variant = JSON.parse_string(FileAccess.get_file_as_string("res://data/vegetation_catalog.json"))
	for e in (cat as Dictionary).get("assets", (cat as Dictionary).get("species", [])):
		var files: Dictionary = e.get("files", e.get("meshes", {}))
		var d := {}
		for k in ["lod0", "lod1", "far"]:
			var p := str(files.get(k, ""))
			if p != "" and ResourceLoader.exists(p):
				d[k] = load(p)
		_veg[e["id"]] = d


func _load_props() -> void:
	var cat: Variant = JSON.parse_string(FileAccess.get_file_as_string("res://data/props_catalog.json"))
	for e in (cat as Dictionary).get("props", []):
		var m0 := str(e.get("mesh", ""))
		if m0 == "" or not ResourceLoader.exists(m0):
			continue
		var d := {"lod0": load(m0), "end": float(e.get("visibility_end", 120.0))}
		var m1 := str(e.get("mesh_lod1", ""))
		if m1 != "" and ResourceLoader.exists(m1):
			d["lod1"] = load(m1)
		_props[e["id"]] = d


func _place_props(node: Node3D, props: Dictionary) -> void:
	for id in props:
		if String(id).begins_with("rp_") or id in ["lamp_ornate", "rotunda", "median_bed", "flagpole"]:
			# modular city road pack (WorldModels parts, scaled x3.2)
			WorldModels.multi(node, id, props[id], 140.0, false)
			continue
		var meta: Dictionary = _props.get(id, {})
		if meta.is_empty():
			continue
		var xs: Array = props[id]
		var chain := [["lod0", 0.0, float(meta["end"]) * (0.4 if meta.has("lod1") else 1.0)]]
		if meta.has("lod1"):
			chain.append(["lod1", float(meta["end"]) * 0.4, float(meta["end"]) * 1.6])
		for c in chain:
			var mm := MultiMesh.new()
			mm.transform_format = MultiMesh.TRANSFORM_3D
			mm.mesh = meta[c[0]]
			mm.instance_count = xs.size()
			for i in xs.size():
				mm.set_instance_transform(i, xs[i])
			var mmi := MultiMeshInstance3D.new()
			mmi.multimesh = mm
			mmi.visibility_range_begin = c[1]
			mmi.visibility_range_end = c[2]
			mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
			node.add_child(mmi)


func _refresh_lights() -> void:
	var pts := PackedVector3Array()
	var kinds := PackedByteArray()
	for s in sectors:
		for q in sectors[s].get("lamps", []):
			pts.append(q)
			kinds.append(0)
	lights.points = pts
	lights.kinds = kinds


# ------------------------------------------------------------------------------------------ far mesh
func _build_far() -> void:
	var stride := int(FAR_STEP / wd.step)
	var nv := (wd.n - 1) / stride + 1
	var V := PackedVector3Array()
	var N := PackedVector3Array()
	for j in nv:
		for i in nv:
			var gi := i * stride
			var gj := j * stride
			V.append(Vector3(wd.origin.x + gi * wd.step, wd.h_grid(gi, gj), wd.origin.y + gj * wd.step))
			var hx := wd.h_grid(gi + stride, gj) - wd.h_grid(gi - stride, gj)
			var hz := wd.h_grid(gi, gj + stride) - wd.h_grid(gi, gj - stride)
			N.append(Vector3(-hx, 2.0 * FAR_STEP, -hz).normalized())
	var I := PackedInt32Array()
	for j in nv - 1:
		for i in nv - 1:
			var a := j * nv + i
			I.append_array([a, a + 1, a + nv, a + 1, a + nv + 1, a + nv])
	_far = MeshInstance3D.new()
	_far.name = "FarTerrain"
	_far.mesh = _mesh_from({"v": V, "n": N, "i": I})
	_far.material_override = mats["far"]
	_far.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	add_child(_far)


static func _mesh_from(t: Dictionary) -> ArrayMesh:
	var arr := []
	arr.resize(Mesh.ARRAY_MAX)
	arr[Mesh.ARRAY_VERTEX] = t["v"]
	arr[Mesh.ARRAY_NORMAL] = t["n"]
	arr[Mesh.ARRAY_INDEX] = t["i"]
	var m := ArrayMesh.new()
	m.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
	return m


# ------------------------------------------------------------------------------------------ lakes, edges, waterfalls
func _build_lakes() -> void:
	for lk in wd.lakes:
		var c := Vector2(lk["c"][0], lk["c"][1])
		var r := Vector2(lk["r"][0], lk["r"][1]) * 1.12
		var level := float(lk["level"])
		var V := PackedVector3Array([Vector3(c.x, level, c.y)])
		var N := PackedVector3Array([Vector3.UP])
		var I := PackedInt32Array()
		var seg := 64
		for k in seg:
			var a := TAU * k / seg
			V.append(Vector3(c.x + cos(a) * r.x, level, c.y + sin(a) * r.y))
			N.append(Vector3.UP)
		for k in seg:
			I.append_array([0, 1 + (k + 1) % seg, 1 + k])
		var mi := MeshInstance3D.new()
		mi.name = "Lake_" + str(lk["id"])
		mi.mesh = _mesh_from({"v": V, "n": N, "i": I})
		if not mats.has("lake"):
			var lm := (mats["water"] as ShaderMaterial).duplicate() as ShaderMaterial
			lm.set_shader_parameter("lake", true)
			mats["lake"] = lm
		mi.material_override = mats["lake"]
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(mi)


func _build_edges() -> void:
	## invisible walls at the world rectangle (behind the high rim of peaks)
	var body := StaticBody3D.new()
	body.name = "WorldEdge"
	add_child(body)
	var o := wd.origin
	var s := wd.size
	for e in [[Vector3(o.x + s * 0.5, 600, o.y + 30), Vector3(s, 2400, 4)], [Vector3(o.x + 30, 600, o.y + s * 0.5), Vector3(4, 2400, s)],
			[Vector3(o.x + s - 30, 600, o.y + s * 0.5), Vector3(4, 2400, s)]]:
		var cs := CollisionShape3D.new()
		var b := BoxShape3D.new()
		b.size = e[1]
		cs.shape = b
		cs.position = e[0]
		body.add_child(cs)


func _waterfalls() -> void:
	for w in wd.waterfalls:
		var p := Vector3(w["x"], w["top"], w["z"])
		var h := float(w["top"]) - float(w["bottom"])
		var q := QuadMesh.new()
		q.size = Vector2(7.0, h)
		var mi := MeshInstance3D.new()
		mi.name = "Waterfall"
		mi.mesh = q
		var m := ShaderMaterial.new()
		m.shader = load("res://assets/shaders/world_water.gdshader")
		m.set_shader_parameter("noise_tex", load("res://assets/textures/noise_macro.png"))
		m.set_shader_parameter("fall", true)
		mi.material_override = m
		mi.position = p - Vector3(0, h * 0.5, 0)
		mi.rotation.y = 0.3
		add_child(mi)
		var pt := CPUParticles3D.new()
		pt.amount = 60
		pt.lifetime = 1.6
		pt.emission_shape = CPUParticles3D.EMISSION_SHAPE_BOX
		pt.emission_box_extents = Vector3(3.5, 0.3, 1.0)
		pt.direction = Vector3.UP
		pt.spread = 50.0
		pt.initial_velocity_min = 1.0
		pt.initial_velocity_max = 3.0
		pt.gravity = Vector3(0, -2.0, 0)
		pt.scale_amount_min = 2.0
		pt.scale_amount_max = 4.0
		var qm := QuadMesh.new()
		var pm := StandardMaterial3D.new()
		pm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		pm.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
		pm.albedo_color = Color(1, 1, 1, 0.22)
		pm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		qm.material = pm
		pt.mesh = qm
		pt.position = Vector3(w["x"], w["bottom"], w["z"])
		add_child(pt)
		var au := AudioStreamPlayer3D.new()
		if ResourceLoader.exists("res://assets/audio/sea/swim_loop.ogg"):
			var st: AudioStream = load("res://assets/audio/sea/swim_loop.ogg")
			au.stream = st
			if st is AudioStreamOggVorbis:
				(st as AudioStreamOggVorbis).loop = true
			au.unit_size = 25.0
			au.max_distance = 220.0
			au.volume_db = 2.0
			au.position = Vector3(w["x"], w["bottom"] + 2.0, w["z"])
			au.autoplay = true
			add_child(au)


# ------------------------------------------------------------------------------------------ streaming
## an extra point kept loaded with collision (a teleport destination, until the player is there)
var hold := Vector3.INF


func _focus_points() -> Array[Vector3]:
	var pts: Array[Vector3] = []
	if hold != Vector3.INF:
		pts.append(hold)
	var cam := get_viewport().get_camera_3d()
	if cam:
		pts.append(cam.global_position)
	for n in get_tree().get_nodes_in_group(&"player"):
		pts.append((n as Node3D).global_position)
	for n in get_tree().get_nodes_in_group(&"vehicle"):
		if n is RigidBody3D and (n as RigidBody3D).freeze:
			continue                     # parked far away (frozen): no sectors kept loaded for it
		pts.append((n as Node3D).global_position)
	return pts


func _sc(p: Vector3) -> Vector2i:
	return Vector2i(floori((p.x - wd.origin.x) / SECTOR), floori((p.z - wd.origin.y) / SECTOR))


func _valid(s: Vector2i) -> bool:
	var m := builder.sectors_x()
	return s.x >= 0 and s.y >= 0 and s.x < m and s.y < m


func _process(_delta: float) -> void:
	if not enabled:
		return
	var pts := _focus_points()
	if pts.is_empty():
		return
	var cam_sc := _sc(pts[0])
	# desired: lod per sector (0 near, 1 outer ring), collision around every focus point
	var want := {}
	for dj in range(-NEAR, NEAR + 1):
		for di in range(-NEAR, NEAR + 1):
			var s := cam_sc + Vector2i(di, dj)
			if _valid(s):
				want[s] = 0 if maxi(absi(di), absi(dj)) <= 1 else 1
	var colw := {}
	for p in pts:
		var c := _sc(p)
		for dj in range(-1, 2):
			for di in range(-1, 2):
				var s := c + Vector2i(di, dj)
				if _valid(s):
					colw[s] = true
					if not want.has(s) or want[s] != 0:
						want[s] = 0
	# start jobs
	var started := 0
	for s in want:
		var cur: Dictionary = sectors.get(s, {})
		var need_lod: int = want[s]
		if (cur.is_empty() or cur["lod"] != need_lod) and not _jobs.has(s) and not _results.has(s) and started < 2:
			_start_job(s, need_lod)
			started += 1
	# instance finished results (limited per frame)
	_mutex.lock()
	var done := _results.keys()
	_mutex.unlock()
	var inst := 0
	for s in done:
		if inst >= 1:
			break
		_mutex.lock()
		var res: Dictionary = _results[s]
		_results.erase(s)
		_mutex.unlock()
		_jobs.erase(s)
		if want.has(s) and want[s] == res["lod"]:
			_instance(s, res)
			inst += 1
	# collision on/off
	for s in sectors:
		var d: Dictionary = sectors[s]
		var need: bool = colw.has(s) and int(d["lod"]) == 0
		if need != d["col"]:
			_set_collision(d, need)
	# unload what is no longer wanted (only once the near square around the camera is complete)
	var complete := true
	for dj in range(-NEAR, NEAR + 1):
		for di in range(-NEAR, NEAR + 1):
			var s := cam_sc + Vector2i(di, dj)
			if _valid(s) and not sectors.has(s):
				complete = false
	if complete:
		for s in sectors.keys():
			if not want.has(s):
				(sectors[s]["node"] as Node).queue_free()
				sectors.erase(s)
				_refresh_lights()
		var x0 := wd.origin.x + (cam_sc.x - NEAR) * SECTOR
		var z0 := wd.origin.y + (cam_sc.y - NEAR) * SECTOR
		var x1 := x0 + (2 * NEAR + 1) * SECTOR
		var z1 := z0 + (2 * NEAR + 1) * SECTOR
		(mats["far"] as ShaderMaterial).set_shader_parameter("near_rect", Vector4(x0 + 1, z0 + 1, x1 - 1, z1 - 1))
		_rect = Rect2(x0, z0, x1 - x0, z1 - z0)
	ready_count = sectors.size()


func _start_job(s: Vector2i, lod: int) -> void:
	var m := _mutex
	var res := _results
	var b := builder
	var id := WorkerThreadPool.add_task(func() -> void:
		var r := b.build(s, lod)
		m.lock()
		res[s] = r
		m.unlock())
	_jobs[s] = id


## leaving the game / a test: let the sector builders finish (no worker touches a freed node)
func _exit_tree() -> void:
	for id in _jobs.values():
		WorkerThreadPool.wait_for_task_completion(id)
	_jobs.clear()


## synchronous load around a point (tests / spawning far from the city)
func preload_at(p: Vector3) -> void:
	var c := _sc(p)
	for dj in range(-1, 2):
		for di in range(-1, 2):
			var s := c + Vector2i(di, dj)
			if _valid(s) and (not sectors.has(s) or sectors[s]["lod"] != 0):
				_instance(s, builder.build(s, 0))
				_set_collision(sectors[s], true)


func _instance(s: Vector2i, res: Dictionary) -> void:
	if sectors.has(s):
		(sectors[s]["node"] as Node).queue_free()
	var node := Node3D.new()
	node.name = "Sector_%d_%d" % [s.x, s.y]
	add_child(node)
	var lod: int = res["lod"]
	var t := MeshInstance3D.new()
	t.name = "Terrain"
	t.mesh = _mesh_from(res["terrain"])
	t.material_override = mats["terrain"]
	t.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	node.add_child(t)
	var rd: Dictionary = res["roads"]
	for k in ["asphalt", "dirt", "side", "verge", "conc", "lamps"]:
		var arr: Array = rd.get(k, [])
		if arr.is_empty():
			continue
		var m := ArrayMesh.new()
		m.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
		var mi := MeshInstance3D.new()
		mi.name = "Road_" + k
		mi.mesh = m
		mi.material_override = mats["road"] if k in ["asphalt", "dirt"] else (mats["side"] if k == "side" else (mats["verge"] if k == "verge" else (mats["lamp"] if k == "lamps" else mats["conc"])))
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if k == "conc" else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		node.add_child(mi)
	var za: Array = rd.get("zebra", [])
	if not za.is_empty() and not (za[Mesh.ARRAY_VERTEX] as PackedVector3Array).is_empty():
		var zm := ArrayMesh.new()
		zm.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, za)
		var zmi := MeshInstance3D.new()
		zmi.name = "Zebra"
		zmi.mesh = zm
		zmi.material_override = mats["zebra"]
		zmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		zmi.visibility_range_end = 260.0
		node.add_child(zmi)
	var wa: Array = res["water"]
	if not wa.is_empty():
		var m := ArrayMesh.new()
		m.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, wa)
		var mi := MeshInstance3D.new()
		mi.name = "River"
		mi.mesh = m
		mi.material_override = mats["water"]
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		node.add_child(mi)
	var bd: Dictionary = res["buildings"]
	if not (bd["facade"] as Array).is_empty():
		var m := ArrayMesh.new()
		m.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, bd["facade"], [], {},
			Mesh.ARRAY_CUSTOM_RGBA_FLOAT << Mesh.ARRAY_FORMAT_CUSTOM0_SHIFT)
		var mi := MeshInstance3D.new()
		mi.name = "Buildings"
		mi.mesh = m
		mi.material_override = mats["building"]
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if lod == 0 else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		node.add_child(mi)
	for k in ["roof", "walls"]:
		var arr: Array = bd[k]
		if arr.is_empty():
			continue
		var m := ArrayMesh.new()
		m.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
		var mi := MeshInstance3D.new()
		mi.name = "B_" + k
		mi.mesh = m
		mi.material_override = mats["roof"] if k == "roof" else mats["wall"]
		node.add_child(mi)
	var models: Dictionary = bd.get("models", {})
	for kind in models:
		# imported building models: towers visible from far, villas near
		WorldModels.multi(node, kind, models[kind], 4000.0 if kind == "sky" else 700.0, lod == 0)
	var ov: PackedVector3Array = bd["occ_v"]
	if not ov.is_empty():
		var occ := ArrayOccluder3D.new()
		occ.set_arrays(ov, bd["occ_i"])
		var oi := OccluderInstance3D.new()
		oi.name = "Occluders"
		oi.occluder = occ
		node.add_child(oi)
	var gd: Dictionary = res.get("guard", {})
	if lod == 0 and not (gd.get("xfs", []) as Array).is_empty():
		WorldModels.multi(node, "guardrail", gd["xfs"], 400.0, false)
	_trees(node, res["trees"], lod)
	_items(node, res["items"], lod)
	_place_props(node, rd["props"])
	sectors[s] = {"node": node, "lod": lod, "col": false, "res_hm": res.get("hm", PackedFloat32Array()),
		"faces": res.get("terrain_faces", PackedVector3Array()),
		"road_col": rd["col"], "boxes": bd["boxes"] + rd["pboxes"] + (gd.get("boxes", []) as Array), "lamps": rd["lights"],
		"x0": wd.origin.x + s.x * SECTOR, "z0": wd.origin.y + s.y * SECTOR}
	_refresh_lights()


func _set_collision(d: Dictionary, on: bool) -> void:
	d["col"] = on
	var node: Node3D = d["node"]
	var old := node.get_node_or_null("Collision")
	if old:
		old.name = "Collision_old"
		old.queue_free()
	if not on:
		return
	var holder := Node3D.new()
	holder.name = "Collision"
	node.add_child(holder)
	var hm: PackedFloat32Array = d["res_hm"]
	var tf: PackedVector3Array = d.get("faces", PackedVector3Array())
	if not tf.is_empty():
		# sector with tunnel portals: terrain collision with holes (same triangles as the mesh)
		var tb0 := StaticBody3D.new()
		tb0.name = "WorldTerrain"
		holder.add_child(tb0)
		var cps0 := ConcavePolygonShape3D.new()
		cps0.backface_collision = true
		cps0.set_faces(tf)
		var cs0 := CollisionShape3D.new()
		cs0.shape = cps0
		tb0.add_child(cs0)
	elif not hm.is_empty():
		var tb := StaticBody3D.new()
		tb.name = "WorldTerrain"
		holder.add_child(tb)
		var cells := int(SECTOR / wd.step)
		var hs := HeightMapShape3D.new()
		hs.map_width = cells + 1
		hs.map_depth = cells + 1
		var data := hm.duplicate()
		for i in data.size():
			data[i] /= wd.step                     # uniform scale by `step` (non-uniform shape scale is unsupported)
		hs.map_data = data
		var cs := CollisionShape3D.new()
		cs.shape = hs
		cs.scale = Vector3.ONE * wd.step
		cs.position = Vector3(float(d["x0"]) + SECTOR * 0.5, 0, float(d["z0"]) + SECTOR * 0.5)
		tb.add_child(cs)
	var rc: PackedVector3Array = d["road_col"]
	if not rc.is_empty():
		var rb := StaticBody3D.new()
		rb.name = "WorldRoad"
		holder.add_child(rb)
		var cps := ConcavePolygonShape3D.new()
		cps.backface_collision = true
		cps.set_faces(rc)
		var cs2 := CollisionShape3D.new()
		cs2.shape = cps
		rb.add_child(cs2)
	if not (d["boxes"] as Array).is_empty():
		var body := StaticBody3D.new()
		body.name = "WorldBuildings"
		holder.add_child(body)
		for b in d["boxes"]:
			var cs3 := CollisionShape3D.new()
			var bs := BoxShape3D.new()
			bs.size = b[1]
			cs3.shape = bs
			cs3.transform = Transform3D(Basis(Vector3.UP, b[2]), b[0])
			body.add_child(cs3)


# ------------------------------------------------------------------------------------------ trees, signs
func _trees(node: Node3D, trees: Dictionary, lod: int) -> void:
	## LOD0 sectors: lod0 / lod1 meshes in 64 m cells (per-cell visibility ranges) + far impostors
	## for the whole sector; LOD1 sectors: far impostors only
	for id in trees:
		var xs: Array = trees[id]
		var meshes: Dictionary = _veg.get(id, {})
		if meshes.is_empty():
			continue
		if lod == 0:
			var small := String(id).begins_with("flowers") or String(id).begins_with("rose") or String(id).begins_with("hedge") or String(id).begins_with("shrub") or String(id).begins_with("grass")
			if small:
				# flowers / shrubs: 16 m cells (the range is measured to a cell's centre: big cells made
				# beds vanish right in front of the player), fading out at 90 m
				_cells(node, meshes["lod0"], xs, 0.0, 90.0, 16.0)
				continue
			if meshes.has("lod0"):
				_cells(node, meshes["lod0"], xs, 0.0, 60.0)
			if meshes.has("lod1"):
				_cells(node, meshes["lod1"], xs, 60.0, 220.0)
		var far: Mesh = meshes.get("far", meshes.get("lod1"))
		if far == null:
			continue
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.use_colors = true
		mm.mesh = far
		mm.instance_count = xs.size()
		for i in xs.size():
			mm.set_instance_transform(i, xs[i])
			mm.set_instance_color(i, Color.WHITE)
		var mmi := MultiMeshInstance3D.new()
		mmi.multimesh = mm
		mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		mmi.visibility_range_begin = 220.0 if lod == 0 else 0.0
		mmi.visibility_range_end = 1800.0
		node.add_child(mmi)


func _cells(node: Node3D, mesh: Mesh, xs: Array, r0: float, r1: float, cell := 64.0) -> void:
	var cells := {}
	for t in xs:
		var o: Vector3 = (t as Transform3D).origin
		var k := Vector2i(floori(o.x / cell), floori(o.z / cell))
		if not cells.has(k):
			cells[k] = []
		cells[k].append(t)
	for k in cells:
		var arr: Array = cells[k]
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.use_colors = true
		mm.mesh = mesh
		mm.instance_count = arr.size()
		for i in arr.size():
			mm.set_instance_transform(i, arr[i])
			mm.set_instance_color(i, Color.WHITE)
		var mmi := MultiMeshInstance3D.new()
		mmi.multimesh = mm
		mmi.visibility_range_begin = r0
		mmi.visibility_range_end = r1
		if cell < 64.0:
			mmi.visibility_range_end_margin = 12.0
			mmi.visibility_range_fade_mode = GeometryInstance3D.VISIBILITY_RANGE_FADE_SELF
		mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		node.add_child(mmi)


func _items(node: Node3D, items: Array, lod: int) -> void:
	for it in items:
		var kind: String = it[0]
		var d: Dictionary = it[1]
		var p := Vector3(d["x"], d["y"], d["z"])
		match kind:
			"sign":
				_sign(node, p, float(d["yaw"]), str(d["text"]), d.get("t", "town") == "town", bool(d.get("end", false)))
			"km":
				_kmpost(node, p, float(d["yaw"]), int(d["km"]))
			"fuel":
				_fuel_station(node, d, lod)
			"landmark":
				WorldLandmarks.build(node, d, lod)
			"billboard":
				# the post stands on the ground (the data height is the road's): lowest ground under
				# the post footprint, sunk 0.2 m so it never floats on a slope
				var gp := p
				gp.y = minf(minf(wd.height_at(p.x - 0.6, p.z - 0.6), wd.height_at(p.x + 0.6, p.z + 0.6)),
					minf(wd.height_at(p.x + 0.6, p.z - 0.6), wd.height_at(p.x - 0.6, p.z + 0.6))) - 0.2
				WorldModels.billboard(node, gp, float(d["yaw"]), int(d.get("variant", 0)))


func _sign(node: Node3D, p: Vector3, yaw: float, text: String, town: bool, end: bool) -> void:
	var root := Node3D.new()
	root.position = p
	root.rotation.y = yaw
	node.add_child(root)
	var post := MeshInstance3D.new()
	var cm := CylinderMesh.new()
	cm.top_radius = 0.05
	cm.bottom_radius = 0.05
	cm.height = 2.6
	post.mesh = cm
	post.position = Vector3(0, 1.3, 0)
	post.material_override = mats["conc"]
	root.add_child(post)
	var plate := MeshInstance3D.new()
	var bm := BoxMesh.new()
	var w := clampf(text.length() * 0.24 + 0.6, 1.6, 6.5)
	bm.size = Vector3(w, 0.8 if town else 1.0, 0.05)
	plate.mesh = bm
	plate.position = Vector3(0, 2.75, 0)
	var sm := StandardMaterial3D.new()
	sm.albedo_color = Color(1, 1, 1) if town else Color(0.12, 0.42, 0.22)
	plate.material_override = sm
	root.add_child(plate)
	for side: float in [1.0, -1.0]:
		var lb := Label3D.new()
		lb.text = text
		lb.font = _sign_font
		lb.font_size = 64
		lb.pixel_size = 0.0045
		lb.modulate = Color(0.05, 0.05, 0.08) if town else Color.WHITE
		lb.outline_size = 0
		lb.position = Vector3(0, 2.75, 0.03 * side)
		lb.rotation.y = 0.0 if side > 0 else PI
		lb.double_sided = false
		root.add_child(lb)
		if town and end:
			var bar := MeshInstance3D.new()
			var bb := BoxMesh.new()
			bb.size = Vector3(w * 0.95, 0.06, 0.07)
			bar.mesh = bb
			bar.position = Vector3(0, 2.75, 0)
			bar.rotation.z = 0.25
			var rm := StandardMaterial3D.new()
			rm.albedo_color = Color(0.8, 0.1, 0.1)
			bar.material_override = rm
			root.add_child(bar)


func _kmpost(node: Node3D, p: Vector3, yaw: float, km: int) -> void:
	var root := Node3D.new()
	root.position = p
	root.rotation.y = yaw
	node.add_child(root)
	var post := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = Vector3(0.25, 1.1, 0.12)
	post.mesh = bm
	post.position = Vector3(0, 0.55, 0)
	var sm := StandardMaterial3D.new()
	sm.albedo_color = Color(0.95, 0.95, 0.92)
	post.material_override = sm
	root.add_child(post)
	for side: float in [1.0, -1.0]:
		var lb := Label3D.new()
		lb.text = str(km)
		lb.font = _sign_font
		lb.font_size = 48
		lb.pixel_size = 0.004
		lb.modulate = Color(0.05, 0.05, 0.05)
		lb.position = Vector3(0, 0.8, 0.065 * side)
		lb.rotation.y = 0.0 if side > 0 else PI
		root.add_child(lb)


func _fuel(node: Node3D, p: Vector3, yaw: float) -> void:
	var root := Node3D.new()
	root.name = "FuelStation"
	root.position = p
	root.rotation.y = yaw
	node.add_child(root)
	var canopy := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = Vector3(18, 0.8, 12)
	canopy.mesh = bm
	canopy.position = Vector3(0, 5.2, 0)
	var cm := StandardMaterial3D.new()
	cm.albedo_color = Color(0.92, 0.92, 0.9)
	canopy.material_override = cm
	root.add_child(canopy)
	var stripe := MeshInstance3D.new()
	var sb := BoxMesh.new()
	sb.size = Vector3(18.1, 0.3, 12.1)
	stripe.mesh = sb
	stripe.position = Vector3(0, 5.0, 0)
	var smt := StandardMaterial3D.new()
	smt.albedo_color = Color(0.1, 0.45, 0.25)
	smt.emission_enabled = true
	smt.emission = Color(0.1, 0.5, 0.25) * 0.3
	stripe.material_override = smt
	root.add_child(stripe)
	for x: float in [-5.0, 0.0, 5.0]:
		var col := MeshInstance3D.new()
		var cy := BoxMesh.new()
		cy.size = Vector3(0.5, 4.8, 0.5)
		col.mesh = cy
		col.position = Vector3(x, 2.4, 0)
		col.material_override = mats["conc"]
		root.add_child(col)
		var pump := MeshInstance3D.new()
		var pb := BoxMesh.new()
		pb.size = Vector3(0.9, 1.7, 0.6)
		pump.mesh = pb
		pump.position = Vector3(x, 0.85, 2.0)
		var pm := StandardMaterial3D.new()
		pm.albedo_color = Color(0.15, 0.5, 0.3)
		pump.material_override = pm
		root.add_child(pump)
	var shop := MeshInstance3D.new()
	var shb := BoxMesh.new()
	shb.size = Vector3(12, 3.6, 7)
	shop.mesh = shb
	shop.position = Vector3(0, 1.8, 12)
	shop.material_override = cm
	root.add_child(shop)
	var lb := Label3D.new()
	lb.text = "АЗС · ЗАПРАВКА"
	lb.font = _sign_font
	lb.font_size = 96
	lb.pixel_size = 0.01
	lb.modulate = Color(0.1, 0.45, 0.25)
	lb.position = Vector3(0, 5.2, -6.1)
	lb.rotation.y = PI
	root.add_child(lb)
	var body := StaticBody3D.new()
	root.add_child(body)
	for x: float in [-5.0, 0.0, 5.0]:
		var cs := CollisionShape3D.new()
		var b := BoxShape3D.new()
		b.size = Vector3(0.9, 1.7, 0.6)
		cs.shape = b
		cs.position = Vector3(x, 0.85, 2.0)
		body.add_child(cs)
	var cs2 := CollisionShape3D.new()
	var b2 := BoxShape3D.new()
	b2.size = Vector3(12, 3.6, 7)
	cs2.shape = b2
	cs2.position = Vector3(0, 1.8, 12)
	body.add_child(cs2)


## filling station (Lowpoly Gas Station, AspectStudios, CC-BY 4.0): the model's +X (pumps, canopy,
## price sign) faces the road; shop + sign collide; FuelService finds it by the group "fuel_station"
func _fuel_station(node: Node3D, d: Dictionary, lod: int) -> void:
	var o := Vector3(float(d.get("ox", d["x"])), float(d["y"]), float(d.get("oz", d["z"])))
	var xf := Transform3D(Basis(Vector3.UP, float(d["yaw"])), o)
	var root := WorldModels.place(node, "gas_station", xf, 1200.0, lod == 0)
	root.name = "FuelStation"
	root.add_to_group(&"fuel_station")
	root.set_meta("pump", xf * Vector3(7.5, 0.0, 0.3))
	var body := StaticBody3D.new()
	body.name = "FuelStationBody"
	root.add_child(body)
	for spec in [[Vector3(-6.0, 2.8, 0.4), Vector3(12.2, 5.6, 17.4)], [Vector3(17.7, 3.3, -5.9), Vector3(1.0, 6.7, 1.0)]]:
		var cs := CollisionShape3D.new()
		var bs := BoxShape3D.new()
		bs.size = spec[1]
		cs.shape = bs
		cs.position = spec[0]
		body.add_child(cs)
	# the forecourt: a concrete slab under the pumps and the shop, out to the road edge (the model has
	# no ground of its own - it stood on the grass); a thick slab hides terrain bumps, collision included
	var slab := MeshInstance3D.new()
	var sbm := BoxMesh.new()
	sbm.size = Vector3(33.0, 0.7, 25.0)
	slab.mesh = sbm
	slab.material_override = mats["conc"]
	slab.position = Vector3(3.0, -0.27, 0.0)
	slab.visibility_range_end = 900.0
	root.add_child(slab)
	var scs := CollisionShape3D.new()
	var sbs := BoxShape3D.new()
	sbs.size = sbm.size
	scs.shape = sbs
	scs.position = slab.position
	body.add_child(scs)
	if wd:
		wd.add_no_grass(xf * Vector3(3.0, 0, 0), xf.basis.x, 17.5, 13.5)
	# price board, both faces: AI-92 14 smn / l
	for side: float in [1.0, -1.0]:
		var lb := Label3D.new()
		lb.text = "АЗС\nАИ-92  14 смн/л"
		lb.font = _sign_font
		lb.font_size = 72
		lb.pixel_size = 0.012
		lb.modulate = Color(1.0, 0.95, 0.4)
		lb.outline_size = 10
		lb.outline_modulate = Color(0.05, 0.2, 0.1)
		lb.position = Vector3(18.4 if side > 0 else 17.0, 5.6, 0.2)
		lb.rotation.y = PI * 0.5 if side > 0 else -PI * 0.5
		root.add_child(lb)


func _street_lamp(node: Node3D, p: Vector3) -> void:
	var mi := MeshInstance3D.new()
	var cm := CylinderMesh.new()
	cm.top_radius = 0.07
	cm.bottom_radius = 0.1
	cm.height = 8.0
	mi.mesh = cm
	mi.position = p + Vector3(0, 4.0, 0)
	mi.material_override = mats["conc"]
	node.add_child(mi)
	var head := MeshInstance3D.new()
	var hb := BoxMesh.new()
	hb.size = Vector3(0.5, 0.18, 0.9)
	head.mesh = hb
	head.position = p + Vector3(0, 8.0, 0)
	head.material_override = mats["lamp"]
	node.add_child(head)


# ------------------------------------------------------------------------------------------ queries
func is_ready_at(p: Vector3) -> bool:
	var s := _sc(p)
	return sectors.has(s) and sectors[s]["col"]


func loaded_sectors() -> int:
	return sectors.size()
