class_name Realty
extends Node3D
## 0.25: real estate. Houses, apartments and garages for sale in the city: a «ПРОДАЁТСЯ» board with
## the price stands at the street side of the building (walk up, ACTION → buy). Bought property is
## saved (Wallet.homes) and gives:
##   house / apartment: «ОТДОХНУТЬ» - full health, the game is saved, night → morning
##   garage: «ГАРАЖ» - your last car is brought here repaired, washed and with a full tank
## The places are picked from the city's own buildings (deterministic: the same in every game).

const KINDS := {
	"house": {"title": "Дом", "count": 4, "price": [150000, 350000]},
	"apartment": {"title": "Квартира", "count": 4, "price": [60000, 95000]},
	"garage": {"title": "Гараж", "count": 4, "price": [12000, 20000]},
}
const MIN_GAP := 350.0

var wd: WorldData
var session: CarSession
var laklak: LakLakJob
var props: Array = []            ## {id, kind, title, price, pos: Vector3, yaw, addr, node: Node3D, label: Label3D}


func _ready() -> void:
	wd = WorldData.get_instance()
	if wd == null or wd.buildings.is_empty():
		return
	_pick()
	for P in props:
		_build_sign(P)


func owned(id: String) -> bool:
	return Wallet.homes.has(id)


func _pick() -> void:
	var rng := RandomNumberGenerator.new()
	rng.seed = 2025
	var idx := range(wd.buildings.size())
	# deterministic shuffle
	for i in range(idx.size() - 1, 0, -1):
		var j := rng.randi_range(0, i)
		var t: int = idx[i]
		idx[i] = idx[j]
		idx[j] = t
	var counts := {"house": 0, "apartment": 0, "garage": 0}
	var used: Array[Vector3] = []
	for i: int in idx:
		var b: Array = wd.buildings[i]
		var kind := String(b[0])
		var k := ""
		if kind == "house" or kind.begins_with("villa"):
			k = "house"
		elif kind in ["panel5", "panel9", "brick5"]:
			k = "apartment" if counts["apartment"] < KINDS["apartment"]["count"] else "garage"
		if k == "" or counts[k] >= int(KINDS[k]["count"]):
			continue
		var c := Vector3(float(b[1]), float(b[8]), float(b[2]))
		if absf(c.x) > 2100.0 or c.z > -900.0 or c.z < -4900.0:
			continue
		if wd.in_plaza(c.x, c.z):
			continue
		var far := true
		for u in used:
			if Vector2(u.x - c.x, u.z - c.z).length() < MIN_GAP:
				far = false
				break
		if not far or laklak == null:
			continue
		var kerb := laklak._kerb_near(c)
		if kerb == Vector3.INF:
			continue
		var pos := _front_point(b, kerb)
		if pos == Vector3.INF:
			continue
		used.append(c)
		counts[k] += 1
		var pr: Array = KINDS[k]["price"]
		var price := int(round(rng.randf_range(float(pr[0]), float(pr[1])) / 1000.0)) * 1000
		var id := "%s_%d" % [k, i]
		var to_kerb := Vector3(kerb.x - pos.x, 0, kerb.z - pos.z)
		props.append({"id": id, "kind": k, "title": String(KINDS[k]["title"]), "price": price, "pos": pos,
				"yaw": atan2(to_kerb.x, to_kerb.z), "addr": laklak._address(pos, "house"), "kerb": kerb})


## a point 1.6 m outside the building's wall on the side towards its street
func _front_point(b: Array, kerb: Vector3) -> Vector3:
	var cx := float(b[1])
	var cz := float(b[2])
	var yaw := float(b[3])
	var hl := float(b[4]) * 0.5
	var hd := float(b[5]) * 0.5
	var rt := Vector2(cos(yaw), -sin(yaw))
	var f := Vector2(-sin(yaw), -cos(yaw))
	var dir := Vector2(kerb.x - cx, kerb.z - cz)
	var dist := dir.length()
	if dist < 1.0:
		return Vector3.INF
	dir /= dist
	var lx := dir.dot(rt)
	var lz := dir.dot(f)
	# ray from the centre to the wall of the L x D box
	var t := minf(hl / maxf(absf(lx), 0.001), hd / maxf(absf(lz), 0.001))
	if t + 1.6 > dist - 2.0:
		return Vector3.INF               # no room between the wall and the street
	var p := Vector2(cx, cz) + dir * (t + 1.6)
	var y := wd.height_at(p.x, p.y)
	return Vector3(p.x, y, p.y)


