class_name AnimRetarget
extends RefCounted
## Runtime retargeting of the shared rifle animation pack onto any Mixamo-style
## skeleton, whatever its bind pose (T or A), bone roll, scale or node hierarchy.
##
## Method: world-space delta from a common reference pose. The pack's rest pose
## (a T-pose) is the reference; for the target a virtual T-pose is computed by
## swinging every limb bone onto the pack's bone direction. A source local
## rotation q_s then maps to
##   q_t = Rref_t(parent)^-1 * Ws(parent) * q_s * Ws(bone)^-1 * Rref_t(bone)

const PACK_PATH := "res://assets/animations/rifle_pack.glb"
const LOOPS: PackedStringArray = ["shoot", "idle", "walk", "run", "crouch_idle", "crouch_walk", "prone_idle", "prone_walk"]
## Pack name -> game name.
const RENAME := {
	"idle simple": "idle", "simple walk": "walk", "run": "run", "jump": "jump",
	"simple shoot": "shoot", "reload idle": "reload", "reload walk": "reload_walk", "reload run": "reload_run",
	"simple death": "death", "crouch idle": "crouch_idle", "walk crouch": "crouch_walk",
	"crouch shoot": "crouch_shoot", "reload crouch": "crouch_reload", "crouch death": "crouch_death",
	"idle simple to crouch": "to_crouch", "simple to crouch": "to_crouch_b",
	"crouch to pron": "to_prone", "pron to crouch": "prone_to_crouch", "pron idle": "prone_idle",
	"pron walk": "prone_walk", "pron shot": "prone_shoot", "pron reload": "prone_reload", "pron death": "prone_death",
}
## Bone -> child that defines its direction in the reference pose.
const DIR_CHILD := {
	"Spine": "Spine1", "Spine1": "Spine2", "Spine2": "Neck", "Neck": "Head", "Head": "HeadTop_End",
	"LeftShoulder": "LeftArm", "LeftArm": "LeftForeArm", "LeftForeArm": "LeftHand", "LeftHand": "LeftHandMiddle1",
	"RightShoulder": "RightArm", "RightArm": "RightForeArm", "RightForeArm": "RightHand", "RightHand": "RightHandMiddle1",
	"LeftUpLeg": "LeftLeg", "LeftLeg": "LeftFoot", "LeftFoot": "LeftToeBase",
	"RightUpLeg": "RightLeg", "RightLeg": "RightFoot", "RightFoot": "RightToeBase",
}

static var _pack: Dictionary = {}


## "mixamorig_LeftArm_09" / "mixamorig:LeftArm" -> "LeftArm".
static func canon(bone_name: String) -> String:
	var n := bone_name
	var i := n.find("mixamorig")
	if i >= 0:
		n = n.substr(i + 9).lstrip(":_0123456789")
	var j := n.length()
	while j > 0 and n[j - 1].is_valid_int():
		j -= 1
	if j < n.length() and j > 0 and n[j - 1] == "_":
		n = n.substr(0, j - 1)
	return n


static func bone_map(skel: Skeleton3D) -> Dictionary:
	var m := {}
	for i in skel.get_bone_count():
		var c := canon(skel.get_bone_name(i))
		if not m.has(c):
			m[c] = i
	return m


## Transform of `node` relative to `root` (works outside the scene tree).
static func rel_xform(node: Node3D, root: Node) -> Transform3D:
	var t := Transform3D.IDENTITY
	var n: Node = node
	while n != null and n != root:
		if n is Node3D:
			t = (n as Node3D).transform * t
		n = n.get_parent()
	return t


## Rest pose analysis of one skeleton in its model-root space.
static func analyse(skel: Skeleton3D, root: Node) -> Dictionary:
	var x := rel_xform(skel, root)
	var map := bone_map(skel)
	var world: Array[Transform3D] = []
	for i in skel.get_bone_count():
		world.append(x * skel.get_bone_global_rest(i))
	var info := {"x": x, "map": map, "world": world}
	var foot_y := INF
	for n: String in ["LeftToeBase", "RightToeBase", "LeftFoot", "RightFoot"]:
		if map.has(n):
			foot_y = minf(foot_y, world[map[n]].origin.y)
	var hips: Vector3 = world[map["Hips"]].origin
	var up: Vector3 = (world[map["Spine"]].origin - hips).normalized()
	var right: Vector3 = (world[map["RightUpLeg"]].origin - world[map["LeftUpLeg"]].origin).normalized()
	var fwd := up.cross(right).normalized()
	right = fwd.cross(up).normalized()
	info["frame"] = Basis(right, up, fwd)
	info["forward"] = fwd
	# Toe/ankle joints sit above the sole; 6% of leg length is a good sole estimate.
	info["foot_y"] = foot_y - (hips.y - foot_y) * 0.06
	info["hips"] = hips
	var top: Vector3 = world[map["Head"]].origin
	if map.has("HeadTop_End"):
		top = world[map["HeadTop_End"]].origin
	else:
		top += Vector3.UP * (top.y - hips.y) * 0.3
	info["top_y"] = top.y
	return info


