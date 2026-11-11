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
		"name": "Toyota Camry", "color": Color(0.02, 0.022, 0.026), "interior": true,
		"door_cut": {"x": -0.5, "y": [-0.27, 0.9], "z": [-0.76, 0.26]},
		"cabin": Vector3(0.9, 0.84, 0.78), "cabin_clip": [0.72, 1.2],
		"cut": [AABB(Vector3(-0.64, 0.18, -0.62), Vector3(0.5, 0.52, 0.55))]},
	"lexus": {"file": "lexus_rx.glb", "yaw": 0.0, "wheels": "materials",
		"wheel_mats": ["Material.056", "Material.057", "mat_0001_wheel", "mat_0003_rotor_j"], "paint": ["Material.049", "Material.051"],
		"mass": 2050.0, "cg": 0.66, "front": 0.56, "kw": 220.0, "nm": 362.0, "vmax": 200.0, "split": 0.45,
		"gears": [4.6, 2.7, 1.8, 1.4, 1.0, 0.79], "fd": 3.30, "mu": 0.93, "f": [1.45, 1.4], "arb": [17000.0, 8000.0],
		"tank": 72.0, "l100": 10.5, "r": 0.39, "size": Vector3(1.92, 1.71, 4.89), "cd": 0.85, "brake": 24000.0,
		"door": Vector3(-1.0, 0.6, -0.4), "seat": Vector3(-0.38, 0.68, 0.1), "lamp": Vector3(0, 0.75, -2.35),
		"boxes": [[Vector3(1.9, 0.75, 4.85), Vector3(0, 0.2 + 0.375, 0)], [Vector3(1.7, 0.65, 2.9), Vector3(0, 0.95 + 0.33, 0.2)]],
		"name": "Lexus RX 350", "color": Color(0.03, 0.07, 0.2), "interior": true, "hide": ["Object_19", "Object_21"],
		"door_cut": {"x": -0.5, "y": [-0.2, 1.1], "z": [-0.74, 0.26]},
		"cabin": Vector3(0.94, 0.92, 0.85), "cabin_clip": [0.9, 1.55]},
	"bus": {"file": "city_bus.glb", "yaw": -PI * 0.5, "wheels": "names", "merge": true, "paint": ["paint"],
		"mass": 12000.0, "cg": 1.05, "front": 0.36, "kw": 210.0, "nm": 1100.0, "vmax": 90.0, "split": 0.0,
		"gears": [3.40, 1.90, 1.40, 1.00, 0.78, 0.70], "fd": 5.6, "mu": 0.85, "f": [1.25, 1.3], "arb": [160000.0, 120000.0],
		"tank": 250.0, "l100": 32.0, "r": 0.5, "size": Vector3(2.55, 3.2, 12.2), "cd": 5.5, "brake": 120000.0,
		"door": Vector3(-1.35, 0.5, -4.6), "seat": Vector3(-0.75, 1.35, -4.85), "lamp": Vector3(0, 1.0, -6.05),
		"boxes": [[Vector3(2.5, 2.3, 12.0), Vector3(0, 0.4 + 1.15, 0)], [Vector3(2.4, 0.7, 11.6), Vector3(0, 2.7 + 0.35, 0)]],
		"cam": 1.9, "name": "Автобус"},
	# 0.25: the owner's car pack (car_pack_1.glb, split by dushanbe_city_src/tools/vehicles/car_pack.py):
	# the wheels are separate ("tire_N"), the lamps are painted on the texture with additive lens quads
	# over them, the European plates are covered by Tajik ones (number = Label3D, changeable)
	"w123": {"file": "../cars/w123.glb", "yaw": PI, "wheels": "names", "paint": [], "pack": true,
		"mass": 1400.0, "cg": 0.55, "front": 0.53, "kw": 100.0, "nm": 185.0, "vmax": 180.0, "split": 0.0,
		"gears": [3.98, 2.39, 1.46, 1.0, 0.83], "fd": 3.69, "mu": 0.9, "f": [1.3, 1.25], "arb": [14000.0, 6000.0],
		"tank": 65.0, "l100": 10.5, "r": 0.308, "size": Vector3(1.79, 1.44, 4.73), "cd": 0.85, "brake": 17000.0,
		"door": Vector3(-1.0, 0.55, -0.2), "seat": Vector3(-0.38, 0.36, 0.3), "lamp": Vector3(0, 0.66, -2.35),
		"boxes": [[Vector3(1.78, 0.6, 4.72), Vector3(0, 0.18 + 0.3, 0)], [Vector3(1.5, 0.5, 2.3), Vector3(0, 0.78 + 0.25, 0.2)]],
		"name": "Mercedes-Benz W123", "inner": true, "interior": true, "cabin": Vector3(0.92, 1.08, 0.82), "cabin_clip": [0.95, 1.25]},
	"e30": {"file": "../cars/e30.glb", "yaw": PI, "wheels": "names", "paint": [], "pack": true,
		"mass": 1210.0, "cg": 0.5, "front": 0.52, "kw": 125.0, "nm": 226.0, "vmax": 215.0, "split": 0.0,
		"gears": [3.83, 2.2, 1.4, 1.0, 0.81], "fd": 3.73, "mu": 0.95, "f": [1.5, 1.45], "arb": [16000.0, 9000.0],
		"tank": 55.0, "l100": 9.0, "r": 0.308, "size": Vector3(1.66, 1.36, 4.3), "cd": 0.7, "brake": 16000.0,
		"door": Vector3(-0.95, 0.55, -0.1), "seat": Vector3(-0.36, 0.48, 0.2), "lamp": Vector3(0, 0.6, -2.12),
		"boxes": [[Vector3(1.64, 0.58, 4.28), Vector3(0, 0.17 + 0.29, 0)], [Vector3(1.4, 0.48, 2.0), Vector3(0, 0.75 + 0.24, 0.15)]],
		"name": "BMW E30", "interior": true, "cabin": Vector3(0.86, 0.8, 0.74), "cabin_clip": [0.68, 1.1]},
	"e30m": {"file": "../cars/e30_low.glb", "yaw": PI, "wheels": "names", "paint": [], "pack": true,
		"mass": 1180.0, "cg": 0.45, "front": 0.5, "kw": 162.0, "nm": 240.0, "vmax": 235.0, "split": 0.0,
		"gears": [3.72, 2.4, 1.77, 1.26, 1.0], "fd": 3.25, "mu": 0.98, "f": [1.8, 1.75], "arb": [22000.0, 9000.0],
		"tank": 55.0, "l100": 10.0, "r": 0.308, "size": Vector3(1.66, 1.3, 4.3), "cd": 0.68, "brake": 18000.0,
		"door": Vector3(-0.95, 0.5, -0.1), "seat": Vector3(-0.36, 0.43, 0.2), "lamp": Vector3(0, 0.56, -2.12),
		"boxes": [[Vector3(1.64, 0.56, 4.28), Vector3(0, 0.12 + 0.28, 0)], [Vector3(1.4, 0.46, 2.0), Vector3(0, 0.7 + 0.23, 0.15)]],
		"name": "BMW E30 (занижена)", "interior": true, "cabin": Vector3(0.86, 0.78, 0.74), "cabin_clip": [0.64, 1.1], "ground_drop": 0.06},
	"r12": {"file": "../cars/r12.glb", "yaw": PI, "wheels": "names", "paint": [], "pack": true,
		"mass": 900.0, "cg": 0.52, "front": 0.6, "kw": 40.0, "nm": 92.0, "vmax": 145.0, "split": 1.0,
		"gears": [3.6, 2.26, 1.48, 1.03], "fd": 4.12, "mu": 0.88, "f": [1.3, 1.25], "arb": [9000.0, 4000.0],
		"tank": 50.0, "l100": 8.0, "r": 0.308, "size": Vector3(1.64, 1.42, 4.3), "cd": 0.75, "brake": 12000.0,
		"door": Vector3(-0.95, 0.55, -0.1), "seat": Vector3(-0.36, 0.36, 0.25), "lamp": Vector3(0, 0.62, -2.15),
		"boxes": [[Vector3(1.62, 0.6, 4.28), Vector3(0, 0.18 + 0.3, 0)], [Vector3(1.4, 0.5, 2.1), Vector3(0, 0.78 + 0.25, 0.1)]],
		"name": "Renault 12", "inner": true, "interior": true, "cabin": Vector3(0.88, 1.06, 0.78), "cabin_clip": [0.92, 1.1]},
	# 0.25: Mercedes-Benz GLS 580 (owner's model, dushanbe_city_src/tools/vehicles/gls.py): black,
	# smoked lamps, 4.0 V8 biturbo, 9G-Tronic, 4MATIC
	"gls": {"file": "../cars/gls.glb", "yaw": PI, "wheels": "names", "paint": ["primary"], "pack": true,
		"mass": 2600.0, "cg": 0.72, "front": 0.52, "kw": 360.0, "nm": 700.0, "vmax": 250.0, "split": 0.45,
		"gears": [5.35, 3.24, 2.25, 1.64, 1.21, 1.0, 0.86, 0.72, 0.6], "fd": 2.82, "mu": 0.96, "f": [1.3, 1.25],
		"arb": [21000.0, 10000.0], "tank": 90.0, "l100": 12.5, "r": 0.387, "size": Vector3(1.96, 1.82, 5.21),
		"cd": 0.95, "brake": 32000.0, "door": Vector3(-1.08, 0.65, -0.35), "seat": Vector3(-0.42, 0.82, 0.15),
		"lamp": Vector3(0, 0.88, -2.55),
		"boxes": [[Vector3(1.94, 0.85, 5.15), Vector3(0, 0.3 + 0.42, 0)], [Vector3(1.78, 0.62, 3.3), Vector3(0, 1.15 + 0.31, 0.25)]],
		"name": "Mercedes-Benz GLS 580", "color": Color(0.012, 0.012, 0.014), "interior": false, "mesh_lamps": true},
}

