class_name Minimap
extends Control
## Round minimap, top-left. A prebaked top-down map (tools/terrain/build_coast.py: coast, beaches,
## streets, buildings, paths, promenade) is sampled by a canvas shader around the player and rotated
## with the camera (heading-up). The player arrow shows where the character faces; "С" marks north.
## Size follows the screen (22 % of the short side, 150..320 px in the 1600x900 canvas).

var player: PlayerController
## while driving: follow this node (the car) and rotate with this camera instead of the player
static var focus: Node3D = null
static var focus_camera: Camera3D = null
## a mission target (LakLak drop-off): drawn on the map, or on the rim as an arrow when out of range
static var target := Vector3.INF
static var target_owner: Object = null    ## which job set the target
## nearest filling station when the fuel is low (green)
static var fuel_marker := Vector3.INF
var _map: ColorRect
var _overlay: Control              # arrow + north marker, drawn above the map
var _mat: ShaderMaterial
var _font: Font


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	_mat = ShaderMaterial.new()
	_mat.shader = load("res://assets/shaders/minimap.gdshader")
	_mat.set_shader_parameter("map_tex", load("res://assets/ui/minimap.png"))
	if ResourceLoader.exists("res://assets/ui/world_map.png") and WorldData.get_instance().ok:
		var wd := WorldData.get_instance()
		_mat.set_shader_parameter("world_tex", load("res://assets/ui/world_map.png"))
		_mat.set_shader_parameter("world_rect", Vector4(wd.origin.x, wd.origin.y, wd.size, wd.size))
		_mat.set_shader_parameter("seam_z", wd.seam_z)
		_mat.set_shader_parameter("has_world", true)
	_map = ColorRect.new()
	_map.material = _mat
	_map.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_map)
	_overlay = Control.new()
	_overlay.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_overlay.draw.connect(_draw_overlay)
	add_child(_overlay)
	_font = ThemeDB.fallback_font
	get_viewport().size_changed.connect(_layout)
	_layout()


func _layout() -> void:
	var vs := get_viewport_rect().size
	var d := clampf(minf(vs.x, vs.y) * 0.22, 150.0, 320.0)
	position = Vector2(16, 16)
	size = Vector2(d, d)
	_map.size = size
	_overlay.size = size


func _process(_delta: float) -> void:
	if player == null:
		var ps := get_tree().get_nodes_in_group(&"player")
		if ps.is_empty():
			return
		player = ps[0] as PlayerController
	var p := focus.global_position if is_instance_valid(focus) else player.global_position
	_mat.set_shader_parameter("center", Vector2(p.x, p.z))
	_mat.set_shader_parameter("yaw", _view_yaw())
	_overlay.queue_redraw()


func _view_yaw() -> float:
	if is_instance_valid(focus_camera):
		var f := -focus_camera.global_transform.basis.z
		return atan2(-f.x, -f.z)
	return player.cam_yaw


func _facing() -> float:
	return focus.global_rotation.y if is_instance_valid(focus) else player.facing


func _draw_overlay() -> void:
	if player == null:
		return
	var c := size * 0.5
	var R := size.x * 0.5
	var yaw := _view_yaw()
	# player arrow: facing relative to the camera (screen-up = camera forward)
	var rel := _facing() - yaw
	var dir := Vector2(-sin(rel), -cos(rel))
	var side := Vector2(-dir.y, dir.x)
	var s := R * 0.13
	var pts := PackedVector2Array([c + dir * s * 1.2, c - dir * s * 0.7 + side * s * 0.75, c - dir * s * 0.35, c - dir * s * 0.7 - side * s * 0.75])
	_overlay.draw_colored_polygon(pts, Color(0.1, 0.1, 0.1, 0.6))
	var inner := PackedVector2Array()
	for q in pts:
		inner.append(c + (q - c) * 0.78)
	_overlay.draw_colored_polygon(inner, Color(1.0, 0.82, 0.25))
	# mission target (orange) / nearest filling station (green); radius of the map: 160 m
	for mk in [[target, Color(1.0, 0.6, 0.1)], [fuel_marker, Color(0.2, 0.9, 0.35)]]:
		_marker(mk[0], mk[1], c, R, yaw)
	# north marker on the rim

	var nd := Vector2(sin(yaw), -cos(yaw))
	var np := c + nd * (R - R * 0.11)
	_overlay.draw_circle(np, R * 0.1, Color(0.08, 0.09, 0.1, 0.85))
	var fs := int(R * 0.13)
	var tw := _font.get_string_size("С", HORIZONTAL_ALIGNMENT_CENTER, -1, fs)
	_overlay.draw_string(_font, np + Vector2(-tw.x * 0.5, tw.y * 0.33), "С", HORIZONTAL_ALIGNMENT_CENTER, -1, fs, Color(0.95, 0.95, 0.95))


func _marker(target_p: Vector3, col: Color, c: Vector2, R: float, yaw: float) -> void:
	if target_p == Vector3.INF:
		return
	var p := focus.global_position if is_instance_valid(focus) else player.global_position
	var f := Vector2(-sin(yaw), -cos(yaw))
	var rt := Vector2(-f.y, f.x)
	var d := Vector2(target_p.x - p.x, target_p.z - p.z)
	var sp := Vector2(d.dot(rt), -d.dot(f)) * (R / 160.0)
	var on_map := sp.length() < R * 0.86
	if not on_map:
		sp = sp.normalized() * R * 0.86
	var tc := c + sp
	_overlay.draw_circle(tc, R * 0.085, Color(0.05, 0.05, 0.05, 0.8))
	_overlay.draw_circle(tc, R * 0.065, col)
	if not on_map:
		var dn := sp.normalized()
		var sd := Vector2(-dn.y, dn.x)
		_overlay.draw_colored_polygon(PackedVector2Array([tc + dn * R * 0.14, tc + sd * R * 0.06, tc - sd * R * 0.06]), col)
