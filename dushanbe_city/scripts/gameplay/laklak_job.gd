class_name LakLakJob
extends Node
## LakLak delivery job.
##  1. At the LakLak depot (landmark "laklak", ave. Aini) the player walks to the office door:
##     «УСТРОИТЬСЯ В LAKLAK» hires him (saved).
##  2. Getting into the blue LakLak van starts an order: a parcel for a real address in the city (a
##     residential / office / shop building, the drop-off point at the kerb of the nearest street).
##     The destination is shown by a light beacon in the world, on the minimap and on the map.
##  3. Stopping the van at the drop-off (< 9 m, < 6 km/h) delivers it: pay = 30 smn + 22 smn per km
##     (straight-line distance) + 15 smn bonus when on time; the next order follows at once.
## Money and the job record are saved (Wallet).

signal delivered(pay: int)
signal order_started(dest: Vector3)

const DROP_RADIUS := 9.0
const DEPOT_JOB_POINT := Vector3(0.5, 0.0, 2.0)       ## depot-local: office door (west face of the building)
const DEPOT_VAN_SPOT := Vector3(-16.0, 0.0, -14.0)    ## depot-local: van parking, facing the avenue

var session: CarSession
var van: VehicleVan
var wd: WorldData
var depot: Dictionary = {}
var depot_xf := Transform3D.IDENTITY
var order := {}                      ## {"dest": Vector3, "from": Vector3, "km": float, "pay": int, "t": float, "limit": float, "addr": String}
var order_no := 0
var _rng := RandomNumberGenerator.new()
var _ui: CanvasLayer
var _money: Label
var _job: Label
var _toast: Label
var _toast_t := 0.0
var _beacon: Node3D
var _office: Node


func _ready() -> void:
	Wallet.load_state()
	wd = WorldData.get_instance()
	_rng.seed = 20261109
	for l in wd.landmarks:
		if l["id"] == "laklak":
			depot = l
	if not depot.is_empty():
		depot_xf = Transform3D(Basis(Vector3.UP, float(depot.get("yaw", 0.0))), Vector3(depot["x"], depot["y"], depot["z"]))
	_build_ui()
	_build_beacon()
	_office = LakLakOffice.new()
	_office.name = "LakLakOffice"
	_office.set("job", self)
	add_child(_office)


func depot_point(local: Vector3) -> Vector3:
	return depot_xf * local


func van_spawn() -> Transform3D:
	var p := depot_point(DEPOT_VAN_SPOT)
	var yaw := float(depot.get("yaw", 0.0)) + PI * 0.5
	return Transform3D(Basis(Vector3.UP, yaw), p)


func hire() -> void:
	if Wallet.laklak_hired:
		toast("Вы уже работаете в LakLak.\nСадитесь в синий фургон — заказ ждёт.")
		return
	Wallet.laklak_hired = true
	Wallet.save_state()
	toast("Вы приняты в LakLak!\nСадитесь в синий фургон у склада.")


# ------------------------------------------------------------------------------------------ orders
func _process(delta: float) -> void:
	_toast_t -= delta
	_toast.visible = _toast_t > 0.0
	_money.text = "Деньги: " + Wallet.fmt(Wallet.money)
	var in_van := session != null and session.driving and session.car == van and van != null
	if Wallet.laklak_hired and in_van and order.is_empty():
		new_order()
	if not order.is_empty():
		order["t"] = float(order["t"]) + delta
		var dest: Vector3 = order["dest"]
		var at := van.global_position if van else Vector3.INF
		var d := Vector2(at.x - dest.x, at.z - dest.z).length()
		_job.text = "LakLak · заказ №%d: %s · %.1f км · %s" % [order_no, order["addr"], d / 1000.0, Wallet.fmt(int(order["pay"]))]
		if in_van and d < DROP_RADIUS and van.speed_kmh < 6.0:
			complete()
		# the marker / route only while driving the van: out of it the order waits, no marker
		_beacon.visible = in_van
		_beacon.global_position = dest
		if in_van:
			Minimap.target = dest
			Minimap.target_owner = self
		elif Minimap.target_owner == self:
			Minimap.target = Vector3.INF
			Minimap.target_owner = null
	else:
		_beacon.visible = false
		if Minimap.target_owner == self:
			Minimap.target = Vector3.INF
			Minimap.target_owner = null
		if Wallet.laklak_hired:
			_job.text = "LakLak · садитесь в синий фургон" if not in_van else "LakLak · новый заказ…"
		else:
			_job.text = "Работа: склад LakLak (пр. Айни) — устройтесь курьером" if not depot.is_empty() and not (session and session.driving) else ""
	_job.visible = _job.text != ""


