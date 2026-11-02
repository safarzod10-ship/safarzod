class_name VehiclePrado
extends RigidBody3D
## Toyota Land Cruiser Prado J150 (2nd facelift, 5-door) — custom vehicle physics on RigidBody3D.
## Why not VehicleBody3D: its tyre model is a single friction value (no slip-angle curve, no
## combined slip, no grip loss/recovery), which cannot produce a controlled slide of a heavy SUV.
##
## Model (see docs/VEHICLE.md for sources and numbers):
## * body: 2320 kg (2240 kg kerb + driver), CG 0.78 m above ground, 53/47 front/rear, principal inertia
##   from a mass-weighted box; collision = two boxes (lower body, cabin)
## * suspension: one ray per wheel, linear spring around the static load (1.4 Hz front / 1.35 Hz rear),
##   separate bump/rebound damping, travel +0.14 / -0.16 m, anti-roll bars (front stiffer -> understeer),
##   tyre forces applied at roll-centre height (SUV roll without unrealistic tip-overs)
## * tyres 265/65 R17 (r = 0.398 m): Pacejka-style lateral curve on slip angle, friction circle with
##   the longitudinal force, sliding friction (0.82 mu) + grip memory -> slides build up and grip
##   returns gradually; low-speed lateral damping; surface mu from the collider (asphalt / terrain)
## * drivetrain: full-time 4WD 40/60, 6-speed automatic (real J150 ratios), torque converter at
##   pull-away, ABS brakes 65/35, handbrake locks the rear axle, rolling resistance, aero drag
## * game configuration: 170 kW / 500 Nm, limiter 200 km/h (the real 150 kW car does ~175 km/h)

signal damaged(health: float)
signal repaired

const MPS_TO_KMH := 3.6
const MODEL := "res://assets/vehicles/prado/prado.glb"

@export_group("Body")
@export var vehicle_mass := 2320.0
@export var cg_height := 0.78            ## above ground (m)
@export var front_weight := 0.53
@export_group("Suspension")
@export var freq_front := 1.40           ## Hz
@export var freq_rear := 1.35
@export var damping_ratio := 0.36
@export var bump_travel := 0.14
@export var droop_travel := 0.16
@export var arb_front := 17000.0         ## N/m of left-right compression difference
@export var arb_rear := 7000.0
@export var roll_center := 0.30          ## m above ground where tyre forces act
@export_group("Tyres")
@export var mu := 0.92                   ## peak friction, all-terrain SUV tyres on dry asphalt
@export var slide_mu := 0.82             ## sliding / peak
@export var tyre_B := 7.5                ## Pacejka-style stiffness (peak at ~8-9 deg)
@export var tyre_C := 1.45
@export var rolling_resistance := 0.013
@export var easy_drift := false          ## game option: easier slides (base model untouched)
@export_group("Drivetrain")
@export var max_power_kw := 170.0        ## game configuration
@export var max_torque := 500.0          ## N m (1GD-FTV)
@export var top_speed_kmh := 200.0       ## game limiter
@export var final_drive := 3.909
@export var gears: Array[float] = [3.60, 2.09, 1.49, 1.00, 0.69, 0.58]
@export var reverse_ratio := 3.73
@export var front_split := 0.40
@export var brake_force := 26000.0       ## total N at full pedal (ABS keeps it under the grip limit)
@export var brake_front := 0.65
@export var cd_a := 1.15                 ## drag area Cd*A (m^2)

# --- state readable by UI / audio / camera / tests
var throttle := 0.0
var brake := 0.0
var steer := 0.0                          ## smoothed -1..1
var handbrake := false
var gear := 1                             ## -1 reverse, 0 neutral, 1..6
var rpm := 800.0
var engine_load := 0.0
var speed_kmh := 0.0                      ## |v| of the physical body in km/h (speedometer)
var forward_speed := 0.0                  ## m/s along the car (signed)
var health := 100.0
var driven := false                       ## player in control
var wheels: Array[Dictionary] = []
var slip_amount := 0.0                    ## 0..1 tyre slip (audio / smoke)
var wheels_on_ground := 0
var last_impact := 0.0                    ## m/s of the last hit (audio)

