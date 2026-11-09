class_name PlayerCombat
extends Node
## The player's weapons in hand (Weapons.current):
##  * fists / bat: the punch animation; at the hit moment a short sphere test in front of the chest
##    hurts what is there (vehicles lose condition, physics bodies are pushed), with a hit sound;
##    the bat model is held in the right hand and swung with the punch;
##  * pistol / AK: the gun in the right hand, raised (WeaponAim arm IK) while shooting; the shot is a
##    ray from the camera through the screen centre (crosshair), then from the muzzle to that point:
##    muzzle flash + light, tracer, sparks / dust + bullet hole, the gunshot; vehicles lose
##    condition (smoke, fire, explosion - VehicleFire). Pistol: one shot per press; AK: automatic
##    while the button is held. Ammo from the gun shop.
## Fire button: the touch FIST button (its icon is the current weapon), LMB / F on desktop.

var player: PlayerController
var sk: Skeleton3D
var aim: WeaponAim
var models := {}                  ## weapon id -> Node3D (in the scene, top level)
var aim_t := 0.0                  ## > 0: arm raised (seconds left)
var _cool := 0.0
var _hit_done := false
var _swing := 0.0

const MUZZLE := {"pistol": Vector3(0, 0.078, -0.175), "ak47": Vector3(0, 0.07, -0.7)}


func _ready() -> void:
	sk = player.model.find_children("*", "Skeleton3D", true, false)[0]
	aim = WeaponAim.new()
	aim.name = "WeaponAim"
	aim.combat = self
	sk.add_child(aim)
	for id in ["bat", "pistol", "ak47"]:
		var ps: PackedScene = load("res://assets/weapons/%s.glb" % id)
		var holder := Node3D.new()
		holder.name = "Weapon_" + id
		holder.top_level = true
		var m := ps.instantiate() as Node3D
		m.rotation.y = PI                # Blender -Y (barrel / bat tip) -> Godot -Z (forward)
		holder.add_child(m)
		holder.visible = false
		add_child(holder)
		models[id] = holder


func gun() -> bool:
	return Weapons.uses_ammo(Weapons.current)


func _physics_process(delta: float) -> void:
	_cool -= delta
	aim_t -= delta
	if not PlayerInput.touch_active:
		PlayerInput.fire_held = Input.is_mouse_button_pressed(MOUSE_BUTTON_LEFT) and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED
	var on_foot := player.process_mode != Node.PROCESS_MODE_DISABLED and player.is_visible_in_tree() and not PlayerLife.dead
	for id in models:
		(models[id] as Node3D).visible = on_foot and Weapons.current == id
	if not on_foot:
		PlayerInput.fire_held = false
		PlayerInput.consume_fire()
		return
	var w := Weapons.current
	var d: Dictionary = Weapons.DATA[w]
	if gun():
		var want := PlayerInput.consume_fire() or (bool(d.get("auto", false)) and PlayerInput.fire_held)
		if want and _cool <= 0.0:
			_shoot(w, d)
	else:
		if PlayerInput.consume_fire():
			PlayerInput.queue_punch()          # fists / bat: the punch animation
		_melee(w, d)


# ------------------------------------------------------------------------------------------ guns
func _shoot(w: String, d: Dictionary) -> void:
	if Weapons.ammo_of(w) <= 0:
		_cool = 0.35
		WeaponFX.sound(get_tree(), "empty_click", player.global_position, -4.0)
		return
	Weapons.ammo[w] = Weapons.ammo_of(w) - 1
	_cool = float(d["rate"])
	aim_t = 1.6
	# turn to where the camera looks
	player.facing = player.cam_yaw
	player.rotation.y = player.facing
	var cam := player.get_camera()
	var from := cam.global_position
	var dir := -cam.global_transform.basis.z
	var spread := 0.006 if w == "pistol" else 0.014
	dir = (dir + Vector3(randf_range(-spread, spread), randf_range(-spread, spread), randf_range(-spread, spread))).normalized()
	var space := player.get_world_3d().direct_space_state
	var excl: Array[RID] = [player.get_rid()]
	var q := PhysicsRayQueryParameters3D.create(from, from + dir * float(d["range"]), 0xFFFFFFFF, excl)
	var hit := space.intersect_ray(q)
	var target: Vector3 = hit.position if not hit.is_empty() else from + dir * float(d["range"])
	var muzzle := muzzle_pos(w)
	# the muzzle may see something closer than the crosshair point (a wall beside the player)
	var q2 := PhysicsRayQueryParameters3D.create(muzzle, target + (target - muzzle).normalized() * 0.05, 0xFFFFFFFF, excl)
	var hit2 := space.intersect_ray(q2)
	if not hit2.is_empty():
		hit = hit2
		target = hit2.position
	var mdir := (target - muzzle).normalized()
	WeaponFX.muzzle_flash(get_tree(), muzzle, mdir, w == "ak47")
	WeaponFX.tracer(get_tree(), muzzle + mdir * 0.3, target)
	WeaponFX.sound(get_tree(), w, muzzle, 2.0 if w == "ak47" else 0.0, 300.0)
	if not hit.is_empty():
		var col: Object = hit.collider
		var v := _vehicle_of(col)
		WeaponFX.impact(get_tree(), target, hit.normal, v != null)
		if v:
			v.weapon_hit(float(d["damage"]) * 0.12)
		elif col is RigidBody3D:
			(col as RigidBody3D).apply_impulse(mdir * 6.0, target - (col as RigidBody3D).global_position)


