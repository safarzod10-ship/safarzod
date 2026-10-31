extends Node
## PerformanceMonitor — collects real engine metrics. Nothing here is
## synthesised: every value comes from Engine / Performance / OS.
## Note: under --headless the dummy renderer draws nothing, so FPS and draw
## call numbers there do NOT describe mobile GPU performance.

signal sample_ready(sample: Dictionary)

const SAMPLE_INTERVAL := 0.5
const HISTORY := 120  # 60 s of samples

var history: Array[Dictionary] = []
var _accum := 0.0
var _frame_ms_max := 0.0


func _process(delta: float) -> void:
	_frame_ms_max = maxf(_frame_ms_max, delta * 1000.0)
	_accum += delta
	if _accum < SAMPLE_INTERVAL:
		return
	_accum = 0.0
	var s := take_sample()
	_frame_ms_max = 0.0
	history.append(s)
	if history.size() > HISTORY:
		history.pop_front()
	sample_ready.emit(s)


func take_sample() -> Dictionary:
	return {
		"fps": Engine.get_frames_per_second(),
		"frame_ms_worst": snappedf(_frame_ms_max, 0.01),
		"process_ms": snappedf(Performance.get_monitor(Performance.TIME_PROCESS) * 1000.0, 0.01),
		"physics_ms": snappedf(Performance.get_monitor(Performance.TIME_PHYSICS_PROCESS) * 1000.0, 0.01),
		"draw_calls": int(Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME)),
		"primitives": int(Performance.get_monitor(Performance.RENDER_TOTAL_PRIMITIVES_IN_FRAME)),
		"objects": int(Performance.get_monitor(Performance.RENDER_TOTAL_OBJECTS_IN_FRAME)),
		"video_mem_mb": snappedf(Performance.get_monitor(Performance.RENDER_VIDEO_MEM_USED) / 1048576.0, 0.1),
		"static_mem_mb": snappedf(Performance.get_monitor(Performance.MEMORY_STATIC) / 1048576.0, 0.1),
		"nodes": int(Performance.get_monitor(Performance.OBJECT_NODE_COUNT)),
		"time_msec": Time.get_ticks_msec(),
	}


## Min / average FPS over the stored history (empty dict if no samples yet).
func summary() -> Dictionary:
	if history.is_empty():
		return {}
	var total := 0.0
	var lo := INF
	for s in history:
		total += s["fps"]
		lo = minf(lo, s["fps"])
	return {"samples": history.size(), "fps_avg": snappedf(total / history.size(), 0.1), "fps_min": lo}