var model: Node3D
var _reverse_timer := 0.0
var _shift_timer := 0.0
var _materials: Array[ShaderMaterial] = []
var _dents: Array = []                    ## [Vector4 pos_r, Vector4 dir_depth]
var _hit_cooldown := 0.0
var _boost := 0.3                         ## turbo spool 0..1
var _prev_v := Vector3.ZERO
var _impact_acc := 0.0
var _impact_point := Vector3.ZERO
var _impact_normal := Vector3.ZERO
var _impact_steps := 0
var _part_rest := {}                      ## node -> rest Transform3D (repair)
var _steering_wheel: Node3D
var _steering_rest := Transform3D.IDENTITY
var _ground_y := -0.823                   ## model-space ground at rest


func _ready() -> void:
	VehicleInput.ensure_actions()
	mass = vehicle_mass
	center_of_mass_mode = RigidBody3D.CENTER_OF_MASS_MODE_CUSTOM
	continuous_cd = true
	contact_monitor = true
	max_contacts_reported = 8
	can_sleep = false
	linear_damp_mode = RigidBody3D.DAMP_MODE_REPLACE
	angular_damp_mode = RigidBody3D.DAMP_MODE_REPLACE
	linear_damp = 0.0
	angular_damp = 0.15
	add_to_group(&"vehicle")
	_build_model()
	_build_collision()
	var cg_z := _wheel_z(true) + (1.0 - front_weight) * (_wheel_z(false) - _wheel_z(true))
	center_of_mass = Vector3(0.0, _ground_y + cg_height, cg_z)
	# principal inertia of a mass-weighted box (0.8: mass concentrated towards the centre)
	var L := 4.83
	var W := 1.885
	var H := 1.85
	inertia = Vector3(mass / 12.0 * (H * H + L * L), mass / 12.0 * (W * W + L * L), mass / 12.0 * (W * W + H * H)) * 0.8
	_setup_wheels()
	var audio := VehicleAudio.new()
	audio.name = "Audio"
	audio.car = self
	add_child(audio)


# ------------------------------------------------------------------------------------------- model
func _build_model() -> void:
	model = (load(MODEL) as PackedScene).instantiate()
	model.name = "Model"
	add_child(model)
	var shader: Shader = load("res://assets/shaders/vehicle.gdshader")
	var glass: Shader = load("res://assets/shaders/vehicle_glass.gdshader")
	var cache := {}
	for mi in model.find_children("*", "MeshInstance3D", true, false):
		var m := mi as MeshInstance3D
		var interior := String(m.name).begins_with("int") or m.name == "steeringwheel"
		m.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF if interior else GeometryInstance3D.SHADOW_CASTING_SETTING_ON
		for s in m.mesh.get_surface_count():
			var src := m.mesh.surface_get_material(s) as BaseMaterial3D
			if src == null:
				continue
			var key := src.resource_name
			if not cache.has(key):
				var sm := ShaderMaterial.new()
				var is_glass := key.begins_with("glass") or src.transparency == BaseMaterial3D.TRANSPARENCY_ALPHA
				sm.shader = glass if is_glass else shader
				sm.resource_name = key
				sm.set_shader_parameter("albedo_tex", src.albedo_texture)
				sm.set_shader_parameter("albedo_color", src.albedo_color)
				if not is_glass:
					_style_material(sm, key, src)
				cache[key] = sm
				_materials.append(sm)
			m.set_surface_override_material(s, cache[key])
	_steering_wheel = model.find_child("steeringwheel", true, false)
	if _steering_wheel:
		_steering_rest = _steering_wheel.transform
	# per-part transform into car (model root) space, for the shared dent field
	await get_tree().process_frame
	_update_part_uniforms()


