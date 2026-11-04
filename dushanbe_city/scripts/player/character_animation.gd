class_name CharacterAnimation
extends Node
## Animation of the walking character (stage 4): builds and drives one AnimationTree.
##
## State machine (sm):
##   ground     idle <-> locomotion. Locomotion = Blend2(walk8, run):
##                walk8 = BlendSpace2D (sync) of walk / walk_back / strafe_left / strafe_right
##                        (CMU 16_16, 136_25, 113_18) on a normalised 1-cycle timeline, all starting at
##                        a left-foot strike -> phase-aligned blends, playback rate = speed / stride;
##                run   = BlendSpace1D (sync) walk -> run (09_09) -> fast run (16_46).
##   stop_walk / stop_run  one-shot stops (CMU 16_33, 127_05), started at the phase whose captured
##              speed matches the current speed; the controller decelerates along the same curve.
##   jump_start -> air (tuck, blending to the landing-ready pose while falling) -> jump_land -> ground
##   swim       swim_idle <-> swim (Quaternius UAL, CC0)
##   interact / sit_enter / sit_exit / sit_idle   (UAL) car door, getting in / out, generic actions
## Root: + upper-body OneShot punch layer (jab / cross, UAL).
## Clips in the tree are referenced as m/<name> (player_mocap.res) and p/<name> (player_anims.res).

const MOCAP_LIB := "res://assets/characters/animations/player_mocap.res"
const ANIM_LIB := "res://assets/characters/animations/player_anims.res"
const UAL_CLIPS := ["punch_jab", "punch_cross", "swim", "swim_idle", "interact", "sit_enter", "sit_exit", "sit_idle", "pickup"]
const UPPER_BODY := ["Spine", "Chest", "UpperChest", "LeftShoulder", "LeftUpperArm",
	"LeftLowerArm", "LeftHand", "RightShoulder", "RightUpperArm", "RightLowerArm", "RightHand"]

var tree: AnimationTree
var playback: AnimationNodeStateMachinePlayback
var anim_player: AnimationPlayer
## metres per cycle of each locomotion clip, measured on our skeleton (data/mocap_report.json)
var stride := {"walk": 0.983 * 1.2362, "walk_back": 0.9, "strafe_left": 0.87, "strafe_right": 0.87,
	"run": 3.077 * 0.7412, "run_fast": 4.0 * 0.65}
var contact_speed := {"walk": 0.983, "run": 3.077, "run_fast": 4.0}
var stop_curves := {}           ## "stop_walk" / "stop_run" -> [[t, speed], ...]
var _stop_nodes := {}
var _punch_t := -1.0
var _punch_len := 0.0
var _punch_queue := false
var _punch_alt := false


func setup(model: Node3D, jump_height: float, gravity: float) -> void:
	anim_player = model.find_child("AnimationPlayer", true, false)
	if ResourceLoader.exists(ANIM_LIB) and not anim_player.has_animation_library(&"p"):
		anim_player.add_animation_library(&"p", load(ANIM_LIB))
	if ResourceLoader.exists(MOCAP_LIB) and not anim_player.has_animation_library(&"m"):
		anim_player.add_animation_library(&"m", load(MOCAP_LIB))
	_read_report()
	tree = AnimationTree.new()
	tree.name = "AnimationTree"
	tree.tree_root = _build_root()
	model.add_child(tree)
	tree.anim_player = tree.get_path_to(anim_player)
	tree.callback_mode_process = AnimationMixer.ANIMATION_CALLBACK_MODE_PROCESS_PHYSICS   # in step with movement
	tree.active = true
	playback = tree.get(&"parameters/sm/playback")
	playback.start(&"ground")
	tree.set(&"parameters/sm/air/hold/seek_request", 0.0)
	tree.set(&"parameters/sm/ground/idle/scale", 0.5)
	# stretch the captured air phase (0.408 s) over the real ballistic air time of our jump
	var v0 := sqrt(2.0 * gravity * jump_height)
	tree.set(&"parameters/sm/air/air/scale", 0.408 / (2.0 * v0 / gravity))


