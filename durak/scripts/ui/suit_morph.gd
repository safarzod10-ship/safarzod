class_name SuitMorph
extends Control
## Зацикленная анимация мастей (по референсу): пики → червы → три круга
## кружатся → трефы → бубны → круг и ножка → пики. Всё векторное: контуры
## мастей приводятся к одинаковому числу точек и плавно перетекают друг в друга.

const N := 160
const NAVY := Color("24253a")
const CRIMSON := Color("9b0030")
const LOOP := 7.2

var shape_size := 220.0
var speed := 1.0
var t := 0.0

static var _shapes := {}


func _init(sz: float = 220.0) -> void:
	shape_size = sz
	custom_minimum_size = Vector2(sz, sz) * 1.3
	mouse_filter = Control.MOUSE_FILTER_IGNORE


func _process(delta: float) -> void:
	if not is_visible_in_tree():
		return
	t = fmod(t + delta * speed, LOOP)
	queue_redraw()


# ---------------------------------------------------------------- контуры

static func _circle(c: Vector2, r: float, n: int = 48) -> PackedVector2Array:
	var p := PackedVector2Array()
	for i in n:
		var a := TAU * i / n
		p.append(c + Vector2(cos(a), sin(a)) * r)
	return p


static func _bezier_path(cmds: Array) -> PackedVector2Array:
	# cmds: [start, [c1, c2, end], ...] — кубические кривые в координатах 0..100.
	var p := PackedVector2Array()
	var cur: Vector2 = cmds[0]
	p.append(cur)
	for k in range(1, cmds.size()):
		var seg: Array = cmds[k]
		if seg.size() == 1:
			p.append(seg[0])
			cur = seg[0]
			continue
		for i in range(1, 17):
			var u := i / 16.0
			p.append(cur.bezier_interpolate(seg[0], seg[1], seg[2], u))
		cur = seg[2]
	return p


static func shape(name: String) -> PackedVector2Array:
	if _shapes.has(name):
		return _shapes[name]
	var raw: PackedVector2Array
	match name:
		"heart":
			raw = _bezier_path([Vector2(50, 20),
				[Vector2(55, 11.5), Vector2(62, 6), Vector2(71.5, 6)],
				[Vector2(85, 6), Vector2(96, 16), Vector2(96, 31)],
				[Vector2(96, 50), Vector2(78, 66), Vector2(50, 92)],
				[Vector2(22, 66), Vector2(4, 50), Vector2(4, 31)],
				[Vector2(4, 16), Vector2(15, 6), Vector2(28.5, 6)],
				[Vector2(38, 6), Vector2(45, 11.5), Vector2(50, 20)]])
		"diamond":
			raw = _bezier_path([Vector2(50, 2),
				[Vector2(58, 18), Vector2(70, 34), Vector2(84, 50)],
				[Vector2(70, 66), Vector2(58, 82), Vector2(50, 98)],
				[Vector2(42, 82), Vector2(30, 66), Vector2(16, 50)],
				[Vector2(30, 34), Vector2(42, 18), Vector2(50, 2)]])
		"spade":
			raw = _bezier_path([Vector2(50, 4),
				[Vector2(78, 28), Vector2(96, 43), Vector2(96, 62)],
				[Vector2(96, 75), Vector2(86, 84), Vector2(73.5, 84)],
				[Vector2(64.5, 84), Vector2(58, 79.5), Vector2(54, 73)],
				[Vector2(55, 83), Vector2(59, 90), Vector2(67, 97)],
				[Vector2(33, 97)],
				[Vector2(41, 90), Vector2(45, 83), Vector2(46, 73)],
				[Vector2(42, 79.5), Vector2(35.5, 84), Vector2(26.5, 84)],
				[Vector2(14, 84), Vector2(4, 75), Vector2(4, 62)],
				[Vector2(4, 43), Vector2(22, 28), Vector2(50, 4)]])
		"club":
			var u := _circle(Vector2(50, 27), 20.5)
			for c in [_circle(Vector2(27, 59), 20.5), _circle(Vector2(73, 59), 20.5), _circle(Vector2(50, 50), 14.0)]:
				u = Geometry2D.merge_polygons(u, c)[0]
			var stem := _bezier_path([Vector2(46.5, 56), [Vector2(46, 76), Vector2(42, 88), Vector2(33, 97)], [Vector2(67, 97)],
				[Vector2(58, 88), Vector2(54, 76), Vector2(53.5, 56)]])
			u = Geometry2D.merge_polygons(u, stem)[0]
			raw = u
		"blob":
			raw = _circle(Vector2(50, 50), 34.0, 64)
	var res := _resample(raw, N)
	_shapes[name] = res
	return res