var preset := "camry"
var spec: Dictionary = {}
static var _split_cache := {}        ## preset -> {"body": Array of [Mesh, Transform3D], "wheels": ...}


## call before add_child
## engine voice per preset (see VehiclePrado.engine_voice): petrol I4 / V6 / I6 / V8 / bus diesel
const VOICES := {
	"camry": {"cyl": 4.0, "pitch": 1.12, "db": -2.0}, "lexus": {"cyl": 6.0, "pitch": 1.0, "db": -1.5},
	"bus": {"cyl": 6.0, "pitch": 0.62, "db": 1.5}, "w123": {"cyl": 4.0, "pitch": 0.9, "db": -1.0},
	"e30": {"cyl": 6.0, "pitch": 1.05, "db": 0.0}, "e30m": {"cyl": 4.0, "pitch": 1.3, "db": 1.5},
	"r12": {"cyl": 4.0, "pitch": 1.25, "db": -3.0}, "gls": {"cyl": 8.0, "pitch": 0.82, "db": 1.0},
}


func configure(p: String) -> void:
	preset = p
	engine_voice = VOICES.get(p, engine_voice)
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
	var src: Node3D = (load(("res://assets/models/extra/" + String(spec["file"])).simplify_path()) as PackedScene).instantiate()
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
	# remove parts of the source's own crude cabin (spec "cut": boxes, triangles fully inside)
	for bx in spec.get("cut", []):
		_cut_box(holder, bx as AABB)
	if bool(spec.get("pack", false)) and not spec.has("glass_ok"):
		_split_white_glass(holder)
	if bool(spec.get("inner", false)):
		_inner_skin(holder)
	var door_done := false
	if spec.has("door_cut"):
		door_done = _split_door(holder)
	for mi in model.find_children("*", "MeshInstance3D", true, false):
		var m := mi as MeshInstance3D
		m.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
		_hi_meshes[m] = m.mesh
		_apply_materials(m)
	for spec2 in [["door_lf_dummy", spec["door"]], ["ped_frontseat", spec["seat"]], ["headlights", spec["lamp"]]]:
		if door_done and spec2[0] == "door_lf_dummy":
			continue
		var n := Node3D.new()
		n.name = spec2[0]
		var v: Vector3 = spec2[1]                 # x, height above the ground, z
		n.position = Vector3(v.x, _ground_y + v.y, v.z)
		model.add_child(n)
	_update_part_uniforms()

	if bool(spec.get("interior", false)):
		_build_interior()
	if bool(spec.get("pack", false)):
		_pack_lamps_and_plates()


