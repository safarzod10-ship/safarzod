class_name CarSession
extends Node
## Getting in and out of the Prado.
## On foot: when the player stands near the driver's (left) door and the car is (almost) still, a
## «СЕСТЬ» button appears (key E). Entering hides the walking character (its collision is removed
## from physics), switches input to the car, the camera to VehicleCamera and the touch UI to
## CarControls. «ВЫЙТИ» (E) puts the character next to the driver's door on free, walkable ground:
## several candidate spots are tested with the character's capsule (never inside the body or under the
## car); if the car is moving fast it brakes first.

const ENTER_DIST := 1.9
var player: PlayerController
var car: VehiclePrado
var walk_touch: CanvasLayer             # walking touch UI (hidden while driving)
var cam: VehicleCamera
var controls: CarControls
var driving := false
var _prompt: Control
var _layer: CanvasLayer
var _exit_requested := false
var _font: Font
var busy := false                       ## animated get-in / get-out running
var door: CarDoorInteractable


func _ready() -> void:
	VehicleInput.ensure_actions()
	_font = load("res://assets/fonts/DejaVuSans-Bold.ttf") if ResourceLoader.exists("res://assets/fonts/DejaVuSans-Bold.ttf") else ThemeDB.fallback_font
	cam = VehicleCamera.new()
	cam.name = "VehicleCamera"
	cam.car = car
	add_child(cam)
	_layer = CanvasLayer.new()
	_layer.layer = 11
	add_child(_layer)
	controls = CarControls.new()
	controls.car = car
	controls.visible = false
	_layer.add_child(controls)
	controls.exit_pressed.connect(func() -> void: _exit_requested = true)
	controls.repair_pressed.connect(func() -> void: car.repair())
	controls.orbit_toggled.connect(func() -> void: cam.orbit_mode = controls.orbit_on)
	_prompt = Control.new()
	_prompt.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_prompt.set_anchors_preset(Control.PRESET_FULL_RECT)
	_prompt.visible = false
	_prompt.draw.connect(_draw_prompt)
	_layer.add_child(_prompt)
	door = CarDoorInteractable.new()
	door.name = "DriverDoor"
	door.session = self
	add_child(door)


func _prompt_rect() -> Rect2:
	var s := _prompt.size
	var u := minf(s.x, s.y) / 10.0
	return Rect2(s.x - 7.6 * u, s.y - 7.4 * u, 2.6 * u, 1.1 * u)


func _draw_prompt() -> void:
	var r := _prompt_rect()
	_prompt.draw_rect(r, Color(0.1, 0.45, 0.9, 0.75))
	_prompt.draw_rect(r, Color(1, 1, 1, 0.8), false, 3.0)
	var fs := int(r.size.y * 0.42)
	var t := "[E] СЕСТЬ"
	var w := _font.get_string_size(t, HORIZONTAL_ALIGNMENT_CENTER, -1, fs)
	_prompt.draw_string(_font, r.get_center() + Vector2(-w.x * 0.5, fs * 0.36), t, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, Color.WHITE)


func can_enter() -> bool:
	if driving or busy or player == null or car == null:
		return false
	var d := player.global_position.distance_to(car.driver_door_point(0.6))
	return d < ENTER_DIST and car.speed_kmh < 5.0 and player.is_on_floor()


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed(&"car_enter"):
		if driving and not busy:
			_exit_requested = true
		# on foot: E is the generic "interact" action (CharacterInteraction -> CarDoorInteractable)
	elif driving and event.is_action_pressed(&"car_repair"):
		car.repair()
	elif driving and event.is_action_pressed(&"car_camera"):
		controls.orbit_on = not controls.orbit_on
		cam.orbit_mode = controls.orbit_on


func _input(event: InputEvent) -> void:
	if _prompt.visible and event is InputEventScreenTouch and event.pressed and _prompt_rect().has_point(event.position):
		get_viewport().set_input_as_handled()
		enter_animated()


func _process(_d: float) -> void:
	var vs := _prompt.get_viewport_rect().size
	if _prompt.size != vs:
		_prompt.position = Vector2.ZERO
		_prompt.size = vs
	var show := can_enter() and not PlayerInput.touch_active   # touch: the ACTION button shows «СЕСТЬ»
	if show != _prompt.visible:
		_prompt.visible = show
	if show:
		_prompt.queue_redraw()
	if driving and _exit_requested:
		# leave only when (nearly) stopped: brake automatically until then
		if car.speed_kmh > 6.0:
			VehicleInput.scripted = {"brake": 1.0}
		else:
			VehicleInput.scripted = null
			_exit_requested = false
			exit_animated()


func enter() -> void:
	if driving:
		return
	driving = true
	PlayerInput.touch_move = Vector2.ZERO
	player.visible = false
	player.process_mode = Node.PROCESS_MODE_DISABLED       # also removes its collision from physics
	car.driven = true
	car.set_driver_visible(true)
	cam.car = car
	cam.snap()
	cam.make_current()
	_set_walk_ui(false)
	controls.visible = true
	Minimap.focus = car
	Minimap.focus_camera = cam