static func _rot(t: Transform3D) -> Quaternion:
	return t.basis.orthonormalized().get_rotation_quaternion()


static func _arc(a: Vector3, b: Vector3) -> Quaternion:
	a = a.normalized()
	b = b.normalized()
	var d := a.dot(b)
	if d > 0.99999:
		return Quaternion.IDENTITY
	if d < -0.99999:
		var axis := a.cross(Vector3.UP)
		if axis.length_squared() < 0.0001:
			axis = a.cross(Vector3.RIGHT)
		return Quaternion(axis.normalized(), PI)
	return Quaternion(a.cross(b).normalized(), acos(d))


static func _load_pack() -> void:
	if not _pack.is_empty():
		return
	var scene := (load(PACK_PATH) as PackedScene).instantiate()
	var skel := scene.find_child("Skeleton3D", true, false) as Skeleton3D
	var player := scene.find_child("AnimationPlayer", true, false) as AnimationPlayer
	var info := analyse(skel, scene)
	var parents := PackedInt32Array()
	var names := PackedStringArray()
	for i in skel.get_bone_count():
		parents.append(skel.get_bone_parent(i))
		names.append(canon(skel.get_bone_name(i)))
	var anims := {}
	for a in player.get_animation_list():
		if RENAME.has(String(a)):
			anims[RENAME[String(a)]] = player.get_animation(a)
	_pack = {"info": info, "parents": parents, "names": names, "anims": anims, "skel_path": String(player.get_node(player.root_node).get_path_to(skel))}
	scene.free()


static func pack_forward() -> Vector3:
	_load_pack()
	return (_pack["info"] as Dictionary)["forward"]


