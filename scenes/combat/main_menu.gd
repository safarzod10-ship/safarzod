extends Node3D
## Main menu: the selected fighter stands on a lit platform holding the chosen
## weapon at the low-ready; arrows change character / weapon, drag to rotate.

const ARENA_SCENE := "res://scenes/combat/arena.tscn"

var _stage: Node3D
var _fighter: Combatant
var _char_i := 0
var _weapon_i := 0
var _name_lbl: Label
var _desc_lbl: Label
var _weapon_lbl: Label
var _stats_lbl: Label
var _spin := 0.55
var _drag := false
var _t := 0.0
var _raise := 0.0


func _ready() -> void:
	GameManager.set_state(GameManager.State.MENU)
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	_char_i = CharacterCatalog.index_of(CombatState.char_id)
	for i in WeaponCatalog.WEAPONS.size():
		if WeaponCatalog.WEAPONS[i]["id"] == CombatState.weapon_id:
			_weapon_i = i
	_build_stage()
	_build_ui()
	_show_fighter()


func _build_stage() -> void:
	var env := Environment.new()
	env.background_mode = Environment.BG_COLOR
	env.background_color = Color(0.035, 0.04, 0.05)
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.35, 0.4, 0.5)
	env.ambient_light_energy = 0.55
	env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	env.tonemap_exposure = 1.15
	env.glow_enabled = true
	env.fog_enabled = true
	env.fog_light_color = Color(0.05, 0.06, 0.08)
	env.fog_density = 0.06
	var we := WorldEnvironment.new()
	we.environment = env
	add_child(we)
	var key := SpotLight3D.new()
	key.position = Vector3(2.6, 3.6, 3.0)
	key.light_energy = 14.0
	key.light_color = Color(1.0, 0.93, 0.82)
	key.spot_range = 12.0
	key.spot_angle = 34.0
	key.shadow_enabled = true
	add_child(key)
	key.look_at(Vector3(0, 1.0, 0))
	var rim := SpotLight3D.new()
	rim.position = Vector3(-2.8, 2.6, -3.0)
	rim.light_energy = 16.0
	rim.light_color = Color(0.45, 0.62, 1.0)
	rim.spot_range = 12.0
	rim.spot_angle = 38.0
	add_child(rim)
	rim.look_at(Vector3(0, 1.2, 0))
	var fill := OmniLight3D.new()
	fill.position = Vector3(-2.0, 1.2, 2.5)
	fill.light_energy = 0.7
	fill.light_color = Color(1.0, 0.6, 0.35)
	fill.omni_range = 7.0
	add_child(fill)
	var floor_mi := MeshInstance3D.new()
	var disc := CylinderMesh.new()
	disc.top_radius = 1.5
	disc.bottom_radius = 1.6
	disc.height = 0.12
	disc.radial_segments = 48
	var fm := StandardMaterial3D.new()
	fm.albedo_color = Color(0.11, 0.115, 0.125)
	fm.metallic = 0.7
	fm.roughness = 0.32
	disc.material = fm
	floor_mi.mesh = disc
	floor_mi.position.y = -0.06
	add_child(floor_mi)
	var ground := MeshInstance3D.new()
	var pm := PlaneMesh.new()
	pm.size = Vector2(60, 60)
	var gm := StandardMaterial3D.new()
	gm.albedo_color = Color(0.05, 0.055, 0.06)
	gm.roughness = 0.6
	pm.material = gm
	ground.mesh = pm
	ground.position.y = -0.12
	add_child(ground)
	_stage = Node3D.new()
	add_child(_stage)
	var cam := Camera3D.new()
	cam.fov = 34.0
	add_child(cam)
	cam.look_at_from_position(Vector3(-0.75, 1.25, 4.6), Vector3(-0.75, 0.98, 0.0))
	_stage.position.x = 0.35


func _show_fighter() -> void:
	if _fighter:
		_fighter.queue_free()
	var cdef: Dictionary = CharacterCatalog.CHARACTERS[_char_i]
	var wdef: Dictionary = WeaponCatalog.WEAPONS[_weapon_i]
	CombatState.char_id = cdef["id"]
	CombatState.weapon_id = wdef["id"]
	_fighter = Combatant.new()
	_fighter.char_id = cdef["id"]
	_fighter.weapon_id = wdef["id"]
	_stage.add_child(_fighter)
	_fighter.set_physics_process(false)
	_fighter.remove_from_group(&"combatants")
	_fighter.collision_layer = 0
	_fighter.aim.weight = 1.0
	_raise = 1.0   # presents the weapon, then settles to the low-ready
	_name_lbl.text = cdef["name"]
	_desc_lbl.text = cdef["desc"]
	_weapon_lbl.text = wdef["name"]
	_stats_lbl.text = "Убито врагов: %d      Лучшая волна: %d" % [CombatState.kills, CombatState.best_wave]


