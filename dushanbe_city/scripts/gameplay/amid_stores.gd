class_name AmidStores
extends Node
## AMID supermarkets the player walks into and shops in (0.23):
##   entrance: a stand of red baskets «ВЗЯТЬ КОРЗИНУ»; 13 aisles of real 3D goods (bottles, cans,
##   cartons, boxes, sacks, bread) on shelving units with boards, price strips and end-cap displays,
##   each aisle's end «ВЗЯТЬ · <товар>»; fridges with glass doors along the back wall (meat, milk,
##   water, cola); fruit and vegetable crates; four tills «КАССА · ОПЛАТИТЬ». Paid goods go into a
##   carrier bag in the hand (Food), which goes into a car's boot and home. Leaving with an unpaid
##   basket leaves it in the shop.
## Every "amid_m" building of the world gets its interior while the player is near (the building's
## sector collision is hollow). Interior frame: hall centre, entrance at local +Z, hall 84 x 50 m.

const BUILD_DIST := 230.0
const HX := 41.4
const HZ := 24.4
const CEIL := 4.2                     ## under the model's inner plane at 4.5 m
const DOOR := 4.5
const HALL_Z := -14.25                ## the model is re-centred on hall + car park: hall centre behind
const SHELF_ITEMS := ["non", "sambusa", "rice", "oil", "eggs", "tea", "choco", "juice", "cola", "water", "milk", "medkit", "rice"]
const FRIDGE_ITEMS := ["meat", "milk", "water", "cola"]
const STAND_ITEMS := ["apple", "tomato", "cucumber", "carrot", "onion", "potato"]
const CATEGORY := ["ХЛЕБ", "ВЫПЕЧКА", "КРУПЫ", "МАСЛО", "ЯЙЦА", "ЧАЙ", "КОНФЕТЫ", "СОКИ", "НАПИТКИ", "ВОДА", "МОЛОКО", "АПТЕКА", "ПРОДУКТЫ"]
const FRIDGE_TITLES := ["МЯСО", "ХОЛОДИЛЬНИК · МОЛОКО", "ВОДА", "НАПИТКИ"]
const ICONS := {"non": "amid_bread", "sambusa": "amid_bread", "rice": "amid_rice", "oil": "amid_oil", "eggs": "amid_egg",
	"tea": "amid_tea", "choco": "amid_candy", "juice": "amid_drink", "cola": "amid_can", "water": "amid_water",
	"milk": "amid_milk", "medkit": "amid_cross", "meat": "amid_cow"}
const VIVID := [Color(0.95, 0.75, 0.1), Color(0.9, 0.15, 0.12), Color(0.15, 0.4, 0.9), Color(0.1, 0.65, 0.25),
	Color(1.0, 0.5, 0.05), Color(0.55, 0.2, 0.7), Color(0.95, 0.95, 0.95), Color(0.1, 0.7, 0.8), Color(0.95, 0.35, 0.6)]

var session: CarSession
var stores: Array = []                ## [{xf: Transform3D, node: Node3D}]
var _t := 0.0
var _ui: CanvasLayer
var _eat_btn: Button
var _info: Label
var _toast: Label
var _toast_t := 0.0
var _held: Node3D                     ## basket / bag mesh in the hero's hand
var _held_kind := ""
static var _mats := {}
static var _meshes := {}


func _ready() -> void:
	add_to_group(&"amid_stores")
	var wd := WorldData.get_instance()
	if wd and wd.ok:
		for b in wd.buildings:
			if String(b[0]) == "amid_m":
				var xf := Transform3D(Basis(Vector3.UP, float(b[3]) + PI), Vector3(float(b[1]), float(b[8]) - 0.3, float(b[2])))
				stores.append({"xf": xf * Transform3D(Basis.IDENTITY, Vector3(0, 0, HALL_Z)), "node": null})
	_build_ui()


func door_point(st: Dictionary) -> Vector3:
	return (st["xf"] as Transform3D) * Vector3(0, 0.3, HZ + 2.0)


func till_point(st: Dictionary, k := 0) -> Vector3:
	return (st["xf"] as Transform3D) * Vector3([-14.0, -7.0, 7.0, 14.0][k] + 1.6, 0.3, 15.0)


func basket_point(st: Dictionary) -> Vector3:
	return (st["xf"] as Transform3D) * Vector3(7.5, 0.3, HZ - 2.6)


func shelf_point(st: Dictionary, i: int) -> Vector3:
	return (st["xf"] as Transform3D) * Vector3(-36.0 + i * 6.0, 0.3, 7.3)


func _process(delta: float) -> void:
	_t -= delta
	_toast_t -= delta
	_toast.visible = _toast_t > 0.0
	var player: Node3D = session.player if session else null
	var focus := Vector3.ZERO
	if player:
		focus = session.car.global_position if session.driving and session.car else player.global_position
	if _t <= 0.0:
		_t = 0.8
		for st in stores:
			var d := (st["xf"] as Transform3D).origin.distance_to(focus)
			if d < BUILD_DIST and st["node"] == null:
				st["node"] = _interior(st)
			elif d > BUILD_DIST + 60.0 and st["node"] != null:
				(st["node"] as Node).queue_free()
				st["node"] = null
		# an unpaid basket stays in the shop
		if Food.hand == "basket" and player:
			var inside := false
			for st in stores:
				var lp := (st["xf"] as Transform3D).affine_inverse() * player.global_position
				if absf(lp.x) < HX + 3.0 and absf(lp.z) < HZ + 4.0:
					inside = true
			if not inside:
				Food.drop_basket()
				say("Корзина оставлена в магазине (не оплачена)")
	_update_held()
	# HUD: eat / drink from the bag; the basket / bag contents line
	var can_eat := Food.hand == "bag" and Food.best_in(Food.bag) != "" and not PlayerLife.dead
	_eat_btn.visible = can_eat
	if can_eat:
		_eat_btn.text = "ПОЕСТЬ / ПОПИТЬ"
		var vs := get_viewport().get_visible_rect().size
		_eat_btn.position = Vector2(vs.x - _eat_btn.size.x - 24.0, vs.y * 0.34)
	var line := ""
	if Food.hand == "basket":
		line = "Корзина: %s  ·  %s" % [Food.listing(Food.basket) if not Food.basket.is_empty() else "пусто", Wallet.fmt(Food.price_of(Food.basket))]
	elif Food.hand == "bag":
		line = "Пакет: %s" % Food.listing(Food.bag)
	_info.text = line
	_info.visible = line != ""