## single-sided shells (no cabin lining): an inner skin = the body's triangles with reversed winding and
## normals, so roof, pillars and door panels are seen from the driver's seat
func _inner_skin(holder: Node3D) -> void:
	for mi in holder.find_children("*", "MeshInstance3D", true, false):
		var m := mi as MeshInstance3D
		var nm := String(m.name).to_lower()
		if m.mesh == null or nm.contains("tire") or nm.contains("lamp") or nm.contains("plate") or nm.contains("glass"):
			continue
		var out := ArrayMesh.new()
		for si in m.mesh.get_surface_count():
			var a: Array = m.mesh.surface_get_arrays(si)
			var V: PackedVector3Array = a[Mesh.ARRAY_VERTEX]
			var I: PackedInt32Array = a[Mesh.ARRAY_INDEX] if a[Mesh.ARRAY_INDEX] != null else PackedInt32Array()
			if I.is_empty():
				I.resize(V.size())
				for q in V.size():
					I[q] = q
			for t in range(0, I.size(), 3):
				var tmp := I[t + 1]
				I[t + 1] = I[t + 2]
				I[t + 2] = tmp
			a[Mesh.ARRAY_INDEX] = I
			if a[Mesh.ARRAY_NORMAL] != null:
				var N: PackedVector3Array = (a[Mesh.ARRAY_NORMAL] as PackedVector3Array).duplicate()
				for q in N.size():
					N[q] = -N[q]
				a[Mesh.ARRAY_NORMAL] = N
			a[Mesh.ARRAY_TANGENT] = null
			out.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, a)
			out.surface_set_material(out.get_surface_count() - 1, m.mesh.surface_get_material(si))
		var inner := MeshInstance3D.new()
		inner.name = m.name + "_inner"
		inner.mesh = out
		inner.transform = m.transform
		inner.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		m.get_parent().add_child(inner)