func _read_report() -> void:
	var f := "res://data/mocap_report.json"
	if not FileAccess.file_exists(f):
		return
	var r: Variant = JSON.parse_string(FileAccess.get_file_as_string(f))
	if not r is Dictionary:
		return
	for k in ["walk", "walk_back", "strafe_left", "strafe_right", "run", "run_fast"]:
		var e: Variant = r.get(k)
		if e is Dictionary and e.has("contact_speed") and e.has("cycle_s"):
			stride[k] = float(e["contact_speed"]) * float(e["cycle_s"])
			contact_speed[k] = float(e["contact_speed"])
	if not (r as Dictionary).has("run_fast"):
		stride["run_fast"] = stride["run"]               # no fast-run capture: the run clip covers it
		contact_speed["run_fast"] = float(contact_speed["run"]) + 1.0
	for k in ["stop_walk", "stop_run"]:
		var e2: Variant = r.get(k)
		if e2 is Dictionary:
			stop_curves[k] = e2["speed_curve"]


func clip(name: String) -> AnimationNodeAnimation:
	var a := AnimationNodeAnimation.new()
	a.animation = StringName(("p/" if name in UAL_CLIPS else "m/") + name)
	return a


func _cycle(name: String) -> AnimationNodeAnimation:
	var a := clip(name)
	a.use_custom_timeline = true
	a.timeline_length = 1.0
	a.stretch_time_scale = true
	a.loop_mode = Animation.LOOP_LINEAR
	return a


func _has(name: String) -> bool:
	return anim_player.has_animation(StringName("m/" + name))