func say(t: String, secs := 2.6) -> void:
	_toast.text = t
	_toast_t = secs


# ------------------------------------------------------------------------------------------ the hand
func _update_held() -> void:
	var player: Node3D = session.player if session else null
	var want := Food.hand if player and not (session and session.driving) else ""
	if want != _held_kind:
		if _held:
			_held.queue_free()
			_held = null
		_held_kind = want
		if want != "":
			_held = basket_mesh() if want == "basket" else bag_mesh()
			_held.top_level = true
			add_child(_held)
	if _held == null or player == null:
		return
	var sk: Skeleton3D = null
	for c in player.find_children("*", "Skeleton3D", true, false):
		sk = c
		break
	var p := player.global_position + player.global_basis * Vector3(-0.32, 0.75, -0.05)
	if sk:
		var bi := sk.find_bone("hand.L")
		if bi >= 0:
			p = (sk.global_transform * sk.get_bone_global_pose(bi)).origin + Vector3(0, -0.2 if _held_kind == "bag" else -0.12, 0)
	var yaw: float = player.global_rotation.y
	if player.get("facing") != null:
		yaw = float(player.get("facing"))
	_held.global_transform = Transform3D(Basis(Vector3.UP, yaw), p)


## a red plastic shop basket (open top, two handles), hanging from its handles
static func basket_mesh() -> Node3D:
	var n := Node3D.new()
	var red := _m("basket")
	for spec in [[Vector3(0.42, 0.02, 0.28), Vector3(0, -0.24, 0)], [Vector3(0.42, 0.2, 0.02), Vector3(0, -0.14, 0.13)],
			[Vector3(0.42, 0.2, 0.02), Vector3(0, -0.14, -0.13)], [Vector3(0.02, 0.2, 0.28), Vector3(0.2, -0.14, 0)],
			[Vector3(0.02, 0.2, 0.28), Vector3(-0.2, -0.14, 0)], [Vector3(0.44, 0.03, 0.3), Vector3(0, -0.04, 0)]]:
		var mi := MeshInstance3D.new()
		var bm := BoxMesh.new()
		bm.size = spec[0]
		mi.mesh = bm
		mi.material_override = red
		mi.position = spec[1]
		n.add_child(mi)
	for sz: float in [-0.1, 0.1]:
		var h := MeshInstance3D.new()
		var tm := TorusMesh.new()
		tm.inner_radius = 0.09
		tm.outer_radius = 0.11
		h.mesh = tm
		h.material_override = _m("steel")
		h.rotation = Vector3(PI * 0.5, 0, 0)
		h.position = Vector3(0, 0.0, sz)
		n.add_child(h)
	return n


## a white carrier bag with the green AMID band and two handles, full of groceries
static func bag_mesh() -> Node3D:
	var n := Node3D.new()
	var body := MeshInstance3D.new()
	var sm := SphereMesh.new()
	sm.radius = 0.2
	sm.height = 0.5
	body.mesh = sm
	body.scale = Vector3(1.0, 1.0, 0.6)
	body.material_override = _m("bagwhite")
	body.position = Vector3(0, -0.3, 0)
	n.add_child(body)
	var band := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = Vector3(0.36, 0.08, 0.25)
	band.mesh = bm
	band.material_override = _m("green")
	band.position = Vector3(0, -0.28, 0)
	n.add_child(band)
	for sx: float in [-0.07, 0.07]:
		var h := MeshInstance3D.new()
		var tm := TorusMesh.new()
		tm.inner_radius = 0.06
		tm.outer_radius = 0.075
		h.mesh = tm
		h.material_override = _m("bagwhite")
		h.rotation = Vector3(0, 0, PI * 0.5)
		h.position = Vector3(sx, -0.04, 0)
		n.add_child(h)
	var bt := MeshInstance3D.new()
	var cm := CylinderMesh.new()
	cm.top_radius = 0.02
	cm.bottom_radius = 0.035
	cm.height = 0.26
	bt.mesh = cm
	bt.material_override = _m("bottle_b")
	bt.position = Vector3(0.07, -0.12, 0.02)
	n.add_child(bt)
	return n


# ------------------------------------------------------------------------------------------ interactions
class Spot:
	extends Node
	var point: Vector3
	var label_fn: Callable
	var can_fn: Callable
	var act_fn: Callable

	func _ready() -> void:
		add_to_group(&"interactable")

	func interaction_label(_p: Node) -> String:
		return label_fn.call()

	func interaction_point(_p: Node) -> Vector3:
		return point

	func can_interact(_p: Node) -> bool:
		return can_fn.call()

	func interact(_p: Node) -> void:
		act_fn.call()


func _spot(root: Node, p: Vector3, label: Callable, can: Callable, act: Callable) -> void:
	var s := Spot.new()
	s.point = p
	s.label_fn = label
	s.can_fn = can
	s.act_fn = act
	root.add_child(s)


func _on_foot() -> bool:
	return session != null and not session.driving


func _pick(id: String) -> void:
	Food.pick(id)
	say("В корзине: %s" % Food.listing(Food.basket))


