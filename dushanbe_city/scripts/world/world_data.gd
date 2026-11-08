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
var waterfalls: Array = []


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
	waterfalls = meta.get("waterfalls", [])
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