func _build_root() -> AnimationNodeBlendTree:
	var sm := AnimationNodeStateMachine.new()
	# ---- ground: idle / walk8 / run
	var bt := AnimationNodeBlendTree.new()
	bt.add_node(&"idle_clip", clip("idle"), Vector2(-400, 0))
	var idle_ts := AnimationNodeTimeScale.new()                  # mocap standing loop: half speed
	bt.add_node(&"idle", idle_ts, Vector2(-200, 0))
	bt.connect_node(&"idle", 0, &"idle_clip")
	var w8 := AnimationNodeBlendSpace2D.new()
	w8.sync = true
	w8.min_space = Vector2(-1, -1)
	w8.max_space = Vector2(1, 1)
	w8.blend_mode = AnimationNodeBlendSpace2D.BLEND_MODE_INTERPOLATED
	w8.add_blend_point(_cycle("walk"), Vector2(0, 1), -1, &"fwd")
	w8.add_blend_point(_cycle("walk_back" if _has("walk_back") else "walk"), Vector2(0, -1), -1, &"back")
	w8.add_blend_point(_cycle("strafe_left" if _has("strafe_left") else "walk"), Vector2(-1, 0), -1, &"left")
	w8.add_blend_point(_cycle("strafe_right" if _has("strafe_right") else "walk"), Vector2(1, 0), -1, &"right")
	bt.add_node(&"walk8", w8, Vector2(-400, 200))
	var w_ts := AnimationNodeTimeScale.new()
	bt.add_node(&"wts", w_ts, Vector2(-200, 200))
	bt.connect_node(&"wts", 0, &"walk8")
	var rb := AnimationNodeBlendSpace1D.new()
	rb.sync = true
	rb.min_space = 0.0
	rb.max_space = 2.0
	rb.add_blend_point(_cycle("walk"), 0.0, -1, &"walk")
	rb.add_blend_point(_cycle("run"), 1.0, -1, &"run")
	rb.add_blend_point(_cycle("run_fast" if _has("run_fast") else "run"), 2.0, -1, &"run_fast")
	bt.add_node(&"run", rb, Vector2(-400, 400))
	var r_ts := AnimationNodeTimeScale.new()
	bt.add_node(&"rts", r_ts, Vector2(-200, 400))
	bt.connect_node(&"rts", 0, &"run")
	var loco := AnimationNodeBlend2.new()
	bt.add_node(&"loco", loco, Vector2(0, 300))
	bt.connect_node(&"loco", 0, &"wts")
	bt.connect_node(&"loco", 1, &"rts")
	var mix := AnimationNodeBlend2.new()
	bt.add_node(&"mix", mix, Vector2(200, 100))
	bt.connect_node(&"mix", 0, &"idle")
	bt.connect_node(&"mix", 1, &"loco")
	bt.connect_node(&"output", 0, &"mix")
	sm.add_node(&"ground", bt, Vector2(0, 0))
	# ---- stops (one-shots with a start offset set when entered)
	for k in ["stop_walk", "stop_run"]:
		if _has(k):
			var n := clip(k)
			n.use_custom_timeline = true
			n.loop_mode = Animation.LOOP_NONE
			n.stretch_time_scale = false
			_stop_nodes[k] = n
			sm.add_node(StringName(k), n, Vector2(300, 300 if k == "stop_walk" else 400))
	# ---- jump phases
	var air := AnimationNodeBlendTree.new()
	var land_pose := clip("jump_land")                          # frame 0 = legs extended for touchdown
	var hold := AnimationNodeTimeSeek.new()
	var air_mix := AnimationNodeBlend2.new()
	air.add_node(&"air_clip", clip("jump_air"), Vector2(-200, 0))
	var air_ts := AnimationNodeTimeScale.new()
	air.add_node(&"air", air_ts, Vector2(0, 0))
	air.connect_node(&"air", 0, &"air_clip")
	air.add_node(&"landpose", land_pose, Vector2(0, 200))
	air.add_node(&"hold", hold, Vector2(200, 200))
	air.add_node(&"fallmix", air_mix, Vector2(400, 100))
	air.connect_node(&"hold", 0, &"landpose")
	air.connect_node(&"fallmix", 0, &"air")
	air.connect_node(&"fallmix", 1, &"hold")
	air.connect_node(&"output", 0, &"fallmix")
	sm.add_node(&"jump_start", clip("jump_start"), Vector2(300, -150))
	sm.add_node(&"air", air, Vector2(600, -150))
	sm.add_node(&"jump_land", clip("jump_land"), Vector2(600, 150))
	# ---- swimming
	var swim := AnimationNodeBlendTree.new()
	swim.add_node(&"idle", clip("swim_idle"), Vector2(-200, 0))
	swim.add_node(&"fwd", clip("swim"), Vector2(-200, 200))
	var swim_ts := AnimationNodeTimeScale.new()
	swim.add_node(&"ts", swim_ts, Vector2(0, 200))
	swim.connect_node(&"ts", 0, &"fwd")
	var swim_mix := AnimationNodeBlend2.new()
	swim.add_node(&"move", swim_mix, Vector2(200, 100))
	swim.connect_node(&"move", 0, &"idle")
	swim.connect_node(&"move", 1, &"ts")
	swim.connect_node(&"output", 0, &"move")
	sm.add_node(&"swim", swim, Vector2(300, 600))
	# ---- interactions (car door, sitting down / getting up, generic use)
	for k in ["interact", "sit_enter", "sit_exit", "sit_idle", "pickup"]:
		var c := clip(k)
		if k != "sit_idle":
			c.loop_mode = Animation.LOOP_NONE
		sm.add_node(StringName(k), c, Vector2(900, 100 * ["interact", "sit_enter", "sit_exit", "sit_idle", "pickup"].find(k)))
	var start := AnimationNodeStateMachineTransition.new()
	start.advance_mode = AnimationNodeStateMachineTransition.ADVANCE_MODE_AUTO
	sm.add_transition(&"Start", &"ground", start)
	var links := [[&"ground", &"jump_start", 0.08], [&"ground", &"air", 0.25], [&"jump_start", &"air", 0.3],
		[&"jump_start", &"jump_land", 0.1], [&"air", &"jump_land", 0.08], [&"jump_land", &"ground", 0.3],
		[&"jump_land", &"jump_start", 0.1], [&"jump_start", &"ground", 0.2], [&"air", &"ground", 0.2],
		[&"ground", &"swim", 0.45], [&"air", &"swim", 0.3], [&"jump_start", &"swim", 0.3], [&"jump_land", &"swim", 0.3],
		[&"swim", &"ground", 0.45]]
	for k in _stop_nodes:
		links += [[&"ground", StringName(k), 0.2], [StringName(k), &"ground", 0.3], [StringName(k), &"jump_start", 0.1],
			[StringName(k), &"air", 0.25], [StringName(k), &"swim", 0.3]]
	for k in ["interact", "sit_enter", "sit_exit", "sit_idle", "pickup"]:
		links += [[&"ground", StringName(k), 0.2], [StringName(k), &"ground", 0.35]]
	links += [[&"interact", &"sit_enter", 0.2], [&"sit_enter", &"sit_idle", 0.2], [&"sit_idle", &"sit_exit", 0.2]]
	for l in links:
		var t := AnimationNodeStateMachineTransition.new()
		t.xfade_time = l[2]
		t.switch_mode = AnimationNodeStateMachineTransition.SWITCH_MODE_IMMEDIATE
		sm.add_transition(l[0], l[1], t)
	# ---- root: state machine + upper-body punch layer
	var root := AnimationNodeBlendTree.new()
	var punch := AnimationNodeOneShot.new()
	punch.fadein_time = 0.08
	punch.fadeout_time = 0.18
	punch.filter_enabled = true
	for b in UPPER_BODY:
		punch.set_filter_path(NodePath("%GeneralSkeleton:" + b), true)
	var which := AnimationNodeBlend2.new()
	root.add_node(&"sm", sm, Vector2(0, 0))
	root.add_node(&"jab", clip("punch_jab"), Vector2(0, 200))
	root.add_node(&"cross", clip("punch_cross"), Vector2(0, 300))
	root.add_node(&"which", which, Vector2(200, 250))
	root.add_node(&"punch", punch, Vector2(400, 100))
	root.connect_node(&"which", 0, &"jab")
	root.connect_node(&"which", 1, &"cross")
	root.connect_node(&"punch", 0, &"sm")
	root.connect_node(&"punch", 1, &"which")
	root.connect_node(&"output", 0, &"punch")
	return root


