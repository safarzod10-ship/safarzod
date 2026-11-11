class_name GrassField
extends Node3D
## Volumetric lawn grass: instanced clumps streamed in a radius around the active camera,
## only on lawn areas (1 m mask built from the generated lawn rectangles). Density/radius
## from the quality preset. Uses the vegetation catalog's grass meshes if present,
## otherwise a procedural blade clump.

var city: Dictionary
var mask := PackedByteArray()      ## 600x600, 1 = lawn
var _mmi: MultiMeshInstance3D
var _last := Vector3(INF, 0, INF)
var override_camera: Camera3D
var wd: WorldData                  ## open world (3D grass on its grass surfaces too)
var _task := -1                    ## WorkerThreadPool task building the next instance buffer
var _pending: PackedFloat32Array
var _pending_center := Vector3.ZERO
var _pending_radius := 0.0
const W := 600
var _ng_ver := 0


const STRIDE := 20   ## floats per instance in the MultiMesh buffer

func _ready() -> void:
	add_to_group(&"streaming_camera_override")
	if RenderingServer.get_current_rendering_method() == "gl_compatibility":
		set_process(false)   # GLES3 fallback: blades shade incorrectly there; lawn texture only
		return
	wd = WorldData.get_instance() if WorldData.get_instance().ok else null
	mask.resize(W * W)
	for l in city.get("lawns", []):
		var r: Array = l[1]
		var x0 := clampi(int(ceil(r[0] + 300.0)), 0, W)
		var x1 := clampi(int(floor(r[2] + 300.0)), 0, W)
		var z0 := clampi(int(ceil(r[1] + 300.0)), 0, W)
		var z1 := clampi(int(floor(r[3] + 300.0)), 0, W)
		for z in range(z0, z1):
			for x in range(x0, x1):
				mask[z * W + x] = 1
	_mmi = MultiMeshInstance3D.new()
	_mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_colors = true      # white instance colour: GLES3 multiplies vertex COLOR by it (0 without colours)
	mm.use_custom_data = true # full 20-float layout (transform 12 + colour 4 + custom 4) for the raw buffer
	mm.mesh = _grass_mesh()
	var gm := mm.mesh.surface_get_material(0) as ShaderMaterial
	if gm:
		gm.set_shader_parameter("palette_noise", load("res://assets/textures/noise_macro.png"))
	_mmi.multimesh = mm
	add_child(_mmi)
	Settings.quality_changed.connect(func(_q: int) -> void: _last = Vector3(INF, 0, INF))


func _grass_mesh() -> Mesh:
	var cat := CityWorld._load_json("res://data/vegetation_catalog.json")
	var want := "grass_clump_lite" if Settings.quality == 0 else ("grass_clump_b" if Settings.quality == 1 else "grass_clump_a")
	var p0 := "res://assets/models/vegetation/meshes/%s_lod0.res" % want
	if ResourceLoader.exists(p0):
		return load(p0)
	for e in cat.get("assets", cat.get("species", [])):
		if e.get("kind", "") == "grass":
			var f: Dictionary = e.get("files", e.get("meshes", {}))
			var p := str(f.get("lod0", ""))
			if p != "" and ResourceLoader.exists(p):
				return load(p)
	return _procedural_clump()


static func _procedural_clump() -> ArrayMesh:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var rng := RandomNumberGenerator.new()
	rng.seed = 11
	for i in 9:
		var a := rng.randf() * TAU
		var r := rng.randf() * 0.18
		var base := Vector3(cos(a) * r, 0, sin(a) * r)
		var h := rng.randf_range(0.14, 0.32)
		var w := rng.randf_range(0.012, 0.022)
		var dir := Vector3(cos(a + 1.3), 0, sin(a + 1.3))
		var lean := Vector3(cos(a), 0, sin(a)) * rng.randf_range(0.03, 0.12)
		var n := Vector3(-dir.z, 0.6, dir.x).normalized()
		var segs := 3
		for s in segs:
			var t0 := float(s) / segs
			var t1 := float(s + 1) / segs
			var p0 := base + Vector3(0, h * t0, 0) + lean * t0 * t0
			var p1 := base + Vector3(0, h * t1, 0) + lean * t1 * t1
			var w0 := w * (1.0 - t0)
			var w1 := w * (1.0 - t1) + 0.001
			var c0 := Color(t0, 0, 0)
			var c1 := Color(t1, 0, 0)
			for v in [[p0 - dir * w0, c0], [p0 + dir * w0, c0], [p1 + dir * w1, c1], [p0 - dir * w0, c0], [p1 + dir * w1, c1], [p1 - dir * w1, c1]]:
				st.set_color(v[1])
				st.set_normal(n)
				st.set_uv(Vector2(0.5, 1.0 - v[1].r))
				st.add_vertex(v[0])
	var m := st.commit()
	var mat := ShaderMaterial.new()
	mat.shader = load("res://assets/shaders/grass_field.gdshader")
	m.surface_set_material(0, mat)
	return m