# ------------------------------------------------------------------------------------------ materials
static func _m(key: String) -> StandardMaterial3D:
	if _mats.has(key):
		return _mats[key]
	var m := StandardMaterial3D.new()
	match key:
		"floor":
			m.albedo_texture = _tile_texture()
			m.uv1_triplanar = true
			m.uv1_world_triplanar = true
			m.uv1_scale = Vector3(0.5, 0.5, 0.5)
			m.roughness = 0.07
			m.metallic_specular = 0.95
		"ceiltile":
			m.albedo_texture = _ceil_texture()
			m.uv1_triplanar = true
			m.uv1_world_triplanar = true
			m.uv1_scale = Vector3(0.42, 0.42, 0.42)
			m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		"marble":
			m.albedo_texture = _marble_texture()
			m.uv1_triplanar = true
			m.uv1_scale = Vector3(0.6, 0.6, 0.6)
			m.roughness = 0.12
			m.metallic_specular = 0.9
		"led":
			m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
			m.albedo_color = Color(1.0, 0.98, 0.94)
		"redsign":
			m.albedo_color = Color(0.78, 0.05, 0.06)
			m.emission_enabled = true
			m.emission = Color(0.7, 0.03, 0.04)
			m.emission_energy_multiplier = 0.55
		"pot":
			m.albedo_color = Color(0.82, 0.82, 0.8)
			m.roughness = 0.7
		"leaf":
			m.albedo_color = Color(0.13, 0.45, 0.12)
			m.roughness = 0.6
			m.cull_mode = BaseMaterial3D.CULL_DISABLED
		"meatcase":
			m.albedo_color = Color(0.93, 0.93, 0.95)
			m.emission_enabled = true
			m.emission = Color(1.0, 0.75, 0.75)
			m.emission_energy_multiplier = 0.25
		"wall":
			m.albedo_color = Color(0.9, 0.9, 0.89)
			m.roughness = 0.8
		"wallgreen":
			m.albedo_color = Color(0.12, 0.55, 0.25)
			m.roughness = 0.6
		"ceil":
			m.albedo_color = Color(0.8, 0.8, 0.78)
			m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		"lamp":
			m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
			m.albedo_color = Color(1, 1, 0.97)
		"shelf":
			m.albedo_color = Color(0.2, 0.21, 0.23)
			m.metallic = 0.55
			m.roughness = 0.35
		"shelfdark":
			m.albedo_color = Color(0.09, 0.09, 0.1)
			m.metallic = 0.4
			m.roughness = 0.5
		"price":
			m.albedo_color = Color(1.0, 0.92, 0.25)
			m.roughness = 0.6
		"pricewhite":
			m.albedo_color = Color(0.98, 0.98, 0.98)
		"green":
			m.albedo_color = Color(0.1, 0.75, 0.25)
			m.emission_enabled = true
			m.emission = Color(0.05, 0.6, 0.2)
			m.emission_energy_multiplier = 0.6
		"glass":
			m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
			m.albedo_color = Color(0.8, 0.92, 1.0, 0.12)
			m.roughness = 0.04
			m.metallic_specular = 0.9
		"fridgein":
			m.albedo_color = Color(0.92, 0.95, 1.0)
			m.emission_enabled = true
			m.emission = Color(0.82, 0.92, 1.0)
			m.emission_energy_multiplier = 1.5
		"frame":
			m.albedo_color = Color(0.3, 0.32, 0.36)
			m.metallic = 0.7
			m.roughness = 0.3
		"counter":
			m.albedo_color = Color(0.07, 0.07, 0.08)
			m.roughness = 0.35
		"countertop":
			m.albedo_color = Color(0.96, 0.96, 0.95)
			m.roughness = 0.25
		"belt":
			m.albedo_color = Color(0.05, 0.05, 0.06)
			m.roughness = 0.6
		"screen":
			m.albedo_color = Color(0.08, 0.25, 0.45)
			m.emission_enabled = true
			m.emission = Color(0.2, 0.6, 1.0)
		"wood":
			m.albedo_color = Color(0.58, 0.4, 0.24)
			m.roughness = 0.75
		"basket":
			m.albedo_color = Color(0.85, 0.08, 0.08)
			m.roughness = 0.45
		"steel":
			m.albedo_color = Color(0.75, 0.76, 0.78)
			m.metallic = 0.8
			m.roughness = 0.3
		"bagwhite":
			m.albedo_color = Color(0.97, 0.97, 0.97)
			m.roughness = 0.5
		"bottle_b":
			m.albedo_color = Color(0.5, 0.78, 1.0, 0.7)
			m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
			m.roughness = 0.08
		"goods":
			m.vertex_color_use_as_albedo = true
			m.roughness = 0.42
		"goodsglass":
			m.vertex_color_use_as_albedo = true
			m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
			m.roughness = 0.06
	_mats[key] = m
	return m


## 60 cm terrazzo floor tiles with grout (generated, no external asset)
static func _tile_texture() -> Texture2D:
	var S := 128
	var img := Image.create(S, S, false, Image.FORMAT_RGB8)
	var n := FastNoiseLite.new()
	n.frequency = 0.35
	for y in S:
		for x in S:
			var g := x % 64 < 1 or y % 64 < 1
			var v := 0.93 + n.get_noise_2d(x, y) * 0.035
			img.set_pixel(x, y, Color(0.74, 0.74, 0.73) if g else Color(v, v, v * 0.985))
	img.generate_mipmaps()
	return ImageTexture.create_from_image(img)


## suspended ceiling: 60 cm white tiles in a thin grey grid
static func _ceil_texture() -> Texture2D:
	var S := 64
	var img := Image.create(S, S, false, Image.FORMAT_RGB8)
	for y in S:
		for x in S:
			var g := x % 64 < 2 or y % 64 < 2
			img.set_pixel(x, y, Color(0.72, 0.72, 0.71) if g else Color(0.93, 0.93, 0.92))
	img.generate_mipmaps()
	return ImageTexture.create_from_image(img)


## polished black marble with pale veins
static func _marble_texture() -> Texture2D:
	var S := 128
	var img := Image.create(S, S, false, Image.FORMAT_RGB8)
	var n := FastNoiseLite.new()
	n.noise_type = FastNoiseLite.TYPE_SIMPLEX
	n.frequency = 0.02
	n.fractal_octaves = 4
	for y in S:
		for x in S:
			var v := absf(sin((x + y * 0.4) * 0.05 + n.get_noise_2d(x, y) * 6.0))
			var vein := pow(1.0 - v, 14.0) * 0.55
			var b := 0.07 + vein
			img.set_pixel(x, y, Color(b, b, b * 1.04))
	img.generate_mipmaps()
	return ImageTexture.create_from_image(img)


