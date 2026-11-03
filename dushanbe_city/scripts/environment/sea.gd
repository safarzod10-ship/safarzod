class_name Sea
extends MeshInstance3D
## The sea: one radial mesh centred on the active camera (fine rings near the viewer, coarse towards
## the 9 km horizon), snapped to an 8 m grid while it follows the camera. The shader evaluates waves
## and colours in WORLD space, so following the camera never makes the water "swim".
## Alpha-blended shallows, no screen/depth reads: depth colour and foam come from the baked sea_mask.png;
## Gerstner waves in the vertex shader (see sea.gdshader).
## Per preset: ring/segment density, vertex swell (High/Ultra), third normal layer + foam lines (Medium+).

const SEA_LEVEL := -1.6
const RADIUS := 9000.0

var _q := -1


func _ready() -> void:
	position.y = SEA_LEVEL
	cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	var m := ShaderMaterial.new()
	m.shader = load("res://assets/shaders/sea.gdshader")
	m.set_shader_parameter("mask_tex", load("res://assets/terrain/sea_mask.png"))
	m.set_shader_parameter("wave_nrm", load("res://assets/textures/sea/wave_normal.png"))
	m.set_shader_parameter("foam_tex", load("res://assets/textures/noise_macro.png"))
	material_override = m
	custom_aabb = AABB(Vector3(-RADIUS, -5, -RADIUS), Vector3(RADIUS * 2, 10, RADIUS * 2))
	sorting_offset = -50.0                     # transparent: drawn before particles / the wake
	apply_quality(Settings.quality)


func apply_quality(q: int) -> void:
	if q == _q:
		return
	_q = q
	var segs: int = [64, 96, 128, 160][q]           # Gerstner waves need vertices near the viewer
	var growth: float = [1.16, 1.12, 1.09, 1.08][q]
	mesh = _radial_mesh(segs, growth)
	var m := material_override as ShaderMaterial
	m.set_shader_parameter("detail", 0.0 if q == Settings.Quality.LOW else 1.0)
	m.set_shader_parameter("foam_amount", 0.7 if q == Settings.Quality.LOW else 1.0)
	m.set_shader_parameter("wave_scale", [0.6, 1.0, 1.0, 1.0][q])


func _process(_delta: float) -> void:
	var cam := get_viewport().get_camera_3d()
	if cam:
		var p := cam.global_position
		global_position = Vector3(snappedf(p.x, 8.0), SEA_LEVEL, snappedf(p.z, 8.0))


static func _radial_mesh(segs: int, growth: float) -> ArrayMesh:
	var radii: Array[float] = [0.0]
	var r := 2.0
	while r < RADIUS:
		radii.append(r)
		r = maxf(r * growth, r + 2.0)
	radii.append(RADIUS)
	var verts := PackedVector3Array()
	var idx := PackedInt32Array()
	verts.append(Vector3.ZERO)
	for k in range(1, radii.size()):
		for s in segs:
			var a := TAU * s / segs + (0.5 * TAU / segs if k % 2 == 0 else 0.0)
			verts.append(Vector3(sin(a) * radii[k], 0.0, cos(a) * radii[k]))
	# centre fan
	for s in segs:
		idx.append_array([0, 1 + (s + 1) % segs, 1 + s])
	for k in range(1, radii.size() - 1):
		var a0 := 1 + (k - 1) * segs
		var b0 := 1 + k * segs
		for s in segs:
			var a := a0 + s
			var a1 := a0 + (s + 1) % segs
			var b := b0 + s
			var b1 := b0 + (s + 1) % segs
			idx.append_array([a, a1, b, a1, b1, b])
	var normals := PackedVector3Array()
	normals.resize(verts.size())
	normals.fill(Vector3.UP)
	var tangents := PackedFloat32Array()
	for i in verts.size():
		tangents.append_array([1.0, 0.0, 0.0, 1.0])
	var arr := []
	arr.resize(Mesh.ARRAY_MAX)
	arr[Mesh.ARRAY_VERTEX] = verts
	arr[Mesh.ARRAY_NORMAL] = normals
	arr[Mesh.ARRAY_TANGENT] = tangents
	arr[Mesh.ARRAY_INDEX] = idx
	var am := ArrayMesh.new()
	am.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arr)
	return am
