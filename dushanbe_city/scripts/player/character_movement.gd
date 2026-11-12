class_name CharacterMovement
extends RefCounted
## Obstacle handling of the CharacterBody3D (stage 4 component, logic unchanged since v0.4 tests):
## * try_step_up: automatic step-up of curbs / stairs / small ledges (<= step_height) as a 3-phase
##   sweep of the real collider: UP (stops under a low ceiling), FORWARD (still blocked -> wall),
##   DOWN onto the top. Accepted only if the top is walkable, the tread is >= step_min_tread deep
##   (no climbing rails / wall edges) and the body fits standing on it. The body is placed
##   STEP_OVERLAP onto the top; the model and camera absorb the lift smoothly (visual offsets).
## * snap_down: step DOWN off curbs / stairs without free-falling (Godot's floor snap rejects a
##   collider resting on a step EDGE); accepted if the surface under the contact is walkable.
## Slopes: CharacterBody3D floor_max_angle = max_slope_deg (+0.5), floor_constant_speed,
## floor_stop_on_slope, floor_block_on_wall (set by the controller).

const STEP_OVERLAP := 0.08

var body: CharacterBody3D
var cfg: CharacterConfig
var last_step_height := 0.0


func _init(b: CharacterBody3D, c: CharacterConfig) -> void:
	body = b
	cfg = c


## returns [lift (Vector3), nudge (Vector3)] applied, or [] if no step was taken
func try_step_up(motion: Vector3) -> Array:
	var dir := motion.normalized()
	var probe := dir * maxf(motion.length(), 0.02)
	var xf := body.global_transform
	var col := KinematicCollision3D.new()
	if not body.test_move(xf, probe, col, 0.001):
		return []
	if col.get_normal().y > cos(body.floor_max_angle):
		return []                                       # walkable slope: move_and_slide handles it
	var rise := cfg.step_height + 0.02
	var up_col := KinematicCollision3D.new()
	if body.test_move(xf, Vector3.UP * rise, up_col, 0.001):
		rise = up_col.get_travel().length() - 0.005     # low ceiling: only what fits under it
		if rise < 0.03:
			return []
	var raised := xf.translated(Vector3.UP * rise)
	var onto := col.get_travel() + dir * STEP_OVERLAP
	if body.test_move(raised, onto, null, 0.001):
		return []                                       # still blocked at max step height: a wall
	var ahead := raised.translated(onto)
	var down_col := KinematicCollision3D.new()
	if not body.test_move(ahead, Vector3.DOWN * (rise + 0.05), down_col, 0.001):
		return []                                       # nothing to stand on (a gap)
	var h := rise - down_col.get_travel().length()
	if h < 0.01 or h > cfg.step_height + 0.005:
		return []
	var edge := col.get_position()
	var space := body.get_world_3d().direct_space_state
	var top_y := xf.origin.y + h
	var tread_pt := Vector3(edge.x, 0.0, edge.z) + dir * cfg.step_min_tread
	var ray := PhysicsRayQueryParameters3D.create(Vector3(tread_pt.x, top_y + 0.1, tread_pt.z),
			Vector3(tread_pt.x, top_y - 0.06, tread_pt.z), body.collision_mask, [body.get_rid()])
	var hit := space.intersect_ray(ray)
	if hit.is_empty() or (hit.normal as Vector3).y < cos(body.floor_max_angle) or absf((hit.position as Vector3).y - top_y) > 0.05:
		return []
	var lift := Vector3.UP * (h + 0.005)
	if body.test_move(xf.translated(lift + onto), Vector3.ZERO, null, 0.001):
		return []                                       # no room to stand on the step
	body.global_position += lift + onto
	last_step_height = h
	return [lift, onto]


func snap_down() -> bool:
	var col := KinematicCollision3D.new()
	if not body.test_move(body.global_transform, Vector3.DOWN * (cfg.step_height + 0.05), col, 0.001):
		return false                                  # real ledge: fall
	var p := col.get_position()
	var hit := body.get_world_3d().direct_space_state.intersect_ray(PhysicsRayQueryParameters3D.create(
			p + Vector3.UP * 0.05, p + Vector3.DOWN * 0.05, body.collision_mask, [body.get_rid()]))
	if hit.is_empty() or (hit.normal as Vector3).y < cos(body.floor_max_angle):
		return false
	body.global_position += col.get_travel()
	body.velocity.y = 0.0
	return true