## product meshes by pack shape (shared): [Mesh, offset, glassy]
static func _shape_meshes(shape: String) -> Array:
	if _meshes.has(shape):
		return _meshes[shape]
	var out: Array = []
	match shape:
		"bottle":
			var c := CylinderMesh.new()
			c.top_radius = 0.042
			c.bottom_radius = 0.045
			c.height = 0.2
			c.radial_segments = 10
			out.append([c, Transform3D(Basis.IDENTITY, Vector3(0, 0.1, 0)), true])
			var nk := CylinderMesh.new()
			nk.top_radius = 0.014
			nk.bottom_radius = 0.04
			nk.height = 0.09
			nk.radial_segments = 8
			out.append([nk, Transform3D(Basis.IDENTITY, Vector3(0, 0.245, 0)), true])
			var lab := CylinderMesh.new()
			lab.top_radius = 0.047
			lab.bottom_radius = 0.047
			lab.height = 0.07
			lab.radial_segments = 10
			out.append([lab, Transform3D(Basis.IDENTITY, Vector3(0, 0.1, 0)), false, "dark"])
			var cap := CylinderMesh.new()
			cap.top_radius = 0.016
			cap.bottom_radius = 0.016
			cap.height = 0.02
			cap.radial_segments = 8
			out.append([cap, Transform3D(Basis.IDENTITY, Vector3(0, 0.298, 0)), false, "dark"])
		"can":
			var c2 := CylinderMesh.new()
			c2.top_radius = 0.033
			c2.bottom_radius = 0.033
			c2.height = 0.12
			c2.radial_segments = 10
			out.append([c2, Transform3D(Basis.IDENTITY, Vector3(0, 0.06, 0)), false])
			var rim := CylinderMesh.new()
			rim.top_radius = 0.03
			rim.bottom_radius = 0.034
			rim.height = 0.012
			rim.radial_segments = 10
			out.append([rim, Transform3D(Basis.IDENTITY, Vector3(0, 0.125, 0)), false, "silver"])
		"carton":
			var b := BoxMesh.new()
			b.size = Vector3(0.075, 0.2, 0.075)
			out.append([b, Transform3D(Basis.IDENTITY, Vector3(0, 0.1, 0)), false])
			var cb := BoxMesh.new()
			cb.size = Vector3(0.078, 0.09, 0.078)
			out.append([cb, Transform3D(Basis.IDENTITY, Vector3(0, 0.14, 0)), false, "white"])
			var top := PrismMesh.new()
			top.size = Vector3(0.075, 0.04, 0.075)
			out.append([top, Transform3D(Basis.IDENTITY, Vector3(0, 0.22, 0)), false])
		"box":
			var b2 := BoxMesh.new()
			b2.size = Vector3(0.16, 0.22, 0.06)
			out.append([b2, Transform3D(Basis.IDENTITY, Vector3(0, 0.11, 0)), false])
			var lb := BoxMesh.new()
			lb.size = Vector3(0.165, 0.08, 0.064)
			out.append([lb, Transform3D(Basis.IDENTITY, Vector3(0, 0.13, 0)), false, "white"])
			var lb2 := BoxMesh.new()
			lb2.size = Vector3(0.166, 0.025, 0.065)
			out.append([lb2, Transform3D(Basis.IDENTITY, Vector3(0, 0.035, 0)), false, "dark"])
		"sack":
			var s := SphereMesh.new()
			s.radius = 0.13
			s.height = 0.34
			s.radial_segments = 10
			s.rings = 6
			out.append([s, Transform3D(Basis.IDENTITY.scaled(Vector3(1.0, 1.0, 0.55)), Vector3(0, 0.17, 0)), false])
		"loaf":
			var d := CylinderMesh.new()
			d.top_radius = 0.1
			d.bottom_radius = 0.11
			d.height = 0.045
			d.radial_segments = 14
			out.append([d, Transform3D(Basis.IDENTITY, Vector3(0, 0.025, 0)), false])
		"round":
			var r := SphereMesh.new()
			r.radius = 0.045
			r.height = 0.09
			r.radial_segments = 8
			r.rings = 5
			out.append([r, Transform3D(Basis.IDENTITY, Vector3(0, 0.045, 0)), false])
		"slab":
			var sb := BoxMesh.new()
			sb.size = Vector3(0.24, 0.045, 0.16)
			out.append([sb, Transform3D(Basis.IDENTITY, Vector3(0, 0.023, 0)), false])
	_meshes[shape] = out
	return out


# ------------------------------------------------------------------------------------------ interior
var _root: Node3D
var _body: StaticBody3D


func _bx(size: Vector3, pos: Vector3, mat: String, solid := true) -> void:
	var mi := MeshInstance3D.new()
	var bm := BoxMesh.new()
	bm.size = size
	mi.mesh = bm
	mi.material_override = _m(mat)
	mi.position = pos
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_root.add_child(mi)
	if solid:
		var cs := CollisionShape3D.new()
		var sh := BoxShape3D.new()
		sh.size = size
		cs.shape = sh
		cs.position = pos
		_body.add_child(cs)


var _goods := {}                      ## shape -> [Array transforms, Array colors]


## two steel cables from the top of a hanging sign up to the ceiling
func _hang(center: Vector3, width: float, height: float) -> void:
	var top := center.y + height * 0.5
	var ln := CEIL - top
	for sx: float in [-1.0, 1.0]:
		_bx(Vector3(0.02, ln, 0.02), Vector3(center.x + sx * width * 0.38, top + ln * 0.5, center.z), "steel", false)


## a store sign: a coloured board sized to its text, a white icon on the left, cables to the ceiling
func _sign(c: Vector3, text: String, icon: String, h: float, mat: String, both: bool, size: int, hang: bool) -> void:
	var cw := float(size) * 0.01 * 0.74
	var tw := float(text.length()) * cw
	var isz := h * 0.72
	var w := tw + isz + 0.75
	_bx(Vector3(w, h, 0.07), c, mat, false)
	if hang:
		_hang(c, w, h)
	var sides: Array = [1.0, -1.0] if both else [1.0]
	for sd: float in sides:
		var yaw := 0.0 if sd > 0.0 else PI
		var ix := c.x + sd * (-w * 0.5 + 0.3 + isz * 0.5)
		var lx := c.x + sd * (isz + 0.15) * 0.5
		_icon(Vector3(ix, c.y, c.z + sd * 0.045), icon, isz, yaw)
		_label(_root, text, Vector3(lx, c.y, c.z + sd * 0.045), yaw, size, Color(1, 1, 1))


func _icon(p: Vector3, icon: String, sz: float, yaw: float) -> void:
	var path := "res://assets/ui/icons/%s.svg" % icon
	if not ResourceLoader.exists(path):
		return
	var sp := Sprite3D.new()
	sp.texture = load(path)
	sp.pixel_size = sz / float(maxi(sp.texture.get_width(), 1))
	sp.double_sided = false
	sp.position = p
	sp.rotation.y = yaw
	_root.add_child(sp)


## a potted plant: concrete pot, soil, a fan of long leaves
func _plant(p: Vector3) -> void:
	_bx(Vector3(0.6, 0.7, 0.6), p + Vector3(0, 0.35, 0), "pot", false)
	_bx(Vector3(0.52, 0.03, 0.52), p + Vector3(0, 0.69, 0), "wood", false)
	var leaf := BoxMesh.new()
	leaf.size = Vector3(0.09, 0.8, 0.012)
	for k in 14:
		var a := float(k) / 14.0 * TAU + float(k % 3) * 0.4
		var tilt := 0.35 + float(k % 4) * 0.13
		var mi := MeshInstance3D.new()
		mi.mesh = leaf
		mi.material_override = _m("leaf")
		var b := Basis(Vector3.UP, a) * Basis(Vector3.RIGHT, tilt)
		mi.transform = Transform3D(b, p + Vector3(0, 0.7, 0) + b * Vector3(0, 0.4, 0))
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		_root.add_child(mi)