func _process(delta: float) -> void:
	_t += delta
	if not _drag:
		_spin = lerp_angle(_spin, 0.55 + sin(_t * 0.25) * 0.12, delta * 1.5)
	_stage.rotation.y = PI + _spin
	if _fighter and _fighter.aim:
		_raise = move_toward(_raise, 0.0, delta * 0.9)
		var breathe := sin(_t * 1.6) * 0.012
		_fighter.aim.pitch = lerpf(-0.62, -0.05, smoothstep(0.0, 1.0, _raise)) + breathe
		_fighter.aim.lean = sin(_t * 0.8) * 0.01


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventScreenTouch:
		_drag = (event as InputEventScreenTouch).pressed
	elif event is InputEventScreenDrag:
		_spin += (event as InputEventScreenDrag).relative.x * 0.008
	elif event is InputEventMouseButton and (event as InputEventMouseButton).button_index == MOUSE_BUTTON_LEFT:
		_drag = (event as InputEventMouseButton).pressed
	elif event is InputEventMouseMotion and _drag:
		_spin += (event as InputEventMouseMotion).relative.x * 0.008


# ------------------------------------------------------------------ UI

func _label(text: String, size: int, color := Color.WHITE) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", color)
	l.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return l


func _button(text: String, size: int, min_size: Vector2, accent := false) -> Button:
	var b := Button.new()
	b.text = text
	b.custom_minimum_size = min_size
	b.add_theme_font_size_override("font_size", size)
	b.focus_mode = Control.FOCUS_NONE
	for state: String in ["normal", "hover", "pressed"]:
		var sb := StyleBoxFlat.new()
		var base := Color(0.86, 0.24, 0.14) if accent else Color(1, 1, 1, 0.08)
		if state == "hover":
			base = base.lightened(0.12)
		elif state == "pressed":
			base = base.darkened(0.15)
		sb.bg_color = base
		sb.set_corner_radius_all(10)
		sb.border_color = Color(1, 1, 1, 0.25 if not accent else 0.0)
		sb.set_border_width_all(0 if accent else 2)
		sb.content_margin_left = 16
		sb.content_margin_right = 16
		b.add_theme_stylebox_override(state, sb)
	return b


func _selector(title: String, on_step: Callable) -> Label:
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 6)
	box.add_child(_label(title, 18, Color(1, 1, 1, 0.55)))
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 12)
	var prev := _button("◀", 26, Vector2(64, 60))
	prev.pressed.connect(on_step.bind(-1))
	row.add_child(prev)
	var value := _label("", 30)
	value.custom_minimum_size = Vector2(250, 0)
	value.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	value.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(value)
	var next := _button("▶", 26, Vector2(64, 60))
	next.pressed.connect(on_step.bind(1))
	row.add_child(next)
	box.add_child(row)
	_panel.add_child(box)
	return value


var _panel: VBoxContainer


func _build_ui() -> void:
	var layer := CanvasLayer.new()
	add_child(layer)
	var root := Control.new()
	root.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	layer.add_child(root)
	_panel = VBoxContainer.new()
	_panel.set_anchors_preset(Control.PRESET_LEFT_WIDE)
	_panel.offset_left = 90
	_panel.offset_right = 520
	_panel.offset_top = 70
	_panel.offset_bottom = -60
	_panel.add_theme_constant_override("separation", 20)
	_panel.mouse_filter = Control.MOUSE_FILTER_IGNORE
	root.add_child(_panel)
	_panel.add_child(_label("DUSHANBE", 76))
	var sub := _label("БОЕВОЙ ПОЛИГОН", 22, Color(0.92, 0.36, 0.2))
	_panel.add_child(sub)
	var gap := Control.new()
	gap.custom_minimum_size = Vector2(0, 26)
	_panel.add_child(gap)
	_name_lbl = _selector("БОЕЦ", _step_char)
	_desc_lbl = _label("", 18, Color(1, 1, 1, 0.7))
	_panel.add_child(_desc_lbl)
	_weapon_lbl = _selector("ОРУЖИЕ", _step_weapon)
	var spacer := Control.new()
	spacer.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_panel.add_child(spacer)
	_stats_lbl = _label("", 18, Color(1, 1, 1, 0.6))
	_panel.add_child(_stats_lbl)
	var play := _button("ИГРАТЬ", 34, Vector2(404, 84), true)
	play.pressed.connect(_play)
	_panel.add_child(play)
	var world := _button("Город (просмотр)", 20, Vector2(404, 54))
	world.pressed.connect(func() -> void: SceneLoader.change_scene("res://scenes/world/dushanbe_environment.tscn"))
	_panel.add_child(world)


func _step_char(step: int) -> void:
	_char_i = posmod(_char_i + step, CharacterCatalog.CHARACTERS.size())
	_show_fighter()


func _step_weapon(step: int) -> void:
	_weapon_i = posmod(_weapon_i + step, WeaponCatalog.WEAPONS.size())
	_show_fighter()


func _play() -> void:
	CombatState.save()
	SceneLoader.change_scene(ARENA_SCENE)