func _process(_d: float) -> void:
	var cam := override_camera if override_camera else get_viewport().get_camera_3d()
	if cam == null:
		return
	# finished background build -> upload (cheap); never blocks the frame
	if _task >= 0 and WorkerThreadPool.is_task_completed(_task):
		WorkerThreadPool.wait_for_task_completion(_task)
		_task = -1
		_apply(_pending, _pending_center, _pending_radius)
	var p := cam.global_position
	if wd and wd.no_grass_ver != _ng_ver and _task < 0:
		_ng_ver = wd.no_grass_ver
		_last = Vector3(INF, 0, INF)
	if _task >= 0 or Vector2(p.x - _last.x, p.z - _last.z).length() < 3.0:
		return
	_last = p
	_pending_center = p
	_pending_radius = float(Settings.get_value("grass_radius"))
	var dens := float(Settings.get_value("grass_density"))
	_task = WorkerThreadPool.add_task(_build_buffer.bind(p, _pending_radius, dens), false, "grass")


## Synchronous rebuild (tests/captures).
func rebuild(center: Vector3) -> void:
	var radius := float(Settings.get_value("grass_radius"))
	_build_buffer(center, radius, float(Settings.get_value("grass_density")))
	_apply(_pending, center, radius)


func _build_buffer(center: Vector3, radius: float, dens: float) -> void:
	var step := 0.30 / sqrt(dens)
	var xs: PackedFloat32Array = []
	var cnt := 0
	var r2 := radius * radius
	var cell_ok := {}                     ## open world: grass_ok per 2 m cell (one check for ~25 clumps)
	var gx0 := floori((center.x - radius) / step)
	var gx1 := ceili((center.x + radius) / step)
	var gz0 := floori((center.z - radius) / step)
	var gz1 := ceili((center.z + radius) / step)
	xs.resize((gx1 - gx0 + 1) * (gz1 - gz0 + 1) * STRIDE)
	for gz in range(gz0, gz1 + 1):
		for gx in range(gx0, gx1 + 1):
			var hsh := (gx * 73856093) ^ (gz * 19349663)
			var h2 := (hsh * 1103515245 + 12345) & 0x7fffffff
			var jx := float(hsh & 1023) / 1023.0 * 1.6 - 0.3
			var jz := float(h2 & 1023) / 1023.0 * 1.6 - 0.3
			var x := (gx + jx) * step
			var z := (gz + jz) * step
			var dx := x - center.x
			var dz := z - center.z
			if dx * dx + dz * dz > r2:
				continue
			var mx := int(x + 300.0)
			var mz := int(z + 300.0)
			var gy := 0.0
			if mx >= 0 and mz >= 0 and mx < W and mz < W:
				if mask[mz * W + mx] == 0:
					continue
				gy = 0.15 + CityWorld.city_relief(x, z)
			elif wd != null:
				var ck := Vector2i(floori(x * 0.5), floori(z * 0.5))
				if not cell_ok.has(ck):
					cell_ok[ck] = wd.grass_ok(x, z)
				if not cell_ok[ck]:
					continue
				gy = wd.height_at(x, z) - 0.02            # open world: on the terrain itself
			else:
				continue
			var rot := float((hsh >> 20) & 1023) / 1023.0 * TAU
			var s := 0.9 + float((h2 >> 12) & 255) / 255.0 * 0.7
			var c := cos(rot) * s
			var sn := sin(rot) * s
			var o := cnt * STRIDE
			xs[o] = c; xs[o + 1] = 0.0; xs[o + 2] = sn; xs[o + 3] = x
			xs[o + 4] = 0.0; xs[o + 5] = s; xs[o + 6] = 0.0; xs[o + 7] = gy
			xs[o + 8] = -sn; xs[o + 9] = 0.0; xs[o + 10] = c; xs[o + 11] = z
			xs[o + 12] = 1.0; xs[o + 13] = 1.0; xs[o + 14] = 1.0; xs[o + 15] = 1.0   # instance colour
			xs[o + 16] = jx; xs[o + 17] = jz; xs[o + 18] = 0.0; xs[o + 19] = 0.0     # custom (unused by shaders)
			cnt += 1
	xs.resize(cnt * STRIDE)
	_pending = xs


func _apply(xs: PackedFloat32Array, center: Vector3, radius: float) -> void:
	var cnt := xs.size() / STRIDE
	var mm := _mmi.multimesh
	mm.instance_count = cnt
	if cnt > 0:
		mm.buffer = xs
	var m := mm.mesh.surface_get_material(0) as ShaderMaterial
	if m and m.shader and m.shader.resource_path.ends_with("grass.gdshader"):
		m.set_shader_parameter("fade_start", radius * 0.65)
		m.set_shader_parameter("fade_end", radius * 0.95)
	RenderingServer.global_shader_parameter_set(&"grass_center", Vector3(center.x, 0, center.z))
	RenderingServer.global_shader_parameter_set(&"grass_radius", radius)


func _exit_tree() -> void:
	if _task >= 0:
		WorkerThreadPool.wait_for_task_completion(_task)
		_task = -1