## owner's car pack: some models carry their windows as an own object ("... glass ...") with an
## opaque material -> the tinted, transparent vehicle glass shader (_apply_materials: "glass*")
func _split_white_glass(holder: Node3D) -> void:
	for mi in holder.find_children("*", "MeshInstance3D", true, false):
		var m := mi as MeshInstance3D
		if m.mesh == null or not String(m.name).to_lower().contains("glass"):
			continue
		var mesh := m.mesh.duplicate() as ArrayMesh
		for si in mesh.get_surface_count():
			var gm := StandardMaterial3D.new()
			gm.resource_name = "glass_auto"
			gm.albedo_color = Color(0.55, 0.62, 0.68)
			gm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
			mesh.surface_set_material(si, gm)
		m.mesh = mesh


## owner's car pack: lamp lens quads -> additive glow shader (dark when off, VehicleLights drives the
## same parameters); Tajik plate numbers as Label3D on the plate quads
const LAMP_KEYS := ["headlight rf", "taillight rr", "body.5", "fari.4", "fari.3", "fari.2"]
var plate_labels: Array = []


func _pack_lamps_and_plates() -> void:
	var glow: Shader = load("res://assets/shaders/lamp_overlay.gdshader")
	for k in LAMP_KEYS:
		var m: ShaderMaterial = _mat_cache.get(k)
		if m:
			var keep_col: Variant = m.get_shader_parameter("emission_color")
			m.shader = glow
			m.set_shader_parameter("use_uv_edge", not bool(spec.get("mesh_lamps", false)))
			if keep_col != null:
				m.set_shader_parameter("emission_color", keep_col)
	for mi in model.find_children("*", "MeshInstance3D", true, false):
		var nm := String(mi.name)
		if mi.mesh == null or not (nm.begins_with("plate_front") or nm.begins_with("plate_rear")):
			continue
		(mi as MeshInstance3D).cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		var front := nm.begins_with("plate_front")
		var bb: AABB = mi.mesh.get_aabb()
		var lb := Label3D.new()
		lb.name = "PlateNumber"
		lb.font = HudStyle.font()
		lb.font_size = 64
		lb.pixel_size = 0.00105
		lb.modulate = Color(0.06, 0.06, 0.07)
		lb.outline_size = 0
		lb.double_sided = false
		lb.shaded = true
		var n := 1.0 if front else -1.0           # the quad faces mesh-local +Z (front) / -Z (rear)
		lb.position = bb.get_center() + Vector3(0.045 * n, 0.012, 0.004 * n)
		lb.rotation.y = 0.0 if front else PI
		mi.add_child(lb)
		plate_labels.append(lb)
	set_plate(Plates.number_for(String(name)))


func set_plate(t: String) -> void:
	for lb in plate_labels:
		if is_instance_valid(lb):
			(lb as Label3D).text = t