func _style_material(sm: ShaderMaterial, key: String, src: BaseMaterial3D) -> void:
	## the source model (GTA-style conversion) has roughness 1.0 everywhere: give each surface class
	## a believable response (paint, chrome/alloy, rubber, lights, interior)
	var rough := 0.85
	var met := 0.0
	var spec := 0.5
	if key == "primary" or key.begins_with("body"):
		rough = 0.22; spec = 0.6
		sm.set_shader_parameter("paint", 1.0 if key == "primary" else 0.0)
	elif key.begins_with("wheel"):
		rough = 0.35 if key.contains("2") or key.contains("3") else 0.9
		met = 0.6 if key.contains("2") else 0.0
	elif key.begins_with("fari") or key.begins_with("headlight") or key.begins_with("taillight"):
		rough = 0.12; spec = 0.7
		if key.begins_with("taillight"):
			sm.set_shader_parameter("emission_color", Color(0.9, 0.05, 0.03))
	elif key.begins_with("int"):
		rough = 0.8
	if src.transparency == BaseMaterial3D.TRANSPARENCY_ALPHA_SCISSOR or src.transparency == BaseMaterial3D.TRANSPARENCY_ALPHA_HASH:
		sm.set_shader_parameter("alpha_cut", 0.5)
	sm.set_shader_parameter("roughness", rough)
	sm.set_shader_parameter("metallic", met)
	sm.set_shader_parameter("specular", spec)


func _update_part_uniforms() -> void:
	var inv := model.global_transform.affine_inverse()
	for mi in model.find_children("*", "MeshInstance3D", true, false):
		var m := mi as MeshInstance3D
		var xf := inv * m.global_transform        # part -> car(model) space
		var b := xf.basis
		m.set_instance_shader_parameter(&"part_x", Vector4(b.x.x, b.y.x, b.z.x, xf.origin.x))
		m.set_instance_shader_parameter(&"part_y", Vector4(b.x.y, b.y.y, b.z.y, xf.origin.y))
		m.set_instance_shader_parameter(&"part_z", Vector4(b.x.z, b.y.z, b.z.z, xf.origin.z))


func _build_collision() -> void:
	# lower body (bumpers, sills: 0.42 m ground clearance at rest) + cabin
	for spec in [[Vector3(1.84, 0.70, 4.50), Vector3(0.0, _ground_y + 0.42 + 0.35, -0.05)],
			[Vector3(1.70, 0.72, 3.05), Vector3(0.0, _ground_y + 1.12 + 0.36, 0.45)]]:
		var cs := CollisionShape3D.new()
		var bs := BoxShape3D.new()
		bs.size = spec[0]
		cs.shape = bs
		cs.position = spec[1]
		add_child(cs)


func _setup_wheels() -> void:
	var names := {"wheel_lf_dummy": [true, true], "wheel_rf_dummy": [true, false], "wheel_lb_dummy": [false, true], "wheel_rb_dummy": [false, false]}
	var inv := global_transform.affine_inverse()
	for n in names:
		var dummy: Node3D = model.find_child(n, true, false)
		var mesh: Node3D = dummy.get_child(0) as Node3D
		var front: bool = names[n][0]
		var hub: Vector3 = inv * dummy.global_position
		var load_n: float = mass * 9.81 * (front_weight if front else 1.0 - front_weight) * 0.5
		var f: float = freq_front if front else freq_rear
		var corner_m: float = load_n / 9.81
		var k: float = corner_m * pow(TAU * f, 2.0)
		wheels.append({
			"node": dummy, "mesh": mesh, "mesh_rest": mesh.transform, "rest": dummy.transform,
			"front": front, "left": names[n][1], "hub": hub, "radius": 0.398,
			"static_load": load_n, "k": k, "c": 2.0 * damping_ratio * sqrt(k * corner_m),
			"offset": 0.0, "offset_vel": 0.0, "contact": false, "normal": Vector3.UP, "load": 0.0,
			"spin": 0.0, "omega": 0.0, "steer": 0.0, "slide": 0.0, "slip_lat": 0.0, "slip_long": 0.0,
			"surface_mu": 1.0, "collider": null,
		})
		_part_rest[dummy] = dummy.transform


func _wheel_z(front: bool) -> float:
	var d: Node3D = model.find_child("wheel_lf_dummy" if front else "wheel_lb_dummy", true, false)
	return (global_transform.affine_inverse() * d.global_position).z


