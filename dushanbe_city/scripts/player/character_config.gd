class_name CharacterConfig
extends Resource
## All tunable parameters of the walking character in one place (stage 4). The controller and its
## components read from here; a .tres can override them (res://assets/characters/player/config.tres).

@export_group("Speeds (m/s)")
@export var walk_speed := 1.0           ## forward walk (CMU 16_16, contact speed 0.98 m/s)
@export var back_speed := 0.55          ## walking backwards (CMU 136_25, natural 0.52 m/s)
@export var strafe_speed := 0.6         ## side steps (CMU 113_18, natural 0.53-0.59 m/s)
@export var run_speed := 4.5            ## run (CMU 09_09 3.08 m/s blended with 16_46 fast run)
@export var swim_speed := 1.1
@export var swim_fast_speed := 1.7

@export_group("Acceleration (m/s^2)")
@export var walk_accel := 2.6           ## 0 -> 1 m/s in ~0.4 s (start walk)
@export var walk_decel := 3.2
@export var run_accel := 5.5            ## 1 -> 4.5 m/s in ~0.65 s (start run)
@export var run_decel := 6.0
@export var air_control := 0.25
@export var turn_rate := 9.0            ## 1/s, exponential heading smoothing while moving
@export var turn_in_place_rate := 4.5   ## rad/s when turning on the spot (stepping animation)

@export_group("Jump / gravity")
@export var jump_height := 0.7          ## m (strong human standing jump)
@export var gravity := 9.8
@export var takeoff_time := 0.25        ## push-off before the feet leave the ground (s)
@export var coyote_time := 0.12
@export var jump_buffer := 0.15

@export_group("Obstacles")
@export var step_height := 0.30         ## max curb / step climbed automatically (0.40 is blocked)
@export var step_min_tread := 0.10      ## the top of a step must be at least this deep
@export var max_slope_deg := 40.0

@export_group("Feet")
@export var foot_ik := true             ## ground-adapted feet (2 rays per frame, near camera only)
@export var foot_ik_max_adjust := 0.22  ## m, max foot / pelvis correction

@export_group("Camera")
@export var camera_distance := 3.6
@export var camera_height := 1.55
@export var camera_fov := 68.0
@export var run_extra_distance := 0.55  ## pulled back a little while running
@export var run_fov_add := 5.0
@export var swim_camera_height := 1.15  ## above the surface while swimming (never under water)
@export var mouse_sensitivity := 0.0025
@export var touch_look_sensitivity := 0.0055   ## rad per 720p-pixel of swipe (UI setting scales it)
@export var pitch_min_deg := -65.0
@export var pitch_max_deg := 30.0
@export var collision_in_speed := 14.0  ## camera moves in fast when a wall comes between
@export var collision_out_speed := 2.5  ## and comes back slowly when the view clears
