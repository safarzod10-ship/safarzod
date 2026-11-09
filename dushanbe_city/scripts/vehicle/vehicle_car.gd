class_name VehicleCar
extends VehiclePrado
## Other drivable vehicles on the SAME physics as the Prado (VehiclePrado: raycast suspension, tyre
## model, gearbox, damage, fuel, lights, audio), configured by a preset before it enters the tree:
##   "camry"  Toyota Camry 2020 (ItsDiyor, CC-BY 4.0): front-drive sedan, 60 l tank. The source has
##            the wheels baked into the body mesh: they are cut out geometrically (triangles inside
##            each tyre's cylinder) so they spin and steer.
##   "lexus"  Lexus RX 350 2022 (ActsOfDoge, Sketchfab Standard licence): AWD crossover, 72 l tank.
##   "bus"    city bus (12.2 m, supplied by the project owner): 829 parts merged per material into
##            10 meshes (draw calls), wheels found by name; rear dual wheels spin together. 250 l tank.
## The model is turned so its front is -Z, the ground is at _ground_y and the axle midpoint at z = 0.
## Wheel pivots / spinners are named like the Prado's dummies so the parent code drives them.

const PRESETS := {
	"camry": {"file": "camry.glb", "yaw": PI, "wheels": "split", "paint": ["Paint_Color"],
		"mass": 1560.0, "cg": 0.52, "front": 0.61, "kw": 152.0, "nm": 250.0, "vmax": 210.0, "split": 1.0,
		"gears": [3.30, 2.00, 1.40, 1.00, 0.76, 0.62], "fd": 3.70, "mu": 0.95, "f": [1.55, 1.5], "arb": [16000.0, 8000.0],
		"tank": 60.0, "l100": 7.8, "r": 0.336, "size": Vector3(1.84, 1.445, 4.885), "cd": 0.62, "brake": 19000.0,
		"door": Vector3(-0.95, 0.55, -0.35), "seat": Vector3(-0.38, 0.52, 0.15), "lamp": Vector3(0, 0.65, -2.3),
		"boxes": [[Vector3(1.8, 0.62, 4.8), Vector3(0, 0.16 + 0.31, 0)], [Vector3(1.58, 0.55, 2.4), Vector3(0, 0.78 + 0.27, 0.25)]],
		"name": "Toyota Camry"},
	"lexus": {"file": "lexus_rx.glb", "yaw": 0.0, "wheels": "materials",
		"wheel_mats": ["Material.056", "Material.057", "mat_0001_wheel", "mat_0003_rotor_j"], "paint": ["Material.049", "Material.051"],
		"mass": 2050.0, "cg": 0.66, "front": 0.56, "kw": 220.0, "nm": 362.0, "vmax": 200.0, "split": 0.45,
		"gears": [4.6, 2.7, 1.8, 1.4, 1.0, 0.79], "fd": 3.30, "mu": 0.93, "f": [1.45, 1.4], "arb": [17000.0, 8000.0],
		"tank": 72.0, "l100": 10.5, "r": 0.39, "size": Vector3(1.92, 1.71, 4.89), "cd": 0.85, "brake": 24000.0,
		"door": Vector3(-1.0, 0.6, -0.4), "seat": Vector3(-0.38, 0.68, 0.1), "lamp": Vector3(0, 0.75, -2.35),
		"boxes": [[Vector3(1.9, 0.75, 4.85), Vector3(0, 0.2 + 0.375, 0)], [Vector3(1.7, 0.65, 2.9), Vector3(0, 0.95 + 0.33, 0.2)]],
		"name": "Lexus RX 350"},
	"bus": {"file": "city_bus.glb", "yaw": -PI * 0.5, "wheels": "names", "merge": true, "paint": ["paint"],
		"mass": 12000.0, "cg": 1.05, "front": 0.36, "kw": 210.0, "nm": 1100.0, "vmax": 90.0, "split": 0.0,
		"gears": [3.40, 1.90, 1.40, 1.00, 0.78, 0.70], "fd": 5.6, "mu": 0.85, "f": [1.25, 1.3], "arb": [160000.0, 120000.0],
		"tank": 250.0, "l100": 32.0, "r": 0.5, "size": Vector3(2.55, 3.2, 12.2), "cd": 5.5, "brake": 120000.0,
		"door": Vector3(-1.35, 0.5, -4.6), "seat": Vector3(-0.75, 1.35, -4.85), "lamp": Vector3(0, 1.0, -6.05),
		"boxes": [[Vector3(2.5, 2.3, 12.0), Vector3(0, 0.4 + 1.15, 0)], [Vector3(2.4, 0.7, 11.6), Vector3(0, 2.7 + 0.35, 0)]],
		"cam": 1.9, "name": "Автобус"},
}