# ------------------------------------------------------------------------------------------- physics
func _physics_process(delta: float) -> void:
	_read_input(delta)
	_hit_cooldown = maxf(0.0, _hit_cooldown - delta)


func _read_input(delta: float) -> void:
	var t := 0.0
	var b := 0.0
	var s := 0.0
	var hb := false
	if driven or VehicleInput.scripted != null:
		t = VehicleInput.throttle()
		b = VehicleInput.brake()
		s = VehicleInput.steer()
		hb = VehicleInput.handbrake()
	else:
		# nobody at the wheel: 'P' — service brake + handbrake, no automatic reverse
		throttle = 0.0
		brake = move_toward(brake, 1.0, delta * 5.0)
		handbrake = true
		steer = move_toward(steer, 0.0, delta * 3.4)
		if gear == -1 and absf(forward_speed) < 0.5:
			gear = 1
		return
	# reverse logic: holding BRAKE at standstill engages reverse (then brake = reverse throttle,
	# gas = brake); holding GAS at standstill in reverse engages drive again
	var v := forward_speed
	if gear >= 1:
		if b > 0.1 and absf(v) < 0.6 and t < 0.05:
			_reverse_timer += delta
			if _reverse_timer > 0.35:
				gear = -1
				_reverse_timer = 0.0
		else:
			_reverse_timer = 0.0
	elif gear == -1:
		if t > 0.1 and absf(v) < 0.6:
			_reverse_timer += delta
			if _reverse_timer > 0.25:
				gear = 1
				_reverse_timer = 0.0
		else:
			_reverse_timer = 0.0
	if gear == -1:
		var tmp := t
		t = b
		b = tmp
	throttle = move_toward(throttle, t, delta * 3.0)       # pedal travel: smooth, never instant
	brake = move_toward(brake, b, delta * 5.0)
	handbrake = hb
	# steering: speed-sensitive rack, smooth in and self-centring out
	var rate := 2.4 if absf(s) > absf(steer) and signf(s) == signf(steer) or steer == 0.0 else 3.4
	steer = move_toward(steer, s, delta * rate)