## Animated get-in: walk to the door (normal locomotion, no teleport), face the car, open the door
## (UAL Interact), sit down while sliding into the seat (UAL Sitting_Enter; the body's collision is
## off so it passes the door opening, not the bodywork), then control and camera switch to the car.
func enter_animated() -> void:
	if driving or busy or not can_enter():
		return
	busy = true
	player.interaction.busy = true
	var door_pt := car.driver_door_point(0.75)
	var bx := car.global_transform.basis.x
	var face := atan2(-bx.x, -bx.z)                 # looking at the car's left side
	await player.walk_to(door_pt, face, 2.5)
	car.audio_door(false)
	await player.play_action("interact", 0.65)
	var seat := car.driver_door_point(-0.45) + Vector3.UP * 0.25
	var start := player.global_position
	var shape_on := player.collision_layer
	player.collision_layer = 0
	player.collision_mask = 0
	player.set_physics_process(false)
	player.anim.travel(&"sit_enter")
	var T := 0.85
	var t := 0.0
	while t < T:
		await get_tree().process_frame
		t += get_process_delta_time()
		var k := smoothstep(0.0, 1.0, t / T)
		player.global_position = start.lerp(seat, k)
	player.collision_layer = shape_on
	player.collision_mask = 1
	player.set_physics_process(true)
	player.end_sequence()
	player.interaction.busy = false
	busy = false
	enter()


## Animated get-out: the car must be (nearly) stopped; a free spot next to the door is found first;
## the character appears in the seat and gets out (UAL Sitting_Exit) to that spot, then walks freely.
func exit_animated() -> void:
	if not driving or busy:
		return
	busy = true
	var spot := find_exit_spot()
	var seat := car.driver_door_point(-0.45) + Vector3.UP * 0.25
	exit()                                           # control / camera back to the walker
	player.interaction.busy = true
	player.collision_layer = 0
	player.collision_mask = 0
	player.set_physics_process(false)
	player.global_position = seat
	player.seq_active = true
	player.anim.travel(&"sit_exit")
	var T := 0.9
	var t := 0.0
	while t < T:
		await get_tree().process_frame
		t += get_process_delta_time()
		player.global_position = seat.lerp(spot, smoothstep(0.0, 1.0, t / T))
	player.global_position = spot
	player.collision_layer = 2
	player.collision_mask = 1
	player.set_physics_process(true)
	player.end_sequence()
	player.interaction.busy = false
	busy = false


func exit() -> void:
	if not driving:
		return
	var spot := find_exit_spot()
	driving = false
	car.driven = false
	car.set_driver_visible(false)
	controls.release()
	controls.visible = false
	VehicleInput.release_all()
	player.process_mode = Node.PROCESS_MODE_INHERIT
	player.visible = true
	var yaw := car.global_rotation.y + PI * 0.5          # face away from the door
	player.teleport(spot, yaw)
	player.set_camera_angles(car.global_rotation.y, player.cam_pitch)
	player.get_camera().make_current()
	_set_walk_ui(true)
	Minimap.focus = null
	Minimap.focus_camera = null


func find_exit_spot() -> Vector3:
	## candidates around the driver's door first, then behind / the other side / in front;
	## each is tested with the walking capsule (free space) and needs ground within 1.5 m below
	var b := car.global_transform.basis
	var door := car.driver_door_point(0.0)
	var cands: Array[Vector3] = [
		door - b.x * 1.0, door - b.x * 1.5, door - b.x * 1.0 + b.z * 1.2, door - b.x * 1.0 - b.z * 1.2,
		car.global_position + b.z * 3.4 - b.x * 0.6, car.global_position + b.x * 1.9, car.global_position - b.z * 3.6,
		door - b.x * 2.4]
	var space := car.get_world_3d().direct_space_state
	var shape := CapsuleShape3D.new()
	shape.radius = 0.32
	shape.height = 1.75
	for c in cands:
		var hit := space.intersect_ray(PhysicsRayQueryParameters3D.create(c + Vector3.UP * 1.5, c + Vector3.DOWN * 2.0, 1, [car.get_rid()]))
		if hit.is_empty() or (hit.normal as Vector3).y < 0.75:
			continue
		var g: Vector3 = hit.position
		var q := PhysicsShapeQueryParameters3D.new()
		q.shape = shape
		q.transform = Transform3D(Basis.IDENTITY, g + Vector3.UP * (0.875 + 0.06))
		q.collision_mask = 1
		if space.intersect_shape(q, 1).is_empty():
			return g
	return door - b.x * 1.2 + Vector3.UP * 0.5


var _walk_touch_shown := false


func _set_walk_ui(on: bool) -> void:
	if walk_touch == null:
		return
	if not on:
		_walk_touch_shown = walk_touch.visible
		controls.touch_mode = _walk_touch_shown      # pedals/arrows only on touch devices
		walk_touch.call("set_shown", false)
	else:
		walk_touch.call("set_shown", _walk_touch_shown)