var preset := "camry"
var spec: Dictionary = {}
static var _split_cache := {}        ## preset -> {"body": Array of [Mesh, Transform3D], "wheels": ...}


## call before add_child
func configure(p: String) -> void:
	preset = p
	spec = PRESETS[p]
	vehicle_mass = spec["mass"]
	cg_height = spec["cg"]
	front_weight = spec["front"]
	max_power_kw = spec["kw"]
	max_torque = spec["nm"]
	top_speed_kmh = spec["vmax"]
	front_split = spec["split"]
	var g: Array = spec["gears"]
	gears.assign(g)
	final_drive = spec["fd"]
	mu = spec["mu"]
	freq_front = spec["f"][0]
	freq_rear = spec["f"][1]
	arb_front = spec["arb"][0]
	arb_rear = spec["arb"][1]
	tank_l = spec["tank"]
	consumption_l100 = spec["l100"]
	fuel_l = tank_l * 0.55
	wheel_radius = spec["r"]
	body_size = spec["size"]
	cd_a = spec["cd"]
	brake_force = spec["brake"]
	cam_scale = spec.get("cam", 1.0)
	_ground_y = -(wheel_radius + 0.18) if p != "bus" else -0.75


func _build_model() -> void:
	if spec.is_empty():
		configure(preset)
	model = Node3D.new()
	model.name = "Model"
	add_child(model)
	var holder := Node3D.new()
	holder.name = "Body"
	holder.transform = Transform3D(Basis(Vector3.UP, float(spec["yaw"])), Vector3(0.0, _ground_y, 0.0))
	model.add_child(holder)
	var src: Node3D = (load("res://assets/models/extra/" + String(spec["file"])) as PackedScene).instantiate()
	holder.add_child(src)
	# wheel parts (MeshInstances) per quadrant
	var wheel_parts: Array = []
	match String(spec["wheels"]):
		"materials":
			for mi in src.find_children("*", "MeshInstance3D", true, false):
				var m := mi as MeshInstance3D
				var mat := m.mesh.surface_get_material(0)
				if mat and (spec["wheel_mats"] as Array).has(mat.resource_name):
					wheel_parts.append(m)
		"names":
			for mi in src.find_children("*", "MeshInstance3D", true, false):
				var nm := String(mi.name).to_lower()
				if (nm.contains("tire") or nm.contains("heavy wheel") or nm.contains("commercial wheel") or nm.contains("formed wheel") or nm.contains("wheel nut") or nm.contains("hubcap")) \
						and not nm.contains("house") and not nm.contains("steering") and not nm.contains("arch"):
					wheel_parts.append(mi)
		"split":
			wheel_parts = _split_wheels(src)
	# centres -> axle midpoint at z = 0
	var cz := 0.0
	var zs: Array[float] = []
	for m in wheel_parts:
		var c := _centre_in(m as MeshInstance3D, model)
		zs.append(c.z)
	if not zs.is_empty():
		cz = (zs.min() + zs.max()) * 0.5
	holder.position.z -= cz
	var groups := {}
	var radii: Array[float] = []
	for m in wheel_parts:
		var mi := m as MeshInstance3D
		var c := _centre_in(mi, model)
		var key := ("l" if c.x < 0.0 else "r") + ("f" if c.z < 0.0 else "b")
		if not groups.has(key):
			groups[key] = []
		groups[key].append(mi)
	for key in groups:
		var box := AABB()
		var first := true
		for mi in groups[key]:
			var b := _rel(mi, model) * (mi as MeshInstance3D).mesh.get_aabb()
			box = b if first else box.merge(b)
			first = false
		var centre := box.get_center()
		radii.append(box.size.y * 0.5)
		var dummy := Node3D.new()
		dummy.name = "wheel_%s_dummy" % key
		dummy.position = centre
		model.add_child(dummy)
		var spin := Node3D.new()
		spin.name = "Spin"
		dummy.add_child(spin)
		for mi in groups[key]:
			var keep := _rel(mi, model)
			mi.get_parent().remove_child(mi)
			spin.add_child(mi)
			mi.transform = Transform3D(Basis.IDENTITY, -centre) * keep
	if not radii.is_empty():
		var rs := 0.0
		for q in radii:
			rs += q
		wheel_radius = rs / radii.size()          # the model's real tyre radius
	if spec.get("merge", false):
		_merge_by_material(src, model, "Merged")
		for d in model.get_children():
			if String(d.name).begins_with("wheel_") and d.get_child_count() > 0:
				_merge_by_material(d.get_child(0), d.get_child(0), "Rim")
	for mi in model.find_children("*", "MeshInstance3D", true, false):
		var m := mi as MeshInstance3D
		m.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
		_hi_meshes[m] = m.mesh
		_apply_materials(m)
	for spec2 in [["door_lf_dummy", spec["door"]], ["ped_frontseat", spec["seat"]], ["headlights", spec["lamp"]]]:
		var n := Node3D.new()
		n.name = spec2[0]
		var v: Vector3 = spec2[1]                 # x, height above the ground, z
		n.position = Vector3(v.x, _ground_y + v.y, v.z)
		model.add_child(n)
	_update_part_uniforms()