func _integrate_forces(state: PhysicsDirectBodyState3D) -> void:
	var dt := state.step
	var xf := state.transform
	var basis := xf.basis
	var up := basis.y
	var fwd := -basis.z
	var right := basis.x
	var vel := state.linear_velocity
	forward_speed = vel.dot(fwd)
	speed_kmh = vel.length() * MPS_TO_KMH
	var space := state.get_space_state()
	var dmg := _damage_factors()

	# ---- suspension
	var on := 0
	for w in wheels:
		var hub_world: Vector3 = xf * (w["hub"] as Vector3)
		var top := hub_world + up * (bump_travel + 0.05)
		var bottom := hub_world - up * (droop_travel + float(w["radius"]))
		var q := PhysicsRayQueryParameters3D.create(top, bottom, collision_mask, [get_rid()])
		var hit := space.intersect_ray(q)
		var prev: float = w["offset"]
		if hit.is_empty():
			w["contact"] = false
			w["offset"] = move_toward(prev, -droop_travel, dt * 1.5)
			w["offset_vel"] = 0.0
			w["load"] = 0.0
			continue
		on += 1
		var contact: Vector3 = hit.position
		# wheel centre sits radius above the contact along the body's up axis
		var off := (contact - hub_world).dot(up) + float(w["radius"])
		off = clampf(off, -droop_travel, bump_travel)
		w["offset"] = off
		w["offset_vel"] = (off - prev) / dt
		w["contact"] = true
		w["contact_point"] = contact
		w["normal"] = hit.normal
		w["collider"] = hit.collider
		w["surface_mu"] = 0.78 if hit.collider is StaticBody3D and String((hit.collider as Node).name) == "TerrainBody" else 1.0
	wheels_on_ground = on
	# anti-roll bars: left/right offset difference per axle
	var arb := {true: 0.0, false: 0.0}
	for front in [true, false]:
		var l := 0.0
		var r := 0.0
		for w in wheels:
			if w["front"] == front:
				if w["left"]:
					l = w["offset"]
				else:
					r = w["offset"]
		arb[front] = (l - r) * (arb_front if front else arb_rear)

	# ---- engine / gearbox
	var wheel_omega := absf(forward_speed) / 0.398
	_update_gearbox(dt, wheel_omega)
	var ratio := (gears[gear - 1] if gear >= 1 else (reverse_ratio if gear == -1 else 0.0)) * final_drive
	var eng_omega := maxf(wheel_omega * ratio, 800.0 * TAU / 60.0)
	rpm = lerpf(rpm, eng_omega * 60.0 / TAU, 0.25)
	# turbo: boost builds with throttle and rpm (lag ~0.7 s), off-boost torque ~60 %
	var boost_target := clampf((rpm - 1100.0) / 900.0, 0.0, 1.0) * throttle
	_boost = move_toward(_boost, boost_target, dt * (1.4 if boost_target > _boost else 3.0))
	var power_cap: float = max_power_kw * 1000.0 * float(dmg["power"])
	var torque: float = minf(max_torque * _torque_curve(rpm) * lerpf(0.6, 1.0, _boost), power_cap / maxf(eng_omega, 1.0)) * float(dmg["power"])
	if _shift_timer > 0.15:
		torque *= 0.25                         # torque interruption while the automatic shifts
	var converter := lerpf(1.2, 1.0, clampf(absf(forward_speed) / 5.0, 0.0, 1.0)) if gear == 1 or gear == -1 else 1.0
	var limit: float = (top_speed_kmh if gear >= 1 else 25.0) * float(dmg["vmax"]) / MPS_TO_KMH
	var drive_total: float = torque * converter * ratio * 0.90 / 0.398 * throttle
	if absf(forward_speed) > limit:
		drive_total = 0.0
	drive_total *= signf(ratio) if gear >= 1 else -1.0
	engine_load = throttle * (0.0 if absf(forward_speed) > limit else 1.0)

	# ---- tyre forces
	var total_slip := 0.0
	var s_max := deg_to_rad(lerpf(34.0, 7.0, smoothstep(0.0, 45.0, absf(forward_speed))))
	for w in wheels:
		var front: bool = w["front"]
		# Ackermann: inner wheel steers more
		var st: float = steer * s_max * float(dmg["steer"])
		if front and st != 0.0:
			var inner: bool = (st < 0.0) == bool(w["left"])
			st *= 1.12 if inner else 0.9
		w["steer"] = st if front else 0.0
		if not w["contact"]:
			w["omega"] = lerpf(float(w["omega"]), float(w["omega"]) * 0.98, 1.0)
			w["spin"] = fmod(float(w["spin"]) + float(w["omega"]) * dt, TAU)
			continue
		var n: Vector3 = w["normal"]
		var cp: Vector3 = w["contact_point"]
		var off: float = w["offset"]
		var k: float = float(w["k"]) * float(dmg["spring"])
		var c: float = float(w["c"]) * float(dmg["damper"])
		var damper := c * (0.7 if float(w["offset_vel"]) > 0.0 else 1.3) * float(w["offset_vel"])
		var arb_f: float = float(arb[front]) * (1.0 if w["left"] else -1.0)
		var fz := maxf(0.0, float(w["static_load"]) + k * off + damper + arb_f)
		if off >= bump_travel - 0.001:
			fz += 60000.0 * (off - bump_travel + 0.02)            # bump stop
		w["load"] = fz
		var apply_at: Vector3 = cp + up * roll_center - xf.origin
		state.apply_force(n * fz, cp - xf.origin)
		# wheel frame on the ground plane
		var wf := fwd.rotated(up, -float(w["steer"]))
		wf = (wf - n * wf.dot(n)).normalized()
		var wr := n.cross(wf).normalized() * -1.0
		var pv := state.get_velocity_at_local_position(cp - xf.origin)
		var v_long := pv.dot(wf)
		var v_lat := pv.dot(wr)
		var m_surf: float = mu * float(w["surface_mu"])
		var slide: float = w["slide"]
		var mu_eff := m_surf * lerpf(1.0, slide_mu, slide)
		var fmax := mu_eff * fz
		# longitudinal: drive split 4WD, brakes with ABS, handbrake locks rear
		var axle_share := front_split if front else 1.0 - front_split
		var fx: float = drive_total * axle_share * 0.5
		var locked := handbrake and not front
		var bshare := brake_front if front else 1.0 - brake_front
		var fb := brake * brake_force * bshare * 0.5
		var stop_force := absf(v_long) * float(w["static_load"]) / 9.81 / dt
		if fb > 0.0:
			fx -= signf(v_long) * minf(minf(fb, fmax * 0.95), stop_force)
		fx -= signf(v_long) * minf(rolling_resistance * fz, stop_force)
		var spinning := absf(fx) > fmax
		if locked:
			fx = -signf(v_long) * minf(slide_mu * m_surf * fz, stop_force)
		# lateral: slip-angle curve, damped at walking speeds
		var alpha := atan2(v_lat, maxf(absf(v_long), 0.5))
		var fy := -fmax * sin(tyre_C * atan(tyre_B * alpha))
		var low := 1.0 - smoothstep(0.5, 3.0, absf(v_long))
		var fy_stop := -v_lat * float(w["static_load"]) / 9.81 / dt * 0.5
		fy = lerpf(fy, clampf(fy_stop, -fmax, fmax), low)
		if locked:
			fy *= 0.35 * (0.8 if easy_drift else 1.0)
		if easy_drift and not front and slide > 0.2:
			fy *= 0.85
		# friction circle
		var tot := sqrt(fx * fx + fy * fy)
		var sat := tot / maxf(fmax, 1.0)
		if sat > 1.0:
			fx /= sat
			fy /= sat
		# grip memory: saturating tyres slide (lower mu) and recover gradually
		var target := 1.0 if sat > 1.05 or spinning or locked or absf(alpha) > 0.24 else 0.0
		var rec := 1.1 if not easy_drift else 0.7
		w["slide"] = move_toward(slide, target, dt * (4.0 if target > slide else rec))
		w["slip_lat"] = alpha
		total_slip = maxf(total_slip, clampf(maxf(absf(alpha) / 0.3, float(w["slide"])), 0.0, 1.0))
		state.apply_force(wf * fx + wr * fy, apply_at)
		# wheel rotation: rolls with the ground, faster when spinning, stops when locked
		var omega := v_long / float(w["radius"])
		if spinning and not locked:
			omega += signf(fx if fx != 0.0 else 1.0) * 6.0 * throttle
		if locked:
			omega = 0.0
		w["omega"] = omega
		w["spin"] = fmod(float(w["spin"]) + omega * dt, TAU)
	slip_amount = total_slip
	# aero drag at the CG
	var v2 := vel.length_squared()
	if v2 > 0.01:
		state.apply_central_force(-vel.normalized() * 0.5 * 1.2 * cd_a * v2)
	if easy_drift and slip_amount > 0.3 and absf(forward_speed) > 6.0:
		# drift assist: a little yaw damping makes counter-steer catch the slide
		state.apply_torque(-up * state.angular_velocity.dot(up) * mass * 0.35)
	_collect_impacts(state)