## pick a destination: a building of the city 0.5 .. 2.6 km away, drop-off at the kerb of its street
func new_order() -> void:
	var from := van.global_position if van else depot_point(DEPOT_VAN_SPOT)
	var dest := Vector3.INF
	var addr := ""
	for attempt in 400:
		var b: Array = wd.buildings[_rng.randi() % wd.buildings.size()]
		var kind := String(b[0])
		if not kind in ["panel5", "panel9", "brick5", "house", "shop", "office", "hotel", "tower", "sky", "admin"] and not kind.begins_with("villa"):
			continue
		var bp := Vector3(b[1], b[8], b[2])
		if absf(bp.x) > 2100.0 or bp.z > -900.0 or bp.z < -4900.0:
			continue
		var dist := Vector2(bp.x - from.x, bp.z - from.z).length()
		if dist < 500.0 or dist > 2600.0:
			continue
		var kerb := _kerb_near(bp)
		if kerb == Vector3.INF:
			continue
		dest = kerb
		addr = _address(kerb, kind)
		break
	if dest == Vector3.INF:
		return
	order_no += 1
	var km := Vector2(dest.x - from.x, dest.z - from.z).length() / 1000.0
	order = {"dest": dest, "from": from, "km": km, "pay": 30 + int(round(km * 22.0)), "t": 0.0, "limit": 90.0 + km * 150.0, "addr": addr}
	toast("Заказ №%d: %s\n%.1f км · оплата %s" % [order_no, addr, km, Wallet.fmt(int(order["pay"]))])
	order_started.emit(dest)


func complete() -> void:
	var pay := int(order["pay"])
	var bonus := 15 if float(order["t"]) < float(order["limit"]) else 0
	Wallet.deliveries += 1
	Wallet.earn(pay + bonus)
	toast("Доставлено! +%s%s\nВсего доставок: %d" % [Wallet.fmt(pay + bonus), " (бонус за скорость)" if bonus > 0 else "", Wallet.deliveries])
	delivered.emit(pay + bonus)
	order = {}


## the kerbside point of the street nearest to a building (on the carriageway edge, + 1.5 m in)
func _kerb_near(p: Vector3) -> Vector3:
	var best := INF
	var out := Vector3.INF
	for r in wd.roads:
		if not String(r["cls"]) in ["avenue", "highway", "street"]:
			continue
		var pts: Array = r["pts"]
		var hw := float(r["w"]) * 0.5
		for k in range(0, pts.size(), 3):
			var q := Vector3(pts[k][0], pts[k][1], pts[k][2])
			var d := Vector2(q.x - p.x, q.z - p.z).length()
			if d < best:
				best = d
				var to := Vector3(p.x - q.x, 0, p.z - q.z).normalized()
				out = q + to * maxf(hw - 2.0, 1.0)
	return out if best < 120.0 else Vector3.INF


func _address(p: Vector3, kind: String) -> String:
	var best := INF
	var rname := ""
	for r in wd.roads:
		if String(r["name"]) == "" or not String(r["cls"]) in ["avenue", "highway", "street"]:
			continue
		var pts: Array = r["pts"]
		for k in range(0, pts.size(), 4):
			var d := Vector2(float(pts[k][0]) - p.x, float(pts[k][2]) - p.z).length()
			if d < best:
				best = d
				rname = String(r["name"])
	var house := 1 + int(absf(p.x * 0.37 + p.z * 0.11)) % 140
	var what: String = "дом" if not kind in ["shop", "office", "hotel", "admin"] else {"shop": "магазин", "office": "офис", "hotel": "гостиница", "admin": "учреждение"}[kind]
	return "%s, %s %d" % [rname if rname != "" and best < 260.0 else "Душанбе", what, house]


