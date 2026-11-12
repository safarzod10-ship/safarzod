class_name RoadNav
extends Node
## Navigator: the route along the roads to Minimap.target (a place picked on the map, a LakLak
## drop-off, the next bus stop, ...), drawn as a blue line on the minimap and on the big map.
## Graph: every road of the open world (tools/world, 10 m samples) + the lanes and junction
## connectors of the peninsula city (data/city/traffic.json), linked where roads meet (junctions:
## nodes of different roads closer than their half widths, at the same height ±3 m - overpasses are
## not junctions) and where a road ends next to another one. Search: A* (straight-line heuristic).
## The route is rebuilt when the target changes or when the driver leaves it (> 35 m).

static var route := PackedVector3Array()     ## the current route (player -> target), world points
static var instance: RoadNav

const STEP := 10.0
const CELL := 24.0
const REROUTE_DIST := 35.0

var nodes := PackedVector3Array()
var adj: Array = []                          ## node -> PackedInt32Array of neighbours
var ready_graph := false
var _hash := {}                              ## Vector2i -> Array[int]
var _task := -1
var _last_target := Vector3.INF
var _t := 0.0


func _ready() -> void:
	instance = self
	_task = WorkerThreadPool.add_task(build)


func _exit_tree() -> void:
	if _task >= 0:
		WorkerThreadPool.wait_for_task_completion(_task)
		_task = -1
	if instance == self:
		instance = null
	route = PackedVector3Array()


# ------------------------------------------------------------------------------------------ graph
func build() -> void:
	var lines: Array = []                    ## [PackedVector3Array, radius]
	var wd := WorldData.get_instance()
	if wd.ok:
		for r in wd.roads:
			var p := PackedVector3Array()
			for q in r["pts"]:
				p.append(Vector3(q[0], q[1], q[2]))
			lines.append([p, float(r["w"]) * 0.5 + 2.0])
	# the peninsula's asphalt roads out of the city (to the open world at the seam), 2D polylines:
	# no heights - their junctions are linked regardless of the level (flag)
	if FileAccess.file_exists("res://data/terrain/paths.json"):
		var tp: Variant = JSON.parse_string(FileAccess.get_file_as_string("res://data/terrain/paths.json"))
		if tp is Dictionary:
			for pa in tp.get("paths", []):
				if not bool(pa.get("asphalt", false)):
					continue
				var p := PackedVector3Array()
				for q in pa["pts"]:
					p.append(Vector3(q[0], NAN, q[1]))
				lines.append([p, float(pa.get("road_half", 4.0)) + 2.0])
	if FileAccess.file_exists(TrafficGraph.PATH):
		var t: Variant = JSON.parse_string(FileAccess.get_file_as_string(TrafficGraph.PATH))
		if t is Dictionary:
			for key in ["lanes", "connectors"]:
				for l in t[key]:
					var p := PackedVector3Array()
					for q in l["points"]:
						p.append(Vector3(q[0], q[1], q[2]))
					if p.size() >= 2:
						lines.append([p, 4.0])
	var line_of := PackedInt32Array()
	var rad := PackedFloat32Array()
	var ends: Array[int] = []
	var tmp_adj: Array = []
	for li in lines.size():
		var P: PackedVector3Array = lines[li][0]
		var r: float = lines[li][1]
		# resample every STEP m (keeps the first and the last point)
		var prev := -1
		var acc := 0.0
		for k in P.size():
			if k > 0:
				acc += _d2(P[k], P[k - 1])
			if k == 0 or k == P.size() - 1 or acc >= STEP:
				acc = 0.0
				var id := nodes.size()
				nodes.append(P[k])
				line_of.append(li)
				rad.append(r)
				tmp_adj.append([])
				if prev >= 0:
					tmp_adj[prev].append(id)
					tmp_adj[id].append(prev)
				if k == 0 or k == P.size() - 1:
					ends.append(id)
				prev = id
				var c := _cell(P[k])
				if not _hash.has(c):
					_hash[c] = []
				_hash[c].append(id)
	# junctions: nodes of different lines within their radius, same level
	for i in nodes.size():
		var p := nodes[i]
		var c := _cell(p)
		for dj in range(-1, 2):
			for di in range(-1, 2):
				for j in _hash.get(c + Vector2i(di, dj), []):
					if j <= i or line_of[j] == line_of[i]:
						continue
					var q := nodes[j]
					if absf(q.y - p.y) > 3.0:      # (false for the level-less peninsula roads: NAN)
						continue
					if Vector2(p.x - q.x, p.z - q.z).length() < maxf(rad[i], rad[j]):
						tmp_adj[i].append(j)
						tmp_adj[j].append(i)
	# dead ends next to another road (gaps at the seam between the city and the world map)
	for e in ends:
		var best := -1
		var bd := 26.0
		var p := nodes[e]
		var c := _cell(p)
		for dj in range(-1, 2):
			for di in range(-1, 2):
				for j in _hash.get(c + Vector2i(di, dj), []):
					if line_of[j] == line_of[e] or absf(nodes[j].y - p.y) > 4.0:   # NAN: any level
						continue
					var d := Vector2(p.x - nodes[j].x, p.z - nodes[j].z).length()
					if d < bd:
						bd = d
						best = j
		if best >= 0 and not (tmp_adj[e] as Array).has(best):
			tmp_adj[e].append(best)
			tmp_adj[best].append(e)
	for a in tmp_adj:
		adj.append(PackedInt32Array(a))
	ready_graph = true


