class_name MissionCutscene
extends Node3D
## A short GTA-style cutscene before a mission: black letterbox bars slide in, the HUD hides, a slow
## camera orbit around the hero and the mission giver (a city character in his own clothes) while the
## subtitles tell the job. A tap / key skips it. `finished` fires at the end (or after the skip).

signal finished

const MODEL := "res://assets/characters/player/player.glb"
const MOCAP := "res://assets/characters/animations/player_mocap.res"
const LINE_TIME := 2.8

static var playing := false

var lines: PackedStringArray = PackedStringArray()
var giver_tex := 0
var hero: Node3D
var _cam: Camera3D
var _prev_cam: Camera3D
var _ui: CanvasLayer
var _top: ColorRect
var _bot: ColorRect
var _sub: Label
var _t := 0.0
var _dur := 0.0
var _centre := Vector3.ZERO
var _a0 := 0.0
var _hidden: Array = []
var _done := false


## play `ls` at the hero's position; the giver stands 2.2 m in front of him
static func play(parent: Node, hero_node: Node3D, ls: PackedStringArray, tex := 0) -> MissionCutscene:
	var cs := MissionCutscene.new()
	cs.lines = ls
	cs.giver_tex = tex
	cs.hero = hero_node
	parent.add_child(cs)
	return cs


func _ready() -> void:
	playing = true
	_dur = LINE_TIME * maxi(lines.size(), 1) + 0.6
	var hp := hero.global_position
	var fwd := hero.global_basis.z
	fwd.y = 0.0
	fwd = fwd.normalized() if fwd.length() > 0.1 else Vector3.FORWARD
	_centre = hp + fwd * 1.1 + Vector3(0, 1.45, 0)
	_a0 = atan2(fwd.x, fwd.z) + PI * 0.5
	_spawn_giver(hp + fwd * 2.2, hp)
	hero.set_physics_process(false)
	_prev_cam = get_viewport().get_camera_3d()
	_cam = Camera3D.new()
	_cam.fov = 50.0
	add_child(_cam)
	_place_cam(0.0)
	_cam.make_current()
	# hide the game HUD (every canvas layer under ours), keep a list to bring them back
	for n in get_tree().root.find_children("*", "CanvasLayer", true, false):
		var cl := n as CanvasLayer
		if cl.visible and cl.layer < 40:
			cl.visible = false
			_hidden.append(cl)
	_build_ui()


func _spawn_giver(at: Vector3, look_at_p: Vector3) -> void:
	if not ResourceLoader.exists(MODEL):
		return
	var g: Node3D = (load(MODEL) as PackedScene).instantiate()
	g.name = "MissionGiver"
	add_child(g)
	var wd := WorldData.get_instance()
	if wd and wd.ok:
		at.y = wd.height_at(at.x, at.z) + 0.05
	g.global_position = at
	var to := look_at_p - at
	g.rotation.y = atan2(to.x, to.z)
	var tex := ClothesShop.outfit_texture(giver_tex)
	for mi in g.find_children("*", "MeshInstance3D", true, false):
		var base := (mi as MeshInstance3D).get_active_material(0) as StandardMaterial3D
		if base and tex:
			var mm := base.duplicate() as StandardMaterial3D
			mm.albedo_texture = tex
			(mi as MeshInstance3D).material_override = mm
	var ap: AnimationPlayer = g.find_child("AnimationPlayer", true, false)
	if ap and ResourceLoader.exists(MOCAP):
		if not ap.has_animation_library(&"m"):
			ap.add_animation_library(&"m", load(MOCAP))
		ap.play(&"m/idle")


func _place_cam(k: float) -> void:
	# a slow half orbit at 4.5..3.6 m, slightly above the eyes
	var a := _a0 + k * PI * 0.55
	var r := lerpf(4.6, 3.6, k)
	var p := _centre + Vector3(sin(a) * r, 0.35 + 0.25 * k, cos(a) * r)
	_cam.global_position = p
	_cam.look_at(_centre, Vector3.UP)


func _build_ui() -> void:
	_ui = CanvasLayer.new()
	_ui.layer = 45
	add_child(_ui)
	var vs := get_viewport().get_visible_rect().size
	var bh := vs.y * 0.12
	_top = ColorRect.new()
	_top.color = Color.BLACK
	_top.size = Vector2(vs.x, bh)
	_top.position = Vector2(0, -bh)
	_ui.add_child(_top)
	_bot = ColorRect.new()
	_bot.color = Color.BLACK
	_bot.size = Vector2(vs.x, bh)
	_bot.position = Vector2(0, vs.y)
	_ui.add_child(_bot)
	var tw := create_tween().set_parallel(true)
	tw.tween_property(_top, "position:y", 0.0, 0.5)
	tw.tween_property(_bot, "position:y", vs.y - bh, 0.5)
	_sub = Label.new()
	_sub.add_theme_font_override("font", HudStyle.font())
	_sub.add_theme_font_size_override("font_size", 30)
	_sub.add_theme_color_override("font_color", Color(1, 1, 1))
	_sub.add_theme_color_override("font_outline_color", Color.BLACK)
	_sub.add_theme_constant_override("outline_size", 8)
	_sub.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_sub.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_sub.position = Vector2(vs.x * 0.1, vs.y - bh - 96)
	_sub.size = Vector2(vs.x * 0.8, 90)
	_ui.add_child(_sub)
	var skip := Label.new()
	skip.text = "нажмите, чтобы пропустить"
	skip.add_theme_font_size_override("font_size", 16)
	skip.add_theme_color_override("font_color", Color(0.7, 0.7, 0.7))
	skip.position = Vector2(vs.x - 290, vs.y - bh * 0.62)
	_ui.add_child(skip)


func _process(delta: float) -> void:
	if _done:
		return
	_t += delta
	PlayerInput.reset()
	_place_cam(clampf(_t / _dur, 0.0, 1.0))
	var li := clampi(int(_t / LINE_TIME), 0, maxi(lines.size() - 1, 0))
	if lines.size() > 0:
		_sub.text = lines[li]
	if _t >= _dur:
		end()


func _input(e: InputEvent) -> void:
	if _done or _t < 0.6:
		return
	if (e is InputEventScreenTouch and e.pressed) or (e is InputEventMouseButton and e.pressed) or (e is InputEventKey and e.pressed and not e.echo):
		get_viewport().set_input_as_handled()
		end()


func end() -> void:
	if _done:
		return
	_done = true
	playing = false
	for cl in _hidden:
		if is_instance_valid(cl):
			(cl as CanvasLayer).visible = true
	if is_instance_valid(hero):
		hero.set_physics_process(true)
	if is_instance_valid(_prev_cam):
		_prev_cam.make_current()
	PlayerInput.reset()
	finished.emit()
	queue_free()
