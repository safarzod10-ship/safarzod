class_name WorldModels
extends RefCounted
## Imported models used by the open world (assets/models/extra, all CC-BY 4.0, see docs/CREDITS.md):
## the parts (mesh + transform relative to a chosen origin) are extracted once from each glTF scene
## and cached, then placed as MeshInstances / MultiMeshes by OpenWorld.
##   sky        skyscraper (22 x 22 x 114 m)                 origin: footprint centre, ground
##   villa1..4  low-poly modern houses (4 sub-models)        origin: footprint centre, ground
##   billboard  metal billboard (post at the origin, poster facing +X), + the DushanbeCity ad poster
##   guardrail  W-beam guardrail segment, 10 m along Z     origin: centre, ground
##   flag       national flag of Tajikistan on its pole      origin: foot of the pole
##   laklak     factory / warehouse building (LakLak depot)  origin: footprint centre, ground
##   rp_lamp_a/b/c, rp_bench  street lamps / bench of the modular city road pack (x3.2 scale)

const DIR := "res://assets/models/extra/"
static var _cache := {}
static var _mats := {}
## roadside billboard posters (supplied by the project owner), in turn along the roads
const ADS := ["res://assets/textures/ads/ad_dcnext.png", "res://assets/textures/ads/ad_orienbank.png",
	"res://assets/textures/ads/ad_laklak.png", "res://assets/textures/ads/ad_eskhata.png"]


## Array of [Mesh, Transform3D] for a model key (main thread)
static func parts(key: String) -> Array:
	if _cache.has(key):
		return _cache[key]
	var out: Array = []
	match key:
		"sky":
			out = _extract("skyscraper.glb", func(_n: String) -> bool: return true, true)
		"villa1", "villa2", "villa3", "villa4":
			var k := key.substr(5)
			out = _extract("houses_lowpoly.glb", func(n: String) -> bool: return n.begins_with(k + "_"), true)
		"billboard":
			out = _extract("billboard.glb", func(_n: String) -> bool: return true, false)
		"guardrail":
			out = _extract("guardrail.glb", func(_n: String) -> bool: return true, false)
			# the beam stands on the ground (the source floats 0.4 m above its origin)
			for p in out:
				var xf: Transform3D = p[1]
				xf.origin.y -= 0.405
				p[1] = xf
		"flag":
			out = _extract("tajik_flag.glb", func(_n: String) -> bool: return true, false)
			# foot of the pole at the origin
			var lo := INF
			for p in out:
				var b: AABB = (p[1] as Transform3D) * (p[0] as Mesh).get_aabb()
				lo = minf(lo, b.position.y)
			for p in out:
				var xf2: Transform3D = p[1]
				xf2.origin.y -= lo
				p[1] = xf2
		"laklak":
			out = _extract("laklak_building.glb", func(_n: String) -> bool: return true, true)
		"rp_lamp_a", "rp_lamp_b", "rp_lamp_c", "rp_bench":
			var obj: String = {"rp_lamp_a": "Object_43", "rp_lamp_b": "Object_45", "rp_lamp_c": "Object_47", "rp_bench": "Object_5"}[key]
			if key == "rp_bench":
				out = _extract("road_pack.glb", func(n: String) -> bool: return n == "Object_59" or n == "Object_60", true, 3.2)
			else:
				out = _extract("road_pack.glb", func(n: String) -> bool: return n == obj, true, 3.2)
	_cache[key] = out
	return out


## mesh parts of a glTF scene whose MeshInstance name passes `keep`; transforms relative to the
## scene root (scaled by `scale`), optionally re-centred (footprint centre at x = z = 0, bottom y = 0)
static func _extract(file: String, keep: Callable, recentre: bool, scale := 1.0) -> Array:
	var path := DIR + file
	if not ResourceLoader.exists(path):
		push_warning("WorldModels: missing " + path)
		return []
	var root: Node3D = (load(path) as PackedScene).instantiate()
	var out: Array = []
	var box := AABB()
	var first := true
	for n in root.find_children("*", "MeshInstance3D", true, false):
		var mi := n as MeshInstance3D
		if mi.mesh == null or not keep.call(String(mi.name)):
			continue
		var xf := Transform3D.IDENTITY
		var c: Node = mi
		while c != root and c != null:
			xf = (c as Node3D).transform * xf
			c = c.get_parent()
		xf = Transform3D(Basis.IDENTITY.scaled(Vector3.ONE * scale), Vector3.ZERO) * xf
		out.append([mi.mesh, xf])
		var b := xf * mi.mesh.get_aabb()
		if first:
			box = b
			first = false
		else:
			box = box.merge(b)
	root.free()
	if recentre and not out.is_empty():
		var shift := Vector3(-(box.position.x + box.size.x * 0.5), -box.position.y, -(box.position.z + box.size.z * 0.5))
		for p in out:
			var xf: Transform3D = p[1]
			xf.origin += shift
			p[1] = xf
	return out