func _style_material(sm: ShaderMaterial, key: String, src: BaseMaterial3D) -> void:
	super(sm, key, src)
	if (spec.get("paint", []) as Array).has(key):
		sm.set_shader_parameter("paint", 1.0)
		sm.set_shader_parameter("roughness", 0.2)
		sm.set_shader_parameter("specular", 0.65)
		if spec.has("color"):
			# factory metallic paint (Camry: black, Lexus: deep blue); the garage can repaint it
			sm.set_shader_parameter("albedo_color", spec["color"])
			sm.set_shader_parameter("metallic", 0.45)


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
## The driver's door is part of the one-piece body mesh in these models: every triangle inside the
## door's outline (left side, between the A and B pillars, sill to window frame; spec "door_cut",
## model space) moves into its own mesh under a hinge node "door_lf_dummy" at the door's front
## edge, so it swings open like the Prado's real door part (VehiclePrado._update_doors).
func _split_door(holder: Node3D) -> bool:
	var dc: Dictionary = spec["door_cut"]
	var xo := float(dc["x"])
	var y0 := float(dc["y"][0])
	var y1 := float(dc["y"][1])
	var z0 := float(dc["z"][0])
	var z1 := float(dc["z"][1])
	var hinge := Node3D.new()
	hinge.name = "door_lf_dummy"
	var outer := -float((spec["size"] as Vector3).x) * 0.5
	hinge.position = Vector3(outer, (y0 + y1) * 0.5, z0)
	model.add_child(hinge)
	var moved := 0
	for mi in holder.find_children("*", "MeshInstance3D", true, false):
		var m := mi as MeshInstance3D
		if not m.visible or (spec.get("hide", []) as Array).has(String(m.name)):
			continue
		var lx := _rel(m, model)
		var new_body := ArrayMesh.new()
		var door_mesh := ArrayMesh.new()
		for sidx in m.mesh.get_surface_count():
			var a0: Array = m.mesh.surface_get_arrays(sidx)
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
			var door_idx := PackedInt32Array()
			for t in range(0, I.size(), 3):
				var inside := true
				for q in 3:
					var c := lx * V[I[t + q]]
					if not (c.x < xo and c.y > y0 and c.y < y1 and c.z > z0 and c.z < z1):
						inside = false
						break
				if inside:
					door_idx.append_array([I[t], I[t + 1], I[t + 2]])
				else:
					body_idx.append_array([I[t], I[t + 1], I[t + 2]])
			var mat := m.mesh.surface_get_material(sidx)
			if not body_idx.is_empty():
				var ab := a.duplicate()
				ab[Mesh.ARRAY_INDEX] = body_idx
				new_body.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, ab)
				new_body.surface_set_material(new_body.get_surface_count() - 1, mat)
			if not door_idx.is_empty():
				# compact: only the door's vertices, in hinge space
				var remap := {}
				var nV := PackedVector3Array()
				var keep := PackedInt32Array()
				var nI := PackedInt32Array()
				var to_hinge := hinge.transform.affine_inverse() * lx
				for q in door_idx:
					if not remap.has(q):
						remap[q] = nV.size()
						nV.append(to_hinge * V[q])
						keep.append(q)
					nI.append(int(remap[q]))
				var ad: Array = []
				ad.resize(Mesh.ARRAY_MAX)
				ad[Mesh.ARRAY_VERTEX] = nV
				ad[Mesh.ARRAY_INDEX] = nI
				var N: Variant = a[Mesh.ARRAY_NORMAL]
				if N != null:
					var nn := PackedVector3Array()
					for q in keep:
						nn.append((to_hinge.basis * (N as PackedVector3Array)[q]).normalized())
					ad[Mesh.ARRAY_NORMAL] = nn
				var T: Variant = a[Mesh.ARRAY_TANGENT]
				if T != null:
					var tt := PackedFloat32Array()
					for q in keep:
						var tv := to_hinge.basis * Vector3((T as PackedFloat32Array)[q * 4], (T as PackedFloat32Array)[q * 4 + 1], (T as PackedFloat32Array)[q * 4 + 2])
						tv = tv.normalized()
						tt.append_array([tv.x, tv.y, tv.z, (T as PackedFloat32Array)[q * 4 + 3]])
					ad[Mesh.ARRAY_TANGENT] = tt
				for ch in [Mesh.ARRAY_TEX_UV, Mesh.ARRAY_TEX_UV2]:
					if a[ch] != null:
						var uv := PackedVector2Array()
						for q in keep:
							uv.append((a[ch] as PackedVector2Array)[q])
						ad[ch] = uv
				if a[Mesh.ARRAY_COLOR] != null:
					var cl := PackedColorArray()
					for q in keep:
						cl.append((a[Mesh.ARRAY_COLOR] as PackedColorArray)[q])
					ad[Mesh.ARRAY_COLOR] = cl
				door_mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, ad)
				door_mesh.surface_set_material(door_mesh.get_surface_count() - 1, mat)
				moved += door_idx.size() / 3
		if door_mesh.get_surface_count() > 0:
			m.mesh = new_body
			var dmi := MeshInstance3D.new()
			dmi.name = "Door_" + String(m.name)
			dmi.mesh = door_mesh
			hinge.add_child(dmi)
	print("door cut %s: %d triangles" % [preset, moved])
	return moved > 0


