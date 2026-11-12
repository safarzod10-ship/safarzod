class_name WorldData
extends RefCounted
## Data of the DUSHANBE-X open world north of the peninsula (built by
## dushanbe_city_src/tools/world/build_world.py, see docs/WORLD_PLAN.md):
##   height.bin  float32 1281 x 1281 (8 m grid, rows = z), roads and plots carved in
##   surface.bin uint8 tyre surface class (CityWorld.Surface, + SNOW 6)
##   splat.bin   RGBA8 terrain shader weights (R rock, G snow, B earth, A sand)
##   biome.bin   RGBA8 (R forest, G fields, B settlement, A water proximity)
##   world.json  roads, rivers, lakes, places, landmarks, buildings, signs, km posts, fuel
## One shared instance (WorldData.get_instance()); queries are thread-safe reads.

const DIR := "res://data/world/"
static var _inst: WorldData

var ok := false
var origin := Vector2(-5120, -11040)
var step := 8.0
var n := 1281
var size := 10240.0
var seam_z := -800.0
var heights := PackedFloat32Array()
var surface := PackedByteArray()
var splat := PackedByteArray()
var biome := PackedByteArray()
var meta: Dictionary = {}
var roads: Array = []
var rivers: Array = []
var lakes: Array = []
var places: Array = []
var landmarks: Array = []
var buildings: Array = []
var signs: Array = []
var kmposts: Array = []
var fuel: Array = []
var services: Array = []          ## auto services (garages), 3x the filling stations
var washes: Array = []            ## 0.24: car washes (beside an auto service, where an AMID would be < 2 km from another)
var waterfalls: Array = []
var billboards: Array = []
var guardrails: Array = []
var fillets: Array = []
var crossings: Array = []
var no_grass: Array = []          ## paved areas added at runtime: [cx, cz, fx, fz, half along, half across]
var no_grass_ver := 0
var _ng_hash := {}                  ## Vector2i (32 m) -> rects
var _ng_lock := Mutex.new()
var _ng_keys := {}
var _road_hash := {}                 ## Vector2i (16 m) -> PackedFloat32Array [x, z, y, half width, ...]


static func get_instance() -> WorldData:
	if _inst == null:
		_inst = WorldData.new()
		_inst._load()
	return _inst


func _load() -> void:
	if not FileAccess.file_exists(DIR + "world.json"):
		push_warning("WorldData: no world data")
		return
	meta = JSON.parse_string(FileAccess.get_file_as_string(DIR + "world.json"))
	origin = Vector2(meta["origin"][0], meta["origin"][1])
	step = float(meta["step"])
	n = int(meta["size"])
	size = step * (n - 1)
	seam_z = float(meta.get("seam_z", -800.0))
	heights = FileAccess.get_file_as_bytes(DIR + "height.bin").to_float32_array()
	surface = FileAccess.get_file_as_bytes(DIR + "surface.bin")
	splat = FileAccess.get_file_as_bytes(DIR + "splat.bin")
	biome = FileAccess.get_file_as_bytes(DIR + "biome.bin")
	roads = meta.get("roads", [])
	rivers = meta.get("rivers", [])
	lakes = meta.get("lakes", [])
	places = meta.get("places", [])
	landmarks = meta.get("landmarks", [])
	buildings = meta.get("buildings", [])
	signs = meta.get("signs", [])
	kmposts = meta.get("kmposts", [])
	fuel = meta.get("fuel", [])
	services = meta.get("services", [])
	washes = meta.get("washes", [])
	waterfalls = meta.get("waterfalls", [])
	billboards = meta.get("billboards", [])
	guardrails = meta.get("guardrails", [])
	fillets = meta.get("fillets", [])
	crossings = meta.get("crossings", [])
	# (PackedFloat32Array is a value type: build plain Arrays first, then pack once)
	var tmp := {}
	for r in roads:
		var hw := float(r["w"]) * 0.5
		for p in r["pts"]:
			var c := Vector2i(floori(float(p[0]) / 16.0), floori(float(p[2]) / 16.0))
			if not tmp.has(c):
				tmp[c] = []
			(tmp[c] as Array).append_array([float(p[0]), float(p[2]), float(p[1]), hw])
	for c in tmp:
		_road_hash[c] = PackedFloat32Array(tmp[c])
	ok = true


## inside the open-world terrain (north of the seam, within the rectangle)
func contains(x: float, z: float) -> bool:
	return ok and z < seam_z and x >= origin.x and x <= origin.x + size and z >= origin.y


func height_at(x: float, z: float) -> float:
	var fx := clampf((x - origin.x) / step, 0.0, n - 1.001)
	var fz := clampf((z - origin.y) / step, 0.0, n - 1.001)
	var i := int(fx)
	var j := int(fz)
	var u := fx - i
	var v := fz - j
	var k := j * n + i
	return lerpf(lerpf(heights[k], heights[k + 1], u), lerpf(heights[k + n], heights[k + n + 1], u), v)


func h_grid(i: int, j: int) -> float:
	return heights[clampi(j, 0, n - 1) * n + clampi(i, 0, n - 1)]


func surface_at(x: float, z: float) -> int:
	var i := clampi(int(round((x - origin.x) / step)), 0, n - 1)
	var j := clampi(int(round((z - origin.y) / step)), 0, n - 1)
	return surface[j * n + i]


## biome channel 0..3 at a world point (0..1)
func biome_at(x: float, z: float, ch: int) -> float:
	var i := clampi(int(round((x - origin.x) / step)), 0, n - 1)
	var j := clampi(int(round((z - origin.y) / step)), 0, n - 1)
	return biome[(j * n + i) * 4 + ch] / 255.0