func _torque_curve(r: float) -> float:
	## 1GD-FTV-like: full 500 N m from 1600 rpm (game configuration holds it to 3200), softer below,
	## falls off towards the 4400 rpm cut-off
	if r < 1600.0:
		return lerpf(0.55, 1.0, clampf((r - 800.0) / 800.0, 0.0, 1.0))
	if r < 3200.0:
		return 1.0
	return lerpf(1.0, 0.7, clampf((r - 3200.0) / 1200.0, 0.0, 1.0))


func _update_gearbox(dt: float, wheel_omega: float) -> void:
	_shift_timer = maxf(0.0, _shift_timer - dt)
	if gear < 1 or _shift_timer > 0.0:
		return
	var r := wheel_omega * gears[gear - 1] * final_drive * 60.0 / TAU
	var up_rpm := lerpf(2300.0, 3900.0, throttle)
	if r > up_rpm and gear < gears.size():
		gear += 1
		_shift_timer = 0.45
	elif gear > 1:
		var down := wheel_omega * gears[gear - 2] * final_drive * 60.0 / TAU
		if down < lerpf(1700.0, 3200.0, throttle) and r < 1350.0 + throttle * 900.0:
			gear -= 1
			_shift_timer = 0.35


# ------------------------------------------------------------------------------------------- visuals
func _process(delta: float) -> void:
	for w in wheels:
		var d: Node3D = w["node"]
		var rest: Transform3D = w["rest"]
		var mesh: Node3D = w["mesh"]
		var tilt := 0.0
		if health < 35.0 and not w["front"]:
			tilt = deg_to_rad(4.0) * (1.0 - health / 35.0) * (1.0 if w["left"] else -1.0)   # bent suspension
		var ps: float = (d.get_parent() as Node3D).global_transform.basis.get_scale().y
		d.transform = Transform3D(rest.basis * Basis(Vector3.DOWN, float(w["steer"])) * Basis(Vector3.BACK, tilt),
				rest.origin + Vector3.UP * float(w["offset"]) / ps)
		var mr: Transform3D = w["mesh_rest"]
		# spin about the axle (pivot X axis); negative angle = top of the tyre moves forward (-Z)
		mesh.transform = Transform3D(Basis(Vector3.RIGHT, -float(w["spin"])) * mr.basis, mr.origin)
	if _steering_wheel:
		_steering_wheel.transform = Transform3D(_steering_rest.basis * Basis(Vector3.BACK, steer * deg_to_rad(240.0)), _steering_rest.origin)


