class_name VehicleBoat
extends VehiclePrado
## Small motorboat (Timon Matthews, CC-BY 4.0, see docs/CREDITS.md) on the sea around the peninsula
## and on the lakes (Iskandar, Komsomol). Reuses the vehicle framework (CarSession get-in / out,
## camera, touch pedals + steering, HUD, engine audio, lights) with its own physics instead of tyres:
##   buoyancy   8 hull points; each pushes up in proportion to its depth below the local water
##              surface (sea: the same Gerstner swell the player swims in; lakes: flat) -> the boat
##              floats at ~0.22 m draft, rolls / pitches with the waves
##   propulsion outboard thrust at the stern below the waterline (GAS forward, BRAKE reverse) only
##              when the propeller is in the water; the rudder (= the outboard) turns the stern
##   water drag low along the hull, high sideways (no drifting like on ice), + angular damping
## On land the hull just lies on its collision box.

const BOAT_MODEL := "res://assets/models/extra/motorboat.glb"
const L_HALF := 2.9
const W_HALF := 0.85
const DRAFT := 0.22
const MAX_THRUST := 8200.0
const DRAG_FWD := 26.0          ## N per (m/s)^2 along the hull
const DRAG_SIDE := 900.0        ## N per m/s sideways (keel)

var in_water := false
var _pts: Array[Vector3] = []
var _wake: CPUParticles3D


func _init() -> void:
	vehicle_mass = 820.0
	cg_height = 0.0               ## centre of mass at the waterline - 0.22 m (stable)
	top_speed_kmh = 62.0


func _ready() -> void:
	super()
	# the swimmer's boundary walls (CityWorld "Bounds", at wading depth) do not stop a boat
	var bounds := CityWorld.instance.get_node_or_null("Bounds") if CityWorld.instance else null
	if bounds:
		add_collision_exception_with(bounds)


func _wheel_z(front: bool) -> float:
	return -L_HALF * 0.7 if front else L_HALF * 0.7


func _setup_wheels() -> void:
	pass                          # no wheels


func _build_model() -> void:
	model = Node3D.new()
	model.name = "Model"
	add_child(model)
	var src: Node3D = (load(BOAT_MODEL) as PackedScene).instantiate()
	var holder := Node3D.new()
	holder.name = "Boat"
	model.add_child(holder)
	holder.add_child(src)
	# source: length along X (bow at -X, outboard at +X), keel at y = -0.14: bow -> -Z, waterline at y = 0
	holder.transform = Transform3D(Basis(Vector3.UP, -PI * 0.5), Vector3(0.0, -0.157, 0.0))
	for mi in src.find_children("*", "MeshInstance3D", true, false):
		var m := mi as MeshInstance3D
		m.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
		_hi_meshes[m] = m.mesh
		_apply_materials(m)
	for spec in [["door_lf_dummy", Vector3(-1.0, 0.4, 0.6)], ["ped_frontseat", Vector3(-0.35, 0.25, 1.5)], ["headlights", Vector3(0.0, 0.5, -2.6)]]:
		var n := Node3D.new()
		n.name = spec[0]
		n.position = spec[1]
		model.add_child(n)
	_ground_y = -DRAFT
	for sz: float in [-L_HALF * 0.85, -L_HALF * 0.3, L_HALF * 0.3, L_HALF * 0.85]:
		for sx: float in [-W_HALF, W_HALF]:
			_pts.append(Vector3(sx * (0.55 if sz < -L_HALF * 0.5 else 1.0), -0.25, sz))
	_wake = CPUParticles3D.new()
	_wake.name = "Wake"
	_wake.amount = 70
	_wake.lifetime = 1.4
	_wake.emitting = false
	_wake.local_coords = false
	_wake.direction = Vector3(0, 1, 1)
	_wake.spread = 30.0
	_wake.initial_velocity_min = 1.0
	_wake.initial_velocity_max = 3.0
	_wake.gravity = Vector3(0, -6, 0)
	_wake.scale_amount_min = 0.6
	_wake.scale_amount_max = 1.4
	var q := QuadMesh.new()
	q.size = Vector2(0.5, 0.5)
	var pm := StandardMaterial3D.new()
	pm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	pm.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	pm.albedo_color = Color(1, 1, 1, 0.5)
	pm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	q.material = pm
	_wake.mesh = q
	_wake.position = Vector3(0, -0.1, L_HALF + 0.2)
	add_child(_wake)


func _build_collision() -> void:
	for spec in [[Vector3(1.75, 0.55, 5.6), Vector3(0.0, -0.05, 0.1)], [Vector3(1.2, 0.35, 1.4), Vector3(0.0, -0.3, -2.4)]]:
		var cs := CollisionShape3D.new()
		var bs := BoxShape3D.new()
		bs.size = spec[0]
		cs.shape = bs
		cs.position = spec[1]
		add_child(cs)