# ------------------------------------------------------------------------------------------ UI
func toast(t: String) -> void:
	_toast.text = t
	_toast_t = 4.0


func _build_ui() -> void:
	_ui = CanvasLayer.new()
	_ui.layer = 16
	add_child(_ui)
	var font: Font = load("res://assets/fonts/game_font.tres")
	# money + job line: top-left under the round minimap (clear of the car's top buttons and the
	# map / menu buttons on the right); positions follow the screen size (_layout)
	_money = Label.new()
	_money.add_theme_font_override("font", font)
	_money.add_theme_font_size_override("font_size", 24)
	_money.add_theme_color_override("font_color", Color(0.55, 1.0, 0.6))
	_money.add_theme_color_override("font_outline_color", Color.BLACK)
	_money.add_theme_constant_override("outline_size", 7)
	_ui.add_child(_money)
	_job = Label.new()
	_job.add_theme_font_override("font", font)
	_job.add_theme_font_size_override("font_size", 17)
	_job.add_theme_color_override("font_color", Color(0.6, 0.82, 1.0))
	_job.add_theme_color_override("font_outline_color", Color.BLACK)
	_job.add_theme_constant_override("outline_size", 6)
	_job.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_ui.add_child(_job)
	get_viewport().size_changed.connect(_layout)
	_layout()
	_toast = Label.new()
	_toast.add_theme_font_override("font", font)
	_toast.add_theme_font_size_override("font_size", 32)
	_toast.add_theme_color_override("font_color", Color(1.0, 0.95, 0.75))
	_toast.add_theme_color_override("font_outline_color", Color(0.02, 0.1, 0.3))
	_toast.add_theme_constant_override("outline_size", 10)
	_toast.set_anchors_preset(Control.PRESET_CENTER)
	_toast.offset_left = -500
	_toast.offset_right = 500
	_toast.offset_top = -170
	_toast.offset_bottom = -60
	_toast.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_toast.visible = false
	_ui.add_child(_toast)


func _layout() -> void:
	var vs := get_viewport().get_visible_rect().size
	var d := clampf(minf(vs.x, vs.y) * 0.22, 150.0, 320.0)      # the minimap's size (Minimap._layout)
	# money: drawn by TopHud (top-right, green); the job line at the top, right of the minimap
	_money.visible = false
	_job.position = Vector2(16 + d + 24, minf(vs.x, vs.y) * 0.175)
	_job.size = Vector2(minf(vs.x * 0.45, 620.0), 60)


func _build_beacon() -> void:
	_beacon = Node3D.new()
	_beacon.name = "LakLakBeacon"
	add_child(_beacon)
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	m.albedo_color = Color(1.0, 0.62, 0.15, 0.35)
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	var col := MeshInstance3D.new()
	var cm := CylinderMesh.new()
	cm.top_radius = 1.6
	cm.bottom_radius = 2.4
	cm.height = 70.0
	cm.cap_top = false
	cm.cap_bottom = false
	col.mesh = cm
	col.material_override = m
	col.position.y = 35.0
	col.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_beacon.add_child(col)
	var ring := MeshInstance3D.new()
	var tm := TorusMesh.new()
	tm.inner_radius = DROP_RADIUS - 0.6
	tm.outer_radius = DROP_RADIUS
	ring.mesh = tm
	var rm := m.duplicate() as StandardMaterial3D
	rm.albedo_color = Color(1.0, 0.7, 0.2, 0.8)
	ring.material_override = rm
	ring.position.y = 0.2
	ring.scale = Vector3(1, 0.15, 1)
	_beacon.add_child(ring)
	_beacon.visible = false