# ------------------------------------------------------------------------------------------- damage
func _damage_factors() -> Dictionary:
	## gameplay effect of the car's condition (never fully disabled):
	## >70 % almost normal; 40-70 % less power/handling; 15-40 % slow, soft suspension; <15 % crawling
	var h := health / 100.0
	return {
		"power": clampf(lerpf(0.25, 1.0, smoothstep(0.0, 0.7, h)), 0.25, 1.0),
		"vmax": clampf(lerpf(0.15, 1.0, smoothstep(0.05, 0.75, h)), 0.15, 1.0),
		"steer": lerpf(0.8, 1.0, smoothstep(0.1, 0.5, h)),
		"spring": lerpf(0.75, 1.0, smoothstep(0.1, 0.45, h)),
		"damper": lerpf(0.5, 1.0, smoothstep(0.1, 0.45, h)),
	}


func _collect_impacts(state: PhysicsDirectBodyState3D) -> void:
	## A collision = a velocity jump the car's own forces cannot produce (> ~3 g in one step).
	## Jolt spreads one crash over several contacts and steps, so the jump is accumulated while it
	## lasts; the impact point/normal come from the strongest contact (fallback: the body front).
	var v := state.linear_velocity
	var jump := (v - _prev_v).length()
	_prev_v = v
	var dt := state.step
	if jump > 30.0 * dt and state.get_contact_count() > 0:
		var best := -1.0
		for i in state.get_contact_count():
			var imp := state.get_contact_impulse(i).length()
			var pos := state.get_contact_local_position(i)
			# ignore the ground under the wheels (contacts below the sills)
			if (state.transform.affine_inverse() * pos).y < _ground_y + 0.30:
				continue
			if imp > best:
				best = imp
				_impact_point = pos
				_impact_normal = state.get_contact_local_normal(i)
		if best >= 0.0:
			_impact_acc += jump
			_impact_steps = 4
			return
	if _impact_steps > 0:
		_impact_steps -= 1
		if _impact_steps == 0 and _impact_acc > 1.6 and _hit_cooldown <= 0.0:
			call_deferred("_add_damage", _impact_point, _impact_normal, _impact_acc)
			_hit_cooldown = 0.3
		if _impact_steps == 0:
			_impact_acc = 0.0


