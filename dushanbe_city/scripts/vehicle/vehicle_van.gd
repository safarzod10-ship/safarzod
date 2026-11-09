class_name VehicleVan
extends VehiclePrado
## LakLak delivery van: the "European Delivery Van" model (Evan Hiltz, CC-BY 4.0, see docs/CREDITS.md)
## painted LakLak blue with the company's logo on both sides and the rear doors. Same physics as the
## Prado (VehiclePrado: raycast suspension, tyre model, gearbox, damage, lights, audio), with the
## numbers of a 3.5 t-class rear-drive panel van: lighter engine, lower top speed, softer, taller.
## The model's wheels are plain meshes: they get pivot / spinner nodes named like the Prado's dummies
## (wheel_lf_dummy ...), so the parent's wheel code drives them unchanged.

const VAN_MODEL := "res://assets/models/extra/delivery_van.glb"
const AXLE_MID_Z := 2.068        ## model space: halfway between the axles (front axle at +Z in the source)


func _init() -> void:
	vehicle_mass = 2250.0
	cg_height = 0.92
	front_weight = 0.52
	freq_front = 1.35
	freq_rear = 1.45
	arb_front = 14000.0
	arb_rear = 6500.0
	mu = 0.88
	max_power_kw = 105.0
	max_torque = 330.0
	top_speed_kmh = 150.0
	final_drive = 3.92
	gears = [4.0, 2.3, 1.48, 1.0, 0.79, 0.66]
	front_split = 0.0
	brake_force = 23000.0
	cd_a = 1.55
	tank_l = 70.0
	consumption_l100 = 11.5
	fuel_l = 42.0
	body_size = Vector3(2.25, 2.5, 5.26)


func _build_model() -> void:
	model = Node3D.new()
	model.name = "Model"
	add_child(model)
	var holder := Node3D.new()
	holder.name = "Van"
	# source: front at +Z, ground at y = 0 -> car space: front at -Z, axle midpoint at z = 0
	holder.transform = Transform3D(Basis(Vector3.UP, PI), Vector3(0.0, _ground_y + 0.006, AXLE_MID_Z))
	model.add_child(holder)
	var src: Node3D = (load(VAN_MODEL) as PackedScene).instantiate()
	holder.add_child(src)
	var blue: Texture2D = load("res://assets/vehicles/laklak/van_body_blue.png")
	for mi in src.find_children("*", "MeshInstance3D", true, false):
		var m := mi as MeshInstance3D
		m.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
		_hi_meshes[m] = m.mesh
		_apply_materials(m)
	# LakLak blue body paint
	for key in _mat_cache:
		if String(key).contains("body"):
			var sm: ShaderMaterial = _mat_cache[key]
			sm.set_shader_parameter("albedo_tex", blue)
			sm.set_shader_parameter("roughness", 0.3)
			sm.set_shader_parameter("specular", 0.6)
	_make_wheel_pivots(src)
	# driver's door hinge, front seat (driver: left side), headlights (for VehicleLights)
	for spec in [["door_lf_dummy", Vector3(-1.15, _ground_y + 0.55, -1.15)], ["ped_frontseat", Vector3(-0.49, _ground_y + 1.22, -0.95)],
			["headlights", Vector3(0.0, _ground_y + 0.85, -2.45)]]:
		var n := Node3D.new()
		n.name = spec[0]
		n.position = spec[1]
		model.add_child(n)
	_logos()
	_update_part_uniforms()


func _make_wheel_pivots(src: Node3D) -> void:
	for mi in src.find_children("wheel_front_ply*", "MeshInstance3D", true, false):
		var m := mi as MeshInstance3D
		# wheel centre in car (model) space
		var xf := _rel(m, model)
		var c := xf * m.mesh.get_aabb().get_center()
		var left := c.x < 0.0
		var front := c.z < 0.0
		var dummy := Node3D.new()
		dummy.name = "wheel_%s%s_dummy" % ["l" if left else "r", "f" if front else "b"]
		dummy.position = c
		model.add_child(dummy)
		var spin := Node3D.new()
		spin.name = "Spin"
		dummy.add_child(spin)
		var keep := xf
		m.get_parent().remove_child(m)
		spin.add_child(m)
		m.transform = Transform3D(Basis.IDENTITY, -c) * keep


## transform of `n` relative to ancestor `root` (works outside the scene tree)
static func _rel(n: Node3D, root: Node3D) -> Transform3D:
	var xf := Transform3D.IDENTITY
	var c: Node = n
	while c != root and c != null:
		xf = (c as Node3D).transform * xf
		c = c.get_parent()
	return xf


func _logos() -> void:
	var tex: Texture2D = load("res://assets/vehicles/laklak/laklak_logo.png")
	var mat := StandardMaterial3D.new()
	mat.albedo_texture = tex
	mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR
	mat.alpha_scissor_threshold = 0.5
	mat.roughness = 0.35
	# glossy vinyl print: a little self-illumination keeps it readable on the shaded side
	mat.emission_enabled = true
	mat.emission_texture = tex
	mat.emission_energy_multiplier = 0.22
	mat.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC
	var g := _ground_y
	# cargo sides (x = +-1.125 m), rear doors (z = +2.82)
	for spec in [[Vector3(1.135, g + 1.45, 0.55), PI * 0.5, Vector2(3.3, 1.13), "R"], [Vector3(-1.135, g + 1.45, 0.55), -PI * 0.5, Vector2(3.3, 1.13), "L"],
			[Vector3(0.0, g + 1.75, 2.815), 0.0, Vector2(1.7, 0.58), "Rear"]]:
		var q := QuadMesh.new()
		q.size = spec[2]
		var mi := MeshInstance3D.new()
		mi.name = "LakLakLogo" + String(spec[3])
		mi.mesh = q
		mi.material_override = mat
		mi.position = spec[0]
		mi.rotation.y = spec[1]
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		model.add_child(mi)


func _build_collision() -> void:
	# body 2.25 m wide, 5.26 m long (car z -2.46 .. 2.80), roof 2.45 m above the ground
	for spec in [[Vector3(2.2, 1.25, 5.15), Vector3(0.0, _ground_y + 0.38 + 0.625, 0.17)],
			[Vector3(2.1, 0.8, 4.4), Vector3(0.0, _ground_y + 1.63 + 0.4, 0.5)]]:
		var cs := CollisionShape3D.new()
		var bs := BoxShape3D.new()
		bs.size = spec[0]
		cs.shape = bs
		cs.position = spec[1]
		add_child(cs)


func apply_quality() -> void:
	var bias: float = [0.5, 0.7, 1.0, 1.4][Settings.quality]
	for mi in model.find_children("*", "MeshInstance3D", true, false):
		(mi as MeshInstance3D).lod_bias = bias
