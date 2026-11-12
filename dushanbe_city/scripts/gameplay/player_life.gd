class_name PlayerLife
extends Node
## The player's health (100). Explosions / falls take it; at 0 the player dies: «ВЫ ПОГИБЛИ», then
## wakes up at the nearest hospital (or the start point on the peninsula), paying 10 % of the money
## (max 500 smn) for the treatment. Health slowly comes back (1 / s after 8 s without damage).

static var health := 100.0
static var armor := 0.0                ## 0..100, like GTA: the vest takes most of the damage first
const ARMOR_PRICE := 600
static var dead := false
static var instance: PlayerLife

var session: CarSession
var _since_hit := 99.0
var _ui: CanvasLayer
var _label: Label
var _dim: ColorRect
var _grey: ColorRect            ## death: the screen turns grey (screen-reading shader)
var _black: ColorRect


func _ready() -> void:
	instance = self
	health = 100.0
	dead = false
	_ui = CanvasLayer.new()
	_ui.layer = 45
	add_child(_ui)
	_dim = ColorRect.new()
	_dim.color = Color(0.25, 0.0, 0.0, 0.0)
	_dim.set_anchors_preset(Control.PRESET_FULL_RECT)
	_dim.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_ui.add_child(_dim)
	_grey = ColorRect.new()
	_grey.set_anchors_preset(Control.PRESET_FULL_RECT)
	_grey.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var sh := Shader.new()
	sh.code = """shader_type canvas_item;
uniform sampler2D screen_tex : hint_screen_texture, filter_linear;
uniform float amount = 0.0;
void fragment() {
	vec3 c = texture(screen_tex, SCREEN_UV).rgb;
	float l = dot(c, vec3(0.299, 0.587, 0.114));
	vec3 g = vec3(l) * vec3(1.05, 0.98, 0.95);
	float v = 1.0 - smoothstep(0.35, 0.95, distance(SCREEN_UV, vec2(0.5)));
	COLOR = vec4(mix(c, g * mix(0.55, 1.0, v), amount), 1.0);
}"""
	var mat := ShaderMaterial.new()
	mat.shader = sh
	_grey.material = mat
	_grey.visible = false
	_ui.add_child(_grey)
	_black = ColorRect.new()
	_black.color = Color(0, 0, 0, 0)
	_black.set_anchors_preset(Control.PRESET_FULL_RECT)
	_black.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_ui.add_child(_black)
	_label = Label.new()
	_label.set_anchors_preset(Control.PRESET_CENTER)
	_label.offset_left = -500
	_label.offset_right = 500
	_label.offset_top = -80
	_label.offset_bottom = 80
	_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	_label.add_theme_font_override("font", HudStyle.font())
	_label.add_theme_font_size_override("font_size", 64)
	_label.add_theme_color_override("font_color", Color(0.85, 0.08, 0.08))
	_label.add_theme_color_override("font_outline_color", Color.BLACK)
	_label.add_theme_constant_override("outline_size", 14)
	_label.visible = false
	_ui.add_child(_label)


static var invulnerable := false       ## screenshots only

static func damage(amount: float) -> void:
	if instance == null or dead or amount <= 0.0 or invulnerable:
		return
	if armor > 0.0:
		var soak := minf(armor, amount * 0.75)
		armor -= soak
		amount -= soak
	health = maxf(0.0, health - amount)
	instance._since_hit = 0.0
	if health <= 0.0:
		instance._die()


func _process(delta: float) -> void:
	_since_hit += delta
	Food.tick(delta)
	if not dead and _since_hit > 8.0 and health < 100.0 and Food.ok_to_heal():
		health = minf(100.0, health + delta)
	if not dead:
		_dim.color.a = clampf((40.0 - health) / 40.0, 0.0, 1.0) * 0.35 + clampf(0.6 - _since_hit, 0.0, 0.6) * 0.4