func _add_damage(p_world: Vector3, n_world: Vector3, dv: float) -> void:
	## dent at the contact, pushed along the contact normal (into the body), size and depth
	## from the hit strength; health drops with (impact speed - 6 km/h)^1.5
	last_impact = dv
	var inv := model.global_transform.affine_inverse()
	var p := inv * p_world
	var dir := (inv.basis * n_world).normalized()
	# the contact normal points out of the other body into the car: push the panel inward
	var to_center := (Vector3(0, p.y, 0) - Vector3(p.x, p.y, p.z)).normalized()
	if dir.dot(to_center) < 0.0:
		dir = -dir
	var depth := clampf((dv - 1.4) * 0.03, 0.015, 0.2)
	var radius := clampf(0.28 + dv * 0.05, 0.3, 0.75)
	_dents.append([Vector4(p.x, p.y, p.z, radius), Vector4(dir.x, dir.y, dir.z, depth)])
	if _dents.size() > 8:
		_merge_oldest_dents()
	_push_dents()
	health = maxf(0.0, health - pow(maxf(dv - 1.6, 0.0), 1.5) * 0.9)   # 30 km/h wall ~ -15 %, 55 km/h ~ -45 %
	damaged.emit(health)


func _merge_oldest_dents() -> void:
	# keep 8: merge the two closest dents into one (depth adds up, capped)
	var bi := 0
	var bj := 1
	var bd := INF
	for i in _dents.size():
		for j in range(i + 1, _dents.size()):
			var a: Vector4 = _dents[i][0]
			var b: Vector4 = _dents[j][0]
			var d := Vector3(a.x, a.y, a.z).distance_to(Vector3(b.x, b.y, b.z))
			if d < bd:
				bd = d; bi = i; bj = j
	var A: Array = _dents[bi]
	var B: Array = _dents[bj]
	var pa: Vector4 = A[0]
	var pb: Vector4 = B[0]
	var da: Vector4 = A[1]
	var db: Vector4 = B[1]
	var pos := (Vector3(pa.x, pa.y, pa.z) + Vector3(pb.x, pb.y, pb.z)) * 0.5
	var dir := (Vector3(da.x, da.y, da.z) * da.w + Vector3(db.x, db.y, db.z) * db.w).normalized()
	_dents[bi] = [Vector4(pos.x, pos.y, pos.z, maxf(pa.w, pb.w) + bd * 0.5), Vector4(dir.x, dir.y, dir.z, minf(da.w + db.w * 0.6, 0.18))]
	_dents.remove_at(bj)


func _push_dents() -> void:
	var ps: Array[Vector4] = []
	var ds: Array[Vector4] = []
	for i in 8:
		if i < _dents.size():
			ps.append(_dents[i][0])
			ds.append(_dents[i][1])
		else:
			ps.append(Vector4(0, 0, 0, 1))
			ds.append(Vector4.ZERO)
	for m in _materials:
		m.set_shader_parameter("dent_pos", ps)
		m.set_shader_parameter("dent_dir", ds)
		m.set_shader_parameter("dent_count", _dents.size())


## Full repair: dents and scratches gone (the geometry itself was never modified), suspension,
## engine power and handling back to 100 %. The same car object keeps driving.
func repair() -> void:
	_dents.clear()
	_push_dents()
	health = 100.0
	for w in wheels:
		w["slide"] = 0.0
	repaired.emit()


func damage_at(p_world: Vector3, n_world: Vector3, dv: float) -> void:
	## for tests / scripted events
	_add_damage(p_world, n_world, dv)


func place(pos: Vector3, yaw: float) -> void:
	## put the car on the ground at pos (raycast), wheels at static ride height
	var space := get_world_3d().direct_space_state
	var hit := space.intersect_ray(PhysicsRayQueryParameters3D.create(pos + Vector3.UP * 30.0, pos + Vector3.DOWN * 60.0, collision_mask, [get_rid()]))
	var y := (hit.position as Vector3).y if not hit.is_empty() else pos.y
	global_transform = Transform3D(Basis(Vector3.UP, yaw), Vector3(pos.x, y - _ground_y, pos.z))
	linear_velocity = Vector3.ZERO
	angular_velocity = Vector3.ZERO
	reset_physics_interpolation()


## world position next to the driver's door (left, LHD) for entering / leaving
func driver_door_point(outside := 0.9) -> Vector3:
	var d: Node3D = model.find_child("door_lf_dummy", true, false)
	var p := d.global_position + global_transform.basis.x * -outside
	return p