func _cut_box(holder: Node3D, box: AABB) -> void:
	for mi in holder.find_children("*", "MeshInstance3D", true, false):
		var m := mi as MeshInstance3D
		var lx := _rel(m, model)
		var out := ArrayMesh.new()
		var changed := false
		for si in m.mesh.get_surface_count():
			var a0: Array = m.mesh.surface_get_arrays(si)
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
			var keep := PackedInt32Array()
			for t in range(0, I.size(), 3):
				if box.has_point(lx * V[I[t]]) and box.has_point(lx * V[I[t + 1]]) and box.has_point(lx * V[I[t + 2]]):
					changed = true
					continue
				keep.append_array([I[t], I[t + 1], I[t + 2]])
			if keep.is_empty():
				continue
			a[Mesh.ARRAY_INDEX] = keep
			out.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, a)
			out.surface_set_material(out.get_surface_count() - 1, m.mesh.surface_get_material(si))
		if changed:
			m.mesh = out


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


# ------------------------------------------------------------------------------------------ interior
## a proper cabin for the imported cars whose own interior is missing / untextured (Camry: black,
## Lexus: white dashboard with a second, right-hand steering wheel - removed): soft-touch dark
## dashboard, instrument cluster with lit dials, centre screen, console, leather seats and a
## steering wheel that turns with the steering (named "steeringwheel": VehiclePrado rotates it)
func _build_interior() -> void:
	var body := model.get_node_or_null("Body")
	for nm in spec.get("hide", []):
		var n := model.find_child(String(nm), true, false)
		if n:
			(n as Node3D).visible = false
	if spec.has("cabin") and _prado_cabin():
		return
	var seat: Vector3 = spec["seat"]
	var g := _ground_y
	var sy := g + seat.y                       # hip height of the driver
	var hw := float((spec["size"] as Vector3).x) * 0.5 - 0.12
	var dz := seat.z - 0.95                    # dashboard face
	var root := Node3D.new()
	root.name = "Interior"
	model.add_child(root)
	var dash := _imat(Color(0.14, 0.14, 0.15), 0.7)
	var trim := _imat(Color(0.16, 0.14, 0.12), 0.6, 0.0)
	var leather := _imat(Color(0.32, 0.22, 0.14) if preset == "lexus" else Color(0.12, 0.12, 0.13), 0.5)
	var chrome := _imat(Color(0.7, 0.7, 0.72), 0.25, 0.9)
	# dashboard: a long rounded slab + the upper pad towards the windscreen
	# (kept under the hood / windscreen line: the old upper pad showed through the bonnet)
	_ibox(root, Vector3(hw * 2.0, 0.24, 0.3), Vector3(0, sy + 0.38, dz - 0.03), dash, 0.06)
	_ibox(root, Vector3(hw * 2.0, 0.06, 0.2), Vector3(0, sy + 0.5, dz + 0.15), dash, 0.03)
	_ibox(root, Vector3(hw * 1.9, 0.03, 0.03), Vector3(0, sy + 0.4, dz + 0.26), trim, 0.01)        # trim strip
	# instrument cluster hood + two lit dials
	_ibox(root, Vector3(0.42, 0.1, 0.16), Vector3(seat.x, sy + 0.5, dz + 0.16), dash, 0.04)
	for k in 2:
		var dial := MeshInstance3D.new()
		var cm := SphereMesh.new()
		cm.radius = 0.062
		cm.height = 0.124
		dial.mesh = cm
		dial.scale = Vector3(1, 1, 0.12)
		var dm := _imat(Color(0.02, 0.02, 0.03), 0.4)
		dm.emission_enabled = true
		dm.emission = Color(0.25, 0.55, 1.0) if k == 0 else Color(1.0, 0.45, 0.15)
		dm.emission_energy_multiplier = 0.18
		dial.material_override = dm
		dial.position = Vector3(seat.x + (k - 0.5) * 0.16, sy + 0.46, dz + 0.25)
		# the needle
		var nd := MeshInstance3D.new()
		var nb := BoxMesh.new()
		nb.size = Vector3(0.006, 0.05, 0.004)
		nd.mesh = nb
		var nm := _imat(Color(1, 0.3, 0.2), 0.4)
		nm.emission_enabled = true
		nm.emission = Color(1, 0.3, 0.2)
		nd.material_override = nm
		nd.position = dial.position + Vector3(0.01, 0.012, 0.012)
		nd.rotation.z = deg_to_rad(-40.0)
		root.add_child(nd)
		root.add_child(dial)
	# centre screen + console
	var scr := _imat(Color(0.02, 0.03, 0.05), 0.15)
	scr.emission_enabled = true
	scr.emission = Color(0.08, 0.16, 0.28)
	scr.emission_energy_multiplier = 0.35
	_ibox(root, Vector3(0.26, 0.15, 0.02), Vector3(0, sy + 0.44, dz + 0.26), scr, 0.0)
	_ibox(root, Vector3(0.26, 0.22, 0.75), Vector3(0, sy + 0.08, seat.z - 0.35), dash, 0.04)
	_ibox(root, Vector3(0.05, 0.08, 0.05), Vector3(0, sy + 0.24, seat.z - 0.3), chrome, 0.01)       # gear selector
	# front seats (cushion + backrest + headrest)
	for sx: float in [seat.x, -seat.x]:
		_ibox(root, Vector3(0.5, 0.12, 0.52), Vector3(sx, sy - 0.02, seat.z + 0.05), leather, 0.05)
		var back := _ibox(root, Vector3(0.5, 0.62, 0.12), Vector3(sx, sy + 0.32, seat.z + 0.33), leather, 0.05)
		back.rotation.x = deg_to_rad(-12.0)
		_ibox(root, Vector3(0.26, 0.17, 0.1), Vector3(sx, sy + 0.72, seat.z + 0.42), leather, 0.04)
	# the steering wheel on its column; local +Z = along the column, away from the driver
	var col_dir := Vector3(0, -0.42, -0.91).normalized()
	var wheel := Node3D.new()
	wheel.name = "steeringwheel"
	var zb := col_dir
	var xb := Vector3.RIGHT
	var yb := zb.cross(xb).normalized()
	wheel.transform = Transform3D(Basis(xb, yb, zb), Vector3(seat.x, sy + 0.44, seat.z - 0.5))
	root.add_child(wheel)
	_steering_wheel = wheel                  # VehiclePrado turns it with the steering
	_steering_rest = wheel.transform
	var rim := MeshInstance3D.new()
	var tm := TorusMesh.new()
	tm.inner_radius = 0.165
	tm.outer_radius = 0.19
	tm.rings = 32
	tm.ring_segments = 10
	rim.mesh = tm
	rim.material_override = leather
	rim.rotation.x = PI * 0.5
	wheel.add_child(rim)
	var hub := MeshInstance3D.new()
	var hm := CylinderMesh.new()
	hm.top_radius = 0.065
	hm.bottom_radius = 0.075
	hm.height = 0.06
	hub.mesh = hm
	hub.material_override = dash
	hub.rotation.x = PI * 0.5
	wheel.add_child(hub)
	for a: float in [PI * 0.5, -PI * 0.5, PI]:
		var sp := _ibox(wheel, Vector3(0.17, 0.035, 0.025), Vector3(cos(a) * 0.095, sin(a) * 0.095, 0.0), dash, 0.01)
		sp.rotation.z = a
	var logo := _ibox(wheel, Vector3(0.05, 0.03, 0.01), Vector3(0, 0, -0.035), chrome, 0.0)
	logo.name = "Logo"
	# column
	var colm := MeshInstance3D.new()
	var cc := CylinderMesh.new()
	cc.top_radius = 0.035
	cc.bottom_radius = 0.045
	cc.height = 0.32
	colm.mesh = cc
	colm.material_override = dash
	root.add_child(colm)
	colm.position = wheel.position + col_dir * 0.18
	colm.look_at_from_position(colm.position, colm.position + col_dir, Vector3.UP)
	colm.rotate_object_local(Vector3.RIGHT, PI * 0.5)