func _put(shape: String, xf: Transform3D, col: Color) -> void:
	if not _goods.has(shape):
		_goods[shape] = [[], []]
	(_goods[shape][0] as Array).append(xf)
	(_goods[shape][1] as Array).append(col)


func _interior(st: Dictionary) -> Node3D:
	var xf0: Transform3D = st["xf"]
	_root = Node3D.new()
	_root.name = "AmidInterior"
	get_tree().current_scene.add_child(_root)
	_root.global_transform = xf0
	_body = StaticBody3D.new()
	_root.add_child(_body)
	_goods = {}
	var rng := RandomNumberGenerator.new()
	rng.seed = int(absf(xf0.origin.x * 13.0 + xf0.origin.z * 7.0))
	# shell: glossy white tiled floor, tiled ceiling with long LED lines, walls with a green dado
	_bx(Vector3(HX * 2, 0.3, HZ * 2), Vector3(0, 0.15, 0), "floor")
	_bx(Vector3(HX * 2, 0.2, HZ * 2), Vector3(0, CEIL + 0.1, 0), "ceiltile", false)
	for i in 7:
		_bx(Vector3(HX * 1.8, 0.04, 0.12), Vector3(0, CEIL - 0.02, -HZ + 4.0 + i * 6.6), "led", false)
	for i in 14:
		_bx(Vector3(0.1, 0.04, HZ * 1.5), Vector3(-39.0 + i * 6.0, CEIL - 0.025, -3.0), "led", false)
	_bx(Vector3(0.4, 14.0, HZ * 2), Vector3(-HX, 7.0, 0), "wall")
	_bx(Vector3(0.4, 14.0, HZ * 2), Vector3(HX, 7.0, 0), "wall")
	_bx(Vector3(HX * 2, 14.0, 0.4), Vector3(0, 7.0, -HZ), "wall")
	for sx: float in [-1.0, 1.0]:
		var w := HX - DOOR
		_bx(Vector3(w, 14.0, 0.4), Vector3(sx * (DOOR + w * 0.5), 7.0, HZ), "wall")
		_bx(Vector3(0.08, 1.2, HZ * 2 - 1.0), Vector3(sx * (HX - 0.22), 0.9, 0), "wallgreen", false)
		# glass entrance: side panes, steel frame, sliding doors parked open
		for g in 2:
			var gx := sx * (DOOR - 0.6 - g * 1.25)
			_bx(Vector3(1.2, 3.3, 0.03), Vector3(gx, 1.95, HZ - 0.3 - g * 0.08), "glass", false)
			_bx(Vector3(0.06, 3.3, 0.08), Vector3(gx + sx * 0.62, 1.95, HZ - 0.3), "frame", false)
		# turnstile gates inside the entrance
		for t in 3:
			var tx := sx * (1.4 + t * 0.95)
			_bx(Vector3(0.14, 1.0, 0.14), Vector3(tx, 0.8, HZ - 3.2), "steel", false)
			_bx(Vector3(0.02, 0.02, 0.75), Vector3(tx - sx * 0.08, 1.0, HZ - 3.2), "steel", false)
	_bx(Vector3(DOOR * 2, 14.0 - 3.4, 0.4), Vector3(0, 3.4 + (14.0 - 3.4) * 0.5, HZ), "wall", false)
	_bx(Vector3(DOOR * 2, 0.12, 0.3), Vector3(0, 3.4, HZ - 0.3), "frame", false)
	_sign(Vector3(0, 3.85, HZ - 0.32), "ДОБРО ПОЖАЛОВАТЬ!", "amid_cart", 0.7, "green", false, 56, true)
	# black marble columns with LED edges, a potted plant at each
	for cp: Vector2 in [Vector2(-24, 9.5), Vector2(0, 9.5), Vector2(24, 9.5), Vector2(-24, -19.6), Vector2(0, -19.6), Vector2(24, -19.6), Vector2(-39.6, 9.5), Vector2(39.6, 9.5)]:
		_bx(Vector3(0.9, CEIL, 0.9), Vector3(cp.x, CEIL * 0.5, cp.y), "marble")
		for ex: float in [-0.46, 0.46]:
			for ez: float in [-0.46, 0.46]:
				_bx(Vector3(0.03, CEIL - 0.6, 0.03), Vector3(cp.x + ex, CEIL * 0.5, cp.y + ez), "led", false)
		_bx(Vector3(1.0, 0.06, 1.0), Vector3(cp.x, CEIL - 0.45, cp.y), "led", false)
		if absf(cp.x) < 39.0:
			_plant(Vector3(cp.x + 0.95, 0.3, cp.y + 0.6))
	for pp: Vector3 in [Vector3(-3.4, 0.3, HZ - 1.2), Vector3(3.4, 0.3, HZ - 1.2), Vector3(-39.6, 0.3, -20.0), Vector3(39.6, 0.3, -20.0), Vector3(-10.5, 0.3, 17.5), Vector3(10.5, 0.3, 17.5)]:
		_plant(pp)
	# ---- shelving units: dark steel gondolas, 5 boards a side, packed with goods, price strips
	for i in 13:
		var x := -36.0 + i * 6.0
		var id: String = SHELF_ITEMS[i]
		var it: Dictionary = Food.ITEMS[id]
		var shape: String = it["shape"]
		var col: Color = it["color"]
		_bx(Vector3(1.24, 0.14, 22.0), Vector3(x, 0.37, -5.0), "shelfdark", false)
		_bx(Vector3(0.05, 2.25, 22.0), Vector3(x, 1.42, -5.0), "shelf", false)
		for zz: float in [-16.0, -10.5, -5.0, 0.5, 6.0]:
			_bx(Vector3(1.24, 2.3, 0.06), Vector3(x, 1.45, zz), "shelfdark", false)
		_bx(Vector3(1.24, 0.06, 22.0), Vector3(x, 2.58, -5.0), "shelfdark", false)
		var cs := CollisionShape3D.new()
		var shs := BoxShape3D.new()
		shs.size = Vector3(1.24, 2.3, 22.0)
		cs.shape = shs
		cs.position = Vector3(x, 1.45, -5.0)
		_body.add_child(cs)
		var step: float = {"bottle": 0.1, "can": 0.075, "carton": 0.09, "box": 0.18, "sack": 0.3, "loaf": 0.23, "round": 0.1}.get(shape, 0.15)
		for side: float in [-1.0, 1.0]:
			for lvl in 5:
				var by := 0.46 + lvl * 0.42
				_bx(Vector3(0.58, 0.025, 22.0), Vector3(x + side * 0.31, by, -5.0), "shelf", false)
				_bx(Vector3(0.012, 0.05, 22.0), Vector3(x + side * 0.605, by, -5.0), "pricewhite", false)
				var z := -15.85
				var tint := col
				var sc := 1.0
				var hs := 1.0
				while z < 5.85:
					if rng.randf() < 0.3:
						tint = col.lerp(VIVID[rng.randi() % VIVID.size()], rng.randf_range(0.35, 0.8))
						sc = rng.randf_range(0.85, 1.15)
						hs = rng.randf_range(0.8, 1.05 if lvl == 4 else 1.2)
					var deps: Array = [0.13, 0.33] if shape != "sack" else [0.25]
					for dep in deps:
						_put(shape, Transform3D(Basis(Vector3.UP, PI * 0.5 if shape == "box" else 0.0).scaled(Vector3(sc, hs, sc)), Vector3(x + side * (0.62 - float(dep)), by + 0.013, z)), tint)
					z += step * sc
				for tz in range(-15, 6, 2):
					_bx(Vector3(0.014, 0.05, 0.12), Vector3(x + side * 0.614, by - 0.002, float(tz) + 0.4), "price", false)
		# end cap: a promo stack, the price board, the big hanging category sign
		_bx(Vector3(1.2, 0.5, 0.8), Vector3(x, 0.55, 6.6), "shelfdark")
		for a in 3:
			for b in 3 - a:
				for c in 2:
					_put(shape, Transform3D(Basis.IDENTITY.scaled(Vector3.ONE * 1.3), Vector3(x - 0.3 + b * 0.3 + a * 0.15, 0.8 + a * 0.32, 6.4 + c * 0.35)), col)
		_bx(Vector3(0.95, 0.46, 0.04), Vector3(x, 1.25, 7.02), "price", false)
		_label(_root, "%s\n%s" % [String(it["name"]), Wallet.fmt(int(it["price"]))], Vector3(x, 1.25, 7.05), 0.0, 24, Color(0.1, 0.1, 0.1))
		_sign(Vector3(x, 3.35, 6.4), CATEGORY[i], ICONS.get(id, "amid_basket"), 0.62, "green", true, 40, true)
		_add_pick(shelf_point(st, i), id)
	# ---- the meat counter: red wall sign with a cow, a lit glass display with cuts of meat
	var mx := -30.0
	_bx(Vector3(15.6, 0.95, 1.3), Vector3(mx, 0.75, -HZ + 0.9), "counter")
	_bx(Vector3(15.6, 0.04, 1.2), Vector3(mx, 1.24, -HZ + 0.85), "meatcase", false)
	_bx(Vector3(15.6, 0.04, 0.5), Vector3(mx, 1.72, -HZ + 0.45), "countertop", false)
	for gx in 8:
		_bx(Vector3(0.04, 0.5, 0.04), Vector3(mx - 7.6 + gx * 2.17, 1.48, -HZ + 0.25), "steel", false)
	var gl := MeshInstance3D.new()
	var glm := BoxMesh.new()
	glm.size = Vector3(15.6, 0.62, 0.02)
	gl.mesh = glm
	gl.material_override = _m("glass")
	gl.position = Vector3(mx, 1.5, -HZ + 1.38)
	gl.rotation.x = -0.45
	_root.add_child(gl)
	for r in 3:
		var xx := mx - 7.5
		while xx < mx + 7.5:
			_put("slab", Transform3D(Basis(Vector3.UP, rng.randf_range(-0.3, 0.3)), Vector3(xx, 1.27, -HZ + 0.45 + r * 0.33)), Color(0.78, 0.12, 0.12).lerp(Color(0.95, 0.55, 0.5), rng.randf_range(0.0, 0.45)))
			xx += rng.randf_range(0.26, 0.34)
	_bx(Vector3(12.0, 1.4, 0.1), Vector3(mx, 3.2, -HZ + 0.26), "redsign", false)
	_icon(Vector3(mx - 3.0, 3.2, -HZ + 0.33), "amid_cow", 1.15, 0.0)
	_label(_root, "МЯСО", Vector3(mx + 0.9, 3.2, -HZ + 0.33), 0.0, 110, Color(1, 1, 1))
	_add_pick(xf0 * Vector3(mx, 0.3, -HZ + 2.7), "meat")
	# ---- fridges along the back wall: black frames, lit inside, colourful packs, glass doors
	for k in range(1, 4):
		var fx := -30.0 + k * 20.0
		var fid: String = FRIDGE_ITEMS[k]
		var fit: Dictionary = Food.ITEMS[fid]
		_bx(Vector3(16.0, 0.3, 1.1), Vector3(fx, 0.3, -HZ + 0.75), "counter")
		_bx(Vector3(16.0, 0.25, 1.1), Vector3(fx, 2.55, -HZ + 0.75), "counter", false)
		for ex: float in [-8.0, 8.0]:
			_bx(Vector3(0.12, 2.4, 1.1), Vector3(fx + ex, 1.35, -HZ + 0.75), "counter", false)
		var fcs := CollisionShape3D.new()
		var fsh := BoxShape3D.new()
		fsh.size = Vector3(16.0, 2.4, 1.1)
		fcs.shape = fsh
		fcs.position = Vector3(fx, 1.35, -HZ + 0.75)
		_body.add_child(fcs)
		_bx(Vector3(15.6, 2.1, 0.06), Vector3(fx, 1.35, -HZ + 0.25), "fridgein", false)
		_bx(Vector3(15.8, 0.05, 0.05), Vector3(fx, 2.4, -HZ + 1.25), "led", false)
		var fshape: String = String(fit["shape"])
		var fcol: Color = fit["color"]
		for lvl in 4:
			_bx(Vector3(15.6, 0.02, 0.9), Vector3(fx, 0.5 + lvl * 0.5, -HZ + 0.7), "pricewhite", false)
			var xx := fx - 7.6
			var tint := fcol
			while xx < fx + 7.6:
				if rng.randf() < 0.3:
					tint = fcol.lerp(VIVID[rng.randi() % VIVID.size()], rng.randf_range(0.2, 0.7))
				for dep in [0.45, 0.75]:
					_put(fshape, Transform3D(Basis.IDENTITY, Vector3(xx, 0.52 + lvl * 0.5, -HZ + float(dep))), tint)
				xx += 0.11
		for d in 8:
			_bx(Vector3(1.9, 2.2, 0.03), Vector3(fx - 7.0 + d * 2.0, 1.35, -HZ + 1.33), "glass", false)
			_bx(Vector3(0.06, 2.2, 0.06), Vector3(fx - 8.0 + d * 2.0, 1.35, -HZ + 1.33), "counter", false)
			_bx(Vector3(0.03, 0.5, 0.05), Vector3(fx - 7.0 + d * 2.0 + 0.85, 1.35, -HZ + 1.38), "steel", false)
		_bx(Vector3(16.0, 0.08, 1.1), Vector3(fx, 2.7, -HZ + 0.75), "counter", false)
		_sign(Vector3(fx, 3.15, -HZ + 1.3), FRIDGE_TITLES[k], "amid_snow" if k == 1 else ICONS.get(fid, "amid_snow"), 0.7, "green", false, 50, false)
		_add_pick(xf0 * Vector3(fx, 0.3, -HZ + 2.7), fid)
	# ---- fruit and vegetable crates on stands (left of the entrance)
	for k in 6:
		var sx2 := -36.0 + k * 4.4
		var vid: String = STAND_ITEMS[k]
		var vit: Dictionary = Food.ITEMS[vid]
		_bx(Vector3(3.4, 0.8, 1.8), Vector3(sx2, 0.7, 13.6), "wood")
		_bx(Vector3(3.2, 0.12, 1.6), Vector3(sx2, 1.16, 13.6), "wood", false)
		for a in 18 * 8 * 2:
			var col_i := a % 18
			var row_i := (a / 18) % 8
			var lay := a / 144
			if lay == 1 and (row_i == 0 or row_i == 7 or col_i == 0 or col_i == 17):
				continue
			var fp := Vector3(sx2 - 1.45 + col_i * 0.17 + lay * 0.085 + rng.randf_range(-0.02, 0.02), 1.2 + lay * 0.08, 12.95 + row_i * 0.185 + lay * 0.09)
			_put("round", Transform3D(Basis.IDENTITY.scaled(Vector3.ONE * (1.6 if vid in ["potato", "onion"] else 1.4)), fp), (vit["color"] as Color).darkened(rng.randf_range(0.0, 0.2)))
		_bx(Vector3(0.05, 0.4, 0.05), Vector3(sx2, 1.35, 14.5), "steel", false)
		_bx(Vector3(1.6, 0.3, 0.04), Vector3(sx2, 1.6, 14.52), "price", false)
		_label(_root, "%s · %s" % [String(vit["name"]), Wallet.fmt(int(vit["price"]))], Vector3(sx2, 1.6, 14.55), 0.0, 22, Color(0.1, 0.1, 0.1))
		_add_pick(xf0 * Vector3(sx2, 0.3, 15.4), vid)
	_sign(Vector3(-25.0, 3.3, 13.6), "ФРУКТЫ И ОВОЩИ", "amid_fruit", 0.7, "green", true, 50, true)
	# ---- basket stand at the entrance
	_bx(Vector3(0.8, 0.1, 0.6), Vector3(7.5, 0.35, HZ - 1.6), "shelfdark")
	for k in 6:
		var bm := basket_mesh()
		bm.position = Vector3(7.5, 0.66 + k * 0.07, HZ - 1.6)
		_root.add_child(bm)
	_bx(Vector3(0.05, 1.5, 0.05), Vector3(7.5, 1.05, HZ - 1.95), "steel", false)
	_bx(Vector3(1.0, 0.32, 0.04), Vector3(7.5, 1.85, HZ - 1.95), "pricewhite", false)
	_bx(Vector3(1.0, 0.05, 0.045), Vector3(7.5, 1.71, HZ - 1.95), "basket", false)
	_label(_root, "КОРЗИНЫ", Vector3(7.5, 1.87, HZ - 1.92), PI, 17, Color(0.85, 0.08, 0.08))
	_label(_root, "КОРЗИНЫ", Vector3(7.5, 1.87, HZ - 1.98), 0.0, 17, Color(0.85, 0.08, 0.08))
	_spot(_root, basket_point(st),
		func() -> String: return "ВЗЯТЬ КОРЗИНУ" if Food.hand == "" else "ВЕРНУТЬ КОРЗИНУ",
		func() -> bool: return _on_foot() and (Food.hand == "" or (Food.hand == "basket" and Food.basket.is_empty())),
		_basket_action)
	# ---- four tills: black counter, white top, belt, scanner, monitor, impulse rack, sign; pay
	for k in 4:
		var tx: float = [-14.0, -7.0, 7.0, 14.0][k]
		_bx(Vector3(1.0, 0.9, 4.0), Vector3(tx, 0.6, 15.0), "counter")
		_bx(Vector3(1.05, 0.05, 4.05), Vector3(tx, 1.075, 15.0), "countertop", false)
		_bx(Vector3(0.7, 0.03, 2.6), Vector3(tx, 1.11, 14.4), "belt", false)
		_bx(Vector3(0.35, 0.12, 0.35), Vector3(tx, 1.16, 16.2), "counter", false)
		_bx(Vector3(0.04, 0.3, 0.04), Vector3(tx + 0.3, 1.25, 16.4), "steel", false)
		_bx(Vector3(0.5, 0.34, 0.04), Vector3(tx + 0.3, 1.55, 16.4), "counter", false)
		_bx(Vector3(0.44, 0.28, 0.01), Vector3(tx + 0.3, 1.55, 16.425), "screen", false)
		_bx(Vector3(0.5, 0.34, 0.01), Vector3(tx + 0.3, 1.55, 16.375), "screen", false)
		# impulse rack: chocolate, gum and drinks by the till
		var rx := tx - 0.95
		_bx(Vector3(0.5, 1.5, 0.45), Vector3(rx, 1.05, 16.2), "shelf")
		for lvl in 4:
			_bx(Vector3(0.52, 0.02, 0.47), Vector3(rx, 0.55 + lvl * 0.32, 16.2), "pricewhite", false)
			for c in 4:
				var pc: Color = VIVID[(k * 7 + lvl * 3 + c) % VIVID.size()]
				_put("box", Transform3D(Basis(Vector3.UP, PI * 0.5).scaled(Vector3.ONE * 0.62), Vector3(rx - 0.18 + c * 0.12, 0.56 + lvl * 0.32, 16.35)), pc)
		_sign(Vector3(tx, 3.35, 15.0), "КАССА %d" % (k + 1), "amid_cart", 0.5, "green", true, 36, true)
		_spot(_root, till_point(st, k),
			func() -> String: return "КАССА · ОПЛАТИТЬ %s" % Wallet.fmt(Food.price_of(Food.basket)),
			func() -> bool: return Food.hand == "basket" and not Food.basket.is_empty() and _on_foot(),
			_pay_action)
	# ---- the goods (one MultiMesh per pack part)
	for shape in _goods:
		for part in _shape_meshes(shape):
			var mm := MultiMesh.new()
			mm.transform_format = MultiMesh.TRANSFORM_3D
			mm.use_colors = true
			var mesh: Mesh = (part[0] as Mesh).duplicate()
			mesh.surface_set_material(0, _m("goodsglass" if part[2] else "goods"))
			mm.mesh = mesh
			var arr: Array = _goods[shape][0]
			var carr: Array = _goods[shape][1]
			mm.instance_count = arr.size()
			for i in arr.size():
				mm.set_instance_transform(i, (arr[i] as Transform3D) * (part[1] as Transform3D))
				var cc: Color = carr[i]
				cc = Color.from_hsv(cc.h, minf(cc.s * 1.35, 1.0), cc.v * 0.9)
				var mode: String = part[3] if (part as Array).size() > 3 else ""
				match mode:
					"white":
						cc = Color(0.97, 0.96, 0.92).lerp(cc, 0.15)
					"dark":
						cc = cc.darkened(0.55)
					"silver":
						cc = Color(0.78, 0.79, 0.8)
				if part[2]:
					cc.a = 0.75
				mm.set_instance_color(i, cc)
			var mmi := MultiMeshInstance3D.new()
			mmi.multimesh = mm
			mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
			_root.add_child(mmi)
	# ---- lights, and a reflection probe so the polished floor mirrors shelves and LED lines
	for lx in [-26.0, 0.0, 26.0]:
		for lz in [-12.0, 8.0]:
			var ol := OmniLight3D.new()
			ol.position = Vector3(lx, CEIL - 0.5, lz)
			ol.omni_range = 26.0
			ol.light_energy = 1.4
			ol.light_color = Color(1.0, 0.98, 0.95)
			_root.add_child(ol)
	var rp := ReflectionProbe.new()
	rp.size = Vector3(HX * 2.0, CEIL + 0.4, HZ * 2.0)
	rp.position = Vector3(0, CEIL * 0.5, 0)
	rp.origin_offset = Vector3(0, -CEIL * 0.5 + 1.6, 0)
	rp.box_projection = true
	rp.interior = true
	rp.update_mode = ReflectionProbe.UPDATE_ONCE
	rp.ambient_mode = ReflectionProbe.AMBIENT_COLOR
	rp.ambient_color = Color(0.95, 0.95, 0.95)
	rp.ambient_color_energy = 0.6
	_root.add_child(rp)
	return _root


