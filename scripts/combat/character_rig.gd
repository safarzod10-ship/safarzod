class_name CharacterRig
extends Node3D
## Visual character: model normalised to HEIGHT metres, feet on the origin,
## facing -Z, with the retargeted animation library in `anim`.

const HEIGHT := 1.8

var char_id := ""
var model: Node3D
var skeleton: Skeleton3D
var anim: AnimationPlayer
var bones: Dictionary = {}
var model_scale := 1.0

static var _lib_cache: Dictionary = {}


static func create(id: String) -> CharacterRig:
	var rig := CharacterRig.new()
	rig._build(id)
	return rig


func _build(id: String) -> void:
	char_id = id
	name = "Rig_" + id
	var def := CharacterCatalog.get_def(id)
	model = (load(def["scene"]) as PackedScene).instantiate() as Node3D
	for n: String in def["hide"]:
		var node := model.find_child(n, true, false)
		if node:
			node.get_parent().remove_child(node)
			node.free()
	var old := model.find_child("AnimationPlayer", true, false)
	if old:
		old.get_parent().remove_child(old)
		old.free()
	skeleton = model.find_child("Skeleton3D", true, false) as Skeleton3D
	var info := AnimRetarget.analyse(skeleton, model)
	bones = info["map"]
	if not _lib_cache.has(id):
		_lib_cache[id] = AnimRetarget.build_library(skeleton, model, info)
	add_child(model)
	# Normalise: height, feet at y=0, pack-forward -> -Z.
	model_scale = HEIGHT / (float(info["top_y"]) - float(info["foot_y"]))
	var f := AnimRetarget.pack_forward()
	var yaw := atan2(f.x, f.z) + PI  # rotate so forward maps onto -Z
	model.transform = Transform3D(Basis(Vector3.UP, -yaw).scaled(Vector3.ONE * model_scale), Vector3.ZERO) \
		* Transform3D(Basis.IDENTITY, Vector3(-info["hips"].x, -float(info["foot_y"]), -info["hips"].z))
	anim = AnimationPlayer.new()
	anim.name = "Anim"
	skeleton.get_parent().add_child(anim)
	anim.root_node = NodePath("..")
	anim.add_animation_library("", _lib_cache[id])
	anim.playback_default_blend_time = 0.2
	for mi in model.find_children("*", "MeshInstance3D", true, false):
		(mi as MeshInstance3D).extra_cull_margin = 1.0  # skinned bounds lag behind animation


func bone(canon_name: String) -> int:
	return bones.get(canon_name, -1)


## Bone pose in this rig's local space.
func bone_xform(canon_name: String) -> Transform3D:
	var i := bone(canon_name)
	if i < 0:
		return Transform3D.IDENTITY
	return AnimRetarget.rel_xform(skeleton, self) * skeleton.get_bone_global_pose(i)
