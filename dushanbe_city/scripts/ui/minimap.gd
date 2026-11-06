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
var _map: ColorRect
var _overlay: Control              # arrow + north marker, drawn above the map
var _mat: ShaderMaterial
var _font: Font


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	_mat = ShaderMaterial.new()
	_mat.shader = load("res://assets/shaders/minimap.gdshader")
	_mat.set_shader_parameter("map_tex", load("res://assets/ui/minimap.png"))
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
	# north marker on the rim
	var nd := Vector2(sin(yaw), -cos(yaw))
	var np := c + nd * (R - R * 0.11)
	_overlay.draw_circle(np, R * 0.1, Color(0.08, 0.09, 0.1, 0.85))
	var fs := int(R * 0.13)
	var tw := _font.get_string_size("С", HORIZONTAL_ALIGNMENT_CENTER, -1, fs)
	_overlay.draw_string(_font, np + Vector2(-tw.x * 0.5, tw.y * 0.33), "С", HORIZONTAL_ALIGNMENT_CENTER, -1, fs, Color(0.95, 0.95, 0.95))