func _style_material(sm: ShaderMaterial, key: String, src: BaseMaterial3D) -> void:
	super(sm, key, src)
	if (spec.get("paint", []) as Array).has(key):
		sm.set_shader_parameter("paint", 1.0)
		sm.set_shader_parameter("roughness", 0.22)
		sm.set_shader_parameter("specular", 0.6)


func _build_collision() -> void:
	var first := true
	for b in spec["boxes"]:
		var cs := CollisionShape3D.new()
		if first:
			# lower body: bevelled bumper edges (longer on the 12 m bus: its big overhangs)
			cs.shape = chamfered_box(b[0], 0.24 if (b[0] as Vector3).z < 8.0 else 0.3, 0.8 if (b[0] as Vector3).z < 8.0 else 1.4)
		else:
			var bs := BoxShape3D.new()
			bs.size = b[0]
			cs.shape = bs
		first = false
		cs.position = (b[1] as Vector3) + Vector3(0, _ground_y, 0)
		add_child(cs)


func apply_quality() -> void:
	var bias: float = [0.5, 0.7, 1.0, 1.4][Settings.quality]
	for mi in model.find_children("*", "MeshInstance3D", true, false):
		(mi as MeshInstance3D).lod_bias = bias


static func _rel(n: Node3D, root: Node3D) -> Transform3D:
	var xf := Transform3D.IDENTITY
	var c: Node = n
	while c != root and c != null:
		xf = (c as Node3D).transform * xf
		c = c.get_parent()
	return xf


static func _centre_in(mi: MeshInstance3D, root: Node3D) -> Vector3:
	return _rel(mi, root) * mi.mesh.get_aabb().get_center()


## many small parts -> one mesh per material (the bus: 829 parts -> ~10 draw calls)
func _merge_by_material(src: Node3D, into: Node3D, label: String) -> void:
	var tools := {}
	var mats := {}
	var parts := src.find_children("*", "MeshInstance3D", true, false)
	if parts.size() < 2:
		return
	for mi in parts:
		var m := mi as MeshInstance3D
		var xf := _rel(m, into)
		for s in m.mesh.get_surface_count():
			var mat := m.mesh.surface_get_material(s)
			var k := mat.resource_name if mat else "none"
			if not tools.has(k):
				var st := SurfaceTool.new()
				st.begin(Mesh.PRIMITIVE_TRIANGLES)
				tools[k] = st
				mats[k] = mat
			(tools[k] as SurfaceTool).append_from(m.mesh, s, xf)
		m.get_parent().remove_child(m)
		m.queue_free()
	for k in tools:
		var mesh := (tools[k] as SurfaceTool).commit()
		if mesh.get_surface_count() > 0:
			mesh.surface_set_material(0, mats[k])
		var mi2 := MeshInstance3D.new()
		mi2.name = label + "_" + String(k)
		mi2.mesh = mesh
		into.add_child(mi2)