# ------------------------------------------------------------------------------------ driving
func travel(state: StringName) -> void:
	if playback and playback.get_current_node() != state:
		playback.travel(state)


func current() -> StringName:
	return playback.get_current_node() if playback else &""


## Ground locomotion. local_v: velocity in the body frame (x = right, y = forward, m/s);
## run_blend 0 = walk mode (8-way), 1 = run mode; step_turn > 0: turning on the spot (stepping).
func set_ground(local_v: Vector2, run_blend: float, step_turn: float) -> void:
	var sp := local_v.length()
	var dir := local_v / sp if sp > 0.01 else Vector2(0, 1)
	# walk8: direction in the blend space, rate = speed / stride of the blended clips
	var wf := maxf(dir.y, 0.0)
	var wb := maxf(-dir.y, 0.0)
	var ws := absf(dir.x)
	var tot := maxf(wf + wb + ws, 1e-3)
	var side_stride: float = stride["strafe_left"] if dir.x < 0.0 else stride["strafe_right"]
	var st: float = (wf * float(stride["walk"]) + wb * float(stride["walk_back"]) + ws * side_stride) / tot
	var wpos := dir
	var wrate := sp / st
	if step_turn > 0.0 and sp < 0.2:
		# turning on the spot: short side steps in the turning direction while the body rotates
		wpos = Vector2(signf(step_turn) * 0.8, 0.15)
		wrate = 0.85
	tree.set(&"parameters/sm/ground/walk8/blend_position", wpos)
	tree.set(&"parameters/sm/ground/wts/scale", maxf(wrate, 0.25))
	# run: 0 walk ... 1 run ... 2 fast run by speed; rate from the blended stride
	var rpos := 0.0
	if sp <= float(contact_speed["walk"]):
		rpos = 0.0
	elif sp <= float(contact_speed["run"]):
		rpos = (sp - float(contact_speed["walk"])) / (float(contact_speed["run"]) - float(contact_speed["walk"]))
	else:
		rpos = 1.0 + clampf((sp - float(contact_speed["run"])) / maxf(float(contact_speed["run_fast"]) - float(contact_speed["run"]), 0.1), 0.0, 1.0)
	var rs: float
	if rpos <= 1.0:
		rs = lerpf(float(stride["walk"]), float(stride["run"]), rpos)
	else:
		rs = lerpf(float(stride["run"]), float(stride["run_fast"]), rpos - 1.0)
	tree.set(&"parameters/sm/ground/run/blend_position", rpos)
	tree.set(&"parameters/sm/ground/rts/scale", maxf(sp, 0.35) / rs)
	tree.set(&"parameters/sm/ground/loco/blend_amount", run_blend)
	var moving := clampf(sp / 0.4, 0.0, 1.0)
	if step_turn > 0.0:
		moving = maxf(moving, 0.75)
	tree.set(&"parameters/sm/ground/mix/blend_amount", moving)


