class_name VehicleLights
extends Node3D
## Prado lamps. The model's lamp surfaces (identified by rendering each material in its own colour,
## docs/STAGE5.md) are driven through the vehicle shader's emission:
##   "headlight rf"          headlamps + fog lamps          dipped / main beam, weak DRL with the engine on
##   "taillight rr", "fari.6" tail lamps                    dim with the headlamps, bright when braking
##   "body.3"                high-mounted stop lamp         braking
##   "body.5"                reversing lamps                gear R
##   "fari.4"                front indicators (both sides)  per side via the shader's side_gain
##   "fari.3" / "fari.2"     left / right indicators (mirror repeaters + rear cluster)
## Indicators: 1.5 Hz, left / right / hazard. A lamp that is smashed (strong dent) goes dark in the shader.
## Real light: ONE SpotLight3D for both headlamps (no shadows; longer and narrower on main beam) and
## only while the headlamps are on — the one dynamic light the car costs.

enum Beam { OFF, LOW, HIGH }
var car: VehiclePrado
var beam := Beam.OFF
var turn := 0                     ## -1 left, 0 off, 1 right
var hazard := false
var blink_on := false             ## current indicator phase (HUD arrows use it)
var braking := false
var reversing := false
var _t := 0.0
var _spot: SpotLight3D
var _mats := {}
var force := {}                   ## views / tests: {"brake": true, "reverse": true} without driving


func setup(c: VehiclePrado) -> void:
	car = c
	for k in ["headlight rf", "taillight rr", "fari.6", "body.3", "body.5", "fari.4", "fari.3", "fari.2"]:
		var m: ShaderMaterial = car._mat_cache.get(k)
		if m:
			_mats[k] = m
	_spot = SpotLight3D.new()
	_spot.name = "Headlamps"
	_spot.light_color = Color(1.0, 0.95, 0.86)
	_spot.shadow_enabled = false
	_spot.light_specular = 0.3
	_spot.visible = false
	car.add_child(_spot)
	var fl: Node3D = car.model.find_child("headlights", true, false)
	var p := car.to_local(fl.global_position) if fl else Vector3(0, 0.0, -2.2)
	_spot.position = Vector3(0.0, p.y, p.z - 0.1)
	_spot.rotation = Vector3(deg_to_rad(-4.0), 0, 0)


func cycle_beam() -> void:
	beam = ((beam + 1) % 3) as Beam


func set_turn(dir: int) -> void:
	turn = 0 if turn == dir else dir
	hazard = false


func toggle_hazard() -> void:
	hazard = not hazard
	if hazard:
		turn = 0


func _process(delta: float) -> void:
	if car == null:
		return
	_t += delta
	blink_on = fmod(_t, 0.667) < 0.36 and (hazard or turn != 0)
	braking = (car.brake > 0.05 and car.driven) or bool(force.get("brake", false))
	reversing = (car.gear == -1 and car.driven) or bool(force.get("reverse", false))
	var engine := car.driven
	var head := 0.0
	if beam == Beam.LOW:
		head = 2.2
	elif beam == Beam.HIGH:
		head = 4.0
	elif engine:
		head = 0.35                                 # daytime running lamps
	_lamp("headlight rf", Color(1.0, 0.96, 0.88), head)
	var tail := 0.9 if beam != Beam.OFF else 0.0
	var stop := 3.5 if braking else tail
	_lamp("taillight rr", Color(1.0, 0.04, 0.02), stop)
	_lamp("fari.6", Color(1.0, 0.04, 0.02), stop)
	_lamp("body.3", Color(1.0, 0.04, 0.02), 3.0 if braking else 0.0)
	_lamp("body.5", Color(1.0, 1.0, 0.95), 2.6 if reversing else 0.0)
	var left := blink_on and (hazard or turn < 0)
	var right := blink_on and (hazard or turn > 0)
	var amber := Color(1.0, 0.5, 0.03)
	_lamp("fari.4", amber, 3.0, Vector2(1.0 if left else 0.0, 1.0 if right else 0.0))
	_lamp("fari.3", amber, 3.0 if left else 0.0)
	_lamp("fari.2", amber, 3.0 if right else 0.0)
	_spot.visible = beam != Beam.OFF
	if _spot.visible:
		var hi := beam == Beam.HIGH
		_spot.spot_range = 75.0 if hi else 38.0
		_spot.spot_angle = 26.0 if hi else 36.0
		_spot.light_energy = 6.0 if hi else 3.5
		_spot.spot_attenuation = 0.8


func _lamp(key: String, col: Color, energy: float, side := Vector2.ONE) -> void:
	var m: ShaderMaterial = _mats.get(key)
	if m == null:
		return
	m.set_shader_parameter("emission_color", col)
	m.set_shader_parameter("emission_energy", energy)
	m.set_shader_parameter("side_gain", side)


## lamp state for tests / HUD
func state() -> Dictionary:
	return {"beam": beam, "turn": turn, "hazard": hazard, "blink": blink_on, "brake": braking, "reverse": reversing,
		"spot": _spot.visible, "head_energy": float((_mats["headlight rf"] as ShaderMaterial).get_shader_parameter("emission_energy")) if _mats.has("headlight rf") else 0.0}