## the Camry: tyres + rims are part of the body meshes. Find the tyres' ground contacts (two axles,
## two sides), then move every triangle lying inside a wheel's cylinder (radius r + 2 cm, tyre width)
## into a separate mesh per wheel; returns the new wheel MeshInstances (under src's parents).
func _split_wheels(src: Node3D) -> Array:
	var r := wheel_radius
	var out: Array = []
	var meshes := src.find_children("*", "MeshInstance3D", true, false)
	# 1. contact points in model (source) space: vertices at the ground, outboard
	var contacts: Array[Vector3] = []
	for mi in meshes:
		var m := mi as MeshInstance3D
		var lx := _rel(m, src)
		for s in m.mesh.get_surface_count():
			var a: Array = m.mesh.surface_get_arrays(s)
			var V: PackedVector3Array = a[Mesh.ARRAY_VERTEX]
			for v in V:
				var p := lx * v
				if p.y < 0.035 and absf(p.x) > 0.55:
					contacts.append(p)
	if contacts.size() < 8:
		return out
	var zmin := INF
	var zmax := -INF
	for p in contacts:
		zmin = minf(zmin, p.z)
		zmax = maxf(zmax, p.z)
	var zmid := (zmin + zmax) * 0.5
	var centres := {}
	for key in ["lf", "rf", "lb", "rb"]:
		centres[key] = [Vector3.ZERO, 0]
	for p in contacts:
		var key := ("l" if p.x > 0.0 else "r") + ("f" if p.z > zmid else "b")   # source: front +Z, left +X
		centres[key][0] += p
		centres[key][1] += 1
	var wc := {}
	for key in centres:
		if int(centres[key][1]) == 0:
			return out
		var c: Vector3 = centres[key][0] / float(centres[key][1])
		wc[key] = Vector3(c.x, r, c.z)
	# 2. split the triangles
	for mi in meshes:
		var m := mi as MeshInstance3D
		var lx := _rel(m, src)
		var new_body := ArrayMesh.new()
		var wheel_meshes := {}
		for s in m.mesh.get_surface_count():
			var a0: Array = m.mesh.surface_get_arrays(s)
			# keep only the plain channels (custom / bone channels need format flags)
			var a: Array = []
			a.resize(Mesh.ARRAY_MAX)
			for ch in [Mesh.ARRAY_VERTEX, Mesh.ARRAY_NORMAL, Mesh.ARRAY_TANGENT, Mesh.ARRAY_COLOR, Mesh.ARRAY_TEX_UV, Mesh.ARRAY_TEX_UV2, Mesh.ARRAY_INDEX]:
				a[ch] = a0[ch]
			var V: PackedVector3Array = a[Mesh.ARRAY_VERTEX]
			var I: PackedInt32Array = a[Mesh.ARRAY_INDEX] if a[Mesh.ARRAY_INDEX] != null else PackedInt32Array()
			if I.is_empty():
				I.resize(V.size())
				for q in V.size():
					I[q] = q
			var body_idx := PackedInt32Array()
			var wheel_idx := {}
			for t in range(0, I.size(), 3):
				var hit := ""
				for key in wc:
					var c: Vector3 = wc[key]
					var inside := true
					for q in 3:
						var p := lx * V[I[t + q]]
						if absf(p.x - c.x) > 0.16 or Vector2(p.y - c.y, p.z - c.z).length() > r + 0.02 or absf(p.x) < 0.5:
							inside = false
							break
					if inside:
						hit = key
						break
				if hit == "":
					body_idx.append_array([I[t], I[t + 1], I[t + 2]])
				else:
					if not wheel_idx.has(hit):
						wheel_idx[hit] = []              # plain Array: a PackedInt32Array in a Dictionary is copied
					(wheel_idx[hit] as Array).append_array([I[t], I[t + 1], I[t + 2]])
			var mat := m.mesh.surface_get_material(s)
			var ab := a.duplicate()
			ab[Mesh.ARRAY_INDEX] = body_idx
			if not body_idx.is_empty():
				new_body.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, ab)
				new_body.surface_set_material(new_body.get_surface_count() - 1, mat)
			for key in wheel_idx:
				if not wheel_meshes.has(key):
					wheel_meshes[key] = ArrayMesh.new()
				var aw := _compact(a, PackedInt32Array(wheel_idx[key]))
				var wm: ArrayMesh = wheel_meshes[key]
				wm.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, aw)
				wm.surface_set_material(wm.get_surface_count() - 1, mat)
		m.mesh = new_body
		for key in wheel_meshes:
			var w := MeshInstance3D.new()
			w.name = "Wheel_" + String(key) + "_" + String(m.name)
			w.mesh = wheel_meshes[key]
			w.transform = m.transform
			m.get_parent().add_child(w)
			out.append(w)
	return out


## arrays holding only the vertices used by `idx` (re-indexed)
static func _compact(a: Array, idx: PackedInt32Array) -> Array:
	var remap := {}
	var order := PackedInt32Array()
	var ni := PackedInt32Array()
	ni.resize(idx.size())
	for q in idx.size():
		var o := idx[q]
		if not remap.has(o):
			remap[o] = order.size()
			order.append(o)
		ni[q] = remap[o]
	var out: Array = []
	out.resize(Mesh.ARRAY_MAX)
	for ch in [Mesh.ARRAY_VERTEX, Mesh.ARRAY_NORMAL, Mesh.ARRAY_TEX_UV, Mesh.ARRAY_TEX_UV2, Mesh.ARRAY_COLOR]:
		var src = a[ch]
		if src == null:
			continue
		var dst = src.duplicate()
		dst.resize(order.size())
		for q in order.size():
			dst[q] = src[order[q]]
		out[ch] = dst
	if a[Mesh.ARRAY_TANGENT] != null:
		var t: PackedFloat32Array = a[Mesh.ARRAY_TANGENT]
		var nt := PackedFloat32Array()
		nt.resize(order.size() * 4)
		for q in order.size():
			for c in 4:
				nt[q * 4 + c] = t[order[q] * 4 + c]
		out[Mesh.ARRAY_TANGENT] = nt
	out[Mesh.ARRAY_INDEX] = ni
	return out