## Привести контур к n точкам равномерно по длине, начиная с верхней точки, по часовой.
static func _resample(poly: PackedVector2Array, n: int) -> PackedVector2Array:
	var p := poly
	if Geometry2D.is_polygon_clockwise(p):
		p.reverse()
	var start := 0
	for i in p.size():
		if p[i].y < p[start].y - 0.01 or (absf(p[i].y - p[start].y) < 0.01 and absf(p[i].x - 50) < absf(p[start].x - 50)):
			start = i
	var q := PackedVector2Array()
	for i in p.size():
		q.append(p[(start + i) % p.size()])
	q.append(q[0])
	var total := 0.0
	for i in q.size() - 1:
		total += q[i].distance_to(q[i + 1])
	var out := PackedVector2Array()
	var seg := 0
	var acc := 0.0
	for k in n:
		var target := total * k / n
		while seg < q.size() - 2 and acc + q[seg].distance_to(q[seg + 1]) < target:
			acc += q[seg].distance_to(q[seg + 1])
			seg += 1
		var l := q[seg].distance_to(q[seg + 1])
		var u := 0.0 if l < 0.0001 else (target - acc) / l
		out.append(q[seg].lerp(q[seg + 1], clampf(u, 0.0, 1.0)))
	return out


static func _lerp_poly(a: PackedVector2Array, b: PackedVector2Array, u: float) -> PackedVector2Array:
	var r := PackedVector2Array()
	r.resize(N)
	for i in N:
		r[i] = a[i].lerp(b[i], u)
	return r


static func _ease(u: float) -> float:
	u = clampf(u, 0.0, 1.0)
	return u * u * (3.0 - 2.0 * u)


static func _back(u: float) -> float:
	u = clampf(u, 0.0, 1.0)
	var c := 1.7
	return 1.0 + (c + 1.0) * pow(u - 1.0, 3) + c * pow(u - 1.0, 2)


# ---------------------------------------------------------------- кадр

func _xf(p: PackedVector2Array, scale_xy: Vector2 = Vector2.ONE, rot: float = 0.0, off: Vector2 = Vector2.ZERO) -> PackedVector2Array:
	var k := shape_size / 100.0
	var c := size / 2.0
	var r := PackedVector2Array()
	r.resize(p.size())
	for i in p.size():
		var v := (p[i] - Vector2(50, 50)) * scale_xy
		r[i] = c + (v.rotated(rot) + off) * k
	return r


func _fill(p: PackedVector2Array, col: Color) -> void:
	if p.size() < 3:
		return
	var tri := Geometry2D.triangulate_polygon(p)
	if tri.is_empty():
		draw_colored_polygon(p, col)
	else:
		var cols := PackedColorArray()
		cols.resize(p.size())
		cols.fill(col)
		draw_polygon(p, cols)
	draw_polyline(p + PackedVector2Array([p[0]]), col, 1.2, true)


func _disc(center: Vector2, r: float, col: Color) -> void:
	var k := shape_size / 100.0
	draw_circle(size / 2.0 + (center - Vector2(50, 50)) * k, r * k, col, true, -1.0, true)