func _build_sign(P: Dictionary) -> void:
	var n := Node3D.new()
	n.name = "Realty_" + String(P["id"])
	add_child(n)
	n.global_position = P["pos"]
	n.rotation.y = float(P["yaw"])
	var post_m := StandardMaterial3D.new()
	post_m.albedo_color = Color(0.25, 0.26, 0.28)
	post_m.metallic = 0.6
	post_m.roughness = 0.4
	for sx in [-1.15, 1.15]:
		var post := MeshInstance3D.new()
		var cm := CylinderMesh.new()
		cm.top_radius = 0.04
		cm.bottom_radius = 0.04
		cm.height = 2.5
		post.mesh = cm
		post.material_override = post_m
		post.position = Vector3(sx, 1.1, -0.06)
		post.visibility_range_end = 220.0
		n.add_child(post)
	var board := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = Vector3(2.4, 1.25, 0.05)
	board.mesh = bm
	var bmat := StandardMaterial3D.new()
	bmat.albedo_color = Color(0.92, 0.6, 0.08)
	bmat.roughness = 0.5
	board.material_override = bmat
	board.position = Vector3(0, 1.95, 0)
	board.visibility_range_end = 220.0
	n.add_child(board)
	P["board_mat"] = bmat
	var font: Font = load("res://assets/fonts/game_font.tres")
	var lbl := Label3D.new()
	lbl.font = font
	lbl.font_size = 48
	lbl.pixel_size = 0.0042
	lbl.outline_size = 0
	lbl.modulate = Color(0.08, 0.08, 0.1)
	lbl.position = Vector3(0, 1.95, 0.03)
	lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	lbl.visibility_range_end = 120.0
	n.add_child(lbl)
	var back := lbl.duplicate() as Label3D
	back.position.z = -0.03
	back.rotation.y = PI
	n.add_child(back)
	P["node"] = n
	P["labels"] = [lbl, back]
	var it := RealtySpot.new()
	it.realty = self
	it.prop = P
	n.add_child(it)
	_refresh(P)


func _refresh(P: Dictionary) -> void:
	var mine := owned(String(P["id"]))
	var t := ("%s\nВАШ" % String(P["title"]).to_upper()) if mine else ("ПРОДАЁТСЯ\n%s\n%s" % [String(P["title"]).to_upper(), Wallet.fmt(int(P["price"]))])
	for l: Label3D in P["labels"]:
		l.text = t
	(P["board_mat"] as StandardMaterial3D).albedo_color = Color(0.2, 0.7, 0.35) if mine else Color(0.92, 0.6, 0.08)


func label_for(P: Dictionary) -> String:
	if not owned(String(P["id"])):
		return "КУПИТЬ %s · %s" % [String(P["title"]).to_upper(), Wallet.fmt(int(P["price"]))]
	return "ГАРАЖ: ПОДАТЬ МАШИНУ" if P["kind"] == "garage" else "ОТДОХНУТЬ"


## buy (returns "" or the reason it failed) / use the property
func use(P: Dictionary) -> String:
	var id := String(P["id"])
	if not owned(id):
		var price := int(P["price"])
		if Wallet.money < price:
			_say("Не хватает денег: %s — %s" % [String(P["title"]), Wallet.fmt(price)])
			return "money"
		Wallet.money -= price
		Wallet.homes.append(id)
		Wallet.save_state()
		_refresh(P)
		_say("Куплено: %s, %s!\n%s" % [String(P["title"]), String(P["addr"]),
				"Здесь можно забрать свою машину — отремонтированной и заправленной" if P["kind"] == "garage" else "Здесь можно отдохнуть и сохраниться"])
		return ""
	if P["kind"] == "garage":
		var car: VehiclePrado = session.car if session else null
		if car == null or (session.driving and session.car == car):
			_say("Нет машины, которую можно подать")
			return "nocar"
		var p: Vector3 = P["pos"]
		var yaw := float(P["yaw"])
		var side := Vector3(cos(yaw), 0, -sin(yaw))
		# parked at the kerb in front of the garage, along the street (the buildings stand right at
		# the sidewalk now: there is no room for a car between the wall and the street)
		var fwd := Vector3(sin(yaw), 0, cos(yaw))
		var kp: Vector3 = P.get("kerb", p + fwd * 4.0)
		if Vector2(kp.x - p.x, kp.z - p.z).length() > 14.0:
			kp = p + fwd * 4.0 + side * 2.5             # the street is far: on the yard in front of the garage
		var wd2 := WorldData.get_instance()
		if wd2 and wd2.ok:
			kp.y = wd2.height_at(kp.x, kp.z)
		car.place(kp + Vector3(0, 0.8, 0), yaw + PI * 0.5)
		car.repair()
		car.set_dirt(0.0)
		car.refuel(999.0)
		_say("Ваша машина у гаража: отремонтирована, помыта, полный бак")
		return ""
	PlayerLife.health = 100.0
	for n in get_tree().get_nodes_in_group(&"time_of_day"):
		var h := float(n.get("hour")) if "hour" in n else 12.0
		if h > 20.0 or h < 6.0:
			n.call("set_hour", 8.0)
	Wallet.save_state()
	_say("Вы отдохнули: здоровье 100%, игра сохранена")
	return ""


func _say(t: String) -> void:
	if laklak:
		laklak.toast(t)