## Builds the animation library for `skel`. Track paths are relative to the
## skeleton's parent ("Skeleton3D:Bone").
static func build_library(skel: Skeleton3D, model_root: Node, tinfo: Dictionary) -> AnimationLibrary:
	_load_pack()
	var sinfo: Dictionary = _pack["info"]
	var smap: Dictionary = sinfo["map"]
	var sworld: Array[Transform3D] = sinfo["world"]
	var sparents: PackedInt32Array = _pack["parents"]
	var tmap: Dictionary = tinfo["map"]
	var tworld: Array[Transform3D] = tinfo["world"]
	var tx: Transform3D = tinfo["x"]
	var sx: Transform3D = sinfo["x"]

	# --- virtual T-pose of the target: Rref[b] = A[b] * rest_world_rot[b]
	var count := skel.get_bone_count()
	var align: Array[Quaternion] = []
	align.resize(count)
	var a_hips := ((sinfo["frame"] as Basis) * (tinfo["frame"] as Basis).inverse()).get_rotation_quaternion()
	var inv_canon := {}
	for c: String in tmap:
		inv_canon[tmap[c]] = c
	for i in count:  # parents always precede children in Skeleton3D
		var p := skel.get_bone_parent(i)
		var a := Quaternion.IDENTITY if p < 0 else align[p]
		var c: String = inv_canon.get(i, "")
		if c == "Hips":
			a = a_hips
		elif DIR_CHILD.has(c) and tmap.has(DIR_CHILD[c]) and smap.has(c) and smap.has(DIR_CHILD[c]):
			var ch: String = DIR_CHILD[c]
			var d_t: Vector3 = a * (tworld[tmap[ch]].origin - tworld[i].origin)
			var d_s: Vector3 = sworld[smap[ch]].origin - sworld[smap[c]].origin
			a = _arc(d_t, d_s) * a
		align[i] = a
	var ref: Array[Quaternion] = []
	for i in count:
		ref.append(align[i] * _rot(tworld[i]))
	var x_rot_t := _rot(tx)
	var x_rot_s := _rot(sx)

	var k: float = (tinfo["hips"].y - tinfo["foot_y"]) / (sinfo["hips"].y - sinfo["foot_y"])
	var skel_node_path := String(skel.name)
	var lib := AnimationLibrary.new()
	var src_prefix: String = String(_pack["skel_path"]) + ":"
	var anims: Dictionary = _pack["anims"]
	var snames: PackedStringArray = _pack["names"]
	for anim_name: String in anims:
		var src: Animation = anims[anim_name]
		var dst := Animation.new()
		dst.length = src.length
		dst.loop_mode = Animation.LOOP_LINEAR if anim_name in LOOPS else Animation.LOOP_NONE
		var covered := {}
		for ti in src.get_track_count():
			var path := String(src.track_get_path(ti))
			var colon := path.rfind(":")
			if colon < 0:
				continue
			var c := canon(path.substr(colon + 1))
			if not tmap.has(c) or not smap.has(c):
				continue
			var sb: int = smap[c]
			var tb: int = tmap[c]
			var tpath := NodePath("%s:%s" % [skel_node_path, skel.get_bone_name(tb)])
			var sp := sparents[sb]
			var tp := skel.get_bone_parent(tb)
			var ws_parent := x_rot_s if sp < 0 else _rot(sworld[sp])
			var ref_parent := x_rot_t if tp < 0 else ref[tp]
			match src.track_get_type(ti):
				Animation.TYPE_ROTATION_3D:
					var pre := ref_parent.inverse() * ws_parent
					var post := _rot(sworld[sb]).inverse() * ref[tb]
					var nt := dst.add_track(Animation.TYPE_ROTATION_3D)
					dst.track_set_path(nt, tpath)
					for ki in src.track_get_key_count(ti):
						var q: Quaternion = src.track_get_key_value(ti, ki)
						dst.rotation_track_insert_key(nt, src.track_get_key_time(ti, ki), (pre * q * post).normalized())
					covered[tb] = true
				Animation.TYPE_POSITION_3D:
					if c != "Hips":
						continue
					var sparent_full := sx if sp < 0 else sworld[sp]
					var tparent_full := tx if tp < 0 else tworld[tp]
					var inv_tp := tparent_full.affine_inverse()
					var nt := dst.add_track(Animation.TYPE_POSITION_3D)
					dst.track_set_path(nt, tpath)
					var n := src.track_get_key_count(ti)
					var first: Vector3 = sparent_full * (src.track_get_key_value(ti, 0) as Vector3)
					var last: Vector3 = sparent_full * (src.track_get_key_value(ti, n - 1) as Vector3)
					var looped := dst.loop_mode != Animation.LOOP_NONE
					for ki in n:
						var t := src.track_get_key_time(ti, ki)
						var w: Vector3 = sparent_full * (src.track_get_key_value(ti, ki) as Vector3)
						if looped:  # strip root motion drift so loops stay in place
							var f := t / maxf(src.length, 0.001)
							w.x -= lerpf(first.x, last.x, f)
							w.z -= lerpf(first.z, last.z, f)
						var m := Vector3(w.x * k, tinfo["foot_y"] + (w.y - sinfo["foot_y"]) * k, w.z * k)
						dst.position_track_insert_key(nt, t, inv_tp * m)
		# Bones the clip does not animate stay in the reference pose, not the bind pose.
		for c: String in tmap:
			var tb: int = tmap[c]
			if covered.has(tb) or not smap.has(c):
				continue
			var tp := skel.get_bone_parent(tb)
			var ref_parent := x_rot_t if tp < 0 else ref[tp]
			var sb: int = smap[c]
			var sp := sparents[sb]
			var ws_parent := x_rot_s if sp < 0 else _rot(sworld[sp])
			var q_rest := ws_parent.inverse() * _rot(sworld[sb])
			var nt := dst.add_track(Animation.TYPE_ROTATION_3D)
			dst.track_set_path(nt, NodePath("%s:%s" % [skel_node_path, skel.get_bone_name(tb)]))
			dst.rotation_track_insert_key(nt, 0.0, (ref_parent.inverse() * ws_parent * q_rest * _rot(sworld[sb]).inverse() * ref[tb]).normalized())
		lib.add_animation(anim_name, dst)
	return lib