static func aabb(key: String) -> AABB:
	var box := AABB()
	var first := true
	for p in parts(key):
		var b := (p[1] as Transform3D) * (p[0] as Mesh).get_aabb()
		if first:
			box = b
			first = false
		else:
			box = box.merge(b)
	return box


## instance a model under `parent` at transform `xf` (MeshInstances, shadows on)
static func place(parent: Node3D, key: String, xf: Transform3D, vis_end := 0.0, shadows := true) -> Node3D:
	var root := Node3D.new()
	root.name = key
	root.transform = xf
	parent.add_child(root)
	for p in parts(key):
		var mi := MeshInstance3D.new()
		mi.mesh = p[0]
		mi.transform = p[1]
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if shadows else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		if vis_end > 0.0:
			mi.visibility_range_end = vis_end
			mi.visibility_range_end_margin = vis_end * 0.05
			mi.visibility_range_fade_mode = GeometryInstance3D.VISIBILITY_RANGE_FADE_DISABLED
		root.add_child(mi)
	return root


## MultiMesh instances of a model (one MultiMeshInstance per part) under `parent`
static func multi(parent: Node3D, key: String, xfs: Array, vis_end := 0.0, shadows := false) -> void:
	if xfs.is_empty():
		return
	for p in parts(key):
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_3D
		mm.mesh = p[0]
		mm.instance_count = xfs.size()
		var local: Transform3D = p[1]
		for i in xfs.size():
			mm.set_instance_transform(i, (xfs[i] as Transform3D) * local)
		var mmi := MultiMeshInstance3D.new()
		mmi.multimesh = mm
		mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if shadows else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		if vis_end > 0.0:
			mmi.visibility_range_end = vis_end
		parent.add_child(mmi)


# ------------------------------------------------------------------------------------------ billboard
## the advertising poster (4 banners in turn: DCnext, Orienbank, LakLak, Eskhata), lit at night
static func ad_material(variant: int) -> Material:
	var key := "ad%d" % variant
	if _mats.has(key):
		return _mats[key]
	var sm := ShaderMaterial.new()
	sm.shader = load("res://assets/shaders/billboard_ad.gdshader")
	var p: String = ADS[variant % ADS.size()]
	if ResourceLoader.exists(p):
		sm.set_shader_parameter("poster", load(p))
	_mats[key] = sm
	return sm


## a complete billboard (model + poster + lamps + collision) at world position / yaw
static func billboard(parent: Node3D, pos: Vector3, yaw: float, variant: int) -> Node3D:
	var root := place(parent, "billboard", Transform3D(Basis(Vector3.UP, yaw), pos), 900.0, true)
	root.name = "Billboard"
	# the poster: the board's front face is at x = +1.69, y 7.15 .. 11.74, z -5.54 .. 5.53 (model)
	var q := QuadMesh.new()
	q.size = Vector2(10.75, 4.32)
	var mi := MeshInstance3D.new()
	mi.name = "Poster"
	mi.mesh = q
	mi.material_override = ad_material(variant)
	mi.position = Vector3(1.705, 9.445, 0.0)
	mi.rotation.y = PI * 0.5                    # quad normal (+Z) -> +X
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.visibility_range_end = 900.0
	root.add_child(mi)
	var body := StaticBody3D.new()
	body.name = "BillboardBody"
	root.add_child(body)
	for spec in [[Vector3(0.0, 3.6, 0.0), Vector3(0.9, 7.2, 0.9)], [Vector3(1.0, 9.45, 0.0), Vector3(1.4, 4.6, 11.07)]]:
		var cs := CollisionShape3D.new()
		var bs := BoxShape3D.new()
		bs.size = spec[1]
		cs.shape = bs
		cs.position = spec[0]
		body.add_child(cs)
	root.add_to_group(&"billboard")
	return root