## death as in the big open-world games: the world slows down (slow motion), the picture drains
## to grey, «ВЫ ПОГИБЛИ», fade to black, then the hospital
func _die() -> void:
	dead = true
	if session and session.driving:
		session.exit()
	_dim.color.a = 0.0
	_grey.visible = true
	(_grey.material as ShaderMaterial).set_shader_parameter("amount", 0.0)
	var tw := create_tween().set_ignore_time_scale(true)
	tw.tween_property(Engine, "time_scale", 0.2, 0.6)
	tw.parallel().tween_method(func(v: float) -> void: (_grey.material as ShaderMaterial).set_shader_parameter("amount", v), 0.0, 1.0, 1.2)
	await get_tree().create_timer(0.9, true, false, true).timeout
	_label.text = "ВЫ ПОГИБЛИ"
	_label.modulate.a = 0.0
	_label.visible = true
	var tw2 := create_tween().set_ignore_time_scale(true)
	tw2.tween_property(_label, "modulate:a", 1.0, 0.5)
	await get_tree().create_timer(2.6, true, false, true).timeout
	var tw3 := create_tween().set_ignore_time_scale(true)
	tw3.tween_property(_black, "color:a", 1.0, 0.8)
	await get_tree().create_timer(0.9, true, false, true).timeout
	Engine.time_scale = 1.0
	_grey.visible = false
	await _respawn()
	var tw4 := create_tween()
	tw4.tween_property(_black, "color:a", 0.0, 1.0)


## a point on the ground 4 m outside the building's wall, on the side that faces the nearest road
## (never on the roof: the footprint is the rotated L x D box, the height is the ground there)
static func _outside(wd: WorldData, b: Array) -> Vector3:
	var c := Vector2(float(b[1]), float(b[2]))
	var yaw := float(b[3])
	var hl := maxf(float(b[4]), float(b[5])) * 0.5     # the model's own axes may differ: clear the longer side
	var hd := hl
	var rt := Vector2(cos(yaw), -sin(yaw))
	var fw := Vector2(-sin(yaw), -cos(yaw))
	var best := Vector2.INF
	var bd := INF
	for cand: Vector2 in [c + fw * (hd + 4.0), c - fw * (hd + 4.0), c + rt * (hl + 4.0), c - rt * (hl + 4.0)]:
		var e := wd.road_edge_dist(cand.x, cand.y)
		if e < 0.5:
			continue                       # not on the carriageway
		if e < bd:
			bd = e
			best = cand
	if best == Vector2.INF:
		best = c + fw * (hd + 4.0)
	var y := wd.height_at(best.x, best.y)
	return Vector3(best.x, y + 0.3, best.y)


func _respawn() -> void:
	var p: Vector3 = HeroHome.instance.spawn_point() if HeroHome.instance else Vector3(-58, 2.4, -90)
	var player: Node3D = session.player if session else null
	if player:
		var best := INF
		var wd := WorldData.get_instance()
		if wd.ok:
			for b in wd.buildings:
				if b[0] == "hospital_m":
					var q := Vector3(b[1], b[8], b[2])
					var d := q.distance_to(player.global_position)
					if d < best:
						best = d
						p = _outside(wd, b)
		if best < INF:
			var ow: Variant = get_parent().get("open_world")
			if ow:
				(ow as OpenWorld).preload_at(p)
			await get_tree().physics_frame
		player.call("teleport", p, 0.0)
	# GTA: the hospital bill comes out of the cash in the pocket (10 %, up to 2000); the bank is safe
	var fee := mini(2000, Wallet.money / 10)
	Wallet.money -= fee
	Wallet.save_state()
	health = 100.0
	dead = false
	_label.text = "Больница: лечение −%s" % Wallet.fmt(fee) if fee > 0 else ""
	_dim.color.a = 0.0
	get_tree().create_timer(3.0, false).timeout.connect(func() -> void: _label.visible = false)
