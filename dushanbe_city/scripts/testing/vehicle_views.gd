extends Node3D
## Real-renderer views of the Prado (xvfb + lavapipe): front, rear, left, right, top, front close-up,
## wheel/suspension close-up, damaged body (scripted impacts) and repaired body.
## godot --path . res://scenes/testing/vehicle_views.tscn -- out=<dir>

var car: VehiclePrado
var cam: Camera3D
var out := "/tmp"


func _ready() -> void:
	for a in OS.get_cmdline_user_args():
		if a.begins_with("out="):
			out = a.substr(4)
	add_child(EnvironmentRig.new())
	var body := StaticBody3D.new()
	add_child(body)
	var cs := CollisionShape3D.new()
	var bs := BoxShape3D.new()
	bs.size = Vector3(200, 1, 200)
	cs.shape = bs
	cs.position.y = -0.5
	body.add_child(cs)
	var ground := MeshInstance3D.new()
	var pm := PlaneMesh.new()
	pm.size = Vector2(200, 200)
	ground.mesh = pm
	ground.material_override = CityMaterials.get_material("asphalt")
	add_child(ground)
	car = (load("res://scenes/vehicles/prado.tscn") as PackedScene).instantiate()
	add_child(car)
	cam = Camera3D.new()
	cam.fov = 40
	add_child(cam)
	cam.make_current()
	await _frames(3)
	car.place(Vector3.ZERO, 0.0)
	await _frames(120)
	var c := car.global_position + Vector3(0, -0.1, 0)
	await _shot("front", c + Vector3(0, 0.9, -7.5), c)
	await _shot("rear", c + Vector3(0, 1.0, 7.5), c)
	await _shot("left", c + Vector3(-8.0, 0.6, 0), c)
	await _shot("right", c + Vector3(8.0, 0.6, 0), c)
	await _shot("top", c + Vector3(0.01, 11.0, 0), c)
	await _shot("three_quarter", c + Vector3(-5.0, 1.8, -5.5), c)
	await _shot("front_close", c + Vector3(-1.4, 0.9, -3.6), c + Vector3(0, 0.1, -2.0))
	var w: Node3D = car.wheels[0]["node"]
	await _shot("wheel_close", w.global_position + Vector3(-1.8, 0.35, -0.6), w.global_position)
	# seated driver (left-hand drive): through the open side / windscreen
	car.set_driver_visible(true)
	await _frames(3)
	var dl := car.global_position + car.global_transform.basis * Vector3(-0.45, 0.55, -0.3)
	await _shot("driver_side", c + Vector3(-3.2, 1.2, -0.6), dl)
	await _shot("driver_front", c + Vector3(-0.9, 1.6, -4.2), dl)
	await _shot("driver_close", c + Vector3(-1.9, 1.15, -0.4), dl)
	car.set_driver_visible(false)
	# damage: a front-left corner hit, a door hit, a rear hit (scripted impacts = same path as crashes)
	var b := car.global_transform.basis
	car.damage_at(car.global_position + b * Vector3(-0.7, -0.05, -2.25), b * Vector3(0, 0, 1), 9.0)
	car.damage_at(car.global_position + b * Vector3(-0.95, 0.05, -0.6), b * Vector3(1, 0, 0), 7.0)
	car.damage_at(car.global_position + b * Vector3(-0.55, 0.4, -1.6), b * Vector3(0.3, -1, 0.4).normalized(), 6.0)
	car.damage_at(car.global_position + b * Vector3(0.4, -0.1, 2.25), b * Vector3(0, 0, -1), 6.0)
	await _frames(5)
	print("VIEWS damaged health=%.0f dents=%d" % [car.health, car._dents.size()])
	await _shot("damaged_front", c + Vector3(-5.0, 1.6, -5.5), c)
	await _shot("damaged_close", c + Vector3(-3.2, 1.0, -3.4), c + Vector3(-0.6, 0.0, -1.2))
	await _shot("damaged_rear", c + Vector3(3.5, 1.5, 6.5), c)
	car.repair()
	await _frames(5)
	await _shot("repaired_front", c + Vector3(-5.0, 1.6, -5.5), c)
	await _shot("repaired_close", c + Vector3(-3.2, 1.0, -3.4), c + Vector3(-0.6, 0.0, -1.2))
	# turning: drive in a circle and shoot from outside (body roll, steered wheels)
	VehicleInput.scripted = {"throttle": 0.55, "steer": 0.7}
	await _frames(60 * 6)
	var p := car.global_position
	var v := car.linear_velocity.normalized()
	var side := v.cross(Vector3.UP).normalized()
	print("VIEWS turning speed=%.0f km/h roll=%.1f deg" % [car.speed_kmh, rad_to_deg(asin(car.global_transform.basis.x.y))])
	await _shot("turning", p + side * 7.0 + v * 4.0 + Vector3(0, 1.2, 0), p)
	VehicleInput.scripted = null
	get_tree().quit()


func _shot(label: String, from: Vector3, at: Vector3) -> void:
	cam.global_position = from
	cam.look_at(at, Vector3.UP if absf((at - from).normalized().y) < 0.98 else Vector3.FORWARD)
	for i in 3:
		await RenderingServer.frame_post_draw
	get_viewport().get_texture().get_image().save_png("%s/prado_%s.png" % [out, label])
	print("VIEWS shot ", label)


func _frames(n: int) -> void:
	for i in n:
		await get_tree().physics_frame