## The real cabin of the Prado model (dashboard, instruments, seats, console: mesh "int", and its
## steering wheel) fitted into this car: anchored at the driver's hip, scaled to the cabin
## (spec "cabin" = width, height, length factors). Far better than boxes; the wheel keeps its
## proportions (uniform scale) and turns about its own column like in the Prado.
static var _prado_scene: PackedScene
const PRADO_HIP := Vector3(0.0, -0.13, -0.24)     ## Prado: driver's hip height / seat z (model space)


func _prado_cabin() -> bool:
	if _prado_scene == null:
		_prado_scene = load("res://assets/vehicles/prado/prado.glb")
	if _prado_scene == null:
		return false
	var src: Node3D = _prado_scene.instantiate()
	var intm := src.find_child("int", true, false) as MeshInstance3D
	var sw := src.find_child("steeringwheel", true, false) as MeshInstance3D
	if intm == null or sw == null:
		src.free()
		return false
	var k: Vector3 = spec["cabin"]
	var seat: Vector3 = spec["seat"]
	var hip := Vector3(0.0, _ground_y + seat.y, seat.z)
	var fit := Transform3D(Basis.from_scale(k), hip - PRADO_HIP * k)
	var root := Node3D.new()
	root.name = "Interior"
	model.add_child(root)
	var cab := MeshInstance3D.new()
	cab.name = "Cabin"
	# clip: no Prado headliner (y above "cabin_clip"[0]) or cargo area (z behind [1]) in a lower /
	# shorter body; vertices go to model space so the test is direct
	var clip: Array = spec.get("cabin_clip", [9.0, 9.0])
	var to_model := fit * _rel(intm, src)
	var cm := ArrayMesh.new()
	for si in intm.mesh.get_surface_count():
		var a0: Array = intm.mesh.surface_get_arrays(si)
		var a: Array = []
		a.resize(Mesh.ARRAY_MAX)
		for ch in [Mesh.ARRAY_VERTEX, Mesh.ARRAY_NORMAL, Mesh.ARRAY_TANGENT, Mesh.ARRAY_TEX_UV, Mesh.ARRAY_INDEX]:
			a[ch] = a0[ch]
		var V: PackedVector3Array = a[Mesh.ARRAY_VERTEX]
		var NV := PackedVector3Array()
		NV.resize(V.size())
		for q in V.size():
			NV[q] = to_model * V[q]
		a[Mesh.ARRAY_VERTEX] = NV
		if a[Mesh.ARRAY_NORMAL] != null:
			var NN: PackedVector3Array = (a[Mesh.ARRAY_NORMAL] as PackedVector3Array).duplicate()
			var nb := to_model.basis.inverse().transposed()
			for q in NN.size():
				NN[q] = (nb * NN[q]).normalized()
			a[Mesh.ARRAY_NORMAL] = NN
		a[Mesh.ARRAY_TANGENT] = null
		var I: PackedInt32Array = a[Mesh.ARRAY_INDEX]
		var keep := PackedInt32Array()
		for t in range(0, I.size(), 3):
			var ok := true
			for q in 3:
				var v := NV[I[t + q]]
				# headliner / cargo area, and the Prado's (taller, wider) pillar trims above the belt
				if v.y > float(clip[0]) or v.z > float(clip[1]) or (v.y > hip.y + 0.42 and absf(v.x) > 0.5):
					ok = false
					break
			if ok:
				keep.append_array([I[t], I[t + 1], I[t + 2]])
		if keep.is_empty():
			continue
		a[Mesh.ARRAY_INDEX] = keep
		cm.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, a)
		cm.surface_set_material(cm.get_surface_count() - 1, intm.mesh.surface_get_material(si))
	cab.mesh = cm
	cab.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	root.add_child(cab)
	# the steering wheel: pivot where the Prado's would land, own orientation, uniform scale
	var sxf := _rel(sw, src)
	var wheel := Node3D.new()
	wheel.name = "steeringwheel"
	var u := (k.x + k.y) * 0.5
	wheel.transform = Transform3D(sxf.basis.orthonormalized().scaled(Vector3.ONE * u), fit * sxf.origin)
	root.add_child(wheel)
	var wm := MeshInstance3D.new()
	wm.mesh = sw.mesh
	wm.transform = Transform3D(Basis.from_scale(sxf.basis.get_scale()), Vector3.ZERO)
	wm.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	wheel.add_child(wm)
	_steering_wheel = wheel
	_steering_rest = wheel.transform
	src.free()
	return true


func _imat(col: Color, rough: float, metal := 0.0) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = col
	m.roughness = rough
	m.metallic = metal
	return m


func _ibox(parent: Node3D, size: Vector3, pos: Vector3, mat: Material, bevel: float) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = size
	mi.mesh = bm
	mi.material_override = mat
	mi.position = pos
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	parent.add_child(mi)
	return mi