func normal_at(x: float, z: float) -> Vector3:
	var hx := height_at(x + step, z) - height_at(x - step, z)
	var hz := height_at(x, z + step) - height_at(x, z - step)
	return Vector3(-hx, 2.0 * step, -hz).normalized()


func splat_image() -> Image:
	return Image.create_from_data(n, n, false, Image.FORMAT_RGBA8, splat)


func place_at(x: float, z: float) -> Dictionary:
	## the named place whose radius contains the point (smallest first), else {}
	var best := {}
	var br := INF
	for p in places:
		var d := Vector2(x - float(p["x"]), z - float(p["z"])).length()
		if d < float(p["r"]) and float(p["r"]) < br:
			br = float(p["r"])
			best = p
	return best


## nearest road edge distance (m, negative = on the carriageway), within ~32 m; INF when none
func road_edge_dist(x: float, z: float) -> float:
	var c := Vector2i(floori(x / 16.0), floori(z / 16.0))
	var best := INF
	for dj in range(-1, 2):
		for di in range(-1, 2):
			var a: PackedFloat32Array = _road_hash.get(c + Vector2i(di, dj), PackedFloat32Array())
			for k in range(0, a.size(), 4):
				var d := Vector2(a[k] - x, a[k + 1] - z).length() - a[k + 3]
				if d < best:
					best = d
	return best


## road surface height of the nearest road sample (NAN when none within ~32 m)
func road_y_near(x: float, z: float) -> float:
	var c := Vector2i(floori(x / 16.0), floori(z / 16.0))
	var best := INF
	var y := NAN
	for dj in range(-1, 2):
		for di in range(-1, 2):
			var a: PackedFloat32Array = _road_hash.get(c + Vector2i(di, dj), PackedFloat32Array())
			for k in range(0, a.size(), 4):
				var d := Vector2(a[k] - x, a[k + 1] - z).length() - a[k + 3]
				if d < best:
					best = d
					y = a[k + 2]
	return y


## may 3D grass blades grow here? (open world: grass surface, off the roads + sidewalks, off the
## landmark plazas, below the alpine zone)
func grass_ok(x: float, z: float) -> bool:
	if not contains(x, z) or surface_at(x, z) != 0:
		return false
	if height_at(x, z) > 900.0:
		return false
	if road_edge_dist(x, z) < 5.0:
		return false
	for l in landmarks:
		if absf(x - float(l["x"])) < float(l["L"]) * 0.5 + 2.0 and absf(z - float(l["z"])) < float(l["D"]) * 0.5 + 2.0:
			return false
	# inside the AMID supermarkets (they can be entered), on the car parks and the front plazas
	if in_plaza(x, z):
		return false
	_ng_lock.lock()
	var lst: Array = _ng_hash.get(Vector2i(floori(x / 32.0), floori(z / 32.0)), [])
	for a: Array in lst:
		var dx := x - float(a[0])
		var dz := z - float(a[1])
		if absf(dx * float(a[2]) + dz * float(a[3])) < float(a[4]) and absf(dx * float(a[3]) - dz * float(a[2])) < float(a[5]):
			_ng_lock.unlock()
			return false
	_ng_lock.unlock()
	return true


## mark a paved rectangle (centre, forward direction, half sizes): no 3D grass blades there
func add_no_grass(c: Vector3, fwd: Vector3, half_along: float, half_across: float) -> void:
	var f := Vector2(fwd.x, fwd.z).normalized()
	var a := [c.x, c.z, f.x, f.y, half_along, half_across]
	var r := maxf(half_along, half_across)
	var key := Vector2i(roundi(c.x * 4.0), roundi(c.z * 4.0))
	_ng_lock.lock()
	if _ng_keys.has(key):
		_ng_lock.unlock()
		return                          # the same sector loaded again
	_ng_keys[key] = true
	no_grass.append(a)
	for j in range(floori((c.z - r) / 32.0), floori((c.z + r) / 32.0) + 1):
		for i in range(floori((c.x - r) / 32.0), floori((c.x + r) / 32.0) + 1):
			var k := Vector2i(i, j)
			if not _ng_hash.has(k):
				_ng_hash[k] = []
			(_ng_hash[k] as Array).append(a)
	no_grass_ver += 1
	_ng_lock.unlock()


var _bigs: Array = []


## on a supermarket / mall plot or its front plaza (down to the street)? (no wild grass, trees there)
func in_plaza(x: float, z: float) -> bool:
	if _bigs.is_empty():
		_bigs.append([INF])
		for b in buildings:
			if String(b[0]) in ["amid_m", "mall_m"]:
				_bigs.append([float(b[1]), float(b[2]), float(b[3]), float(b[4]), float(b[5])])
	for a: Array in _bigs:
		if a[0] == INF:
			continue
		var dx := x - float(a[0])
		var dz := z - float(a[1])
		var yaw := float(a[2])
		var lx := dx * cos(yaw) - dz * sin(yaw)
		var fz := -(dx * sin(yaw) + dz * cos(yaw))
		if absf(lx) < float(a[3]) * 0.5 + 6.0 and fz > -float(a[4]) * 0.5 - 4.0 and fz < float(a[4]) * 0.5 + 22.0:
			return true
	return false


## a landmark plot by id ({} if none): x, y, z, yaw, L, D
func landmark(id: String) -> Dictionary:
	for l in landmarks:
		if String(l["id"]) == id:
			return l
	return {}