## Stop: start the clip at the phase whose captured speed first drops to `speed`; returns the
## remaining length (s), or -1 if there is no stop clip.
func play_stop(kind: String, speed: float) -> float:
	if not _stop_nodes.has(kind) or not stop_curves.has(kind):
		return -1.0
	var curve: Array = stop_curves[kind]
	var t0 := 0.0
	for e in curve:
		if float(e[1]) <= speed:
			t0 = float(e[0])
			break
	var n: AnimationNodeAnimation = _stop_nodes[kind]
	var an := anim_player.get_animation(StringName("m/" + kind))
	n.start_offset = t0
	n.timeline_length = maxf(an.length - t0, 0.1)
	travel(StringName(kind))
	return an.length - t0


## captured speed of a stop clip at time t (the controller follows it -> planted feet)
func stop_speed(kind: String, t: float) -> float:
	var curve: Array = stop_curves.get(kind, [])
	if curve.is_empty():
		return 0.0
	for i in curve.size() - 1:
		if float(curve[i + 1][0]) >= t:
			var a: Array = curve[i]
			var b: Array = curve[i + 1]
			return lerpf(float(a[1]), float(b[1]), clampf((t - float(a[0])) / maxf(float(b[0]) - float(a[0]), 1e-3), 0.0, 1.0))
	return float(curve[-1][1])


func set_fall(amount: float) -> void:
	tree.set(&"parameters/sm/air/fallmix/blend_amount", amount)


func set_swim(speed: float, swim_speed: float) -> void:
	tree.set(&"parameters/sm/swim/move/blend_amount", clampf(speed / 0.5, 0.0, 1.0))
	tree.set(&"parameters/sm/swim/ts/scale", clampf(0.6 + speed / swim_speed * 0.5, 0.6, 1.6))


func clip_length(name: String) -> float:
	var key := StringName(("p/" if name in UAL_CLIPS else "m/") + name)
	return anim_player.get_animation(key).length if anim_player.has_animation(key) else 0.0


# ------------------------------------------------------------------------------------ punches
func request_punch() -> void:
	if _punch_t < 0.0:
		_start_punch()
	elif _punch_t > _punch_len * 0.45:
		_punch_queue = true


func _start_punch() -> void:
	_punch_alt = not _punch_alt
	var cross := not _punch_alt
	tree.set(&"parameters/which/blend_amount", 1.0 if cross else 0.0)
	_punch_len = anim_player.get_animation(&"p/punch_cross" if cross else &"p/punch_jab").length * 0.85
	tree.set(&"parameters/punch/request", AnimationNodeOneShot.ONE_SHOT_REQUEST_FIRE)
	_punch_t = 0.0
	_punch_queue = false


func is_punching() -> bool:
	return _punch_t >= 0.0


func tick(delta: float) -> void:
	if _punch_t >= 0.0:
		_punch_t += delta
		if _punch_t >= _punch_len:
			_punch_t = -1.0
			if _punch_queue:
				_start_punch()
