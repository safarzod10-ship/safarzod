extends Node3D
func _ready() -> void:
	var body := StaticBody3D.new(); add_child(body)
	var cs := CollisionShape3D.new(); var b := BoxShape3D.new(); b.size = Vector3(40, 1, 4400); cs.shape = b; cs.position = Vector3(0, -0.5, -2000); body.add_child(cs)
	var car: VehiclePrado = (load("res://scenes/vehicles/prado.tscn") as PackedScene).instantiate()
	add_child(car)
	for i in 2: await get_tree().physics_frame
	car.place(Vector3.ZERO, 0.0)
	for i in 150: await get_tree().physics_frame
	VehicleInput.scripted = {"throttle": 1.0}
	var t := 0.0
	var line := ""
	while t < 14.0:
		await get_tree().physics_frame
		t += 1.0 / 60.0
		if fmod(t, 1.0) < 1.0 / 60.0:
			line += "t%.0f v%.0f r%.0f g%d | " % [t, car.speed_kmh, car.rpm, car.gear]
		if car.speed_kmh >= 100.0:
			print("T100 ", t); break
	print(line)
	get_tree().quit()