func _draw() -> void:
	var s := t
	# 0.0–0.7  пики стоят
	# 0.7–1.2  пики → червы (сплющивание, цвет)
	if s < 0.7:
		_fill(_xf(shape("spade")), NAVY)
	elif s < 1.25:
		var u := _ease((s - 0.7) / 0.55)
		var squash := 1.0 - sin(u * PI) * 0.22
		var p := _lerp_poly(shape("spade"), shape("heart"), u)
		_fill(_xf(p, Vector2(1.0 + (1.0 - squash) * 0.6, squash)), NAVY.lerp(CRIMSON, u))
	# 1.25–2.0 червы, лёгкое «биение»
	elif s < 2.0:
		var u := (s - 1.25) / 0.75
		var beat := 1.0 + sin(u * PI * 2.0) * 0.04
		_fill(_xf(shape("heart"), Vector2(beat, beat)), CRIMSON)
	# 2.0–2.35 сердце распадается на три круга
	elif s < 2.35:
		var u := _ease((s - 2.0) / 0.35)
		_fill(_xf(shape("heart"), Vector2.ONE * (1.0 - u * 0.75)), Color(CRIMSON, 1.0 - u))
		for i in 3:
			var a := -PI / 2.0 + TAU * i / 3.0 + PI / 3.0
			_disc(Vector2(50, 50) + Vector2(cos(a), sin(a)) * 22.0 * u, 17.0 * _back(u), CRIMSON)
	# 2.35–3.4 три круга кружатся и темнеют
	elif s < 3.4:
		var u := (s - 2.35) / 1.05
		var spin := _ease(u) * TAU * 0.75
		var col := CRIMSON.lerp(NAVY, _ease((u - 0.4) / 0.6))
		var rad := 22.0 + sin(u * PI) * 8.0
		for i in 3:
			var a := -PI / 2.0 + TAU * i / 3.0 + PI / 3.0 + spin
			_disc(Vector2(50, 50) + Vector2(cos(a), sin(a)) * rad, 17.0, col)
	# 3.4–3.8 круги собираются в трефы, растёт ножка
	elif s < 3.8:
		var u := _ease((s - 3.4) / 0.4)
		var spin := TAU * 0.75
		var targets := [Vector2(50, 27), Vector2(73, 59), Vector2(27, 59)]
		for i in 3:
			var a := -PI / 2.0 + TAU * i / 3.0 + PI / 3.0 + spin
			var from := Vector2(50, 50) + Vector2(cos(a), sin(a)) * 22.0
			_disc(from.lerp(targets[i], u), lerpf(17.0, 20.5, u), NAVY)
		_disc(Vector2(50, 50), 14.0 * u, NAVY)
		var stem := PackedVector2Array([Vector2(46.5, 56), Vector2(53.5, 56), Vector2(50 + 17 * u, 56 + 41 * u), Vector2(50 - 17 * u, 56 + 41 * u)])
		_fill(_xf(stem), NAVY)
	# 3.8–4.3 трефы стоят
	elif s < 4.3:
		_fill(_xf(shape("club")), NAVY)
	# 4.3–4.85 трефы → бубны (поворот, цвет)
	elif s < 4.85:
		var u := _ease((s - 4.3) / 0.55)
		var p := _lerp_poly(shape("club"), shape("diamond"), u)
		_fill(_xf(p, Vector2.ONE, sin(u * PI) * 0.35), NAVY.lerp(CRIMSON, u))
	# 4.85–5.5 бубны стоят
	elif s < 5.5:
		_fill(_xf(shape("diamond")), CRIMSON)
	# 5.5–6.0 бубны распадаются: верх — шар, низ — ножка пик
	elif s < 6.0:
		var u := _ease((s - 5.5) / 0.5)
		var p := _lerp_poly(shape("diamond"), shape("blob"), u)
		_fill(_xf(p, Vector2.ONE * lerpf(1.0, 0.9, u), 0.0, Vector2(0, -8 * u)), CRIMSON.lerp(NAVY, u))
		var stem := PackedVector2Array([Vector2(48, 70), Vector2(52, 70), Vector2(50 + 17 * u, 97), Vector2(50 - 17 * u, 97)])
		_fill(_xf(stem), Color(CRIMSON, u))
	# 6.0–6.6 шар превращается в пики
	elif s < 6.6:
		var u := _ease((s - 6.0) / 0.6)
		var blob := shape("blob")
		var shifted := PackedVector2Array()
		for v in blob:
			shifted.append(Vector2(50, 50) + (v - Vector2(50, 50)) * 0.9 + Vector2(0, -8))
		var p := _lerp_poly(shifted, shape("spade"), u)
		var bounce := 1.0 + sin(u * PI) * 0.06
		_fill(_xf(p, Vector2(bounce, 2.0 - bounce)), NAVY)
		if u < 1.0:
			var stem := PackedVector2Array([Vector2(48, 70), Vector2(52, 70), Vector2(67, 97), Vector2(33, 97)])
			_fill(_xf(stem), CRIMSON.lerp(NAVY, u))
	else:
		_fill(_xf(shape("spade")), NAVY)