func muzzle_pos(w: String) -> Vector3:
	var h: Node3D = models.get(w)
	return h.global_transform * MUZZLE.get(w, Vector3.ZERO) if h else player.global_position + Vector3.UP * 1.4


# ------------------------------------------------------------------------------------------ melee
func _melee(w: String, d: Dictionary) -> void:
	var a := player.anim
	if a == null or not a.is_punching():
		_hit_done = false
		_swing = 0.0
		return
	var t: float = a._punch_t / maxf(a._punch_len, 0.01)
	_swing = t
	if t > 0.35 and not _hit_done:
		_hit_done = true
		var fwd := Vector3(-sin(player.facing), 0, -cos(player.facing))
		var c := player.global_position + Vector3.UP * 1.2 + fwd * (float(d["range"]) * 0.6)
		var sh := SphereShape3D.new()
		sh.radius = 0.55
		var qp := PhysicsShapeQueryParameters3D.new()
		qp.shape = sh
		qp.transform = Transform3D(Basis.IDENTITY, c)
		qp.exclude = [player.get_rid()]
		var res := player.get_world_3d().direct_space_state.intersect_shape(qp, 8)
		var hit_any := false
		for r in res:
			var v := _vehicle_of(r.collider)
			if v:
				v.weapon_hit(float(d["damage"]) * 0.08)
				v.apply_impulse(fwd * (300.0 if w == "bat" else 120.0), c - v.global_position)
				hit_any = true
			elif r.collider is RigidBody3D:
				(r.collider as RigidBody3D).apply_central_impulse(fwd * 40.0)
				hit_any = true
			elif r.collider is StaticBody3D:
				hit_any = true
		if hit_any:
			WeaponFX.sound(get_tree(), "bat_hit" if w == "bat" else "punch_hit", c, -2.0, 50.0)


static func _vehicle_of(o: Object) -> VehiclePrado:
	var n := o as Node
	while n:
		if n is VehiclePrado:
			return n
		n = n.get_parent()
	return null


# ------------------------------------------------------------------------------------------ holding
## the weapon model at the right hand: guns aim along the camera while raised, else point forward /
## down; the bat is held up and swung down with the punch
func place_weapon() -> void:
	var w := Weapons.current
	if not models.has(w) or not (models[w] as Node3D).visible:
		return
	var h: Node3D = models[w]
	var hb := sk.find_bone("RightHand")
	if hb < 0:
		return
	var hand := sk.global_transform * sk.get_bone_global_pose(hb)
	var fwd := Vector3(-sin(player.facing), 0, -cos(player.facing))
	var right := fwd.cross(Vector3.UP).normalized()
	var dir: Vector3
	if w == "bat":
		# raised over the shoulder, swinging forward-down during the punch
		var ang := lerpf(deg_to_rad(70.0), deg_to_rad(-35.0), clampf((_swing - 0.1) / 0.45, 0.0, 1.0)) if _swing > 0.0 else deg_to_rad(55.0)
		dir = (fwd * cos(ang) + Vector3.UP * sin(ang)).normalized()
	elif aim_t > 0.0:
		dir = -player.get_camera().global_transform.basis.z
	else:
		dir = (fwd + Vector3.DOWN * 0.9).normalized()
	var up := right.cross(dir).normalized()
	if up.y < 0.0:
		up = -up
	var b := Basis(dir.cross(up).normalized(), up, -dir).orthonormalized()
	# the grip sits in the palm: a little forward of the hand bone
	h.global_transform = Transform3D(b, hand.origin + hand.basis.y.normalized() * 0.07)
