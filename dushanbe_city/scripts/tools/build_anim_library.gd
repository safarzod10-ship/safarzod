extends SceneTree
## Extracts the animations the player needs from the retargeted Quaternius UAL import into
## res://assets/characters/animations/player_anims.res (AnimationLibrary). Tracks already use
## %GeneralSkeleton:<HumanoidBone>, so they apply to the retargeted player skeleton.
const PICK := {
	"idle": "Idle", "walk": "Walk", "jog": "Jog_Fwd", "sprint": "Sprint",
	"jump_start": "Jump_Start", "jump_air": "Jump", "jump_land": "Jump_Land",
	"punch_jab": "Punch_Jab", "punch_cross": "Punch_Cross", "punch_enter": "Punch_Enter",
	"swim": "Swim_Fwd", "swim_idle": "Swim_Idle",
}
const LOOPS := ["idle", "walk", "jog", "sprint", "jump_air", "swim", "swim_idle"]

func _init() -> void:
	var n: Node = (load("res://assets/characters/animations/ual_standard.glb") as PackedScene).instantiate()
	var ap: AnimationPlayer = n.find_children("*", "AnimationPlayer", true, false)[0]
	print("available: ", ap.get_animation_list())
	var lib := AnimationLibrary.new()
	for k in PICK:
		var src: String = PICK[k]
		if not ap.has_animation(src):
			for cand in ap.get_animation_list():
				if String(cand).begins_with(src):
					src = cand
					break
		if not ap.has_animation(src):
			print("MISSING ", PICK[k])
			continue
		var a := ap.get_animation(src).duplicate(true) as Animation
		# drop the Root bone track (no root motion; character controller moves the body)
		for t in range(a.get_track_count() - 1, -1, -1):
			if String(a.track_get_path(t)).ends_with(":Root"):
				a.remove_track(t)
		a.loop_mode = Animation.LOOP_LINEAR if k in LOOPS else Animation.LOOP_NONE
		lib.add_animation(k, a)
		print("  ", k, " <- ", src, " len=", snappedf(a.length, 0.001), " tracks=", a.get_track_count())
	ResourceSaver.save(lib, "res://assets/characters/animations/player_anims.res")
	n.free()
	print("ANIMLIB_DONE")
	quit()