## horizontal distance (the peninsula's out-of-town roads have no heights: y = NAN)
static func _d2(a: Vector3, b: Vector3) -> float:
	return Vector2(a.x - b.x, a.z - b.z).length()


func _cell(p: Vector3) -> Vector2i:
	return Vector2i(floori(p.x / CELL), floori(p.z / CELL))


## the node nearest to p (searching outwards ring by ring, up to ~1.5 km)
func nearest(p: Vector3) -> int:
	var c := _cell(p)
	var best := -1
	var bd := INF
	for ring in 64:
		for dj in range(-ring, ring + 1):
			for di in range(-ring, ring + 1):
				if maxi(absi(di), absi(dj)) != ring:
					continue
				for j in _hash.get(c + Vector2i(di, dj), []):
					var d := Vector2(nodes[j].x - p.x, nodes[j].z - p.z).length()
					if d < bd:
						bd = d
						best = j
		if best >= 0 and bd < ring * CELL:
			break
	return best


## A* from a to b along the roads; [] when there is no connection
func find_path(a: Vector3, b: Vector3) -> PackedVector3Array:
	var out := PackedVector3Array()
	if not ready_graph:
		return out
	var s := nearest(a)
	var g := nearest(b)
	if s < 0 or g < 0:
		return out
	var n := nodes.size()
	var cost := PackedFloat32Array()
	cost.resize(n)
	cost.fill(INF)
	var from := PackedInt32Array()
	from.resize(n)
	from.fill(-1)
	var closed := PackedByteArray()
	closed.resize(n)
	var heap_k := PackedFloat32Array()        # binary heap: priority, node
	var heap_v := PackedInt32Array()
	cost[s] = 0.0
	_push(heap_k, heap_v, _d2(nodes[s], nodes[g]), s)
	var goal := nodes[g]
	while heap_v.size() > 0:
		var u := _pop(heap_k, heap_v)
		if closed[u] == 1:
			continue
		closed[u] = 1
		if u == g:
			break
		var cu := cost[u]
		var pu := nodes[u]
		for v in (adj[u] as PackedInt32Array):
			if closed[v] == 1:
				continue
			var cv := cu + _d2(pu, nodes[v])
			if cv < cost[v]:
				cost[v] = cv
				from[v] = u
				_push(heap_k, heap_v, cv + _d2(nodes[v], goal), v)
	if from[g] < 0 and g != s:
		return out
	var k := g
	var rev := PackedVector3Array()
	while k >= 0:
		rev.append(nodes[k])
		k = from[k]
	rev.reverse()
	out.append(a)
	out.append_array(rev)
	out.append(b)
	return out


static func _push(hk: PackedFloat32Array, hv: PackedInt32Array, k: float, v: int) -> void:
	hk.append(k)
	hv.append(v)
	var i := hk.size() - 1
	while i > 0:
		var p := (i - 1) >> 1
		if hk[p] <= hk[i]:
			break
		var tk := hk[p]
		hk[p] = hk[i]
		hk[i] = tk
		var tv := hv[p]
		hv[p] = hv[i]
		hv[i] = tv
		i = p


static func _pop(hk: PackedFloat32Array, hv: PackedInt32Array) -> int:
	var top := hv[0]
	var last := hk.size() - 1
	hk[0] = hk[last]
	hv[0] = hv[last]
	hk.resize(last)
	hv.resize(last)
	var i := 0
	while true:
		var l := i * 2 + 1
		var r := l + 1
		var m := i
		if l < last and hk[l] < hk[m]:
			m = l
		if r < last and hk[r] < hk[m]:
			m = r
		if m == i:
			break
		var tk := hk[m]
		hk[m] = hk[i]
		hk[i] = tk
		var tv := hv[m]
		hv[m] = hv[i]
		hv[i] = tv
		i = m
	return top


## length of a route (m)
static func length_of(r: PackedVector3Array) -> float:
	var l := 0.0
	for i in range(1, r.size()):
		l += Vector2(r[i].x - r[i - 1].x, r[i].z - r[i - 1].z).length()
	return l


# ------------------------------------------------------------------------------------------ follow
func _player_pos() -> Vector3:
	if is_instance_valid(Minimap.focus):
		return Minimap.focus.global_position
	var ps := get_tree().get_nodes_in_group(&"player")
	return (ps[0] as Node3D).global_position if not ps.is_empty() else Vector3.ZERO


func _process(delta: float) -> void:
	if not ready_graph:
		return
	if _task >= 0:
		WorkerThreadPool.wait_for_task_completion(_task)
		_task = -1
	var tgt := Minimap.target
	if tgt == Vector3.INF:
		route = PackedVector3Array()
		_last_target = Vector3.INF
		return
	var p := _player_pos()
	_t -= delta
	if tgt != _last_target:
		_last_target = tgt
		route = find_path(p, tgt)
		_t = 1.0
		return
	if route.size() < 2:
		if _t <= 0.0:
			_t = 2.0
			route = find_path(p, tgt)
		return
	# drop the passed part; off the route -> rebuild (at most once a second)
	var bi := 0
	var bd := INF
	for i in mini(route.size(), 60):
		var d := Vector2(route[i].x - p.x, route[i].z - p.z).length()
		if d < bd:
			bd = d
			bi = i
	if bi > 1:
		route = route.slice(bi - 1)
	route[0] = p
	if bd > REROUTE_DIST and _t <= 0.0:
		_t = 1.0
		route = find_path(p, tgt)