func _add_pick(p: Vector3, id: String) -> void:
	_spot(_root, p, func() -> String: return "ВЗЯТЬ · %s · %s" % [Food.name_of(id), Wallet.fmt(int(Food.ITEMS[id]["price"]))],
		func() -> bool: return Food.hand == "basket" and _on_foot(),
		func() -> void: _pick(id))


func _basket_action() -> void:
	if Food.hand == "":
		Food.take_basket()
		say("Корзина в руке: возьмите товары с полок и оплатите на кассе")
	else:
		Food.drop_basket()


func _pay_action() -> void:
	var err := Food.pay()
	say("Оплачено. Пакет в руке: положите его в багажник и везите домой" if err == "" else err, 3.5)


static func _label(root: Node3D, t: String, p: Vector3, yaw: float, size: int, col: Color) -> void:
	var lb := Label3D.new()
	lb.double_sided = false
	lb.text = t
	lb.font = HudStyle.font()
	lb.font_size = size
	lb.pixel_size = 0.01
	lb.modulate = col
	lb.outline_size = 0
	lb.position = p
	lb.rotation.y = yaw
	root.add_child(lb)


# ------------------------------------------------------------------------------------------ UI
func _build_ui() -> void:
	_ui = CanvasLayer.new()
	_ui.layer = 30
	add_child(_ui)
	_eat_btn = Button.new()
	_eat_btn.custom_minimum_size = Vector2(230, 60)
	_eat_btn.add_theme_font_override("font", HudStyle.font())
	_eat_btn.add_theme_font_size_override("font_size", 20)
	for stl in ["normal", "hover", "pressed", "focus"]:
		var sb := StyleBoxFlat.new()
		sb.bg_color = Color(0.75, 0.45, 0.1, 0.9).darkened(0.25 if stl == "pressed" else 0.0)
		sb.set_corner_radius_all(14)
		_eat_btn.add_theme_stylebox_override(stl, sb)
	_eat_btn.add_to_group(TouchBlock.GROUP)
	_eat_btn.visible = false
	_eat_btn.pressed.connect(_eat_from_bag)
	_ui.add_child(_eat_btn)
	_info = Label.new()
	_info.add_theme_font_override("font", HudStyle.font())
	_info.add_theme_font_size_override("font_size", 20)
	_info.add_theme_color_override("font_color", Color(1, 1, 1))
	_info.add_theme_constant_override("outline_size", 6)
	_info.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.85))
	_info.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_info.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_info.set_anchors_preset(Control.PRESET_TOP_WIDE)
	_info.offset_top = 236
	_info.offset_left = 260
	_info.offset_right = -260
	_info.visible = false
	_ui.add_child(_info)
	_toast = Label.new()
	_toast.add_theme_font_override("font", HudStyle.font())
	_toast.add_theme_font_size_override("font_size", 26)
	_toast.add_theme_color_override("font_color", Color(0.4, 1.0, 0.5))
	_toast.add_theme_constant_override("outline_size", 6)
	_toast.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.85))
	_toast.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_toast.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_toast.set_anchors_preset(Control.PRESET_TOP_WIDE)
	_toast.offset_top = 190
	_toast.offset_left = 200
	_toast.offset_right = -200
	_toast.visible = false
	_ui.add_child(_toast)


func _eat_from_bag() -> void:
	var id := Food.best_in(Food.bag)
	var msg := Food.consume(id, Food.bag) if id != "" else ""
	say(msg if msg != "" else "В пакете нечего есть")
