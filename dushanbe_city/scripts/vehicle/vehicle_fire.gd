class_name VehicleFire
extends Node
## Damage states of a vehicle (as in big open-world games): condition < 30 % - the engine smokes,
## < 12 % (or 0) - it catches fire and burns for a few seconds, then EXPLODES: fireball, boom, the
## car is thrown up and left as a burnt wreck; everyone within ~9 m is hurt (the player dies close
## to it or inside), nearby cars are damaged too (chain reactions). The wreck is cleared (the car
## restored at its parking place) after 90 s when the player is away from it.

const SMOKE_AT := 30.0
const FIRE_AT := 12.0
const BURN_TIME := 6.0
const RADIUS := 9.0

var car: VehiclePrado
var wrecked := false
var _smoke: CPUParticles3D
var _fire: CPUParticles3D
var _fire_snd: AudioStreamPlayer3D
var _burn := -1.0
var _wreck_t := 0.0
var _home := Transform3D.IDENTITY
var _overlay: StandardMaterial3D


func _ready() -> void:
	car = get_parent() as VehiclePrado
	add_to_group(&"vehicle_fire")
	# the parking place to restore a wreck to (the car is placed after it enters the tree)
	get_tree().create_timer(3.0, false).timeout.connect(func() -> void: _home = car.global_transform)


func engine_point() -> Vector3:
	return Vector3(0, car.body_size.y * 0.25, -car.body_size.z * 0.36)


func _physics_process(delta: float) -> void:
	if car == null:
		return
	if wrecked:
		_wreck_t += delta
		if _wreck_t > 25.0 and _fire:
			_fire.emitting = false
		if _wreck_t > 90.0 and _player_far(150.0):
			restore()
		return
	var h := car.health
	if h < SMOKE_AT and _smoke == null:
		_smoke = WeaponFX.emitter(car, engine_point(), false)
	elif h >= SMOKE_AT and _smoke:
		_smoke.queue_free()
		_smoke = null
	if h < FIRE_AT and _burn < 0.0:
		_burn = 0.0
		_fire = WeaponFX.emitter(car, engine_point() + Vector3(0, 0.2, 0), true)
		_fire_snd = AudioStreamPlayer3D.new()
		_fire_snd.stream = load("res://assets/audio/weapons/fire_loop.wav")
		_fire_snd.unit_size = 6.0
		car.add_child(_fire_snd)
		_fire_snd.position = engine_point()
		_fire_snd.finished.connect(_fire_snd.play)
		_fire_snd.play()
	if _burn >= 0.0:
		_burn += delta * (2.0 if h <= 0.0 else 1.0)
		if h >= FIRE_AT:                        # repaired in time
			_burn = -1.0
			_fire.queue_free()
			_fire = null
			_fire_snd.queue_free()
		elif _burn >= BURN_TIME:
			explode()


func explode() -> void:
	if wrecked:
		return
	wrecked = true
	car.set("wrecked", true)
	car.health = 0.0
	var pos := car.global_position
	WeaponFX.explosion(get_tree(), pos + Vector3(0, 0.6, 0))
	if _fire_snd:
		_fire_snd.queue_free()
	# thrown up and spun
	car.apply_central_impulse(Vector3(randf_range(-1, 1), 6.5, randf_range(-1, 1)) * car.mass)
	car.apply_torque_impulse(Vector3(randf_range(-1, 1), 0, randf_range(-1, 1)) * car.mass * 2.0)
	# burnt look
	_overlay = StandardMaterial3D.new()
	_overlay.albedo_color = Color(0.03, 0.03, 0.03, 0.82)
	_overlay.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	_overlay.roughness = 1.0
	for mi in car.find_children("*", "MeshInstance3D", true, false):
		(mi as MeshInstance3D).material_overlay = _overlay
	# blast: people and cars around
	for s in get_tree().get_nodes_in_group(&"car_session"):
		var ses := s as CarSession
		var d := ses.player.global_position.distance_to(pos) if ses.player else INF
		if ses.driving and ses.car == car:
			d = 0.0
		if d < RADIUS:
			PlayerLife.damage(160.0 * (1.0 - d / RADIUS))
	for v in get_tree().get_nodes_in_group(&"vehicle"):
		if v == car or not v is VehiclePrado:
			continue
		var vd := (v as Node3D).global_position.distance_to(pos)
		if vd < RADIUS:
			var vp := v as VehiclePrado
			vp.health = maxf(0.0, vp.health - 70.0 * (1.0 - vd / RADIUS))
			vp.apply_central_impulse((vp.global_position - pos).normalized() * vp.mass * 4.0 * (1.0 - vd / RADIUS) + Vector3.UP * vp.mass * 2.0)


func restore() -> void:
	wrecked = false
	car.set("wrecked", false)
	_wreck_t = 0.0
	_burn = -1.0
	for mi in car.find_children("*", "MeshInstance3D", true, false):
		(mi as MeshInstance3D).material_overlay = null
	for n in [_smoke, _fire]:
		if n and is_instance_valid(n):
			n.queue_free()
	_smoke = null
	_fire = null
	car.repair()
	car.place(_home.origin + Vector3(0, 0.5, 0), _home.basis.get_euler().y)
	# parked under a roof (the hero's garage): back onto the floor, not onto the roof
	if HeroHome.instance and Vector2(_home.origin.x - HeroHome.instance.garage_point().x, _home.origin.z - HeroHome.instance.garage_point().z).length() < 4.0:
		var p := car.global_position
		p.y = HeroHome.instance.floor_y() + 0.02 - float(car.get("_ground_y"))
		car.global_position = p


func _player_far(d: float) -> bool:
	for p in get_tree().get_nodes_in_group(&"player"):
		if (p as Node3D).global_position.distance_to(car.global_position) < d:
			return false
	return true