func apply_quality() -> void:
	pass


## water surface height at a point: the sea (with its swell) wherever the ground lies below sea
## level, the lakes inside their shore; NAN on land
static func water_level_at(x: float, z: float) -> float:
	var wd := WorldData.get_instance()
	var ground := CityWorld.instance.terrain_height(x, z) if CityWorld.instance else -100.0
	if wd.ok and wd.contains(x, z):
		for lk in wd.lakes:
			var c := Vector2(lk["c"][0], lk["c"][1])
			var r := Vector2(lk["r"][0], lk["r"][1]) * 1.12
			var e := Vector2((x - c.x) / r.x, (z - c.y) / r.y).length()
			var level := float(lk["level"])
			if e < 1.0 and ground < level - 0.1:
				return level
	if ground < PlayerWater.SEA_LEVEL - 0.15:
		return PlayerWater.SEA_LEVEL + PlayerWater.wave_at(x, z, PlayerWater.SEA_LEVEL - ground).y
	return NAN


func _integrate_forces(state: PhysicsDirectBodyState3D) -> void:
	var xf := state.transform
	var b := xf.basis
	var fwd := -b.z
	var vel := state.linear_velocity
	forward_speed = vel.dot(fwd)
	speed_kmh = vel.length() * MPS_TO_KMH
	var g := 9.81
	var k := vehicle_mass * g / (_pts.size() * DRAFT)
	var wet := 0
	var stern_wet := false
	for p in _pts:
		var wp := xf * p
		var lvl := water_level_at(wp.x, wp.z)
		if is_nan(lvl):
			continue
		var depth := clampf(lvl - wp.y, 0.0, 0.7)
		if depth <= 0.0:
			continue
		wet += 1
		if p.z > L_HALF * 0.5:
			stern_wet = true
		var pv := state.get_velocity_at_local_position(wp - xf.origin)
		var f := Vector3.UP * (k * depth - pv.y * vehicle_mass / _pts.size() * 2.4)
		state.apply_force(f, wp - xf.origin)
	in_water = wet > 0
	# propulsion + rudder (outboard at the stern, under the water)
	if in_water:
		var t := throttle - brake * 0.55
		var stern := xf * Vector3(0, -0.3, L_HALF)
		if stern_wet:
			var thrust := MAX_THRUST * t * (1.0 if speed_kmh < top_speed_kmh else 0.0)
			# the outboard turns: thrust direction rotated by the steering (stern swings out)
			var dir := fwd.rotated(b.y, -steer * 0.55)
			state.apply_force(dir * thrust, stern - xf.origin)
			var yaw_t := -steer * (900.0 + absf(forward_speed) * 520.0) * signf(forward_speed + 0.3 * t)
			state.apply_torque(b.y * yaw_t)
		# hull drag: along (quadratic), sideways (keel), vertical handled by the damping above
		var v_f := vel.dot(fwd)
		var v_s := vel.dot(b.x)
		state.apply_central_force(-fwd * signf(v_f) * v_f * v_f * DRAG_FWD - b.x * v_s * DRAG_SIDE * wet / _pts.size())
		state.angular_velocity *= 1.0 - minf(state.step * 1.6, 0.2)
		# engine state for the HUD / audio
		rpm = lerpf(rpm, 900.0 + absf(t) * 3600.0 + absf(forward_speed) * 40.0, 0.1)
		engine_load = absf(t)
		gear = -1 if t < -0.05 else 1
	else:
		rpm = lerpf(rpm, 800.0, 0.1)
		engine_load = 0.0
	wheels_on_ground = 0
	if _wake:
		_wake.emitting = in_water and stern_wet and absf(throttle) > 0.15


func _read_input(delta: float) -> void:
	if not (driven or scripted_here()):
		throttle = move_toward(throttle, 0.0, delta * 3.0)
		brake = 0.0
		steer = move_toward(steer, 0.0, delta * 3.0)
		return
	throttle = move_toward(throttle, VehicleInput.throttle(), delta * 2.0)
	brake = move_toward(brake, VehicleInput.brake(), delta * 2.0)
	steer = move_toward(steer, VehicleInput.steer(), delta * 2.5)


## put the boat on the water at pos (or on the ground when there is none)
func place(pos: Vector3, yaw: float) -> void:
	var lvl := water_level_at(pos.x, pos.z)
	var y := lvl if not is_nan(lvl) else pos.y + 0.5
	global_transform = Transform3D(Basis(Vector3.UP, yaw), Vector3(pos.x, y, pos.z))
	linear_velocity = Vector3.ZERO
	angular_velocity = Vector3.ZERO
	reset_physics_interpolation()


## the boat can be boarded from any side (pier, shore or swimming next to it)
func driver_door_point(outside := 0.9) -> Vector3:
	return global_position - global_transform.basis.x * (W_HALF + outside)
